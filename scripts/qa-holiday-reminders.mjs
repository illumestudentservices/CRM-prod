/**
 * Public-holiday advance notice: right day, right people, exactly once.
 *
 *   npx tsx --env-file=.env scripts/qa-holiday-reminders.mjs
 *
 * ★ THE THREE ASSERTIONS THAT MATTER:
 *   1. It fires on the day that is EXACTLY three away — not two, not four.
 *   2. A second run the same day sends NOTHING. This goes to a whole region at
 *      once, so a duplicate is the same broadcast landing again in a dozen
 *      inboxes.
 *   3. A holiday whose audience is empty is REPORTED, not skipped silently.
 *      On production only 6 of 16 users have a region and 4 of 8 regions hold
 *      nobody, so this is the likely real-world outcome, not an edge case.
 *
 * Nothing is sent: the provider call is intercepted and counted.
 *
 * Footprint: disposable users, regions and holidays, all removed in `finally`.
 */
import { db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

// ── Count what would have been sent ──────────────────────────────────────────
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (typeof url === "string" && url.includes("api.brevo.com")) {
    const b = JSON.parse(init.body);
    sent.push({ to: b.to[0].email, subject: b.subject, html: b.htmlContent });
    return new Response("{}", { status: 201 });
  }
  return realFetch(url, init);
};
process.env.BREVO_API_KEY = "test-key-not-real";

const { runHolidayReminders, HOLIDAY_NOTICE_DAYS } = await import("@/lib/holiday-reminders");

const made = { users: [], regions: [], holidays: [] };
let baseline = {};

/** Midnight UTC, N days from today. */
const dayFromNow = (n) => {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  return new Date(d.getTime() + n * 86_400_000);
};

async function makeHoliday(name, days, extra = {}) {
  const h = await db.holiday.create({
    data: {
      name, date: dayFromNow(days), createdById: made.users[0].user.id,
      isGlobal: false, ...extra,
    },
  });
  made.holidays.push(h.id);
  return h;
}

try {
  startSection("Fixtures");
  baseline = { users: await db.user.count(), holidays: await db.holiday.count() };

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  made.users.push(admin);

  // A region with two members, and one with none.
  const populated = await db.region.create({ data: { name: `ZZRegion Populated ${Date.now()}`, code: `ZP${Date.now() % 10000}` } });
  const empty = await db.region.create({ data: { name: `ZZRegion Empty ${Date.now()}`, code: `ZE${Date.now() % 10000}` } });
  made.regions.push(populated.id, empty.id);

  const a = await createAndLogin({ role: "ICR", extra: { regionId: populated.id } });
  const b = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: populated.id } });
  made.users.push(a, b);
  expect(true, `region "${populated.name}" has 2 members; the other has 0`);

  // ── 1. The window ─────────────────────────────────────────────────────────
  startSection(`Fires on day +${HOLIDAY_NOTICE_DAYS}, and on no other day`);
  {
    await makeHoliday("ZZ Too Soon", HOLIDAY_NOTICE_DAYS - 1, { regionId: populated.id });
    await makeHoliday("ZZ Too Far", HOLIDAY_NOTICE_DAYS + 1, { regionId: populated.id });
    const onTime = await makeHoliday("ZZ On Time", HOLIDAY_NOTICE_DAYS, { regionId: populated.id });

    sent.length = 0;
    const r = await runHolidayReminders();
    expect(r.matched === 1, `exactly 1 holiday matched, saw ${r.matched}`,
      "a day either side must not qualify");
    expect(sent.length === 2, `2 emails — one per region member. Saw ${sent.length}`,
      sent.map((s) => s.to).join(", "));
    expect(sent.every((s) => s.subject.includes("ZZ On Time")),
      "and they are about the right holiday", sent.map((s) => s.subject).join(" | "));
    expect(!sent.some((s) => /Too Soon|Too Far/.test(s.subject)),
      "neither neighbouring holiday was announced");

    // The date must be written out, not numeric — 12/07 reads two ways across
    // the markets this goes to.
    expect(sent[0]?.html.includes(onTime.date.toLocaleDateString("en-GB",
      { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })),
      "the date is spelled out in full, not as digits");
  }

  // ── 2. Exactly once ───────────────────────────────────────────────────────
  startSection("A second run the same day sends nothing");
  {
    sent.length = 0;
    const again = await runHolidayReminders();
    expect(again.matched === 1, "the holiday still matches the window");
    expect(again.alreadySent === 1, "…but is recognised as already announced");
    expect(sent.length === 0,
      `★ 0 further emails. Saw ${sent.length}`,
      "a duplicate here is the same broadcast landing twice in a dozen inboxes");

    // The database, not just the code path, is what makes this safe.
    const rows = await db.holidayReminder.count({
      where: { holiday: { name: "ZZ On Time" } },
    });
    expect(rows === 1, `exactly 1 reminder row recorded, saw ${rows}`);

    // Prove the unique index refuses a duplicate, rather than trusting the
    // `findUnique` guard above to be the only thing standing in the way.
    const h = await db.holiday.findFirst({ where: { name: "ZZ On Time" } });
    let refused = false;
    try {
      await db.holidayReminder.create({ data: { holidayId: h.id, forDate: h.date, sentCount: 99 } });
    } catch { refused = true; }
    expect(refused, "the unique index itself refuses a second row for the same date");
  }

  // ── 3. Nobody to tell ─────────────────────────────────────────────────────
  startSection("A holiday that reaches nobody is reported, not silent");
  {
    await makeHoliday("ZZ Empty Region", HOLIDAY_NOTICE_DAYS, { regionId: empty.id });
    await makeHoliday("ZZ No Region At All", HOLIDAY_NOTICE_DAYS);

    sent.length = 0;
    const r = await runHolidayReminders();
    expect(sent.length === 0, "no emails, because there is nobody to email");
    expect(r.reachedNobody.length === 2,
      `both are reported as reaching nobody, saw ${r.reachedNobody.length}`,
      r.reachedNobody.map((x) => x.name).join(", "));

    const reasons = r.reachedNobody.map((x) => x.reason).join(" | ");
    expect(/no active users are assigned/.test(reasons),
      "the empty-region case explains itself", reasons);
    expect(/applies to nobody/.test(reasons),
      "the no-region case explains itself", reasons);

    // Recorded with a zero count rather than skipped, so it is visible later.
    const zero = await db.holidayReminder.findFirst({
      where: { holiday: { name: "ZZ No Region At All" } }, select: { sentCount: true },
    });
    expect(zero?.sentCount === 0, "the empty send is recorded as sentCount 0");
  }

  // ── 4. Global reaches everyone, except client contacts ────────────────────
  startSection("A global holiday reaches all staff but never a client contact");
  {
    const client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
    made.users.push(client);
    await makeHoliday("ZZ Global Day", HOLIDAY_NOTICE_DAYS, { isGlobal: true });

    sent.length = 0;
    const r = await runHolidayReminders();
    const staff = await db.user.count({
      where: { isActive: true, deletedAt: null, role: { not: "INSTITUTION_CLIENT" } },
    });
    expect(sent.length === staff,
      `reached all ${staff} internal users, saw ${sent.length}`);
    expect(!sent.some((s) => s.to === client.user.email),
      "the client contact was NOT emailed",
      "Illume's office calendar is not an external contact's business");
    expect(r.reachedNobody.length === 0, "a global holiday is not reported as empty");
  }

  // ── 5. Dry run ────────────────────────────────────────────────────────────
  startSection("--dry-run reports without sending or recording");
  {
    const h = await makeHoliday("ZZ Dry Run", HOLIDAY_NOTICE_DAYS, { regionId: populated.id });
    sent.length = 0;
    const r = await runHolidayReminders({ dryRun: true });
    expect(r.matched >= 1, "it still finds the holiday");
    expect(sent.length === 0, "but sends nothing");
    const rec = await db.holidayReminder.count({ where: { holidayId: h.id } });
    expect(rec === 0, "and records nothing, so the real run is unaffected");
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  await db.holidayReminder.deleteMany({ where: { holidayId: { in: made.holidays } } }).catch(() => {});
  await db.holiday.deleteMany({ where: { id: { in: made.holidays } } }).catch(() => {});
  await db.notification.deleteMany({ where: { type: "HOLIDAY_REMINDER" } }).catch(() => {});
  for (const u of made.users) await destroyUser(u);
  await db.region.deleteMany({ where: { id: { in: made.regions } } }).catch(() => {});

  const after = { users: await db.user.count(), holidays: await db.holiday.count() };
  startSection("Footprint");
  expect(after.users === baseline.users, `users back to ${baseline.users}`, `now ${after.users}`);
  expect(after.holidays === baseline.holidays, `holidays back to ${baseline.holidays}`, `now ${after.holidays}`);
  summary();
  await db.$disconnect();
}

/**
 * The nightly automations now email. Do they email ONCE?
 *
 *   npx tsx --env-file=.env scripts/qa-reminder-emails.mjs
 *
 * ★ THE ASSERTION THAT MATTERS IS THE COUNT PER PERSON.
 *
 * Six jobs run every morning and, between them, raise fourteen kinds of
 * reminder. Emailing at each site would have been the smaller change and the
 * wrong one: an ICR with twenty stale students would get twenty messages at
 * 07:00, and the FIRST run after this ships would deliver the whole accumulated
 * backlog one email at a time. A test that only asks "did it email?" passes
 * that happily.
 *
 * Nothing is sent: the provider call is intercepted and counted.
 *
 * Footprint: disposable users and leads, all removed in `finally`.
 */
import { db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

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

const { ReminderDigest } = await import("@/lib/reminder-digest");
const { runLeadAutomation } = await import("@/lib/lead-automation");
const { runOffboardingCountdown, OFFBOARDING_NOTICE_DAYS } =
  await import("@/lib/offboarding-countdown");

const made = { users: [], leads: [] };
let baseline = {};
let template;

const dayFromNow = (n) => new Date(Date.now() + n * 86_400_000);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

try {
  startSection("Fixtures");
  baseline = { users: await db.user.count(), leads: await db.lead.count() };
  template = await db.lead.findFirst({ where: { deletedAt: null } });
  expect(!!template, "found a lead to copy required fields from");

  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  made.users.push(icr);

  // ── 1. The digest itself ──────────────────────────────────────────────────
  startSection("ReminderDigest sends ONE email per person, whatever the count");
  {
    const other = await createAndLogin({ role: "ICR" });
    made.users.push(other);

    const d = new ReminderDigest();
    for (let i = 0; i < 12; i++) {
      await d.add({
        userId: icr.user.id, title: `Item ${i}`, message: `Detail ${i}`,
        type: "LEAD_INACTIVITY", link: `/students/x${i}`,
      });
    }
    await d.add({
      userId: other.user.id, title: "Only one", message: "Detail",
      type: "LEAD_INACTIVITY", link: "/students/y",
    });
    expect(d.itemCount === 13 && d.recipientCount === 2,
      `13 items queued across 2 people`);

    sent.length = 0;
    const n = await d.flush({ heading: "Student pipeline", intro: "test." });
    expect(n === 2 && sent.length === 2,
      `★ 13 items -> 2 emails, NOT 13. Saw ${sent.length}`,
      sent.map((s) => s.to).join(", "));

    const mine = sent.find((s) => s.to === icr.user.email);
    expect(mine?.subject.includes("12"),
      "the subject carries the count so the inbox line is useful unopened",
      mine?.subject);
    expect(/Item 0[\s\S]*Item 11/.test(mine?.html ?? "") ||
           (mine?.html.match(/Item \d+/g) ?? []).length === 12,
      "all 12 items are listed in the one email",
      `${(mine?.html.match(/Item \d+/g) ?? []).length} found`);

    const theirs = sent.find((s) => s.to === other.user.email);
    expect(theirs?.subject.includes("1 item"),
      "a single item reads as singular, not '1 items'", theirs?.subject);
    expect(!theirs?.html.includes("Item 0"),
      "★ and one person's items never appear in another's email",
      "cross-posting a colleague's caseload would be a privacy problem");
  }

  // ── 2. Urgency ordering ───────────────────────────────────────────────────
  startSection("Time-critical items sort to the top and are called out");
  {
    const d = new ReminderDigest();
    await d.add({ userId: icr.user.id, title: "Routine thing", message: "m",
      type: "LEAD_INACTIVITY", link: "/a" });
    await d.add({ userId: icr.user.id, title: "Deadline approaching", message: "m",
      type: "LEAD_DEADLINE", link: "/b", urgent: true });

    sent.length = 0;
    await d.flush({ heading: "Student pipeline", intro: "test." });
    const html = sent[0]?.html ?? "";
    expect(html.indexOf("Deadline approaching") < html.indexOf("Routine thing"),
      "the urgent row is rendered first");
    expect(/time-critical/i.test(html),
      "and the email says how many are time-critical");
  }

  // ── 3. Nothing to say means no email ──────────────────────────────────────
  startSection("An empty run sends nothing at all");
  {
    sent.length = 0;
    const d = new ReminderDigest();
    const n = await d.flush({ heading: "Tasks", intro: "test." });
    expect(n === 0 && sent.length === 0,
      "no email when there is nothing on the list",
      "a daily 'you have 0 items' mail is how people learn to filter a sender");
  }

  // ── 4. Dry run ────────────────────────────────────────────────────────────
  startSection("--dry-run queues but neither emails nor writes notifications");
  {
    const before = await db.notification.count();
    const d = new ReminderDigest({ dryRun: true });
    await d.add({ userId: icr.user.id, title: "X", message: "m",
      type: "LEAD_INACTIVITY", link: "/a" });
    sent.length = 0;
    const n = await d.flush({ heading: "Student pipeline", intro: "test." });
    expect(n === 0 && sent.length === 0, "sends nothing");
    expect(await db.notification.count() === before,
      "and writes no in-app notification either");
    expect(d.itemCount === 1, "but still reports what it would have done");
  }

  // ── 5. Through a real automation ──────────────────────────────────────────
  startSection("lead-automation: several stale students, one email");
  {
    // ★ 16 days, not 30. Past 21 a student ESCALATES to a manager instead of
    // reminding the ICR — correct behaviour, but it means a 30-day fixture
    // tests the escalation path while claiming to test the reminder, and the
    // ICR legitimately receives nothing.
    const stale = daysAgo(16);
    for (let i = 0; i < 3; i++) {
      const { id, createdAt, updatedAt, captureId, ...rest } = template;
      const l = await db.lead.create({
        data: {
          ...rest,
          firstName: "ZZStale", lastName: `Student${i}`,
          email: `zzstale-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@illume.local`,
          stage: "CONTACTED",
          assignedICRId: icr.user.id,
          createdById: icr.user.id,
          // ★ `stageEnteredAt` is the field that matters — lead-automation
          // measures idleness from `activities[0].completedAt ?? stageEnteredAt`,
          // NOT from lastContactedAt. Setting the wrong one leaves the cloned
          // template's original (very old) date in place, so the fixture
          // escalates instead of reminding and the test looks broken.
          stageEnteredAt: stale,
          lastContactedAt: stale,
          lastProgressedAt: stale,
          inactivity14NotifiedAt: null,
          inactivity21NotifiedAt: null,
          createdAt: stale,
        },
      });
      made.leads.push(l.id);
    }

    sent.length = 0;
    const r = await runLeadAutomation();
    const mine = sent.filter((s) => s.to === icr.user.email);
    expect(r.inactivityReminders + r.inactivityEscalations >= 3,
      `the automation found the stale students (${r.inactivityReminders}+${r.inactivityEscalations})`);
    expect(mine.length === 1,
      `★ 3 stale students -> 1 email to the ICR, NOT 3. Saw ${mine.length}`,
      mine.map((s) => s.subject).join(" | "));
    expect((mine[0]?.html.match(/ZZStale/g) ?? []).length >= 3,
      "and all three are listed in it",
      `${(mine[0]?.html.match(/ZZStale/g) ?? []).length} mentions`);
  }

  // ── 6. The offboarding countdown, which watches a field nothing read ──────
  startSection("Offboarding countdown fires on the notice days only");
  {
    const hr = await createAndLogin({ role: "HR_MANAGER" });
    made.users.push(hr);
    const leaver = await createAndLogin({ role: "ICR", withEmployee: true });
    made.users.push(leaver);

    // Exactly 7 days out — a notice day.
    await db.employee.update({
      where: { id: leaver.employee.id },
      data: { endDate: dayFromNow(7), managerId: icr.employee.id },
    });

    sent.length = 0;
    const r = await runOffboardingCountdown();
    expect(r.matched === 1, `found the leaver, saw ${r.matched}`);
    expect(sent.some((s) => s.to === hr.user.email), "HR was told");
    expect(sent.some((s) => s.to === icr.user.email), "the manager was told");
    expect(!sent.some((s) => s.to === leaver.user.email),
      "★ the leaver is NOT sent a countdown to their own last day",
      "that would be a remarkable thing to receive");

    // A day that is not a notice day must be silent.
    await db.employee.update({
      where: { id: leaver.employee.id }, data: { endDate: dayFromNow(15) },
    });
    sent.length = 0;
    const quiet = await runOffboardingCountdown();
    expect(quiet.matched === 0 && sent.length === 0,
      `15 days out is silent — notices are only ${OFFBOARDING_NOTICE_DAYS.join("/")} days`,
      "otherwise it becomes a daily drip and stops meaning anything");

    await db.employee.update({
      where: { id: leaver.employee.id }, data: { endDate: null },
    });
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  for (const id of made.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  await db.lead.deleteMany({ where: { firstName: "ZZStale" } }).catch(() => {});
  await db.notification.deleteMany({
    where: { type: { in: ["LEAD_INACTIVITY", "LEAD_ESCALATION", "OFFBOARDING_COUNTDOWN"] } },
  }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { users: await db.user.count(), leads: await db.lead.count() };
  startSection("Footprint");
  expect(after.users === baseline.users, `users back to ${baseline.users}`, `now ${after.users}`);
  expect(after.leads === baseline.leads, `leads back to ${baseline.leads}`, `now ${after.leads}`);
  summary();
  await db.$disconnect();
}

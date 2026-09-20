/**
 * University renewal notices: the right stage, once each, and catching up.
 *
 *   npx tsx --env-file=.env scripts/qa-renewal-reminders.mjs
 *
 * ★ WHY THIS EXISTS. The renewal job watched `Contract.endDate`, and
 * production has ZERO contract rows — while 22 clients have
 * `Institution.renewalDate` filled in, six of them already lapsed and four of
 * those still ACTIVE. The reminder covered nothing in practice, and nothing
 * about the run said so.
 *
 * The assertions that matter:
 *   1. It reads Institution.renewalDate, not just contracts.
 *   2. Each stage fires ONCE, so a daily cron does not nag every morning.
 *   3. A run MISSED on the exact boundary day still fires the next day. The
 *      contract path used `daysLeft === w`, which loses the notice for good.
 *   4. A lapsed renewal on a live client is raised, not ignored.
 *   5. A client with no account manager is REPORTED, not silently skipped.
 *
 * Nothing is sent: the provider call is intercepted and counted.
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

const { sendRenewalReminders } = await import("@/lib/network-automation");

const made = { users: [], institutions: [] };
let baseline = {};

const dayFromNow = (n) => {
  const t = new Date();
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  return new Date(d.getTime() + n * 86_400_000);
};

async function makeClient(name, renewalDays, { am, status = "ACTIVE" } = {}) {
  const i = await db.institution.create({
    data: {
      name: `ZZUni ${name} ${Date.now()}`,
      country: "Canada",
      type: "UNIVERSITY",
      accountStatus: status,
      createdById: made.users[0].user.id,
      renewalDate: renewalDays === null ? null : dayFromNow(renewalDays),
      accountManagerId: am ?? null,
    },
  });
  made.institutions.push(i.id);
  return i;
}

try {
  startSection("Fixtures");
  baseline = { institutions: await db.institution.count(), users: await db.user.count() };
  const am = await createAndLogin({ role: "ACCOUNT_MANAGER" });
  made.users.push(am);

  // ── 1. It reads the field the business actually fills in ──────────────────
  startSection("Institution.renewalDate is watched, not only Contract.endDate");
  {
    const c = await makeClient("Windsor", 30, { am: am.user.id });
    sent.length = 0;
    const r = await sendRenewalReminders();
    expect(r.renewalsNoticed >= 1, `noticed the client renewal (${r.renewalsNoticed})`);
    expect(sent.some((s) => s.html.includes(c.name)),
      "the account manager was emailed about it",
      sent.map((s) => s.subject).join(" | "));
    const stored = await db.institution.findUnique({
      where: { id: c.id }, select: { renewalNoticeStage: true },
    });
    expect(stored?.renewalNoticeStage === 30,
      `the 30-day stage was recorded, saw ${stored?.renewalNoticeStage}`);
  }

  // ── 2. Once per stage ─────────────────────────────────────────────────────
  startSection("Each stage fires once — a daily cron does not nag");
  {
    sent.length = 0;
    const r = await sendRenewalReminders();
    expect(r.renewalsNoticed === 0,
      `second run the same day notices nothing new, saw ${r.renewalsNoticed}`);
    expect(sent.length === 0,
      "★ and sends no email — otherwise every client is chased every morning");
  }

  // ── 3. Catch-up after a missed day ────────────────────────────────────────
  startSection("A run missed on the boundary day still fires the next day");
  {
    // 89 days: one day PAST the 90-day boundary. The contract path's
    // `daysLeft === w` would never match this again; `<=` still does.
    const c = await makeClient("MissedBoundary", 89, { am: am.user.id });
    sent.length = 0;
    const r = await sendRenewalReminders();
    expect(sent.some((s) => s.html.includes(c.name)),
      "★ 89 days out still triggers the 90-day notice",
      "an exact-day match would have lost this window permanently");
    const stored = await db.institution.findUnique({
      where: { id: c.id }, select: { renewalNoticeStage: true },
    });
    expect(stored?.renewalNoticeStage === 90, `recorded as the 90 stage, saw ${stored?.renewalNoticeStage}`);
  }

  // ── 4. Lapsed renewals ────────────────────────────────────────────────────
  startSection("A renewal that has already lapsed is raised, loudly");
  {
    const c = await makeClient("Lapsed", -45, { am: am.user.id });
    sent.length = 0;
    const r = await sendRenewalReminders();
    expect(r.renewalsOverdue >= 1, `counted as overdue (${r.renewalsOverdue})`);
    const mail = sent.find((s) => s.html.includes(c.name));
    expect(!!mail, "the account manager was told");
    expect(/LAPSED/i.test(mail?.html ?? ""),
      "the wording says it has lapsed, not that it is upcoming");
    expect(/45 days ago/.test(mail?.html ?? ""),
      "and says how long ago", mail?.subject);
  }

  // ── 5. Nobody to tell ─────────────────────────────────────────────────────
  startSection("A client with no account manager is reported, not skipped");
  {
    const c = await makeClient("NoManager", 30, { am: null });
    sent.length = 0;
    const r = await sendRenewalReminders();
    expect(r.noRecipient.some((x) => x.name === c.name),
      "★ reported by name with a reason",
      r.noRecipient.map((x) => `${x.name}: ${x.reason}`).join(" | ") || "nothing reported");
    expect(!sent.some((s) => s.html.includes(c.name)),
      "and no email pretends to have gone somewhere");
  }

  // ── 6. Renewal pushed out ─────────────────────────────────────────────────
  startSection("Pushing the renewal date out rewinds the countdown silently");
  {
    const c = await makeClient("Renewed", 30, { am: am.user.id });
    await sendRenewalReminders();            // fires the 30 stage

    // The client renews for another year.
    await db.institution.update({
      where: { id: c.id }, data: { renewalDate: dayFromNow(170) },
    });
    sent.length = 0;
    await sendRenewalReminders();
    expect(!sent.some((s) => s.html.includes(c.name)),
      "no email — nobody needs telling that a deadline receded");
    const stored = await db.institution.findUnique({
      where: { id: c.id }, select: { renewalNoticeStage: true },
    });
    expect(stored?.renewalNoticeStage === 180,
      `the marker rewound to 180 so next year counts down again, saw ${stored?.renewalNoticeStage}`);
  }

  // ── 7. Closed accounts are left alone ─────────────────────────────────────
  startSection("Churned and suspended clients are not chased");
  {
    const c = await makeClient("Churned", 30, { am: am.user.id, status: "CHURNED" });
    sent.length = 0;
    await sendRenewalReminders();
    expect(!sent.some((s) => s.html.includes(c.name)),
      "a client we no longer work with is not chased for renewal");
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  globalThis.fetch = realFetch;
  await db.notification.deleteMany({ where: { type: "CONTRACT_RENEWAL_DUE" } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const u of made.users) await destroyUser(u);

  const after = { institutions: await db.institution.count(), users: await db.user.count() };
  startSection("Footprint");
  expect(after.institutions === baseline.institutions,
    `institutions back to ${baseline.institutions}`, `now ${after.institutions}`);
  expect(after.users === baseline.users, `users back to ${baseline.users}`, `now ${after.users}`);
  summary();
  await db.$disconnect();
}

/**
 * Field Operations record linking — verification.
 *
 *   node --import tsx --env-file=.env scripts/qa-field-ops-linking.mjs
 *
 * Spec §1: "Every Field Operation must relate to one or more CRM entities" and
 * "No activity should exist in isolation." The create route accepted only four
 * of the six linkable entities the spec names — Campaign and Student were
 * missing despite the columns existing — and every link was optional, so an
 * activity could be saved attached to nothing and would then appear in no
 * delivery report.
 *
 * RUN THREE TIMES with a FRESH LOGIN each pass. Repeating with new credentials
 * is what catches order-dependence, leaked state between runs, and races that
 * pass once by luck — one of which produced a false failure in the previous
 * module. Every disposable account is destroyed at the end of its own pass and
 * the residue is asserted to be zero.
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const PASSES = 3;
const allCreated = [];
const made = { activities: [], institutions: [], markets: [], campaigns: [], leads: [], events: [] };

async function fixtures(adminUserId) {
  const inst = await db.institution.create({
    data: { name: `${TAG}-Inst-${Date.now()}`, country: "Canada", type: "UNIVERSITY", createdById: adminUserId },
  });
  made.institutions.push(inst.id);

  const market = await db.market.create({
    data: { name: `${TAG}-Mkt-${Date.now()}`, code: `M${Date.now().toString().slice(-5)}`, createdById: adminUserId },
  });
  made.markets.push(market.id);

  const lead = await db.lead.create({
    data: {
      firstName: TAG, lastName: `Link-${Date.now().toString().slice(-5)}`,
      email: `${TAG.toLowerCase()}-link-${Date.now()}@illume.local`, phone: "+10000000000",
      nationality: "Indian", countryOfResidence: "India", interestedProgram: "QA",
      studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9, createdById: adminUserId,
    },
  });
  made.leads.push(lead.id);

  return { inst, market, lead };
}

async function runPass(pass) {
  startSection(`PASS ${pass} of ${PASSES} — fresh login`);

  // A brand-new account every pass. Reusing one would hide anything that only
  // fails for a user who has not acted before.
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  allCreated.push(admin);
  ok(`logged in as a new disposable admin (${admin.user.email})`);

  const { inst, market, lead } = await fixtures(admin.user.id);
  const passFixtures = { inst: inst.id, market: market.id, lead: lead.id };

  // ── An activity linked to nothing must be refused ───────────────────────
  const orphan = await api(admin.jar, "POST", "/api/activities", {
    type: "INTERNAL_REVIEW",
    title: `${TAG} p${pass} orphan`,
    date: new Date().toISOString(),
  });
  expect(orphan.status === 422,
    "*** an activity linked to nothing is refused (spec: no activity in isolation) ***",
    `got ${orphan.status}`);
  expect(String(orphan.payload?.error ?? "").toLowerCase().includes("link"),
    "the refusal tells the user to link a record",
    JSON.stringify(orphan.payload?.error));

  // ── Each of the newly accepted links works on its own ───────────────────
  const linkCases = [
    ["client", { institutionId: inst.id }],
    ["market", { marketId: market.id }],
    ["student", { leadId: lead.id }],
  ];
  for (const [label, link] of linkCases) {
    const r = await api(admin.jar, "POST", "/api/activities", {
      type: "CLIENT_MEETING",
      title: `${TAG} p${pass} ${label}`,
      date: new Date().toISOString(),
      ...link,
    });
    expect(r.status === 200 || r.status === 201,
      `an activity linked only to a ${label} is accepted`,
      `got ${r.status} ${JSON.stringify(r.payload?.error ?? "")}`);
  }

  // Prove the student link is genuinely persisted — it is one of the two the
  // route never accepted, so "no error" is not enough.
  const stored = await db.activity.findFirst({
    where: { title: `${TAG} p${pass} student` },
    select: { id: true, leadId: true, marketId: true, institutionId: true },
  });
  expect(!!stored, "the student-linked activity was stored", String(stored?.id));
  expect(stored?.leadId === lead.id,
    "*** leadId is persisted — the column the route never accepted ***",
    `${stored?.leadId} vs ${lead.id}`);

  const mkt = await db.activity.findFirst({
    where: { title: `${TAG} p${pass} market` }, select: { marketId: true },
  });
  expect(mkt?.marketId === market.id, "marketId is persisted", `${mkt?.marketId}`);

  // ── A bogus id must be refused, not 500 ─────────────────────────────────
  const bogus = await api(admin.jar, "POST", "/api/activities", {
    type: "CLIENT_MEETING",
    title: `${TAG} p${pass} bogus`,
    date: new Date().toISOString(),
    leadId: "00000000-0000-0000-0000-000000000000",
  });
  expect(bogus.status === 422,
    "an unknown student id is refused with 422, not a 500", `got ${bogus.status}`);

  // ── Tear this pass's account down and prove it is gone ──────────────────
  //
  // The activities MUST go first. Activity.userId is a required FK to the
  // creating user, and qa-lib's destroyUser does not know about activities, so
  // deleting the account first fails with "FK still referencing" and silently
  // leaves the disposable admin behind. Three passes leaked three accounts
  // before this was reordered — which is precisely what running it repeatedly
  // was meant to surface.
  const rows = await db.activity.findMany({
    where: { title: { startsWith: `${TAG} p${pass}` } }, select: { id: true },
  });
  made.activities.push(...rows.map((r) => r.id));
  await db.activityAttendee.deleteMany({ where: { activityId: { in: rows.map((r) => r.id) } } }).catch(() => {});
  await db.activity.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }).catch(() => {});
  // Anything else this account authored during the pass.
  await db.activity.deleteMany({ where: { userId: admin.user.id } }).catch(() => {});

  // The fixtures block deletion too: institution, market and lead are all
  // created with `createdById` pointing at this account, and those are required
  // FKs. destroyUser knows nothing about them, so it fails and — because the
  // failure is only a warning — leaves the account behind silently.
  await db.lead.delete({ where: { id: passFixtures.lead } }).catch(() => {});
  await db.institution.delete({ where: { id: passFixtures.inst } }).catch(() => {});
  await db.market.delete({ where: { id: passFixtures.market } }).catch(() => {});

  await destroyUser(admin);
  const left = await db.user.count({ where: { id: admin.user.id } });
  // Only drop it from the retry list if it actually went. Popping
  // unconditionally meant a failed delete was never retried in teardown.
  if (left === 0) {
    const i = allCreated.indexOf(admin);
    if (i >= 0) allCreated.splice(i, 1);
  }
  expect(left === 0, `pass ${pass}: the disposable account was deleted`, `${left} remaining`);
  const sessionsLeft = await db.session.count({ where: { userId: admin.user.id } });
  expect(sessionsLeft === 0, `pass ${pass}: its sessions were deleted`, `${sessionsLeft}`);

  return true;
}

async function main() {
  const before = {
    users: await db.user.count(),
    activities: await db.activity.count(),
  };
  startSection("Baseline");
  ok(`users=${before.users} activities=${before.activities}`);

  for (let p = 1; p <= PASSES; p++) await runPass(p);

  startSection("Footprint after three passes");
  const afterUsers = await db.user.count();
  expect(afterUsers === before.users,
    "*** user count returned to baseline — no disposable account survived ***",
    `${before.users} -> ${afterUsers}`);
}

async function teardown() {
  await db.activityAttendee.deleteMany({ where: { activityId: { in: made.activities } } }).catch(() => {});
  await db.activity.deleteMany({ where: { title: { startsWith: TAG } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  await db.lead.deleteMany({ where: { id: { in: made.leads } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  await db.market.deleteMany({ where: { id: { in: made.markets } } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leakedActs = await db.activity.count({ where: { title: { startsWith: TAG } } }).catch(() => -1);
  const leakedUsers = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked activities: ${leakedActs}, leaked users: ${leakedUsers}\n`);
  await db.$disconnect();
}
summary();

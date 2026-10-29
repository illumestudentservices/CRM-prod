/**
 * /api/analytics/overview must scope an INSTITUTION_CLIENT to their OWN
 * institutions — it used to hand them org-wide numbers (every region's leads,
 * markets, sources and enrolment targets, rival clients included).
 *
 *   - a client assigned to A sees only A's leads/targets, 0 events;
 *   - passing ?institutionId=<rival B> does NOT widen the scope back to B;
 *   - a SUPER_ADMIN still sees B's target (proves staff are unaffected).
 *
 *   npx tsx --env-file=.env.local scripts/qa-analytics-client-scope.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

const YEAR = new Date().getFullYear();
let admin, client, instA, instB, assignmentId;
const leadIds = [], targetIds = [];

const mkInst = (name, createdById) =>
  db.institution.create({ data: { name, country: "QA", type: "UNIVERSITY", createdById } });

async function mkLead(institutionId, createdById, country, stage) {
  const l = await db.lead.create({
    data: {
      firstName: "QA", lastName: "Lead", nationality: country, countryOfResidence: country,
      interestedProgram: "QA Program", intakeYear: YEAR, intakeMonth: 9,
      studyLevel: "UNDERGRADUATE", createdById, institutionId, stage,
    },
  });
  leadIds.push(l.id);
  return l;
}
async function mkTarget(institutionId, target) {
  const t = await db.enrollmentTarget.create({ data: { institutionId, year: YEAR, target, actual: 0 } });
  targetIds.push(t.id);
  return t;
}

const targetHasInst = (payload, instId) =>
  Array.isArray(payload?.institutionTargets) &&
  payload.institutionTargets.some((t) => t.institutionId === instId);

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  instA = await mkInst("QA Analytics A (client's)", admin.user.id);
  instB = await mkInst("QA Analytics B (rival)", admin.user.id);
  assignmentId = (await db.institutionUser.create({
    data: { institutionId: instA.id, userId: client.user.id, assignmentStatus: "ACTIVE" },
  })).id;

  // A: 2 leads (1 ENROLLED). B: 3 leads. Distinct countries so markets differ.
  await mkLead(instA.id, admin.user.id, "Atlantis", "ENROLLED");
  await mkLead(instA.id, admin.user.id, "Atlantis", "NEW_LEAD");
  await mkLead(instB.id, admin.user.id, "Borduria", "ENROLLED");
  await mkLead(instB.id, admin.user.id, "Borduria", "NEW_LEAD");
  await mkLead(instB.id, admin.user.id, "Borduria", "NEW_LEAD");
  await mkTarget(instA.id, 10);
  await mkTarget(instB.id, 20);

  for (let run = 1; run <= 3; run++) {
    startSection(`Client sees only their own institution's analytics (run ${run})`);
    let r = await api(client.jar, "GET", "/api/analytics/overview");
    expect(r.ok, "client can load overview", `got ${r.status}`);
    expect(r.payload?.totalLeadsYTD === 2, "totalLeadsYTD counts A's 2 leads only (not B's 3)", `got ${r.payload?.totalLeadsYTD}`);
    expect(r.payload?.enrollmentsYTD === 1, "enrollmentsYTD counts A's 1 enrolled only", `got ${r.payload?.enrollmentsYTD}`);
    expect(targetHasInst(r.payload, instA.id), "institutionTargets include A", JSON.stringify(r.payload?.institutionTargets));
    expect(!targetHasInst(r.payload, instB.id), "institutionTargets do NOT include rival B", JSON.stringify(r.payload?.institutionTargets));
    const marketCountries = (r.payload?.topMarkets ?? []).map((m) => m.country);
    expect(!marketCountries.includes("Borduria"), "top markets exclude B's country (Borduria)", JSON.stringify(marketCountries));
    expect(r.payload?.eventsThisYear === 0, "eventsThisYear is 0 for an external client", `got ${r.payload?.eventsThisYear}`);

    // The param must not widen the scope back to a rival.
    r = await api(client.jar, "GET", `/api/analytics/overview?institutionId=${instB.id}`);
    expect(r.ok && r.payload?.totalLeadsYTD === 2, "?institutionId=<rival> does NOT reveal B's leads (still 2)", `got ${r.status}/${r.payload?.totalLeadsYTD}`);
    expect(!targetHasInst(r.payload, instB.id), "?institutionId=<rival> does NOT reveal B's target", JSON.stringify(r.payload?.institutionTargets));
  }

  startSection("SUPER_ADMIN is unaffected (still sees B)");
  const ra = await api(admin.jar, "GET", "/api/analytics/overview");
  expect(ra.ok, "admin can load overview", `got ${ra.status}`);
  expect(targetHasInst(ra.payload, instB.id), "admin's institutionTargets include B (org-wide, by design)", JSON.stringify(ra.payload?.institutionTargets?.length));
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of targetIds) await db.enrollmentTarget.delete({ where: { id } }).catch(() => {});
  for (const id of leadIds) await db.lead.delete({ where: { id } }).catch(() => {});
  if (assignmentId) await db.institutionUser.delete({ where: { id: assignmentId } }).catch(() => {});
  for (const i of [instA, instB]) if (i) await db.institution.delete({ where: { id: i.id } }).catch(() => {});
  for (const u of [admin, client]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

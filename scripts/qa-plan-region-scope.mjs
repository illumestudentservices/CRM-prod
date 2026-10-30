/**
 * Recruitment-plan tenancy (cross-region read/tamper):
 *   - an ICR sees/edits only their OWN plan;
 *   - a Regional Manager is confined to their region (via the plan's ICR);
 *   - the parent plans/[id] GET+PATCH, the child routes (budget-items,
 *     variations, planned-activities, planned-travel, event-participations)
 *     and variations/[id]/approve all enforce it — a plan outside scope is 404;
 *   - the list only shows in-scope plans;
 *   - SUPER_ADMIN is unscoped.
 *
 *   npx tsx --env-file=.env.local scripts/qa-plan-region-scope.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const YEAR = 2027;
let admin, icrA, icrB, rm1, rm2, r1, r2, planA, planB, variationA;

const mkPlan = async (icrUserId, quarter) => {
  const p = await db.quarterlyRecruitmentPlan.create({
    data: { icrId: icrUserId, quarter, year: YEAR, reportingCurrency: "USD", status: "DRAFT" },
  });
  return p;
};
const planChildrenGone = async (planId) => {
  await db.variationRequest.deleteMany({ where: { planId } }).catch(() => {});
  await db.recruitmentPlanBudgetItem.deleteMany({ where: { planId } }).catch(() => {});
  await db.plannedFieldActivity.deleteMany({ where: { planId } }).catch(() => {});
  await db.plannedTravel.deleteMany({ where: { planId } }).catch(() => {});
  await db.plannedEventParticipation.deleteMany({ where: { planId } }).catch(() => {});
};

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });
  r2 = await db.region.create({ data: { name: `${TAG} R2`, code: `${TAG}2` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  icrA = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });
  icrB = await createAndLogin({ role: "ICR", extra: { regionId: r2.id } });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r1.id } });
  rm2 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r2.id } });

  planA = await mkPlan(icrA.user.id, 1); // region R1 (via icrA)
  planB = await mkPlan(icrB.user.id, 1); // region R2 (via icrB)
  variationA = await db.variationRequest.create({
    data: { planId: planA.id, type: "INCREASE_BUDGET", reason: "QA variation", requestedById: icrA.user.id, status: "SUBMITTED" },
  });

  const A = planA.id;

  // ── Cross-region DENIALS (idempotent) — run ×3 ──────────────────────────
  for (let run = 1; run <= 3; run++) {
    startSection(`Out-of-scope users are 404 on plan A (run ${run})`);
    let r = await api(icrB.jar, "GET", `/api/recruitment-planning/plans/${A}`);
    expect(r.status === 404, "a different ICR cannot read plan A", `got ${r.status}`);
    r = await api(rm2.jar, "GET", `/api/recruitment-planning/plans/${A}`);
    expect(r.status === 404, "an RM from another region cannot read plan A", `got ${r.status}`);
    r = await api(rm2.jar, "GET", `/api/recruitment-planning/plans/${A}/budget-items`);
    expect(r.status === 404, "cross-region RM cannot read A's budget items", `got ${r.status}`);
    r = await api(rm2.jar, "GET", `/api/recruitment-planning/plans/${A}/variations`);
    expect(r.status === 404, "cross-region RM cannot read A's variations", `got ${r.status}`);
    r = await api(rm2.jar, "PATCH", `/api/recruitment-planning/plans/${A}`, { reportingCurrency: "EUR" });
    expect(r.status === 404, "cross-region RM cannot PATCH plan A", `got ${r.status}`);
    r = await api(rm2.jar, "POST", `/api/recruitment-planning/plans/${A}/budget-items`, { category: "FLIGHTS", amount: 100, currency: "USD" });
    expect(r.status === 404, "cross-region RM cannot add a budget item to A", `got ${r.status}`);
    r = await api(icrB.jar, "POST", `/api/recruitment-planning/plans/${A}/budget-items`, { category: "FLIGHTS", amount: 100, currency: "USD" });
    expect(r.status === 404, "a different ICR cannot add a budget item to A", `got ${r.status}`);
    r = await api(rm2.jar, "POST", `/api/recruitment-planning/variations/${variationA.id}/approve`, { decision: "APPROVED" });
    expect(r.status === 404, "cross-region RM cannot approve A's variation", `got ${r.status}`);
    const vstill = await db.variationRequest.findUnique({ where: { id: variationA.id }, select: { status: true } });
    expect(vstill.status === "SUBMITTED", "A's variation is still SUBMITTED (not approved cross-region)", vstill.status);
  }

  // ── In-scope ACCESS (owner / same-region / admin) ───────────────────────
  startSection("In-scope users CAN act on plan A");
  let r = await api(icrA.jar, "GET", `/api/recruitment-planning/plans/${A}`);
  expect(r.ok, "the owning ICR can read plan A", `got ${r.status}`);
  r = await api(rm1.jar, "GET", `/api/recruitment-planning/plans/${A}`);
  expect(r.ok, "the same-region RM can read plan A", `got ${r.status}`);
  r = await api(admin.jar, "GET", `/api/recruitment-planning/plans/${A}`);
  expect(r.ok, "SUPER_ADMIN can read plan A (unscoped)", `got ${r.status}`);
  r = await api(rm1.jar, "GET", `/api/recruitment-planning/plans/${A}/budget-items`);
  expect(r.ok, "same-region RM can read A's budget items", `got ${r.status}`);
  r = await api(rm1.jar, "PATCH", `/api/recruitment-planning/plans/${A}`, { reportingCurrency: "EUR" });
  expect(r.ok, "same-region RM can PATCH plan A (DRAFT)", `got ${r.status}`);
  r = await api(rm1.jar, "POST", `/api/recruitment-planning/plans/${A}/budget-items`, { category: "FLIGHTS", amount: 100, currency: "USD" });
  expect(r.status === 201, "same-region RM can add a budget item to A", `got ${r.status}`);

  // ── List scope ──────────────────────────────────────────────────────────
  startSection("List shows only in-scope plans");
  r = await api(rm2.jar, "GET", `/api/recruitment-planning/plans`);
  const rm2Ids = (r.payload?.data ?? []).map((p) => p.id);
  expect(r.ok && !rm2Ids.includes(A), "cross-region RM's list excludes plan A", `${r.status} ${rm2Ids.length} rows`);
  r = await api(rm1.jar, "GET", `/api/recruitment-planning/plans`);
  const rm1Ids = (r.payload?.data ?? []).map((p) => p.id);
  expect(r.ok && rm1Ids.includes(A), "same-region RM's list includes plan A", `${r.status} ${rm1Ids.length} rows`);

  // ── Variation approve, in-scope (consumes it — last) ────────────────────
  startSection("Same-region RM can approve A's variation");
  r = await api(rm1.jar, "POST", `/api/recruitment-planning/variations/${variationA.id}/approve`, { decision: "APPROVED" });
  expect(r.ok, "same-region RM approves A's variation", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,120)}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const p of [planA, planB]) if (p) await planChildrenGone(p.id);
  for (const p of [planA, planB]) if (p) await db.quarterlyRecruitmentPlan.delete({ where: { id: p.id } }).catch(() => {});
  for (const u of [admin, icrA, icrB, rm1, rm2]) if (u) await destroyUser(u);
  for (const reg of [r1, r2]) if (reg) await db.region.delete({ where: { id: reg.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

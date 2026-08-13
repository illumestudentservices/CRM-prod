/**
 * Recruitment-plan approval chain over real HTTP.
 *
 * The pure matrix check (qa-plan-approval-chain.mjs) proves canTransition, but
 * not the two things only the running route can show:
 *   1. ACCOUNT_MANAGER / VP_GLOBAL_SALES clear the coarse
 *      effectiveHasPermission("recruitment_planning", write|approve) gate. That
 *      reads DB overrides, so a static matrix read is not proof.
 *   2. The reviewer columns are actually written. They were null for months
 *      while the timestamps beside them were being set.
 *
 *   node --import tsx --env-file=.env scripts/qa-plan-approval-http.mjs
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary,
} from "./qa-lib.mjs";

const created = [];
const fixtures = { plans: [], institutions: [] };

async function main() {
  startSection("Setup");

  const icr = await createAndLogin({ role: "ICR" });               created.push(icr);
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER" });   created.push(rm);
  const am = await createAndLogin({ role: "ACCOUNT_MANAGER" });    created.push(am);
  const vp = await createAndLogin({ role: "VP_GLOBAL_SALES" });    created.push(vp);
  const hq = await createAndLogin({ role: "HQ_EXECUTIVE" });       created.push(hq);
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });     created.push(admin);

  const inst = await db.institution.create({
    data: {
      name: `QA Plan Institution ${Date.now()}`,
      country: "Canada",
      type: "UNIVERSITY",
      createdById: admin.user.id,
    },
  });
  fixtures.institutions.push(inst.id);

  // Created directly so the test targets the transition route, not plan creation.
  const plan = await db.quarterlyRecruitmentPlan.create({
    data: {
      icrId: icr.user.id, institutionId: inst.id,
      quarter: 4, year: 2026, status: "DRAFT", reportingCurrency: "USD",
    },
  });
  fixtures.plans.push(plan.id);
  ok(`plan created in DRAFT (${plan.id.slice(0, 8)})`);

  const move = (ctx, toStatus) =>
    api(ctx.jar, "POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { toStatus });
  const reload = () => db.quarterlyRecruitmentPlan.findUnique({ where: { id: plan.id } });

  // ── Walk the happy path, one role per step ────────────────────────────
  startSection("Happy path — each role performs its own step");

  let r = await move(icr, "SUBMITTED");
  expect(r.status === 200, "ICR submits", `got ${r.status} ${JSON.stringify(r.payload)?.slice(0, 120)}`);

  r = await move(rm, "REGIONAL_MANAGER_REVIEW");
  expect(r.status === 200, "REGIONAL_MANAGER performs Regional Manager Review", `got ${r.status}`);
  let row = await reload();
  expect(row.regionalManagerId === rm.user.id,
    "regionalManagerId stamped with the actual reviewer",
    `got ${row.regionalManagerId}`);
  expect(row.regionalReviewedAt !== null, "regionalReviewedAt set");

  // The bug this change fixes: HQ_EXECUTIVE used to own this step and the
  // ACCOUNT_MANAGER could not perform it.
  r = await move(hq, "ACCOUNT_MANAGER_REVIEW");
  expect(r.status === 409, "HQ_EXECUTIVE is REFUSED Account Manager Review", `got ${r.status}`);

  r = await move(am, "ACCOUNT_MANAGER_REVIEW");
  expect(r.status === 200,
    "ACCOUNT_MANAGER performs Account Manager Review (clears the live permission gate)",
    `got ${r.status} ${JSON.stringify(r.payload)?.slice(0, 140)}`);
  row = await reload();
  expect(row.accountManagerId === am.user.id,
    "accountManagerId stamped — the column that was null for months",
    `got ${row.accountManagerId}`);
  expect(row.accountReviewedAt !== null, "accountReviewedAt set");

  r = await move(vp, "INTERNAL_FINAL_REVIEW");
  expect(r.status === 200, "VP_GLOBAL_SALES performs Internal Final Review", `got ${r.status}`);
  row = await reload();
  expect(row.vpReviewerId === vp.user.id,
    "vpReviewerId stamped with the VP", `got ${row.vpReviewerId}`);

  r = await move(vp, "CLIENT_REVIEW");
  expect(r.status === 200, "VP_GLOBAL_SALES records Client Review", `got ${r.status}`);

  r = await move(icr, "APPROVED");
  expect(r.status === 409 || r.status === 403, "ICR cannot approve", `got ${r.status}`);

  r = await move(vp, "APPROVED");
  expect(r.status === 200 || r.status === 207,
    "VP_GLOBAL_SALES approves (207 = approved, activation warned)", `got ${r.status}`);
  row = await reload();
  // APPROVED is transient by design: the route calls activatePlan(), which sets
  // ACTIVE and activatedAt (lib/plan-workflow.ts:230) after raising travel and
  // field-operation stubs. So the end state of a successful approval is ACTIVE,
  // and approvedAt is the evidence that APPROVED was passed through.
  expect(row.status === "ACTIVE",
    "approval auto-activates the plan (APPROVED is transient)", `status=${row.status}`);
  expect(row.approvedAt !== null, "approvedAt set");
  expect(row.activatedAt !== null, "activatedAt set by activatePlan");

  // ── Return path ───────────────────────────────────────────────────────
  startSection("An Account Manager can send a plan back");
  const plan2 = await db.quarterlyRecruitmentPlan.create({
    data: {
      icrId: icr.user.id, institutionId: inst.id,
      quarter: 3, year: 2026, status: "REGIONAL_MANAGER_REVIEW", reportingCurrency: "USD",
    },
  });
  fixtures.plans.push(plan2.id);
  const move2 = (ctx, toStatus) =>
    api(ctx.jar, "POST", `/api/recruitment-planning/plans/${plan2.id}/transition`, { toStatus });

  let r2 = await move2(am, "ACCOUNT_MANAGER_REVIEW");
  expect(r2.status === 200, "AM takes plan 2 into Account Manager Review", `got ${r2.status}`);
  r2 = await move2(am, "RETURNED");
  expect(r2.status === 200,
    "AM can RETURN it — a reviewer that can only advance is not a reviewer",
    `got ${r2.status}`);
  const row2 = await db.quarterlyRecruitmentPlan.findUnique({ where: { id: plan2.id } });
  expect(row2.status === "RETURNED", "plan 2 is RETURNED", `status=${row2.status}`);

  // ── Roles with no business approving ──────────────────────────────────
  startSection("Excluded roles");
  for (const [name, ctx] of [["HR_MANAGER", null], ["EMPLOYEE", null]]) {
    void name; void ctx;
  }
  const emp = await createAndLogin({ role: "EMPLOYEE" }); created.push(emp);
  const r3 = await api(emp.jar, "POST",
    `/api/recruitment-planning/plans/${plan2.id}/transition`, { toStatus: "ACCOUNT_MANAGER_REVIEW" });
  expect(r3.status === 403, "EMPLOYEE is refused at the module gate", `got ${r3.status}`);
}

async function teardown() {
  for (const id of fixtures.plans) {
    await db.plannedTravel.deleteMany({ where: { planId: id } }).catch(() => {});
    await db.plannedEventParticipation.deleteMany({ where: { planId: id } }).catch(() => {});
    await db.plannedFieldActivity.deleteMany({ where: { planId: id } }).catch(() => {});
    await db.recruitmentPlanBudgetItem.deleteMany({ where: { planId: id } }).catch(() => {});
    await db.variationRequest.deleteMany({ where: { planId: id } }).catch(() => {});
    await db.task.deleteMany({ where: { parentType: "RECRUITMENT_PLAN", parentId: id } }).catch(() => {});
    await db.quarterlyRecruitmentPlan.delete({ where: { id } }).catch(() => {});
  }
  for (const ctx of created) {
    await db.activity.deleteMany({ where: { userId: ctx.user.id } }).catch(() => {});
    await db.travelRequest.deleteMany({ where: { requestedById: ctx.user.id } }).catch(() => {});
    await destroyUser(ctx);
  }
  for (const id of fixtures.institutions) {
    await db.activity.deleteMany({ where: { institutionId: id } }).catch(() => {});
    await db.travelRequest.deleteMany({ where: { institutionId: id } }).catch(() => {});
    await db.institution.delete({ where: { id } }).catch(() => {});
  }
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "", "\n", e);
  process.exitCode = 1;
} finally {
  await teardown();
  const leftPlans = await db.quarterlyRecruitmentPlan.count().catch(() => -1);
  console.log(`\n[cleanup] quarterly_recruitment_plans remaining: ${leftPlans}`);
  await db.$disconnect();
}
summary();

/**
 * Attachment row-gates for the report/plan parent types (pentest MEDIUM).
 *
 * lib/attachment-parent.ts gained canAccessRow hooks for RECRUITMENT_PLAN,
 * VARIATION_REQUEST, MONTHLY_REPORT, ICR_MONTHLY_REPORT and
 * QUARTERLY_BUSINESS_REVIEW. Before, these had only a module-permission gate,
 * so recruitment_planning:read / reports:read let a holder list and download
 * another region's (or another client's) attachments by id. Each hook mirrors
 * the parent record's own detail route; out of scope the attachments route
 * answers 404.
 *
 *   npx tsx --env-file=.env.local scripts/qa-attachment-report-hooks.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const YEAR = 2027;
let admin, icrA, icrB, rm1, rm2, client, client2, r1, r2, instA, asgId;
let planA, variationA, monthlyA, icrReportA, qbrA;

const list = (jar, parentType, parentId) =>
  api(jar, "GET", `/api/attachments?parentType=${parentType}&parentId=${parentId}`);

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });
  r2 = await db.region.create({ data: { name: `${TAG} R2`, code: `${TAG}2` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  icrA = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });
  icrB = await createAndLogin({ role: "ICR", extra: { regionId: r2.id } });
  rm1 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r1.id } });
  rm2 = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: r2.id } });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });
  client2 = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  instA = await db.institution.create({
    data: { name: `${TAG} Inst A`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id },
  });
  asgId = (await db.institutionUser.create({
    data: { institutionId: instA.id, userId: client.user.id, assignmentStatus: "ACTIVE" },
  })).id;

  planA = await db.quarterlyRecruitmentPlan.create({
    data: { icrId: icrA.user.id, quarter: 1, year: YEAR, reportingCurrency: "USD", status: "DRAFT" },
  });
  variationA = await db.variationRequest.create({
    data: { planId: planA.id, type: "INCREASE_BUDGET", reason: "QA", requestedById: icrA.user.id, status: "SUBMITTED" },
  });
  monthlyA = await db.monthlyReport.create({
    data: { icrId: icrA.user.id, institutionId: instA.id, regionId: r1.id, reportingMonth: 9, reportingYear: YEAR, status: "DRAFT" },
  });
  icrReportA = await db.icrMonthlyReport.create({
    data: { icrId: icrA.user.id, regionId: r1.id, reportingMonth: 9, reportingYear: YEAR },
  });
  qbrA = await db.quarterlyBusinessReview.create({
    data: { institutionId: instA.id, quarter: 1, year: YEAR },
  });

  for (let run = 1; run <= 3; run++) {
    // RECRUITMENT_PLAN
    startSection(`RECRUITMENT_PLAN attachment gate (run ${run})`);
    let r = await list(icrA.jar, "RECRUITMENT_PLAN", planA.id);
    expect(r.status === 200, "owning ICR lists plan attachments", `got ${r.status}`);
    r = await list(rm1.jar, "RECRUITMENT_PLAN", planA.id);
    expect(r.status === 200, "same-region RM lists plan attachments", `got ${r.status}`);
    r = await list(admin.jar, "RECRUITMENT_PLAN", planA.id);
    expect(r.status === 200, "SUPER_ADMIN lists plan attachments", `got ${r.status}`);
    r = await list(icrB.jar, "RECRUITMENT_PLAN", planA.id);
    expect(r.status === 404, "a different ICR is 404 on the plan's attachments", `got ${r.status}`);
    r = await list(rm2.jar, "RECRUITMENT_PLAN", planA.id);
    expect(r.status === 404, "cross-region RM is 404 on the plan's attachments", `got ${r.status}`);

    // VARIATION_REQUEST
    startSection(`VARIATION_REQUEST attachment gate (run ${run})`);
    r = await list(icrA.jar, "VARIATION_REQUEST", variationA.id);
    expect(r.status === 200, "owning ICR lists variation attachments", `got ${r.status}`);
    r = await list(rm2.jar, "VARIATION_REQUEST", variationA.id);
    expect(r.status === 404, "cross-region RM is 404 on the variation's attachments", `got ${r.status}`);

    // MONTHLY_REPORT
    startSection(`MONTHLY_REPORT attachment gate (run ${run})`);
    r = await list(rm1.jar, "MONTHLY_REPORT", monthlyA.id);
    expect(r.status === 200, "same-region RM lists monthly report attachments", `got ${r.status}`);
    r = await list(admin.jar, "MONTHLY_REPORT", monthlyA.id);
    expect(r.status === 200, "SUPER_ADMIN lists monthly report attachments", `got ${r.status}`);
    r = await list(rm2.jar, "MONTHLY_REPORT", monthlyA.id);
    expect(r.status === 404, "cross-region RM is 404 on monthly report attachments", `got ${r.status}`);
    r = await list(client.jar, "MONTHLY_REPORT", monthlyA.id);
    expect(r.status === 404, "INSTITUTION_CLIENT is 404 on monthly report attachments", `got ${r.status}`);

    // ICR_MONTHLY_REPORT
    startSection(`ICR_MONTHLY_REPORT attachment gate (run ${run})`);
    r = await list(rm1.jar, "ICR_MONTHLY_REPORT", icrReportA.id);
    expect(r.status === 200, "same-region RM lists ICR report attachments", `got ${r.status}`);
    r = await list(admin.jar, "ICR_MONTHLY_REPORT", icrReportA.id);
    expect(r.status === 200, "SUPER_ADMIN lists ICR report attachments", `got ${r.status}`);
    r = await list(rm2.jar, "ICR_MONTHLY_REPORT", icrReportA.id);
    expect(r.status === 404, "cross-region RM is 404 on ICR report attachments", `got ${r.status}`);

    // QUARTERLY_BUSINESS_REVIEW
    startSection(`QBR attachment gate (run ${run})`);
    r = await list(client.jar, "QUARTERLY_BUSINESS_REVIEW", qbrA.id);
    expect(r.status === 200, "assigned client lists their QBR attachments", `got ${r.status}`);
    r = await list(admin.jar, "QUARTERLY_BUSINESS_REVIEW", qbrA.id);
    expect(r.status === 200, "SUPER_ADMIN lists QBR attachments", `got ${r.status}`);
    r = await list(client2.jar, "QUARTERLY_BUSINESS_REVIEW", qbrA.id);
    expect(r.status === 404, "an unassigned client is 404 on the QBR's attachments", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (variationA) await db.variationRequest.delete({ where: { id: variationA.id } }).catch(() => {});
  if (planA) await db.quarterlyRecruitmentPlan.delete({ where: { id: planA.id } }).catch(() => {});
  if (monthlyA) await db.monthlyReport.delete({ where: { id: monthlyA.id } }).catch(() => {});
  if (icrReportA) await db.icrMonthlyReport.delete({ where: { id: icrReportA.id } }).catch(() => {});
  if (qbrA) await db.quarterlyBusinessReview.delete({ where: { id: qbrA.id } }).catch(() => {});
  if (asgId) await db.institutionUser.delete({ where: { id: asgId } }).catch(() => {});
  if (instA) await db.institution.delete({ where: { id: instA.id } }).catch(() => {});
  for (const u of [admin, icrA, icrB, rm1, rm2, client, client2]) if (u) await destroyUser(u);
  for (const reg of [r1, r2]) if (reg) await db.region.delete({ where: { id: reg.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

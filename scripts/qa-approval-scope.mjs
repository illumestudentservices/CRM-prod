/**
 * Who may approve what, and whose region it has to be in.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-approval-scope.mjs
 *
 * The rule being enforced: a Regional Manager acts on their OWN region only; a
 * SUPER_ADMIN acts on everything.
 *
 * Two places did not implement it.
 *
 *   1. POST /api/recruitment-planning/plans/[id]/transition checked the role
 *      and never the region, so any Regional Manager could advance any plan in
 *      the organisation. Approving is not read-only either — reaching APPROVED
 *      runs activatePlan(), which materialises travel, field operations and
 *      tasks. The GET on the same resource IS region-scoped, so the list a
 *      manager saw and the plans they could act on were different sets.
 *
 *   2. The two report approve routes compare `regionId !== report.regionId`.
 *      Both columns are nullable, and in SQL-free JavaScript `null !== null` is
 *      false — so a manager with no region matches a report with no region and
 *      may approve it.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
let regionA = null, regionB = null;
const madePlans = [];

async function makePlan(icrId) {
  const p = await db.quarterlyRecruitmentPlan.create({
    data: {
      icrId,
      quarter: ((new Date().getUTCMonth() / 3) | 0) + 1,
      year: new Date().getUTCFullYear(),
      reportingCurrency: "USD",
      status: "SUBMITTED",
    },
    select: { id: true },
  });
  madePlans.push(p.id);
  return p.id;
}

async function main() {
  startSection("Fixture");
  const regions = await db.region.findMany({ take: 2, orderBy: { name: "asc" } });
  if (regions.length < 2) throw new Error("need >=2 regions");
  [regionA, regionB] = regions;

  // An ICR in each region, and their plans.
  const icrA = await createAndLogin({ role: "ICR", extra: { regionId: regionA.id } });
  ctxs.push(icrA);
  const icrB = await createAndLogin({ role: "ICR", extra: { regionId: regionB.id } });
  ctxs.push(icrB);

  ok(`region A = ${regionA.name}, region B = ${regionB.name}`);

  const rmA = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: regionA.id } });
  ctxs.push(rmA);
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  ctxs.push(admin);

  const advance = (ctx, planId) =>
    api(ctx.jar, "POST", `/api/recruitment-planning/plans/${planId}/transition`, {
      toStatus: "REGIONAL_MANAGER_REVIEW",
      notes: `${TAG} scope probe`,
    });

  // ── The Regional Manager's own region ───────────────────────────────────
  startSection("A Regional Manager may act in their own region");
  {
    const r = await advance(rmA, await makePlan(icrA.user.id));
    expect(r.status === 200,
      "advances a plan belonging to an ICR in their region",
      `status ${r.status} ${JSON.stringify(r.payload).slice(0, 140)}`);
  }

  // ── Somebody else's region ──────────────────────────────────────────────
  startSection("...and NOT in another region");
  {
    const r = await advance(rmA, await makePlan(icrB.user.id));
    expect(r.status === 403 || r.status === 404,
      "*** refused a plan belonging to another region's ICR ***",
      `status ${r.status} — the route checks the role and never the region`);
  }

  // ── A Regional Manager with no region at all ────────────────────────────
  startSection("A Regional Manager with no region may act nowhere");
  {
    const rmNone = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: null } });
    ctxs.push(rmNone);
    const r = await advance(rmNone, await makePlan(icrB.user.id));
    expect(r.status === 403 || r.status === 404,
      "*** refused, rather than treated as belonging everywhere ***",
      `status ${r.status}`);
  }

  // ── Super admin ─────────────────────────────────────────────────────────
  startSection("A Super Admin may act anywhere");
  {
    const r = await advance(admin, await makePlan(icrB.user.id));
    expect(r.status === 200,
      "*** advances a plan in any region ***",
      `status ${r.status} ${JSON.stringify(r.payload).slice(0, 140)}`);
  }

  // ── The null-region report approval ─────────────────────────────────────
  startSection("Report approval does not match null region to null region");
  {
    const icr = await createAndLogin({ role: "ICR", extra: { regionId: null } });
    ctxs.push(icr);
    const inst = await db.institution.findFirst({ select: { id: true } });
    if (!inst) { ok("no institution on this database, skipped"); return; }

    const report = await db.monthlyReport.create({
      data: {
        icrId: icr.user.id, institutionId: inst.id,
        reportingMonth: new Date().getUTCMonth() + 1,
        reportingYear: new Date().getUTCFullYear(),
        status: "PENDING_REVIEW",
        regionId: null,          // the case under test
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    const rmNone = ctxs.find((c) => c.user.role === "REGIONAL_MANAGER" && c.user.regionId === null);
    const r = await api(rmNone.jar, "PATCH", `/api/reports/${report.id}/approve`, {
      action: "APPROVE",
    });
    expect(r.status === 403 || r.status === 404,
      "*** a regionless manager cannot approve a regionless report ***",
      `status ${r.status} — null !== null is false, so the guard passes`);

    await db.reportApproval.deleteMany({ where: { reportId: report.id } }).catch(() => {});
    await db.monthlyReport.delete({ where: { id: report.id } }).catch(() => {});
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 3).join("\n")); }
finally {
  startSection("Teardown");
  for (const id of madePlans) {
    await db.quarterlyRecruitmentPlan.delete({ where: { id } }).catch(() => {});
  }
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

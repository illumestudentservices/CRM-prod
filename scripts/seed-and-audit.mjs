#!/usr/bin/env node
/**
 * Seeds throwaway test data in modules that are empty in prod (Markets,
 * Campaigns, Recruitment Planning) so the display audit can actually
 * exercise their queries against real rows. Then runs the audit. Then
 * hard-deletes every row it created regardless of outcome.
 *
 * Every seeded row's name/label starts with `AUDIT_` so cleanup can
 * pattern-match without touching anything real.
 *
 * Safe to re-run — cleanup is on `finally`.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import crypto from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const TAG = "AUDIT_" + crypto.randomBytes(3).toString("hex").toUpperCase();
const mismatches = [];
const perModule = new Map();
let currentModule = "";
const seeded = { ids: {}, };

function section(name) {
  currentModule = name;
  if (!perModule.has(name)) perModule.set(name, { pass: 0, fail: 0 });
  process.stdout.write(`\n── ${name} ─────────────────────────────────\n`);
}
function check(label, computed, truth, extra = "") {
  const ok = String(computed) === String(truth);
  const arrow = ok ? "✓" : "✗";
  const bucket = perModule.get(currentModule);
  if (ok) bucket.pass++;
  else bucket.fail++;
  process.stdout.write(
    `  ${arrow}  ${label.padEnd(60)} computed=${String(computed).padEnd(6)} truth=${String(truth).padEnd(6)} ${extra}\n`
  );
  if (!ok) mismatches.push({ module: currentModule, label, computed, truth, extra });
}
async function scalar(sql) {
  const r = await db.$queryRawUnsafe(sql);
  const row = r[0];
  return row ? Number(Object.values(row)[0]) : 0;
}

async function seed() {
  process.stdout.write(`[seed] tag=${TAG}\n`);
  const admin = await db.user.findFirst({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true, name: true, email: true },
  });
  if (!admin) throw new Error("no SUPER_ADMIN to attribute test rows to");
  seeded.adminId = admin.id;
  process.stdout.write(`[seed] attributing to ${admin.email}\n`);

  // ── Market ───────────────────────────────────────────────────────────
  const market = await db.market.create({
    data: {
      name: `${TAG}_Market_Testland`,
      code: `${TAG.slice(0, 8)}_TL`,
      countryCode: "TT",
      politicalRiskLevel: "MEDIUM_RISK",
      priority: "HIGH",
      potential: "GROWING",
      isActive: true,
      createdById: admin.id,
    },
  });
  seeded.marketId = market.id;

  // 2 schools under the market
  const schoolA = await db.school.create({
    data: {
      name: `${TAG}_School_A`, country: "Testland", type: "PRIVATE",
      relationshipStatus: "DEVELOPING", marketId: market.id,
      createdById: admin.id,
    },
  });
  const schoolB = await db.school.create({
    data: {
      name: `${TAG}_School_B`, country: "Testland", type: "INTERNATIONAL",
      relationshipStatus: "DEVELOPING", marketId: market.id,
      createdById: admin.id,
    },
  });
  seeded.schoolIds = [schoolA.id, schoolB.id];

  // 1 activity linked to the market
  const activity = await db.activity.create({
    data: {
      title: `${TAG}_Activity`, type: "MARKET_RESEARCH",
      date: new Date(), userId: admin.id, marketId: market.id,
    },
  });
  seeded.activityId = activity.id;

  // 1 risk on the market
  const risk = await db.riskRegister.create({
    data: {
      type: "MARKET", title: `${TAG}_Risk`, likelihood: 3, impact: 4,
      riskScore: 12, status: "OPEN", ownerId: admin.id, marketId: market.id,
    },
  });
  seeded.riskId = risk.id;

  // 3 market update suggestions in different statuses
  const suggIds = [];
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    const s = await db.marketUpdateSuggestion.create({
      data: {
        marketId: market.id, kind: "VISA_CHANGE",
        originalText: `${TAG}_Suggestion_${status}`,
        submittedById: admin.id,
        status,
      },
    });
    suggIds.push(s.id);
  }
  seeded.suggestionIds = suggIds;

  // ── Campaigns ───────────────────────────────────────────────────────
  const campaignIds = [];
  const now = new Date();
  for (const status of ["PLANNED", "OPEN", "COMPLETED"]) {
    const c = await db.campaign.create({
      data: {
        name: `${TAG}_Campaign_${status}`,
        channel: "test",
        startDate: now,
        status,
        createdById: admin.id,
      },
    });
    campaignIds.push(c.id);
  }
  seeded.campaignIds = campaignIds;

  // ── Recruitment Plan ────────────────────────────────────────────────
  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!inst) throw new Error("no institution to attach plan to");
  const plan = await db.quarterlyRecruitmentPlan.create({
    data: {
      icrId: admin.id,
      institutionId: inst.id,
      quarter: 1,
      year: now.getFullYear(),
      reportingCurrency: "USD",
      status: "DRAFT",
    },
  });
  seeded.planId = plan.id;

  // Plan children
  const travelIds = [];
  for (let i = 0; i < 2; i++) {
    const t = await db.plannedTravel.create({
      data: {
        planId: plan.id, destination: `${TAG}_Dest_${i}`,
        country: "Testland", plannedStart: now, plannedEnd: now,
        purpose: `${TAG}_travel_${i}`,
      },
    });
    travelIds.push(t.id);
  }
  seeded.travelIds = travelIds;

  const event = await db.event.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (event) {
    const pep = await db.plannedEventParticipation.create({
      data: {
        planId: plan.id, eventId: event.id,
        institutionRepresentedId: inst.id,
        purpose: `${TAG}_planned_event`,
      },
    });
    seeded.pepId = pep.id;
  }

  const budgetIds = [];
  for (const cat of ["FLIGHTS", "ACCOMMODATION", "MEALS"]) {
    const b = await db.recruitmentPlanBudgetItem.create({
      data: { planId: plan.id, category: cat, amount: 100, currency: "USD" },
    });
    budgetIds.push(b.id);
  }
  seeded.budgetIds = budgetIds;

  const vr = await db.variationRequest.create({
    data: {
      planId: plan.id, type: "OTHER", reason: `${TAG}_variation`,
      requestedById: admin.id, status: "SUBMITTED",
    },
  });
  seeded.variationId = vr.id;

  process.stdout.write(
    `[seed] created market=${market.id}, plan=${plan.id}, ${campaignIds.length} campaigns\n`
  );
}

async function cleanup() {
  process.stdout.write(`\n[cleanup] rolling back tag=${TAG}\n`);
  const deleters = [
    ["market_update_suggestions", `SELECT id FROM market_update_suggestions WHERE "originalText" LIKE '${TAG}_%'`],
    ["risk_registers", `SELECT id FROM risk_registers WHERE title LIKE '${TAG}_%'`],
    ["activities", `SELECT id FROM activities WHERE title LIKE '${TAG}_%'`],
    ["planned_event_participations", `SELECT id FROM planned_event_participations WHERE purpose LIKE '${TAG}_%'`],
    ["planned_travel", `SELECT id FROM planned_travel WHERE destination LIKE '${TAG}_%'`],
    ["recruitment_plan_budget_items", `SELECT p.id FROM recruitment_plan_budget_items p JOIN quarterly_recruitment_plans q ON q.id = p."planId" WHERE q.id = '${seeded.planId ?? ""}'`],
    ["variation_requests", `SELECT id FROM variation_requests WHERE reason LIKE '${TAG}_%'`],
    ["quarterly_recruitment_plans", `SELECT id FROM quarterly_recruitment_plans WHERE id = '${seeded.planId ?? ""}'`],
    ["campaigns", `SELECT id FROM campaigns WHERE name LIKE '${TAG}_%'`],
    ["schools", `SELECT id FROM schools WHERE name LIKE '${TAG}_%'`],
    ["markets", `SELECT id FROM markets WHERE name LIKE '${TAG}_%'`],
    ["deleted_records", `SELECT id FROM deleted_records WHERE "entityLabel" LIKE '${TAG}_%'`],
  ];
  let n = 0;
  for (const [table, sel] of deleters) {
    try {
      const rows = await db.$queryRawUnsafe(sel);
      if (rows.length === 0) continue;
      const ids = rows.map((r) => `'${r.id}'`).join(",");
      const res = await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id IN (${ids})`);
      n += Number(res);
      process.stdout.write(`  · ${table}: ${res} rows\n`);
    } catch (err) {
      process.stdout.write(`  ⚠ ${table}: ${err.message}\n`);
    }
  }
  process.stdout.write(`[cleanup] ${n} rows removed\n`);
}

async function audit() {
  // ── MARKETS (list + detail) ═══════════════════════════════════════
  section("Markets list");
  {
    const markets = await db.market.findMany({
      include: { _count: { select: { schools: true, activities: true, riskRegisters: true } } },
    });
    for (const m of markets) {
      const truthSchools = await scalar(`SELECT COUNT(*) FROM schools WHERE "marketId" = '${m.id}' AND "deletedAt" IS NULL`);
      const truthAct = await scalar(`SELECT COUNT(*) FROM activities WHERE "marketId" = '${m.id}' AND "deletedAt" IS NULL`);
      const truthRisks = await scalar(`SELECT COUNT(*) FROM risk_registers WHERE "marketId" = '${m.id}'`);
      check(`[${m.name}] schools`, m._count.schools, truthSchools);
      check(`[${m.name}] activities`, m._count.activities, truthAct);
      check(`[${m.name}] riskRegisters`, m._count.riskRegisters, truthRisks);
    }
  }

  section("Market Intelligence list");
  {
    const markets = await db.market.findMany({
      include: {
        _count: {
          select: {
            schools: true,
            activities: true,
            updateSuggestions: { where: { status: "PENDING" } },
          },
        },
      },
    });
    for (const m of markets) {
      const truthPending = await scalar(
        `SELECT COUNT(*) FROM market_update_suggestions WHERE "marketId" = '${m.id}' AND status = 'PENDING'`
      );
      check(`[${m.name}] pendingSuggestions`, m._count.updateSuggestions, truthPending);
    }
  }

  section("Market detail suggestions (per status)");
  {
    for (const status of ["PENDING", "APPROVED", "REJECTED", "EDITED"]) {
      const ui = await db.marketUpdateSuggestion.count({
        where: { marketId: seeded.marketId, status },
      });
      const truth = await scalar(
        `SELECT COUNT(*) FROM market_update_suggestions WHERE "marketId" = '${seeded.marketId}' AND status = '${status}'`
      );
      check(`market suggestions ${status}`, ui, truth);
    }
  }

  // ── CAMPAIGNS ═══════════════════════════════════════════════════════
  section("Campaigns (per status)");
  {
    const grouped = await db.campaign.groupBy({
      by: ["status"], where: { deletedAt: null }, _count: { _all: true },
    });
    const sqlG = await db.$queryRawUnsafe(
      `SELECT COALESCE(status::text, 'UNSET') AS s, COUNT(*)::int AS c FROM campaigns WHERE "deletedAt" IS NULL GROUP BY status`
    );
    const t = Object.fromEntries(sqlG.map((r) => [r.s, r.c]));
    const u = Object.fromEntries(grouped.map((r) => [r.status ?? "UNSET", r._count._all]));
    for (const k of new Set([...Object.keys(t), ...Object.keys(u)])) {
      check(`campaign status ${k}`, u[k] ?? 0, t[k] ?? 0);
    }
    // Sum-of-buckets == total
    const total = await db.campaign.count({ where: { deletedAt: null } });
    const sum = Object.values(u).reduce((a, b) => a + b, 0);
    check("campaigns bucket-sum == total", sum, total);
  }

  // ── RECRUITMENT PLANNING ════════════════════════════════════════════
  section("Recruitment Planning list");
  {
    const plans = await db.quarterlyRecruitmentPlan.findMany({
      include: {
        _count: {
          select: {
            plannedTravel: true, plannedEvents: true,
            budgetItems: true, variationRequests: true,
          },
        },
      },
    });
    for (const p of plans) {
      const label = `plan [${p.id.slice(0, 8)}]`;
      check(
        `${label} plannedTravel`, p._count.plannedTravel,
        await scalar(`SELECT COUNT(*) FROM planned_travel WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} plannedEvents`, p._count.plannedEvents,
        await scalar(`SELECT COUNT(*) FROM planned_event_participations WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} budgetItems`, p._count.budgetItems,
        await scalar(`SELECT COUNT(*) FROM recruitment_plan_budget_items WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} variationRequests`, p._count.variationRequests,
        await scalar(`SELECT COUNT(*) FROM variation_requests WHERE "planId" = '${p.id}'`)
      );
    }
  }

  section("Recruitment Planning list (per status)");
  {
    const grouped = await db.quarterlyRecruitmentPlan.groupBy({
      by: ["status"], _count: { _all: true },
    });
    const sqlG = await db.$queryRawUnsafe(
      `SELECT status::text AS s, COUNT(*)::int AS c FROM quarterly_recruitment_plans GROUP BY status`
    );
    const t = Object.fromEntries(sqlG.map((r) => [r.s, r.c]));
    const u = Object.fromEntries(grouped.map((r) => [r.status, r._count._all]));
    for (const k of new Set([...Object.keys(t), ...Object.keys(u)])) {
      check(`plan status ${k}`, u[k] ?? 0, t[k] ?? 0);
    }
  }

  section("Recruitment Plan budget totals (spec §11 reconciliation)");
  {
    const p = await db.quarterlyRecruitmentPlan.findUnique({
      where: { id: seeded.planId },
      include: { budgetItems: true, plannedTravel: true, plannedFieldActivities: true },
    });
    const budgetSumUI = p.budgetItems.reduce((s, b) => s + (b.convertedAmount ?? b.amount ?? 0), 0);
    const budgetSumTruth = await scalar(
      `SELECT COALESCE(SUM(COALESCE("convertedAmount", amount, 0)), 0) FROM recruitment_plan_budget_items WHERE "planId" = '${p.id}'`
    );
    check(`plan budget sum`, budgetSumUI, budgetSumTruth);
  }

  // ── Cross-page consistency for the new modules ══════════════════════
  section("Cross-page consistency (seeded modules)");
  {
    // Campaign COMPLETED bucket vs list-page COMPLETED count
    const listPageCompleted = await db.campaign.count({ where: { deletedAt: null, status: "COMPLETED" } });
    const detailPageCompleted = await scalar(
      `SELECT COUNT(*) FROM campaigns WHERE "deletedAt" IS NULL AND status = 'COMPLETED'`
    );
    check("campaigns COMPLETED list vs detail", listPageCompleted, detailPageCompleted);

    // Recruitment planning list count matches count(*)
    const planCount = await db.quarterlyRecruitmentPlan.count();
    const planSql = await scalar(`SELECT COUNT(*) FROM quarterly_recruitment_plans`);
    check("recruitment plans total", planCount, planSql);
  }
}

async function main() {
  try {
    await seed();
    await audit();
  } finally {
    await cleanup();
  }

  process.stdout.write(`\n════════ SUMMARY ════════\n`);
  let totalP = 0, totalF = 0;
  for (const [mod, b] of perModule) {
    process.stdout.write(`  ${b.fail === 0 ? "✓" : "✗"} ${mod.padEnd(50)} ${b.pass} pass / ${b.fail} fail\n`);
    totalP += b.pass;
    totalF += b.fail;
  }
  process.stdout.write(`\nTOTAL: ${totalP} pass / ${totalF} fail\n`);
  if (mismatches.length > 0) {
    process.stdout.write(`\nMismatches:\n`);
    for (const m of mismatches) {
      process.stdout.write(`  ✗ [${m.module}] ${m.label} — computed=${m.computed} truth=${m.truth}\n`);
    }
    process.exit(1);
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => db.$disconnect());

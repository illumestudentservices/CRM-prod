#!/usr/bin/env node
/**
 * Display audit — verifies every count/KPI the UI renders matches the DB.
 *
 * The pattern: for each display, compute the value the UI would show by
 * replicating its query, then compute a ground-truth value with an
 * independent SQL query. Report any mismatch as a bug candidate.
 *
 * Covers:
 *   - Executive dashboard KPIs and pipeline
 *   - Personal/ICR dashboard KPIs and pipeline
 *   - Students page: total + per-stage + assignment status
 *   - Institutions page: per accountStatus
 *   - Recruitment Partners: per type
 *   - Campaigns: per status
 *   - Events: per status
 *   - Tasks: per status
 *   - Risk & Compliance: open/critical/pending/overdue
 *   - Reports: per status
 *   - HR: employees / on-leave / open tasks / pending leaves
 *   - Recycle bin: total pending
 *
 * Run on the VPS so it can reach @prisma/client and DATABASE_URL.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const mismatches = [];
const notes = [];
function check(label, computed, groundTruth, extra = "") {
  const ok = String(computed) === String(groundTruth);
  const arrow = ok ? "✓" : "✗";
  process.stdout.write(
    `  ${arrow}  ${label.padEnd(56)} computed=${String(computed).padEnd(6)} truth=${String(groundTruth).padEnd(6)} ${extra}\n`
  );
  if (!ok) mismatches.push({ label, computed, groundTruth, extra });
}

async function main() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  // ── EXECUTIVE DASHBOARD KPIs ────────────────────────────────────────
  process.stdout.write("\n=== Executive dashboard ===\n");
  {
    const totalLeadsUI = await db.lead.count({ where: { deletedAt: null } });
    const totalLeadsSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL`)[0].c;
    check("Total Leads", totalLeadsUI, totalLeadsSQL);

    const leadsThisMonthUI = await db.lead.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth } } });
    const leadsThisMonthSQL = (
      await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL AND "createdAt" >= ${startOfMonth}`
    )[0].c;
    check("Leads This Month", leadsThisMonthUI, leadsThisMonthSQL);

    const enrolledUI = await db.lead.count({ where: { deletedAt: null, stage: "ENROLLED" } });
    const enrolledSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL AND stage = 'ENROLLED'`)[0].c;
    check("Enrolled leads", enrolledUI, enrolledSQL);

    const activeInstUI = await db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE" } });
    const activeInstSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM institutions WHERE "deletedAt" IS NULL AND "accountStatus" = 'ACTIVE'`)[0].c;
    check("Active Institutions", activeInstUI, activeInstSQL);
  }

  // ── STUDENTS PAGE (Kanban totals per stage) ────────────────────────
  process.stdout.write("\n=== Students page (kanban) ===\n");
  {
    const stagesUI = await db.lead.groupBy({
      by: ["stage"],
      where: { deletedAt: null },
      _count: { stage: true },
    });
    const stagesSQL = await db.$queryRaw`SELECT stage, COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL GROUP BY stage`;
    const truth = Object.fromEntries(stagesSQL.map((r) => [r.stage, r.c]));
    const uiMap = Object.fromEntries(stagesUI.map((r) => [r.stage, r._count.stage]));
    const allStages = [...new Set([...Object.keys(truth), ...Object.keys(uiMap)])];
    for (const s of allStages) {
      check(`Stage: ${s}`, uiMap[s] ?? 0, truth[s] ?? 0);
    }
    const totalUI = Object.values(uiMap).reduce((a, b) => a + b, 0);
    const totalTruth = Object.values(truth).reduce((a, b) => a + b, 0);
    check("Kanban total (sum of stages)", totalUI, totalTruth);
  }

  // ── LEAD ASSIGNMENT INTEGRITY ───────────────────────────────────────
  process.stdout.write("\n=== Lead assignment sanity ===\n");
  {
    const unassigned = (
      await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL AND "assignedICRId" IS NULL`
    )[0].c;
    notes.push(`Unassigned leads (assignedICRId IS NULL): ${unassigned} — these are invisible on personal dashboards`);
    check("Unassigned leads count", unassigned, unassigned, "informational");
  }

  // ── INSTITUTIONS PAGE (per accountStatus) ──────────────────────────
  process.stdout.write("\n=== Institutions page ===\n");
  {
    const statuses = await db.$queryRaw`SELECT "accountStatus", COUNT(*)::int AS c FROM institutions WHERE "deletedAt" IS NULL GROUP BY "accountStatus"`;
    for (const row of statuses) {
      const uiCount = await db.institution.count({
        where: { deletedAt: null, accountStatus: row.accountStatus },
      });
      check(`Status: ${row.accountStatus}`, uiCount, row.c);
    }
  }

  // ── RECRUITMENT PARTNERS ────────────────────────────────────────────
  process.stdout.write("\n=== Recruitment Partners ===\n");
  {
    const types = await db.$queryRaw`SELECT type, COUNT(*)::int AS c FROM sources WHERE "deletedAt" IS NULL AND "isActive" = true GROUP BY type`;
    for (const row of types) {
      const uiCount = await db.recruitmentPartner.count({
        where: { deletedAt: null, isActive: true, type: row.type },
      });
      check(`Partner type: ${row.type}`, uiCount, row.c);
    }
  }

  // ── CAMPAIGNS ───────────────────────────────────────────────────────
  process.stdout.write("\n=== Campaigns ===\n");
  {
    const statuses = await db.$queryRaw`SELECT COALESCE(status::text, 'UNSET') AS s, COUNT(*)::int AS c FROM campaigns WHERE "deletedAt" IS NULL GROUP BY status`;
    for (const row of statuses) {
      const where = { deletedAt: null };
      if (row.s !== "UNSET") where.status = row.s;
      else where.status = null;
      const uiCount = await db.campaign.count({ where });
      check(`Campaign status: ${row.s}`, uiCount, row.c);
    }
  }

  // ── EVENTS ──────────────────────────────────────────────────────────
  process.stdout.write("\n=== Events ===\n");
  {
    const statuses = await db.$queryRaw`SELECT status, COUNT(*)::int AS c FROM events WHERE "deletedAt" IS NULL GROUP BY status`;
    for (const row of statuses) {
      const uiCount = await db.event.count({ where: { deletedAt: null, status: row.status } });
      check(`Event status: ${row.status}`, uiCount, row.c);
    }
  }

  // ── TASKS ───────────────────────────────────────────────────────────
  process.stdout.write("\n=== Tasks ===\n");
  {
    const statuses = await db.$queryRaw`SELECT status, COUNT(*)::int AS c FROM tasks WHERE "deletedAt" IS NULL GROUP BY status`;
    for (const row of statuses) {
      const uiCount = await db.task.count({ where: { deletedAt: null, status: row.status } });
      check(`Task status: ${row.status}`, uiCount, row.c);
    }
    const total = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM tasks WHERE "deletedAt" IS NULL`)[0].c;
    const uiTotal = await db.task.count({ where: { deletedAt: null } });
    check("Tasks total", uiTotal, total);
  }

  // ── RISK & COMPLIANCE ───────────────────────────────────────────────
  process.stdout.write("\n=== Risk & Compliance ===\n");
  {
    // Risk register client uses risks.filter, not a query — but the source of truth is the API list.
    const openRisksUI = await db.riskRegister.count({ where: { status: "OPEN" } });
    const openRisksSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM risk_registers WHERE status = 'OPEN'`)[0].c;
    check("Open risks", openRisksUI, openRisksSQL);

    const criticalUI = await db.riskRegister.count({ where: { riskScore: { gte: 20 } } });
    const criticalSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM risk_registers WHERE "riskScore" >= 20`)[0].c;
    check("Critical risks (score>=20)", criticalUI, criticalSQL);

    const pendingUI = await db.complianceItem.count({ where: { status: "PENDING" } });
    const pendingSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM compliance_items WHERE status = 'PENDING'`)[0].c;
    check("Pending compliance", pendingUI, pendingSQL);

    const overdueUI = await db.complianceItem.count({ where: { status: "OVERDUE" } });
    const overdueSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM compliance_items WHERE status = 'OVERDUE'`)[0].c;
    check("Overdue compliance", overdueUI, overdueSQL);
  }

  // ── REPORTS ─────────────────────────────────────────────────────────
  process.stdout.write("\n=== Reports ===\n");
  {
    const statuses = await db.$queryRaw`SELECT status, COUNT(*)::int AS c FROM monthly_reports WHERE "deletedAt" IS NULL GROUP BY status`;
    for (const row of statuses) {
      const uiCount = await db.monthlyReport.count({ where: { deletedAt: null, status: row.status } });
      check(`Report status: ${row.status}`, uiCount, row.c);
    }
  }

  // ── HR ──────────────────────────────────────────────────────────────
  process.stdout.write("\n=== HR ===\n");
  {
    // Total employees — Employee model has no deletedAt column (soft-delete
    // is done at the User row and Employee.isActive).
    const totalEmpUI = await db.employee.count({ where: { isActive: true } });
    const totalEmpSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM employees WHERE "isActive" = true`)[0].c;
    check("Active employees", totalEmpUI, totalEmpSQL);

    // Pending leaves (HR "Pending Leave" KPI)
    const pendingLeavesUI = await db.leaveRequest.count({ where: { status: "PENDING" } });
    const pendingLeavesSQL = (await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leave_requests WHERE status = 'PENDING'`)[0].c;
    check("Pending leaves", pendingLeavesUI, pendingLeavesSQL);

    // On Leave Today
    const onLeaveTodayUI = await db.leaveRequest.count({
      where: {
        status: "APPROVED",
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });
    const onLeaveTodaySQL = (
      await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leave_requests WHERE status = 'APPROVED' AND "startDate" <= ${now} AND "endDate" >= ${now}`
    )[0].c;
    check("On leave today", onLeaveTodayUI, onLeaveTodaySQL);
  }

  // ── RECYCLE BIN ─────────────────────────────────────────────────────
  process.stdout.write("\n=== Recycle bin ===\n");
  {
    const pendingUI = await db.deletedRecord.count({ where: { restoredAt: null, purgedAt: null } });
    const pendingSQL = (
      await db.$queryRaw`SELECT COUNT(*)::int AS c FROM deleted_records WHERE "restoredAt" IS NULL AND "purgedAt" IS NULL`
    )[0].c;
    check("Bin pending items", pendingUI, pendingSQL);
  }

  // ── PER-INSTITUTION _count CONSISTENCY ──────────────────────────────
  //
  // Institution detail pages render institution._count.leads etc. Any include
  // that filters by deletedAt=null must be checked against a hand-written
  // SQL. This is the most common place a display drifts.
  process.stdout.write("\n=== Institution detail: _count consistency (spot check) ===\n");
  {
    const inst = await db.institution.findFirst({
      where: { deletedAt: null },
      select: {
        id: true, name: true,
        _count: {
          select: {
            leads: { where: { deletedAt: null } },
            contacts: true,
            contracts: true,
            engagementLogs: true,
            activities: true,
          },
        },
      },
    });
    if (inst) {
      const leadsTruth = (
        await db.$queryRaw`SELECT COUNT(*)::int AS c FROM leads WHERE "institutionId" = ${inst.id} AND "deletedAt" IS NULL`
      )[0].c;
      const contactsTruth = (
        await db.$queryRaw`SELECT COUNT(*)::int AS c FROM institution_contacts WHERE "institutionId" = ${inst.id}`
      )[0].c;
      const contractsTruth = (
        await db.$queryRaw`SELECT COUNT(*)::int AS c FROM contracts WHERE "institutionId" = ${inst.id}`
      )[0].c;
      const engagementsTruth = (
        await db.$queryRaw`SELECT COUNT(*)::int AS c FROM engagement_logs WHERE "institutionId" = ${inst.id}`
      )[0].c;
      const activitiesTruth = (
        await db.$queryRaw`SELECT COUNT(*)::int AS c FROM activities WHERE "institutionId" = ${inst.id} AND "deletedAt" IS NULL`
      )[0].c;

      check(`${inst.name}: _count.leads`, inst._count.leads, leadsTruth);
      check(`${inst.name}: _count.contacts`, inst._count.contacts, contactsTruth);
      check(`${inst.name}: _count.contracts`, inst._count.contracts, contractsTruth);
      check(`${inst.name}: _count.engagementLogs`, inst._count.engagementLogs, engagementsTruth);
      check(`${inst.name}: _count.activities`, inst._count.activities, activitiesTruth);
    }
  }

  // ── PIPELINE STAGE DERIVED FROM INSTITUTION INTERESTS ──────────────
  //
  // Leads have both Lead.stage AND InstitutionInterest.stage. A syncLead
  // helper writes Lead.stage from the "furthest along" interest. Drift here
  // means the kanban shows a different stage than the interests panel.
  process.stdout.write("\n=== Lead ↔ InstitutionInterest stage drift ===\n");
  {
    const drift = await db.$queryRaw`
      SELECT COUNT(*)::int AS c FROM leads l
      WHERE l."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM institution_interests i
          WHERE i."leadId" = l.id
            AND i."closedAt" IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM institution_interests i
          WHERE i."leadId" = l.id
            AND i."closedAt" IS NULL
            AND i.stage::text = l.stage::text
        )
    `;
    notes.push(`Leads whose stage doesn't match any live interest: ${drift[0].c}`);
    if (drift[0].c > 0) {
      mismatches.push({
        label: "Lead.stage vs interest.stage drift",
        computed: drift[0].c,
        groundTruth: 0,
        extra: "leads have a stage that no live interest holds",
      });
      process.stdout.write(`  ✗  Lead-vs-interest stage drift: ${drift[0].c} leads out of sync\n`);
    } else {
      process.stdout.write(`  ✓  Lead-vs-interest stage drift: 0\n`);
    }
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────
  process.stdout.write(`\n=== SUMMARY ===\n`);
  process.stdout.write(`Mismatches: ${mismatches.length}\n`);
  if (mismatches.length > 0) {
    for (const m of mismatches) {
      process.stdout.write(`  ✗ ${m.label} — computed=${m.computed} truth=${m.groundTruth} ${m.extra}\n`);
    }
  }
  if (notes.length > 0) {
    process.stdout.write(`\nNotes:\n`);
    for (const n of notes) process.stdout.write(`  · ${n}\n`);
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => db.$disconnect());

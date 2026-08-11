#!/usr/bin/env node
/**
 * FULL display audit — one check per aggregate rendered on any page.
 *
 * Every db.<model>.count / db.<model>.groupBy / include{_count} in the
 * dashboard tree is mirrored here and compared against an independent raw
 * SQL query. If a page-level query is wrong (e.g. missing deletedAt filter,
 * misusing a status bucket) the mismatch shows up as computed ≠ truth.
 *
 * Runs on the VPS. Prints a per-module summary at the bottom.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const mismatches = [];
let currentModule = "";
const perModule = new Map();

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

async function main() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

  // ══════ DASHBOARD: EXECUTIVE ═══════════════════════════════════════
  section("Dashboard / Executive");
  {
    check(
      "totalLeads",
      await db.lead.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL`)
    );
    check(
      "leadsThisMonth",
      await db.lead.count({ where: { deletedAt: null, createdAt: { gte: startOfMonth } } }),
      await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND "createdAt" >= '${startOfMonth.toISOString()}'`)
    );
    check(
      "leadsLastMonth",
      await db.lead.count({ where: { deletedAt: null, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } } }),
      await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND "createdAt" >= '${startOfLastMonth.toISOString()}' AND "createdAt" <= '${endOfLastMonth.toISOString()}'`)
    );
    check(
      "enrolled",
      await db.lead.count({ where: { deletedAt: null, stage: "ENROLLED" } }),
      await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND stage = 'ENROLLED'`)
    );
    check(
      "enrolledLastMonth (by updatedAt)",
      await db.lead.count({
        where: { deletedAt: null, stage: "ENROLLED", updatedAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      }),
      await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND stage = 'ENROLLED' AND "updatedAt" >= '${startOfLastMonth.toISOString()}' AND "updatedAt" <= '${endOfLastMonth.toISOString()}'`)
    );
    check(
      "activeInstitutions",
      await db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE" } }),
      await scalar(`SELECT COUNT(*) FROM institutions WHERE "deletedAt" IS NULL AND "accountStatus" = 'ACTIVE'`)
    );

    // Pipeline groupBy — every stage must match
    const stagesUI = await db.lead.groupBy({ by: ["stage"], where: { deletedAt: null }, _count: { stage: true } });
    const stagesSQL = await db.$queryRawUnsafe(`SELECT stage, COUNT(*)::int AS c FROM leads WHERE "deletedAt" IS NULL GROUP BY stage`);
    const truth = Object.fromEntries(stagesSQL.map((r) => [r.stage, r.c]));
    const ui = Object.fromEntries(stagesUI.map((r) => [r.stage, r._count.stage]));
    for (const s of new Set([...Object.keys(truth), ...Object.keys(ui)])) {
      check(`Pipeline: ${s}`, ui[s] ?? 0, truth[s] ?? 0);
    }
  }

  // ══════ DASHBOARD: ICR/PERSONAL (sample against one active ICR) ═════
  section("Dashboard / ICR (sample user)");
  {
    const icr = await db.user.findFirst({
      where: { role: "ICR", isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!icr) {
      process.stdout.write("  (no active ICRs — skipped)\n");
    } else {
      const userId = icr.id;
      const where = { deletedAt: null, assignedICRId: userId };
      const label = `[${icr.name ?? userId}] `;
      check(
        label + "totalLeads (mine)",
        await db.lead.count({ where }),
        await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND "assignedICRId" = '${userId}'`)
      );
      check(
        label + "enrolled (mine)",
        await db.lead.count({ where: { ...where, stage: "ENROLLED" } }),
        await scalar(`SELECT COUNT(*) FROM leads WHERE "deletedAt" IS NULL AND "assignedICRId" = '${userId}' AND stage = 'ENROLLED'`)
      );
      check(
        label + "upcomingEvents (mine, planned/confirmed)",
        await db.event.count({
          where: { deletedAt: null, assignedICRId: userId, date: { gte: now }, status: { in: ["PLANNED", "CONFIRMED"] } },
        }),
        await scalar(
          `SELECT COUNT(*) FROM events WHERE "deletedAt" IS NULL AND "assignedICRId" = '${userId}' AND date >= '${now.toISOString()}' AND status IN ('PLANNED','CONFIRMED')`
        )
      );
      check(
        label + "pendingReports (mine)",
        await db.monthlyReport.count({ where: { icrId: userId, status: { in: ["DRAFT", "PENDING_REVIEW"] } } }),
        await scalar(`SELECT COUNT(*) FROM monthly_reports WHERE "icrId" = '${userId}' AND status IN ('DRAFT','PENDING_REVIEW')`)
      );
    }
  }

  // ══════ INSTITUTIONS LIST ══════════════════════════════════════════
  section("Institutions list");
  {
    check(
      "total",
      await db.institution.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM institutions WHERE "deletedAt" IS NULL`)
    );
    check(
      "ACTIVE",
      await db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE" } }),
      await scalar(`SELECT COUNT(*) FROM institutions WHERE "deletedAt" IS NULL AND "accountStatus" = 'ACTIVE'`)
    );
    check(
      "PROSPECT",
      await db.institution.count({ where: { deletedAt: null, accountStatus: "PROSPECT" } }),
      await scalar(`SELECT COUNT(*) FROM institutions WHERE "deletedAt" IS NULL AND "accountStatus" = 'PROSPECT'`)
    );
    // Open Issues aggregate across all institutions
    check(
      "openIssues (aggregate)",
      await db.clientIssue.count({ where: { status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      await scalar(`SELECT COUNT(*) FROM client_issues WHERE status NOT IN ('RESOLVED','CLOSED')`)
    );
  }

  // ══════ INSTITUTION DETAIL (spot check — every _count) ═════════════
  section("Institution detail (_count consistency)");
  {
    const insts = await db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      take: 3,
    });
    for (const inst of insts) {
      const label = `[${inst.name}] `;
      // Every _count filter used on institutions/[id]/page.tsx (line 74+):
      // leads, contacts, contracts, engagementLogs, activities, issues (filtered)
      const uiCounts = await db.institution.findUnique({
        where: { id: inst.id },
        select: {
          _count: {
            select: {
              leads: { where: { deletedAt: null } },
              contacts: true,
              contracts: true,
              engagementLogs: true,
              activities: true,
              issues: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } } },
            },
          },
        },
      });
      check(
        label + "leads (non-deleted)",
        uiCounts._count.leads,
        await scalar(`SELECT COUNT(*) FROM leads WHERE "institutionId" = '${inst.id}' AND "deletedAt" IS NULL`)
      );
      check(
        label + "contacts",
        uiCounts._count.contacts,
        await scalar(`SELECT COUNT(*) FROM institution_contacts WHERE "institutionId" = '${inst.id}'`)
      );
      check(
        label + "contracts",
        uiCounts._count.contracts,
        await scalar(`SELECT COUNT(*) FROM contracts WHERE "institutionId" = '${inst.id}'`)
      );
      check(
        label + "engagementLogs",
        uiCounts._count.engagementLogs,
        await scalar(`SELECT COUNT(*) FROM engagement_logs WHERE "institutionId" = '${inst.id}'`)
      );
      check(
        label + "activities",
        uiCounts._count.activities,
        await scalar(`SELECT COUNT(*) FROM activities WHERE "institutionId" = '${inst.id}'`)
      );
      check(
        label + "openIssues (issues card)",
        uiCounts._count.issues,
        await scalar(`SELECT COUNT(*) FROM client_issues WHERE "institutionId" = '${inst.id}' AND status NOT IN ('RESOLVED','CLOSED')`)
      );
    }
  }

  // ══════ HR PAGE ════════════════════════════════════════════════════
  section("HR page");
  {
    // Active employees (ACTIVE_EMPLOYEE = isActive: true; users.deletedAt IS NULL check via join)
    check(
      "activeEmployees",
      await db.employee.count({ where: { isActive: true, user: { deletedAt: null } } }),
      await scalar(`SELECT COUNT(*) FROM employees e JOIN users u ON u.id = e."userId" WHERE e."isActive" = true AND u."deletedAt" IS NULL`)
    );
    check(
      "onLeaveToday (approved covering today)",
      await db.leaveRequest.count({
        where: { status: "APPROVED", startDate: { lte: now }, endDate: { gte: now } },
      }),
      await scalar(
        `SELECT COUNT(*) FROM leave_requests WHERE status = 'APPROVED' AND "startDate" <= '${now.toISOString()}' AND "endDate" >= '${now.toISOString()}'`
      )
    );
    check(
      "openTasks (HR queue)",
      await db.task.count({ where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM tasks WHERE status IN ('TODO','IN_PROGRESS') AND "deletedAt" IS NULL`)
    );
    check(
      "pendingLeaves (owned by live employee)",
      await db.leaveRequest.count({
        where: { status: "PENDING", employee: { user: { deletedAt: null } } },
      }),
      await scalar(`SELECT COUNT(*) FROM leave_requests lr JOIN employees e ON e.id = lr."employeeId" JOIN users u ON u.id = e."userId" WHERE lr.status = 'PENDING' AND u."deletedAt" IS NULL`)
    );

    // Departments _count.employees
    const depts = await db.department.findMany({
      include: { _count: { select: { employees: { where: { isActive: true, user: { deletedAt: null } } } } } },
    });
    for (const d of depts) {
      const truth = await scalar(
        `SELECT COUNT(*) FROM employees e JOIN users u ON u.id = e."userId" WHERE e."departmentId" = '${d.id}' AND e."isActive" = true AND u."deletedAt" IS NULL`
      );
      check(`Department [${d.name}] employees`, d._count.employees, truth);
    }
  }

  // ══════ REPORTS PAGE ═══════════════════════════════════════════════
  section("Reports list");
  {
    const statuses = ["DRAFT", "PENDING_REVIEW", "REGIONAL_APPROVED", "HQ_REVIEW", "FINAL_APPROVED", "RETURNED"];
    for (const s of statuses) {
      check(
        `status=${s}`,
        await db.monthlyReport.count({ where: { deletedAt: null, status: s } }),
        await scalar(`SELECT COUNT(*) FROM monthly_reports WHERE "deletedAt" IS NULL AND status = '${s}'`)
      );
    }
  }

  // ══════ SETTINGS PAGE ══════════════════════════════════════════════
  section("Settings page");
  {
    check(
      "users (non-deleted)",
      await db.user.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM users WHERE "deletedAt" IS NULL`)
    );
    check("regions", await db.region.count(), await scalar(`SELECT COUNT(*) FROM regions`));
    check(
      "institutions",
      await db.institution.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM institutions WHERE "deletedAt" IS NULL`)
    );
    check(
      "recruitmentPartners (non-deleted)",
      await db.recruitmentPartner.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM sources WHERE "deletedAt" IS NULL`)
    );
  }

  // ══════ FIELD OPERATIONS ═══════════════════════════════════════════
  section("Field Operations (activities)");
  {
    check(
      "totalActivities (non-deleted)",
      await db.activity.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM activities WHERE "deletedAt" IS NULL`)
    );
    check(
      "activitiesThisMonth",
      await db.activity.count({ where: { deletedAt: null, date: { gte: startOfMonth } } }),
      await scalar(`SELECT COUNT(*) FROM activities WHERE "deletedAt" IS NULL AND date >= '${startOfMonth.toISOString()}'`)
    );
    // groupBy type
    const uiByType = await db.activity.groupBy({ by: ["type"], where: { deletedAt: null }, _count: true });
    const sqlByType = await db.$queryRawUnsafe(`SELECT type, COUNT(*)::int AS c FROM activities WHERE "deletedAt" IS NULL GROUP BY type`);
    const t = Object.fromEntries(sqlByType.map((r) => [r.type, r.c]));
    const u = Object.fromEntries(uiByType.map((r) => [r.type, r._count]));
    for (const k of new Set([...Object.keys(t), ...Object.keys(u)])) {
      check(`activity type ${k}`, u[k] ?? 0, t[k] ?? 0);
    }
  }

  // ══════ ACTIVITY LOG ═══════════════════════════════════════════════
  section("Activity log");
  {
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    check(
      "auditLog total",
      await db.auditLog.count(),
      await scalar(`SELECT COUNT(*) FROM audit_logs`)
    );
    check(
      "auditLog today",
      await db.auditLog.count({ where: { createdAt: { gte: today0 } } }),
      await scalar(`SELECT COUNT(*) FROM audit_logs WHERE "createdAt" >= '${today0.toISOString()}'`)
    );
  }

  // ══════ EVENTS TOP-LEVEL LIST ══════════════════════════════════════
  section("Events list");
  {
    check(
      "events total",
      await db.event.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM events WHERE "deletedAt" IS NULL`)
    );
    // per-status via groupBy on the network events page
    const grouped = await db.event.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
    const sqlGrouped = await db.$queryRawUnsafe(`SELECT status, COUNT(*)::int AS c FROM events WHERE "deletedAt" IS NULL GROUP BY status`);
    const t = Object.fromEntries(sqlGrouped.map((r) => [r.status, r.c]));
    const u = Object.fromEntries(grouped.map((r) => [r.status, r._count._all]));
    for (const k of new Set([...Object.keys(t), ...Object.keys(u)])) {
      check(`event status ${k}`, u[k] ?? 0, t[k] ?? 0);
    }

    // spot-check _count.leads on some events
    const events = await db.event.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { leads: true, participations: true, expenses: true } } },
      take: 3,
    });
    for (const e of events) {
      const truthLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE "eventId" = '${e.id}' AND "deletedAt" IS NULL`);
      check(`event [${e.name}] leads (non-deleted)`, e._count.leads, truthLeads);
      const truthParts = await scalar(`SELECT COUNT(*) FROM event_participations WHERE "eventId" = '${e.id}'`);
      check(`event [${e.name}] participations`, e._count.participations, truthParts);
      const truthExp = await scalar(`SELECT COUNT(*) FROM event_expenses WHERE "eventId" = '${e.id}'`);
      check(`event [${e.name}] expenses`, e._count.expenses, truthExp);
    }
  }

  // ══════ RECRUITMENT NETWORK: PARTNERS ══════════════════════════════
  section("Recruitment Network / Partners");
  {
    // per-type groupBy used by the tab bar
    const partnerTabTypes = ["AGENT", "SCHOOL", "REFERRAL_PARTNER", "PARTNER", "EDUCATION_PARTNER"];
    const grouped = await db.recruitmentPartner.groupBy({
      by: ["type"],
      where: { deletedAt: null, isActive: true, type: { in: partnerTabTypes } },
      _count: { _all: true },
    });
    for (const t of partnerTabTypes) {
      const uiCount = grouped.find((r) => r.type === t)?._count._all ?? 0;
      const truth = await scalar(
        `SELECT COUNT(*) FROM sources WHERE "deletedAt" IS NULL AND "isActive" = true AND type = '${t}'`
      );
      check(`type ${t}`, uiCount, truth);
    }
    // sum across the tab bar
    const totalTab = grouped.reduce((a, r) => a + r._count._all, 0);
    const truthTotal = await scalar(
      `SELECT COUNT(*) FROM sources WHERE "deletedAt" IS NULL AND "isActive" = true AND type IN ('AGENT','SCHOOL','REFERRAL_PARTNER','PARTNER','EDUCATION_PARTNER')`
    );
    check(`Partners tab-bar total`, totalTab, truthTotal);

    // spot-check per-partner _count.leads
    const partners = await db.recruitmentPartner.findMany({
      where: { deletedAt: null, isActive: true },
      include: { _count: { select: { leads: true, partnerContacts: true } } },
      take: 3,
    });
    for (const p of partners) {
      const truthLeads = await scalar(`SELECT COUNT(*) FROM leads WHERE "sourceId" = '${p.id}' AND "deletedAt" IS NULL`);
      const truthContacts = await scalar(`SELECT COUNT(*) FROM partner_contacts WHERE "partnerId" = '${p.id}'`);
      check(`partner [${p.name}] leads`, p._count.leads, truthLeads);
      check(`partner [${p.name}] partnerContacts`, p._count.partnerContacts, truthContacts);
    }
  }

  // ══════ RECRUITMENT NETWORK: CAMPAIGNS ═════════════════════════════
  section("Recruitment Network / Campaigns");
  {
    const grouped = await db.campaign.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
    const sqlGrouped = await db.$queryRawUnsafe(`SELECT COALESCE(status::text,'UNSET') AS s, COUNT(*)::int AS c FROM campaigns WHERE "deletedAt" IS NULL GROUP BY status`);
    const t = Object.fromEntries(sqlGrouped.map((r) => [r.s, r.c]));
    const u = Object.fromEntries(grouped.map((r) => [r.status ?? "UNSET", r._count._all]));
    const all = new Set([...Object.keys(t), ...Object.keys(u)]);
    if (all.size === 0) process.stdout.write("  (no campaigns)\n");
    for (const k of all) {
      check(`campaign status ${k}`, u[k] ?? 0, t[k] ?? 0);
    }
  }

  // ══════ RECRUITMENT NETWORK: PERFORMANCE ═══════════════════════════
  section("Recruitment Network / Performance");
  {
    // Sources w/ activity count
    const sources = await db.recruitmentPartner.findMany({
      where: { deletedAt: null, isActive: true },
      include: { _count: { select: { activities: true } } },
      take: 3,
    });
    for (const s of sources) {
      const truth = await scalar(`SELECT COUNT(*) FROM activities WHERE "sourceId" = '${s.id}' AND "deletedAt" IS NULL`);
      check(`partner [${s.name}] activities`, s._count.activities, truth);
    }
  }

  // ══════ RECRUITMENT PLANNING ═══════════════════════════════════════
  section("Recruitment Planning");
  {
    const plans = await db.quarterlyRecruitmentPlan.findMany({
      include: {
        _count: {
          select: { plannedTravel: true, plannedEvents: true, budgetItems: true, variationRequests: true },
        },
      },
      take: 3,
    });
    if (plans.length === 0) {
      process.stdout.write("  (no plans in DB)\n");
    }
    for (const p of plans) {
      const label = `plan [${p.id.slice(0, 8)}]`;
      check(
        `${label} plannedTravel`,
        p._count.plannedTravel,
        await scalar(`SELECT COUNT(*) FROM planned_travel WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} plannedEvents`,
        p._count.plannedEvents,
        await scalar(`SELECT COUNT(*) FROM planned_event_participations WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} budgetItems`,
        p._count.budgetItems,
        await scalar(`SELECT COUNT(*) FROM recruitment_plan_budget_items WHERE "planId" = '${p.id}'`)
      );
      check(
        `${label} variationRequests`,
        p._count.variationRequests,
        await scalar(`SELECT COUNT(*) FROM variation_requests WHERE "planId" = '${p.id}'`)
      );
    }
  }

  // ══════ MARKET INTELLIGENCE ════════════════════════════════════════
  section("Market Intelligence");
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
      take: 3,
    });
    if (markets.length === 0) {
      process.stdout.write("  (no markets in DB)\n");
    }
    for (const m of markets) {
      const label = `market [${m.name}]`;
      check(
        `${label} schools`,
        m._count.schools,
        await scalar(`SELECT COUNT(*) FROM schools WHERE "marketId" = '${m.id}' AND "deletedAt" IS NULL`)
      );
      check(
        `${label} activities`,
        m._count.activities,
        await scalar(`SELECT COUNT(*) FROM activities WHERE "marketId" = '${m.id}' AND "deletedAt" IS NULL`)
      );
      check(
        `${label} pendingSuggestions`,
        m._count.updateSuggestions,
        await scalar(`SELECT COUNT(*) FROM market_update_suggestions WHERE "marketId" = '${m.id}' AND status = 'PENDING'`)
      );
    }
  }

  // ══════ MARKETS ═══════════════════════════════════════════════════
  section("Markets list");
  {
    const markets = await db.market.findMany({
      include: {
        _count: {
          select: {
            schools: true,
            activities: true,
            riskRegisters: true,
          },
        },
      },
      take: 3,
    });
    if (markets.length === 0) {
      process.stdout.write("  (no markets in DB)\n");
    }
    for (const m of markets) {
      const label = `market [${m.name}]`;
      check(
        `${label} riskRegisters`,
        m._count.riskRegisters,
        await scalar(`SELECT COUNT(*) FROM risk_registers WHERE "marketId" = '${m.id}'`)
      );
    }
  }

  // ══════ TASKS PAGE ═════════════════════════════════════════════════
  section("Tasks");
  {
    const statuses = ["TODO", "IN_PROGRESS", "DONE", "CANCELLED"];
    for (const s of statuses) {
      check(
        `status ${s}`,
        await db.task.count({ where: { deletedAt: null, status: s } }),
        await scalar(`SELECT COUNT(*) FROM tasks WHERE "deletedAt" IS NULL AND status = '${s}'`)
      );
    }
    check(
      "total non-deleted",
      await db.task.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM tasks WHERE "deletedAt" IS NULL`)
    );
  }

  // ══════ RISK & COMPLIANCE ══════════════════════════════════════════
  section("Risk & Compliance");
  {
    check(
      "openRisks",
      await db.riskRegister.count({ where: { status: "OPEN" } }),
      await scalar(`SELECT COUNT(*) FROM risk_registers WHERE status = 'OPEN'`)
    );
    check(
      "criticalRisks (score >=20)",
      await db.riskRegister.count({ where: { riskScore: { gte: 20 } } }),
      await scalar(`SELECT COUNT(*) FROM risk_registers WHERE "riskScore" >= 20`)
    );
    for (const s of ["PENDING", "IN_PROGRESS", "COMPLETED", "OVERDUE"]) {
      check(
        `compliance ${s}`,
        await db.complianceItem.count({ where: { status: s } }),
        await scalar(`SELECT COUNT(*) FROM compliance_items WHERE status = '${s}'`)
      );
    }
  }

  // ══════ RECYCLE BIN ════════════════════════════════════════════════
  section("Recycle Bin");
  {
    check(
      "pending items total",
      await db.deletedRecord.count({ where: { restoredAt: null, purgedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM deleted_records WHERE "restoredAt" IS NULL AND "purgedAt" IS NULL`)
    );
    // per entityType groupBy
    const grouped = await db.deletedRecord.groupBy({
      by: ["entityType"],
      where: { restoredAt: null, purgedAt: null },
      _count: { _all: true },
    });
    const sqlG = await db.$queryRawUnsafe(`SELECT "entityType", COUNT(*)::int AS c FROM deleted_records WHERE "restoredAt" IS NULL AND "purgedAt" IS NULL GROUP BY "entityType"`);
    const t = Object.fromEntries(sqlG.map((r) => [r.entityType, r.c]));
    const u = Object.fromEntries(grouped.map((r) => [r.entityType, r._count._all]));
    for (const k of new Set([...Object.keys(t), ...Object.keys(u)])) {
      check(`bin type ${k}`, u[k] ?? 0, t[k] ?? 0);
    }
  }

  // ══════ STAKEHOLDERS (schools + counsellors) ═══════════════════════
  section("Stakeholders");
  {
    check(
      "schools (non-deleted)",
      await db.school.count({ where: { deletedAt: null } }),
      await scalar(`SELECT COUNT(*) FROM schools WHERE "deletedAt" IS NULL`)
    );
    check(
      "counsellors (all)",
      await db.counsellor.count(),
      await scalar(`SELECT COUNT(*) FROM counsellors`)
    );
    // per-school _count.counsellors
    const schools = await db.school.findMany({
      where: { deletedAt: null },
      include: { _count: { select: { counsellors: true } } },
      take: 3,
    });
    for (const s of schools) {
      check(
        `school [${s.name}] counsellors`,
        s._count.counsellors,
        await scalar(`SELECT COUNT(*) FROM counsellors WHERE "schoolId" = '${s.id}'`)
      );
    }
  }

  // ══════ CROSS-PAGE CONSISTENCY ═════════════════════════════════════
  section("Cross-page consistency");
  {
    // Executive dashboard "Total Leads" vs Students page total
    const dashTotal = await db.lead.count({ where: { deletedAt: null } });
    const kanbanSum = (
      await db.lead.groupBy({ by: ["stage"], where: { deletedAt: null }, _count: { stage: true } })
    ).reduce((a, r) => a + r._count.stage, 0);
    check("Dashboard totalLeads == kanban sum", dashTotal, kanbanSum);

    // Institutions page total vs Settings page institutions
    const instA = await db.institution.count({ where: { deletedAt: null } });
    const instB = await db.institution.count({ where: { deletedAt: null } });
    check("Institutions list total == Settings.institutions", instA, instB);

    // HR openTasks vs Tasks page TODO+IN_PROGRESS
    const hrTasks = await db.task.count({
      where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
    });
    const tasksPageOpen =
      (await db.task.count({ where: { status: "TODO", deletedAt: null } })) +
      (await db.task.count({ where: { status: "IN_PROGRESS", deletedAt: null } }));
    check("HR openTasks == Tasks page (TODO+IN_PROGRESS)", hrTasks, tasksPageOpen);
  }

  // ══════ SUMMARY ═════════════════════════════════════════════════════
  process.stdout.write("\n════════ SUMMARY ════════\n");
  let totalP = 0, totalF = 0;
  for (const [mod, b] of perModule) {
    process.stdout.write(`  ${b.fail === 0 ? "✓" : "✗"} ${mod.padEnd(48)} ${b.pass} pass / ${b.fail} fail\n`);
    totalP += b.pass;
    totalF += b.fail;
  }
  process.stdout.write(`\nTOTAL: ${totalP} pass / ${totalF} fail\n`);
  if (mismatches.length > 0) {
    process.stdout.write(`\nMismatches (all bugs to fix):\n`);
    for (const m of mismatches) {
      process.stdout.write(`  ✗ [${m.module}] ${m.label} — computed=${m.computed} truth=${m.truth}\n`);
    }
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exit(1); })
  .finally(() => db.$disconnect());

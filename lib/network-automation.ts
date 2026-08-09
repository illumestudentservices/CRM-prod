import { db } from "@/lib/db";
import type { AgentTier, RelationshipStatus } from "@prisma/client";

/// Automation jobs for the Recruitment Network layer:
///
///   * Agent Tier auto-recalculation (spec §7 Stakeholders retirement)
///   * Relationship Health auto-classification (spec §8)
///   * Contract renewal reminders (spec §6 Clients Module)
///
/// All three are driven by rolling-12-month CRM data and produce
/// notifications + status writes; no user-facing action required.

const DAY_MS = 86_400_000;

// ─── Agent Tier thresholds (spec §7 configurable) ──────────────────────────
// Interpreted as enrolments in the last 12 months.
const AGENT_TIER_THRESHOLDS: Array<{ tier: AgentTier; minEnrolments: number }> = [
  { tier: "PLATINUM", minEnrolments: 20 },
  { tier: "GOLD",     minEnrolments: 10 },
  { tier: "SILVER",   minEnrolments: 3 },
  { tier: "EMERGING", minEnrolments: 0 },
];

export interface AgentTierSummary {
  ranAt: string;
  dryRun: boolean;
  tierChanges: number;
  agentsProcessed: number;
}

export async function recalcAgentTiers(opts: { dryRun?: boolean } = {}): Promise<AgentTierSummary> {
  const dryRun = !!opts.dryRun;
  const summary: AgentTierSummary = { ranAt: new Date().toISOString(), dryRun, tierChanges: 0, agentsProcessed: 0 };

  const rollingFrom = new Date(Date.now() - 365 * DAY_MS);
  const agents = await db.agentProfile.findMany({
    include: { source: { select: { id: true, name: true } } },
  });

  for (const ap of agents) {
    summary.agentsProcessed++;
    // Count leads attributed to this agent's Source that reached ENROLLED
    // through any Institution Interest in the last 12 months.
    const enrolments = await db.institutionInterest.count({
      where: {
        stage: "ENROLLED",
        lead: { sourceId: ap.sourceId, deletedAt: null },
        convertedAt: { gte: rollingFrom },
      },
    });

    let newTier: AgentTier = "EMERGING";
    for (const rule of AGENT_TIER_THRESHOLDS) {
      if (enrolments >= rule.minEnrolments) { newTier = rule.tier; break; }
    }

    if (newTier !== ap.tier) {
      if (!dryRun) {
        // Stamp tierCalculatedAt so subsequent manual PUTs to /api/stakeholders/agents
        // are refused. This is what turns Agent Tier from a manual dropdown
        // into an auto-derived value per spec §7.
        await db.agentProfile.update({
          where: { id: ap.id },
          data: { tier: newTier, enrolments, tierCalculatedAt: new Date() },
        });
      }
      summary.tierChanges++;
    } else if (!dryRun && enrolments !== ap.enrolments) {
      await db.agentProfile.update({
        where: { id: ap.id },
        data: { enrolments, tierCalculatedAt: new Date() },
      });
    } else if (!dryRun && !ap.tierCalculatedAt) {
      // First-time run for an existing agent: stamp so we can start refusing
      // manual overrides even though the tier didn't change.
      await db.agentProfile.update({
        where: { id: ap.id },
        data: { tierCalculatedAt: new Date() },
      });
    }
  }

  return summary;
}

// ─── Relationship Health auto-classification ───────────────────────────────
// spec §8 — School.relationshipStatus is derived from days since last engagement.
export interface RelationshipHealthSummary {
  ranAt: string;
  dryRun: boolean;
  schoolsRecomputed: number;
  statusChanges: number;
}

export async function recomputeRelationshipHealth(opts: { dryRun?: boolean } = {}): Promise<RelationshipHealthSummary> {
  const dryRun = !!opts.dryRun;
  const summary: RelationshipHealthSummary = { ranAt: new Date().toISOString(), dryRun, schoolsRecomputed: 0, statusChanges: 0 };

  const schools = await db.school.findMany({ where: { deletedAt: null } });
  const now = Date.now();

  for (const s of schools) {
    summary.schoolsRecomputed++;
    const lastVisit = s.lastVisitDate ? s.lastVisitDate.getTime() : 0;
    const daysSince = lastVisit ? Math.floor((now - lastVisit) / DAY_MS) : Infinity;

    // Spec §8 realignment: ACTIVE/DEVELOPING/DORMANT/AT_RISK/INACTIVE.
    // Legacy NEW/ESTABLISHED/STRATEGIC still exist in the enum but the
    // classifier no longer writes them (migration 019 remaps existing rows).
    let status: RelationshipStatus = s.relationshipStatus;
    if (!lastVisit) status = "DEVELOPING";
    else if (daysSince > 730) status = "INACTIVE";
    else if (daysSince > 365) status = "DORMANT";
    else if (daysSince > 180) status = "AT_RISK";
    else if (daysSince > 90) status = "DEVELOPING";
    else status = "ACTIVE";

    if (status !== s.relationshipStatus) {
      if (!dryRun) {
        await db.school.update({ where: { id: s.id }, data: { relationshipStatus: status } });
      }
      summary.statusChanges++;
    }
  }

  return summary;
}

// ─── Contract renewal reminders ────────────────────────────────────────────
// spec §6 — 180 / 120 / 90 / 60 / 30 day reminders before contract expiry.
const RENEWAL_WINDOWS = [180, 120, 90, 60, 30];

export interface RenewalReminderSummary {
  ranAt: string;
  dryRun: boolean;
  remindersSent: number;
  contractsExpiringSoon: number;
}

export async function sendRenewalReminders(opts: { dryRun?: boolean } = {}): Promise<RenewalReminderSummary> {
  const dryRun = !!opts.dryRun;
  const summary: RenewalReminderSummary = { ranAt: new Date().toISOString(), dryRun, remindersSent: 0, contractsExpiringSoon: 0 };

  const now = new Date();
  const futureWindow = new Date(now.getTime() + 200 * DAY_MS);
  const contractRows = await db.contract.findMany({
    where: {
      endDate: { gte: now, lte: futureWindow },
      status: { in: ["ACTIVE", "RENEWAL_PENDING"] },
    },
    select: {
      id: true, title: true, endDate: true,
      institution: { select: { id: true, name: true, accountManagerId: true } },
    },
  });
  const contracts = contractRows;

  for (const c of contracts) {
    if (!c.endDate) continue;
    summary.contractsExpiringSoon++;
    const daysLeft = Math.floor((c.endDate.getTime() - now.getTime()) / DAY_MS);
    // Send only when we cross into a window (+/- 1 day tolerance)
    const inWindow = RENEWAL_WINDOWS.some(w => Math.abs(daysLeft - w) <= 0);
    if (!inWindow) continue;

    if (!c.institution.accountManagerId) continue;
    if (dryRun) { summary.remindersSent++; continue; }

    await db.notification.create({
      data: {
        userId: c.institution.accountManagerId,
        type: "CONTRACT_RENEWAL_DUE",
        title: `Contract expires in ${daysLeft} days: ${c.institution.name}`,
        message: `Contract "${c.title}" expires ${c.endDate.toISOString().slice(0, 10)}. Time to plan the renewal.`,
        link: `/institutions/${c.institution.id}#contracts`,
      },
    });
    summary.remindersSent++;
  }

  return summary;
}

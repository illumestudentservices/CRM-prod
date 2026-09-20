import { db } from "@/lib/db";
import { ReminderDigest } from "@/lib/reminder-digest";
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
  /// Clients whose renewal reached nobody, and why. Silence here used to be
  /// invisible: an unassigned client simply never produced a reminder.
  noRecipient: Array<{ name: string; reason: string }>;
  /// Institution-level renewals (the column the business actually fills in).
  renewalsNoticed: number;
  renewalsOverdue: number;
}

export async function sendRenewalReminders(opts: { dryRun?: boolean } = {}): Promise<RenewalReminderSummary> {
  // An Account Manager holding several expiring contracts gets one list, not
  // one email per contract.
  const digest = new ReminderDigest({ dryRun: opts.dryRun ?? false });
  const dryRun = !!opts.dryRun;
  const summary: RenewalReminderSummary = {
    ranAt: new Date().toISOString(), dryRun,
    remindersSent: 0, contractsExpiringSoon: 0,
    noRecipient: [], renewalsNoticed: 0, renewalsOverdue: 0,
  };

  const now = new Date();
  const futureWindow = new Date(now.getTime() + 200 * DAY_MS);
  const contractRows = await db.contract.findMany({
    where: {
      endDate: { gte: now, lte: futureWindow },
      // Migration 019 added the enum column. Match both the new enum and the
      // legacy free-text column so rows written before the migration still
      // trigger reminders. Contracts explicitly TERMINATED / EXPIRED /
      // SUPERSEDED are skipped.
      OR: [
        { statusEnum: { in: ["ACTIVE", "RENEWAL_PENDING"] } },
        { statusEnum: null, status: { in: ["ACTIVE", "RENEWAL_PENDING"] } },
      ],
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
    // ★ `Math.abs(daysLeft - w) <= 0` is an EXACT day match, despite the
    // comment beside it claiming a tolerance. If the run was skipped on the
    // one day a contract sat exactly 180 days out — a deploy, a reboot, a
    // clock drift — that notice was lost for good, because tomorrow it is 179
    // and matches nothing. Contract rows reuse the institution countdown
    // below, which uses `<=` and therefore catches up.
    const inWindow = RENEWAL_WINDOWS.some((w) => daysLeft === w);
    if (!inWindow) continue;

    if (!c.institution.accountManagerId) {
      summary.noRecipient.push({
        name: c.institution.name,
        reason: "no account manager is set on the client",
      });
      continue;
    }
    if (dryRun) { summary.remindersSent++; continue; }

    // Urgent inside 60 days: past that point a renewal needs a conversation,
    // not a reminder, and the lead time to have one is running out.
    await digest.add({
      userId: c.institution.accountManagerId,
      type: "CONTRACT_RENEWAL_DUE",
      title: `Contract expires in ${daysLeft} days: ${c.institution.name}`,
      message: `Contract "${c.title}" expires ${c.endDate.toISOString().slice(0, 10)}. Time to plan the renewal.`,
      link: `/institutions/${c.institution.id}#contracts`,
      urgent: daysLeft <= 60,
    });
    summary.remindersSent++;

    // Spec Tasks §10 — fire task templates keyed on CONTRACT_RENEWAL_DUE so
    // the "Review performance / Prepare renewal meeting" playbook the spec
    // describes runs automatically. Task.createdById references Employee,
    // so resolve the AM's employee row before firing. Best-effort — a
    // template misconfig doesn't stop the reminder itself.
    try {
      const amEmployee = await db.employee.findFirst({
        where: { userId: c.institution.accountManagerId },
        select: { id: true },
      });
      if (amEmployee) {
        const { fireEventTriggers } = await import("./task-workflow");
        await fireEventTriggers("CONTRACT_RENEWAL_DUE", {
          createdById: amEmployee.id,
          assigneeId: amEmployee.id,
          parentType: "INSTITUTION",
          parentId: c.institution.id,
        });
      }
    } catch (err) {
      console.error("[sendRenewalReminders] fireEventTriggers failed", err);
    }
  }

  // ── Institution renewal dates ──────────────────────────────────────────
  //
  // ★ THIS IS WHERE THE BUSINESS ACTUALLY RECORDS RENEWALS.
  //
  // The contract loop above watches `Contract.endDate`. Measured on production
  // there are ZERO contract rows, while 22 clients have `Institution.renewalDate`
  // filled in — including six already lapsed, four of them still ACTIVE, and one
  // ten days out. So the renewal reminder covered nothing at all in practice.
  //
  // Unlike the contract path this uses `daysLeft <= w` with a stored stage, not
  // an exact-day match, so a run missed on the exact boundary day is caught the
  // following morning instead of losing the notice for good.
  const clients = await db.institution.findMany({
    where: {
      deletedAt: null,
      renewalDate: { not: null },
      // A client we have stopped working with does not need chasing. PROSPECT
      // is kept: a renewal date on a prospect is a live commercial date.
      accountStatus: { notIn: ["CHURNED", "SUSPENDED"] },
    },
    select: {
      id: true, name: true, renewalDate: true, accountManagerId: true,
      renewalNoticeStage: true, accountStatus: true,
    },
  });

  const startOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  for (const client of clients) {
    const daysLeft = Math.floor(
      (client.renewalDate!.getTime() - startOfToday.getTime()) / DAY_MS
    );

    // The tightest window this client has reached. 0 means the date has passed,
    // which is its own stage — a lapsed renewal on an ACTIVE client is worth
    // more attention than one still months away, not less.
    const stage =
      daysLeft < 0 ? 0 : RENEWAL_WINDOWS.filter((w) => daysLeft <= w).pop() ?? null;
    if (stage === null) continue; // further out than the widest window

    const stored = client.renewalNoticeStage;

    // Pushed further out than we last announced: the renewal was done, or the
    // date corrected. Rewind the marker so the countdown runs again for the new
    // date, but say nothing — nobody needs telling that a deadline receded.
    if (stored !== null && stage > stored) {
      if (!dryRun) {
        await db.institution.update({
          where: { id: client.id },
          data: { renewalNoticeStage: stage },
        });
      }
      continue;
    }
    // Already announced at this stage or tighter.
    if (stored !== null && stage >= stored) continue;

    if (daysLeft < 0) summary.renewalsOverdue++;
    summary.renewalsNoticed++;

    if (!client.accountManagerId) {
      summary.noRecipient.push({
        name: client.name,
        reason: "no account manager is set on the client",
      });
      continue;
    }
    if (dryRun) continue;

    const when = client.renewalDate!.toISOString().slice(0, 10);
    await digest.add({
      userId: client.accountManagerId,
      type: "CONTRACT_RENEWAL_DUE",
      title:
        daysLeft < 0
          ? `Renewal LAPSED ${Math.abs(daysLeft)} days ago: ${client.name}`
          : `Renewal in ${daysLeft} days: ${client.name}`,
      message:
        daysLeft < 0
          ? `${client.name} was due to renew on ${when} and the date has passed while the account is still ${client.accountStatus}.`
          : `${client.name} is due to renew on ${when}. Time to plan the conversation.`,
      link: `/institutions/${client.id}`,
      // A lapsed renewal, or one inside 60 days, needs a conversation rather
      // than a reminder — and the time to have one is running out.
      urgent: daysLeft < 0 || daysLeft <= 60,
    });
    summary.remindersSent++;

    await db.institution.update({
      where: { id: client.id },
      data: { renewalNoticeStage: stage },
    });
  }

  await digest.flush({
    heading: "Clients",
    intro: "these contracts are coming up for renewal.",
  });

  return summary;
}

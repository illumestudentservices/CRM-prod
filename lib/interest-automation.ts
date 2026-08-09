import { db } from "@/lib/db";
import { INACTIVITY_REMINDER_DAYS, INACTIVITY_ESCALATION_DAYS } from "@/lib/lead-pipeline";
import { syncLeadFromInterests } from "@/lib/interest-sync";
import type { LeadStage } from "@prisma/client";

/// Institution Interest inactivity automation — the per-interest replacement
/// for lead-automation. Each open interest has its own inactivity clock.
///
/// A student may be Awaiting Decision at UofT (inactivity threshold long)
/// while their UCL interest is New Lead (inactivity threshold short); running
/// per-interest lets each get chased on its own schedule.

const DAY_MS = 86_400_000;
const BATCH_LIMIT = 500;

const ACTIVE_STAGES: LeadStage[] = [
  "NEW_LEAD", "CONTACTED", "QUALIFIED",
  "APPLICATION_SUBMITTED", "AWAITING_DECISION",
  "OFFER_RECEIVED", "DEPOSIT_PAID",
];

export interface InterestAutomationSummary {
  ranAt: string;
  dryRun: boolean;
  inactivityReminders: number;
  inactivityEscalations: number;
  deferredReopened: number;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

export async function runInterestAutomation(opts: { dryRun?: boolean } = {}): Promise<InterestAutomationSummary> {
  const dryRun = !!opts.dryRun;
  const summary: InterestAutomationSummary = {
    ranAt: new Date().toISOString(),
    dryRun,
    inactivityReminders: 0,
    inactivityEscalations: 0,
    deferredReopened: 0,
  };

  // ── Inactivity reminders ─────────────────────────────────────────────
  const reminderCandidates = await db.institutionInterest.findMany({
    where: {
      closedAt: null,
      stage: { in: ACTIVE_STAGES },
      inactivity14NotifiedAt: null,
      OR: [
        { lastContactedAt: { lte: daysAgo(INACTIVITY_REMINDER_DAYS) } },
        { AND: [{ lastContactedAt: null }, { createdAt: { lte: daysAgo(INACTIVITY_REMINDER_DAYS) } }] },
      ],
    },
    take: BATCH_LIMIT,
    include: {
      lead: { select: { firstName: true, lastName: true, regionId: true, createdById: true } },
      institution: { select: { name: true } },
    },
  });

  for (const interest of reminderCandidates) {
    if (dryRun) { summary.inactivityReminders++; continue; }
    if (interest.assignedICRId) {
      await db.notification.create({
        data: {
          userId: interest.assignedICRId,
          type: "INTEREST_INACTIVITY_REMINDER",
          title: `Follow up: ${interest.lead.firstName} ${interest.lead.lastName} - ${interest.institution.name}`,
          message: `No engagement in ${INACTIVITY_REMINDER_DAYS} days on this Institution Interest.`,
          link: `/institution-interests/${interest.id}`,
        },
      });
    }
    await db.institutionInterest.update({
      where: { id: interest.id },
      data: { inactivity14NotifiedAt: new Date() },
    });
    summary.inactivityReminders++;
  }

  // ── Inactivity escalations to Regional Manager ───────────────────────
  const escalationCandidates = await db.institutionInterest.findMany({
    where: {
      closedAt: null,
      stage: { in: ACTIVE_STAGES },
      inactivity21NotifiedAt: null,
      OR: [
        { lastContactedAt: { lte: daysAgo(INACTIVITY_ESCALATION_DAYS) } },
        { AND: [{ lastContactedAt: null }, { createdAt: { lte: daysAgo(INACTIVITY_ESCALATION_DAYS) } }] },
      ],
    },
    take: BATCH_LIMIT,
    include: {
      lead: { select: { firstName: true, lastName: true, regionId: true, createdById: true } },
      institution: { select: { name: true } },
    },
  });

  for (const interest of escalationCandidates) {
    if (dryRun) { summary.inactivityEscalations++; continue; }
    const regionId = interest.lead.regionId;
    if (regionId) {
      const rms = await db.user.findMany({
        where: { role: "REGIONAL_MANAGER", regionId, isActive: true, deletedAt: null },
        select: { id: true },
      });
      for (const rm of rms) {
        await db.notification.create({
          data: {
            userId: rm.id,
            type: "INTEREST_INACTIVITY_ESCALATION",
            title: `Overdue: ${interest.lead.firstName} ${interest.lead.lastName} - ${interest.institution.name}`,
            message: `Institution Interest has been inactive for ${INACTIVITY_ESCALATION_DAYS}+ days.`,
            link: `/institution-interests/${interest.id}`,
          },
        });
      }
    }
    await db.institutionInterest.update({
      where: { id: interest.id },
      data: { inactivity14NotifiedAt: new Date(), inactivity21NotifiedAt: new Date() },
    });
    summary.inactivityEscalations++;
  }

  // ── Reopen deferred interests reaching their reopen date ──────────────
  const deferredDue = await db.institutionInterest.findMany({
    where: {
      stage: "DEFERRED",
      closedAt: { not: null },
      deferredReopenAt: { not: null, lte: new Date() },
    },
    take: BATCH_LIMIT,
    include: { lead: { select: { id: true } } },
  });

  for (const interest of deferredDue) {
    if (dryRun) { summary.deferredReopened++; continue; }
    await db.institutionInterest.update({
      where: { id: interest.id },
      data: {
        closedAt: null,
        stage: interest.stageBeforeClose ?? "NEW_LEAD",
        stageEnteredAt: new Date(),
        deferredReopenAt: null,
      },
    });
    if (interest.assignedICRId) {
      await db.notification.create({
        data: {
          userId: interest.assignedICRId,
          type: "INTEREST_DEFERRED_REOPENED",
          title: `Deferred interest reopened for ${interest.deferredIntakeMonth}/${interest.deferredIntakeYear} intake`,
          message: `Follow up with the student — their deferred intake is approaching.`,
          link: `/institution-interests/${interest.id}`,
        },
      });
    }
    await syncLeadFromInterests(interest.lead.id);
    summary.deferredReopened++;
  }

  return summary;
}

import { db } from "@/lib/db";
import {
  STAGE_LABELS,
  INACTIVITY_REMINDER_DAYS,
  INACTIVITY_ESCALATION_DAYS,
} from "@/lib/lead-pipeline";
import type { Prisma } from "@prisma/client";
import { displayName } from "@/lib/person-name";

/**
 * Scheduled pipeline automation.
 *
 * Deliberately *not* an HTTP route. A cron job has no session, so exposing this
 * over HTTP would mean either punching a hole in the auth proxy or guarding an
 * internet-reachable endpoint with a shared secret. Invoked as a local script
 * from the VPS crontab instead, there is nothing reachable from outside to
 * brute-force, rate-limit or leak a secret to.
 *
 * Three things matter here and each is easy to get subtly wrong:
 *
 *  - Inactivity is measured on *completed engagements only*. If SYSTEM rows
 *    counted, the reminder this job writes would reset the very clock it is
 *    measuring and the 21-day escalation would never fire.
 *
 *  - The notified-at flags make it idempotent. Running twice must not
 *    double-notify. They are cleared whenever a real engagement completes, so
 *    the next cycle can chase again.
 *
 *  - Closed, deferred and enrolled students are excluded. Deferred students in
 *    particular are *supposed* to be dormant; chasing them for six months would
 *    be exactly wrong.
 */

/** Bounded so a slow run cannot overlap the next one. */
const BATCH_LIMIT = 500;
const DAY_MS = 86_400_000;

/** Days before an offer expires or a deposit falls due to start warning. */
const DEADLINE_WARNING_DAYS = 7;

export interface AutomationSummary {
  dryRun: boolean;
  ranAt: string;
  inactivityReminders: number;
  inactivityEscalations: number;
  offerExpiryWarnings: number;
  depositDeadlineWarnings: number;
  deferredReopened: number;
  unassigned: string[];
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY_MS);
}

/**
 * Who to escalate to. `User` has no manager relation, so this walks outward:
 * the lead's regional managers, then the creator's region, then super admins.
 * Returns an empty list rather than throwing — an unassigned lead should be
 * reported, not crash the run.
 */
async function resolveEscalationTargets(lead: {
  regionId: string | null;
  createdById: string;
}): Promise<string[]> {
  if (lead.regionId) {
    const rms = await db.user.findMany({
      where: { role: "REGIONAL_MANAGER", regionId: lead.regionId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (rms.length) return rms.map((u) => u.id);
  }

  const creator = await db.user.findUnique({
    where: { id: lead.createdById },
    select: { regionId: true },
  });
  if (creator?.regionId) {
    const rms = await db.user.findMany({
      where: { role: "REGIONAL_MANAGER", regionId: creator.regionId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (rms.length) return rms.map((u) => u.id);
  }

  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  return admins.map((u) => u.id);
}

export async function runLeadAutomation(
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<AutomationSummary> {
  const now = new Date();
  const summary: AutomationSummary = {
    dryRun,
    ranAt: now.toISOString(),
    inactivityReminders: 0,
    inactivityEscalations: 0,
    offerExpiryWarnings: 0,
    depositDeadlineWarnings: 0,
    deferredReopened: 0,
    unassigned: [],
  };

  // Only students actively being worked. Closed outcomes and Enrolled are done.
  const activeScope: Prisma.LeadWhereInput = {
    deletedAt: null,
    stage: { notIn: ["LOST", "DEFERRED", "APPLICATION_REJECTED", "ENROLLED"] },
  };

  // ── Inactivity ─────────────────────────────────────────────────────────
  const candidates = await db.lead.findMany({
    where: activeScope,
    select: {
      id: true,
      firstName: true,
        lastName: true,
      stage: true,
      regionId: true,
      createdById: true,
      assignedICRId: true,
      stageEnteredAt: true,
      inactivity14NotifiedAt: true,
      inactivity21NotifiedAt: true,
      activities: {
        where: { kind: "ENGAGEMENT", completedAt: { not: null }, cancelledAt: null },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { completedAt: true },
      },
    },
    take: BATCH_LIMIT,
  });

  const reminderCutoff = daysAgo(INACTIVITY_REMINDER_DAYS);
  const escalationCutoff = daysAgo(INACTIVITY_ESCALATION_DAYS);

  for (const lead of candidates) {
    // A student with no engagement at all is measured from when they entered
    // the stage, otherwise brand-new leads would look infinitely stale.
    const lastTouch = lead.activities[0]?.completedAt ?? lead.stageEnteredAt;
    const idleDays = Math.floor((now.getTime() - lastTouch.getTime()) / DAY_MS);

    const dueEscalation = lastTouch <= escalationCutoff && !lead.inactivity21NotifiedAt;
    const dueReminder =
      lastTouch <= reminderCutoff && !lead.inactivity14NotifiedAt && !dueEscalation;

    if (!dueReminder && !dueEscalation) continue;

    if (dueReminder) {
      summary.inactivityReminders++;
      if (!lead.assignedICRId) summary.unassigned.push(lead.id);
      if (dryRun) continue;

      await db.$transaction([
        ...(lead.assignedICRId
          ? [
              db.notification.create({
                data: {
                  userId: lead.assignedICRId,
                  title: "Student needs attention",
                  message: `"${displayName(lead)}" has had no activity for ${idleDays} days in ${STAGE_LABELS[lead.stage]}.`,
                  type: "LEAD_INACTIVITY",
                  link: `/students/${lead.id}`,
                },
              }),
            ]
          : []),
        db.lead.update({
          where: { id: lead.id },
          data: { inactivity14NotifiedAt: now },
        }),
        db.leadActivity.create({
          data: {
            leadId: lead.id,
            kind: "SYSTEM",
            type: "INACTIVITY_REMINDER",
            description: `Automated reminder — no activity for ${idleDays} days.`,
            stageAtCreation: lead.stage,
          },
        }),
      ]);
      continue;
    }

    // Escalation
    summary.inactivityEscalations++;
    const targets = await resolveEscalationTargets(lead);
    if (!targets.length) summary.unassigned.push(lead.id);
    if (dryRun) continue;

    await db.$transaction([
      ...targets.map((userId) =>
        db.notification.create({
          data: {
            userId,
            title: "Stalled student",
            message: `"${displayName(lead)}" has had no activity for ${idleDays} days in ${STAGE_LABELS[lead.stage]}.`,
            type: "LEAD_ESCALATION",
            link: `/students/${lead.id}`,
          },
        })
      ),
      db.lead.update({
        where: { id: lead.id },
        // Both flags set: a student escalated to a manager should not then
        // generate a first-level reminder as well.
        data: { inactivity14NotifiedAt: now, inactivity21NotifiedAt: now },
      }),
      db.leadActivity.create({
        data: {
          leadId: lead.id,
          kind: "SYSTEM",
          type: "INACTIVITY_ESCALATION",
          description: `Escalated to management — no activity for ${idleDays} days.`,
          stageAtCreation: lead.stage,
        },
      }),
    ]);
  }

  // ── Offer expiry and deposit deadlines ─────────────────────────────────
  const warningHorizon = new Date(now.getTime() + DEADLINE_WARNING_DAYS * DAY_MS);

  const applications = await db.leadApplication.findMany({
    where: {
      isActive: true,
      lead: activeScope,
      OR: [
        { offerExpiryDate: { gte: now, lte: warningHorizon } },
        { depositDeadline: { gte: now, lte: warningHorizon }, depositPaid: false },
      ],
    },
    select: {
      id: true,
      offerExpiryDate: true,
      depositDeadline: true,
      depositPaid: true,
      lead: { select: { id: true, firstName: true,
        lastName: true, assignedICRId: true } },
    },
    take: BATCH_LIMIT,
  });

  for (const app of applications) {
    if (!app.lead.assignedICRId) continue;

    const notes: string[] = [];
    if (app.offerExpiryDate && app.offerExpiryDate <= warningHorizon) {
      const d = Math.ceil((app.offerExpiryDate.getTime() - now.getTime()) / DAY_MS);
      notes.push(`offer expires in ${d} day${d === 1 ? "" : "s"}`);
      summary.offerExpiryWarnings++;
    }
    if (!app.depositPaid && app.depositDeadline && app.depositDeadline <= warningHorizon) {
      const d = Math.ceil((app.depositDeadline.getTime() - now.getTime()) / DAY_MS);
      notes.push(`deposit due in ${d} day${d === 1 ? "" : "s"}`);
      summary.depositDeadlineWarnings++;
    }
    if (!notes.length || dryRun) continue;

    await db.notification.create({
      data: {
        userId: app.lead.assignedICRId,
        title: "Deadline approaching",
        message: `"${displayName(app.lead)}" — ${notes.join(", ")}.`,
        type: "LEAD_DEADLINE",
        link: `/students/${app.lead.id}`,
      },
    });
  }

  // ── Deferred students due to reopen ────────────────────────────────────
  const dueToReopen = await db.lead.findMany({
    where: { deletedAt: null, stage: "DEFERRED", deferredReopenAt: { lte: now } },
    select: {
      id: true,
      firstName: true,
        lastName: true,
      stageBeforeClose: true,
      assignedICRId: true,
      deferredIntakeYear: true,
      deferredIntakeMonth: true,
    },
    take: BATCH_LIMIT,
  });

  for (const lead of dueToReopen) {
    summary.deferredReopened++;
    if (dryRun) continue;

    // Leads deferred before stageBeforeClose existed have nothing recorded;
    // the start of the pipeline is the honest fallback.
    const restoreTo =
      lead.stageBeforeClose && lead.stageBeforeClose !== "ENROLLED"
        ? lead.stageBeforeClose
        : "NEW_LEAD";

    await db.$transaction([
      db.lead.update({
        where: { id: lead.id },
        data: {
          stage: restoreTo,
          stageEnteredAt: now,
          lastProgressedAt: now,
          stageBeforeClose: null,
          deferredReopenAt: null,
          inactivity14NotifiedAt: null,
          inactivity21NotifiedAt: null,
        },
      }),
      db.leadActivity.create({
        data: {
          leadId: lead.id,
          kind: "SYSTEM",
          type: "LEAD_REOPENED",
          description: `Automatically reopened ahead of the ${lead.deferredIntakeMonth}/${lead.deferredIntakeYear} intake, restored to ${STAGE_LABELS[restoreTo]}.`,
          stageAtCreation: "DEFERRED",
        },
      }),
      ...(lead.assignedICRId
        ? [
            db.notification.create({
              data: {
                userId: lead.assignedICRId,
                title: "Deferred student reopened",
                message: `"${displayName(lead)}" is back in the pipeline ahead of their ${lead.deferredIntakeMonth}/${lead.deferredIntakeYear} intake.`,
                type: "LEAD_REOPENED",
                link: `/students/${lead.id}`,
              },
            }),
          ]
        : []),
    ]);
  }

  return summary;
}

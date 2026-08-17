import { db } from "@/lib/db";
import type { TransitionStatus } from "@prisma/client";

/**
 * Notifications for ICR Transition (spec §28).
 *
 * In-app only. The spec lists the events; it does not ask for email, and adding
 * outbound mail to a workflow that fires on every status change is the kind of
 * thing that quietly becomes a spam source. The bell now opens, so in-app
 * notifications are actually reachable — before this release they were written
 * to a control that did nothing.
 *
 * Every helper is best-effort: a failed notification must never roll back the
 * status change that triggered it. Losing a reminder is recoverable, losing an
 * accepted handover is not.
 */

interface Recipients {
  outgoingIcrId: string;
  incomingIcrId: string | null;
  regionalManagerId: string;
  clientRelationsDirectorId: string | null;
  vpGlobalSalesId: string | null;
}

interface Ctx {
  reportId: string;
  institutionName: string;
  outgoingIcrName: string;
  recipients: Recipients;
}

async function send(
  userIds: (string | null | undefined)[],
  type: string,
  title: string,
  message: string,
  link: string
) {
  // Deduplicated: one person can hold two roles on the same report (an RM who
  // is also the incoming ICR), and telling them twice is noise.
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length) return;
  try {
    await db.notification.createMany({
      data: ids.map((userId) => ({ userId, type, title, message, link })),
    });
  } catch (err) {
    console.error("[transition-notifications]", type, err);
  }
}

/**
 * Announce a workflow move to the people §28 names for it.
 *
 * Written as a switch over the destination status rather than a map, because
 * each case has a different audience and a different sentence — a Record would
 * force a uniform shape that does not exist here.
 */
export async function notifyStatusChange(
  to: TransitionStatus,
  ctx: Ctx,
  comments?: string | null
): Promise<void> {
  const { reportId, institutionName, outgoingIcrName, recipients: r } = ctx;
  const link = `/icr-transition/${reportId}`;
  const subject = `${outgoingIcrName} — ${institutionName}`;

  switch (to) {
    case "ASSIGNED":
      await send([r.outgoingIcrId], "TRANSITION_ASSIGNED",
        "Transition report assigned",
        `You have been asked to complete a handover report for ${subject}.`, link);
      return;

    case "SUBMITTED_TO_RM":
      await send([r.regionalManagerId], "TRANSITION_SUBMITTED",
        "Handover report submitted",
        `${outgoingIcrName} has submitted the handover report for ${institutionName} for your review.`, link);
      return;

    case "RESUBMITTED":
      await send([r.regionalManagerId], "TRANSITION_RESUBMITTED",
        "Handover report resubmitted",
        `${outgoingIcrName} has resubmitted the handover report for ${institutionName}.`, link);
      return;

    case "AMENDMENTS_REQUIRED":
      await send([r.outgoingIcrId], "TRANSITION_AMENDMENTS",
        "Amendments requested",
        comments?.trim()
          ? `Your handover report for ${institutionName} needs changes: ${comments.trim()}`
          : `Your handover report for ${institutionName} has been returned for amendments.`,
        link);
      return;

    case "ACCEPTED_BY_RM":
      await send([r.outgoingIcrId, r.incomingIcrId], "TRANSITION_ACCEPTED",
        "Handover report accepted",
        `The handover report for ${institutionName} has been accepted by the Regional Manager.`, link);
      return;

    case "FINAL":
      // Spec §4 and §28: Client Relations Director and VP Global Sales are told
      // when a report is final, and the incoming ICR gets access.
      await send(
        [r.clientRelationsDirectorId, r.vpGlobalSalesId, r.incomingIcrId, r.outgoingIcrId],
        "TRANSITION_FINAL",
        "Handover report finalised",
        `The handover report for ${subject} is now final.`, link);
      return;

    default:
      // IN_PROGRESS and ARCHIVED are not events anyone needs telling about.
      return;
  }
}

/**
 * Due-date reminders (spec §28: approaching, due today, overdue).
 *
 * Intended to run once a day from the existing cron. Returns what it sent so a
 * scheduled run can be inspected rather than trusted.
 *
 * Only reports that are genuinely outstanding are chased: once a report is with
 * the RM, the ICR has done their part and chasing them is wrong.
 */
export async function sendDueDateReminders(now = new Date()): Promise<{
  approaching: number; dueToday: number; overdue: number;
}> {
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const endOfDay = new Date(startOfDay.getTime() + 86400000);
  const inThreeDays = new Date(startOfDay.getTime() + 3 * 86400000);

  const outstanding = await db.transitionReport.findMany({
    where: { status: { in: ["ASSIGNED", "IN_PROGRESS", "AMENDMENTS_REQUIRED"] } },
    select: {
      id: true, reportDueDate: true, status: true,
      outgoingIcrId: true, regionalManagerId: true,
      institution: { select: { name: true } },
      outgoingIcr: { select: { name: true, email: true } },
    },
  });

  let approaching = 0, dueToday = 0, overdue = 0;

  for (const r of outstanding) {
    const link = `/icr-transition/${r.id}`;
    const who = r.outgoingIcr.name ?? r.outgoingIcr.email;
    const inst = r.institution.name;

    if (r.reportDueDate < startOfDay) {
      const days = Math.round((startOfDay.getTime() - r.reportDueDate.getTime()) / 86400000);
      await send([r.outgoingIcrId], "TRANSITION_OVERDUE",
        "Handover report overdue",
        `Your handover report for ${inst} is ${days} day(s) overdue.`, link);
      // §28 tells the Regional Manager about overdue reports too — an overdue
      // handover is their problem as much as the ICR's.
      await send([r.regionalManagerId], "TRANSITION_OVERDUE_RM",
        "Handover report overdue",
        `${who}'s handover report for ${inst} is ${days} day(s) overdue.`, link);
      overdue++;
    } else if (r.reportDueDate < endOfDay) {
      await send([r.outgoingIcrId], "TRANSITION_DUE_TODAY",
        "Handover report due today",
        `Your handover report for ${inst} is due today.`, link);
      dueToday++;
    } else if (r.reportDueDate < inThreeDays) {
      await send([r.outgoingIcrId], "TRANSITION_DUE_SOON",
        "Handover report due soon",
        `Your handover report for ${inst} is due on ${r.reportDueDate.toDateString()}.`, link);
      approaching++;
    }

    // §28: "Report not started" is its own signal to the RM — an untouched
    // report close to its due date is a different problem from a late one.
    if (r.status === "ASSIGNED" && r.reportDueDate < inThreeDays && r.reportDueDate >= startOfDay) {
      await send([r.regionalManagerId], "TRANSITION_NOT_STARTED",
        "Handover report not started",
        `${who} has not started the handover report for ${inst}, due ${r.reportDueDate.toDateString()}.`,
        link);
    }
  }

  return { approaching, dueToday, overdue };
}

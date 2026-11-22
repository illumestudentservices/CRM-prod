import { db } from "@/lib/db";

/**
 * Overdue client-issue alert (roadmap 2c / Spec §9 SLA).
 *
 * A client issue carries a `targetResolutionAt` deadline. Once that passes and
 * the issue is still open, nobody is told — it just quietly ages. This daily job
 * finds those and notifies ONLY the issue's primary owner (`ownerId`), as the
 * user asked: not the regional manager, not admins.
 *
 * De-duped per overdue "episode": an owner is alerted once when an issue lapses,
 * not every day it stays late. If the owner later pushes the deadline out and it
 * lapses again, `targetResolutionAt` moves forward past the old alert, so a fresh
 * alert fires for the new episode.
 */

// Statuses that still count as "not done". RESOLVED / CLOSED are finished.
const OPEN_STATES = ["OPEN", "IN_PROGRESS", "AWAITING_CLIENT", "AWAITING_INTERNAL_ACTION"] as const;

export interface OverdueIssueAlertSummary {
  overdue: number;    // open issues found past their deadline
  notified: number;   // owners newly alerted this run
  skipped: number;    // already alerted this episode (de-duped)
  errors: number;
  dryRun: boolean;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function runOverdueIssueAlerts(
  { dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}
): Promise<OverdueIssueAlertSummary> {
  const overdue = await db.clientIssue.findMany({
    where: {
      status: { in: [...OPEN_STATES] },
      resolvedAt: null,
      targetResolutionAt: { not: null, lt: now },
      institution: { deletedAt: null },
    },
    select: {
      id: true,
      title: true,
      category: true,
      institutionId: true,
      ownerId: true,
      targetResolutionAt: true,
      institution: { select: { name: true } },
    },
  });

  let notified = 0;
  let skipped = 0;
  let errors = 0;

  for (const issue of overdue) {
    if (!issue.ownerId || !issue.targetResolutionAt) continue;

    // Already alerted for THIS episode? An ISSUE_OVERDUE notice for this issue
    // created at/after the current deadline means we've told the owner already.
    const already = await db.notification.findFirst({
      where: {
        userId: issue.ownerId,
        type: "ISSUE_OVERDUE",
        link: { contains: issue.id },
        createdAt: { gte: issue.targetResolutionAt },
      },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }

    if (dryRun) {
      notified++;
      continue;
    }

    try {
      await db.notification.create({
        data: {
          userId: issue.ownerId,
          title: "Issue overdue",
          message: `"${issue.title}" for ${issue.institution.name} is past its due date (${fmtDate(issue.targetResolutionAt)}). Please update it.`,
          type: "ISSUE_OVERDUE",
          // issue id in the link doubles as the de-dup key above.
          link: `/institutions/${issue.institutionId}?tab=issues&issue=${issue.id}`,
        },
      });
      notified++;
    } catch (e) {
      errors++;
      console.error("[overdue-issue-alerts] notify failed for issue", issue.id, e);
    }
  }

  return { overdue: overdue.length, notified, skipped, errors, dryRun };
}

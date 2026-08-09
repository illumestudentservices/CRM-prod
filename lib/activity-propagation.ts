import { db } from "@/lib/db";

/**
 * Spec §11 (Field Operations) — cross-record propagation.
 *
 * When an activity is marked Completed, its linked parent records should
 * automatically reflect that the last engagement happened. This lets the
 * relationship-health classifier (lib/network-automation.ts) do its job and
 * lets the "Attention Required" panels on Client / Agent / School views stop
 * lying about staleness.
 *
 * Rules:
 * - School.lastVisitDate  — bumped when the activity has schoolId set.
 * - AgentProfile.lastMeetingDate — bumped when the activity's sourceId points
 *   to an AGENT-type Source. (AgentProfile has a `sourceId @unique` FK to Source.)
 * - Source.lastActiveAt — bumped when the activity has any sourceId (spec
 *   §14 network automation reads this).
 *
 * All updates are best-effort: propagation NEVER blocks the primary
 * Activity create/update. Every failure is caller-swallowed.
 */
export async function propagateActivityCompletion(activity: {
  id: string;
  schoolId: string | null;
  sourceId: string | null;
  actualDate: Date | null;
  date: Date;
  endDate: Date | null;
}) {
  const engagedAt = activity.actualDate ?? activity.endDate ?? activity.date;
  if (!engagedAt) return;

  const updates: Promise<unknown>[] = [];

  // School.lastVisitDate — only bump forward.
  if (activity.schoolId) {
    updates.push(
      db.school.updateMany({
        where: {
          id: activity.schoolId,
          OR: [{ lastVisitDate: null }, { lastVisitDate: { lt: engagedAt } }],
        },
        data: { lastVisitDate: engagedAt },
      })
    );
  }

  // Source.lastActiveAt + AgentProfile.lastMeetingDate — bump on any partner engagement.
  if (activity.sourceId) {
    updates.push(
      db.source.updateMany({
        where: {
          id: activity.sourceId,
          OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: engagedAt } }],
        },
        data: { lastActiveAt: engagedAt },
      })
    );

    // AgentProfile is a 1:1 with Source; updateMany with the sourceId key
    // just no-ops if the source isn't an agent, so no need to gate on type.
    updates.push(
      db.agentProfile.updateMany({
        where: {
          sourceId: activity.sourceId,
          OR: [{ lastMeetingDate: null }, { lastMeetingDate: { lt: engagedAt } }],
        },
        data: { lastMeetingDate: engagedAt },
      })
    );
  }

  await Promise.all(updates);
}

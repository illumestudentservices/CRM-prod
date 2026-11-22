import { db } from "@/lib/db";

/**
 * Enrolment-target-at-risk alert (roadmap 2b).
 *
 * Each institution can carry a yearly EnrollmentTarget (target vs actual). When
 * the year is almost over and actual is still well short of target, the account
 * manager should hear about it while there's a sliver of time to act. This daily
 * job finds those and notifies ONLY the institution's primary owner — its
 * account manager — as the user asked.
 *
 * It is a no-op for most of the year: it fires only inside the final `windowDays`
 * of the target year, and alerts each target once per year (de-duped).
 */

export interface TargetAtRiskSummary {
  inWindow: boolean;  // was "now" in the end-of-year alerting window
  atRisk: number;     // targets found short of the threshold
  notified: number;   // account managers newly alerted this run
  skipped: number;    // no owner, or already alerted this year
  errors: number;
  dryRun: boolean;
}

export async function runTargetAtRiskAlerts(
  {
    dryRun = false,
    now = new Date(),
    windowDays = 60,
    riskRatio = 0.8,
  }: { dryRun?: boolean; now?: Date; windowDays?: number; riskRatio?: number } = {}
): Promise<TargetAtRiskSummary> {
  const year = now.getFullYear();
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  const daysLeft = (endOfYear.getTime() - now.getTime()) / 86_400_000;

  // Only sound the alarm in the closing stretch of the year.
  if (daysLeft < 0 || daysLeft > windowDays) {
    return { inWindow: false, atRisk: 0, notified: 0, skipped: 0, errors: 0, dryRun };
  }

  const targets = await db.enrollmentTarget.findMany({
    where: { year, target: { gt: 0 }, institution: { deletedAt: null } },
    select: {
      id: true,
      year: true,
      target: true,
      actual: true,
      institutionId: true,
      institution: { select: { name: true, accountManagerId: true } },
    },
  });

  const startOfYear = new Date(year, 0, 1);
  let atRisk = 0;
  let notified = 0;
  let skipped = 0;
  let errors = 0;

  for (const t of targets) {
    if (t.actual >= t.target * riskRatio) continue; // on track
    atRisk++;

    const ownerId = t.institution.accountManagerId;
    if (!ownerId) {
      skipped++; // no primary owner to tell
      continue;
    }

    const link = `/institutions/${t.institutionId}?target=${t.year}`;
    const already = await db.notification.findFirst({
      where: {
        userId: ownerId,
        type: "ENROLLMENT_TARGET_AT_RISK",
        link: { contains: link },
        createdAt: { gte: startOfYear },
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
      const pct = Math.round((t.actual / t.target) * 100);
      await db.notification.create({
        data: {
          userId: ownerId,
          title: "Intake target at risk",
          message: `${t.institution.name} is at ${t.actual} of ${t.target} enrolments for ${t.year} (${pct}%), with the year almost over. Please review.`,
          type: "ENROLLMENT_TARGET_AT_RISK",
          link,
        },
      });
      notified++;
    } catch (e) {
      errors++;
      console.error("[target-at-risk-alerts] notify failed for target", t.id, e);
    }
  }

  return { inWindow: true, atRisk, notified, skipped, errors, dryRun };
}

import { db } from "@/lib/db";
import { ReminderDigest } from "@/lib/reminder-digest";

/**
 * Counts down to a leaver's last working day.
 *
 * `Employee.endDate` was written by HR and READ BY NOTHING. A departure date
 * could be recorded months ahead and the first anyone heard of it was the
 * person not turning up.
 *
 * Three notices — 30, 7 and 1 days out — because each one is a different job:
 * at 30 you can still plan a handover, at 7 you are booking the knowledge
 * transfer, at 1 you are collecting the laptop. A single reminder has to pick
 * one of those and be wrong about the other two.
 *
 * Deliberately NOT tied to the Offboarding request queue. That queue records a
 * decision someone has made; this watches a date on the employee record, which
 * is set whether or not anyone has started the paperwork. The gap between
 * those two is exactly the case worth catching.
 */

/** Days before the last working day to raise each notice. */
export const OFFBOARDING_NOTICE_DAYS = [30, 7, 1] as const;

export type OffboardingCountdownSummary = {
  ranAt: string;
  dryRun: boolean;
  /// Leavers found inside one of the notice windows.
  matched: number;
  /// Notices queued, across all recipients.
  raised: number;
  /// Leavers whose departure nobody was told about, and why.
  noRecipient: Array<{ employeeId: string; name: string; reason: string }>;
};

/** Midnight UTC, so day arithmetic cannot drift with the clock. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function runOffboardingCountdown(
  { dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}
): Promise<OffboardingCountdownSummary> {
  const today = utcDay(now);
  const summary: OffboardingCountdownSummary = {
    ranAt: now.toISOString(),
    dryRun,
    matched: 0,
    raised: 0,
    noRecipient: [],
  };

  // Only the exact notice days, so a departure 29 days out is silent and the
  // three notices stay meaningful rather than becoming a daily drip.
  const windows = OFFBOARDING_NOTICE_DAYS.map((d) => ({
    days: d,
    from: new Date(today.getTime() + d * 86_400_000),
    to: new Date(today.getTime() + (d + 1) * 86_400_000),
  }));

  const digest = new ReminderDigest({ dryRun });

  for (const w of windows) {
    const leavers = await db.employee.findMany({
      where: {
        endDate: { gte: w.from, lt: w.to },
        user: { isActive: true, deletedAt: null },
      },
      select: {
        id: true, employeeId: true, jobTitle: true, endDate: true,
        user: { select: { id: true, name: true, email: true } },
        manager: { select: { user: { select: { id: true, name: true } } } },
      },
    });

    for (const leaver of leavers) {
      summary.matched++;
      const who = leaver.user.name ?? leaver.user.email;
      const when = leaver.endDate!.toISOString().slice(0, 10);

      // The manager, plus HR. Both, not either: the manager owns the handover
      // and HR owns the paperwork, and neither can do the other's part.
      const recipients = new Set<string>();
      if (leaver.manager?.user?.id) recipients.add(leaver.manager.user.id);
      const hr = await db.user.findMany({
        where: { role: "HR_MANAGER", isActive: true, deletedAt: null },
        select: { id: true },
      });
      for (const h of hr) recipients.add(h.id);

      // The leaver is never told by this job. Their departure is already known
      // to them, and an automated countdown to your own last day would be a
      // remarkable thing to receive.
      recipients.delete(leaver.user.id);

      if (recipients.size === 0) {
        summary.noRecipient.push({
          employeeId: leaver.employeeId,
          name: who,
          reason: leaver.manager?.user?.id
            ? "manager resolved but is inactive, and no active HR_MANAGER exists"
            : "no manager set on the employee record, and no active HR_MANAGER exists",
        });
        continue;
      }

      for (const userId of recipients) {
        await digest.add({
          userId,
          title:
            w.days === 1
              ? `Last working day tomorrow: ${who}`
              : `Leaving in ${w.days} days: ${who}`,
          message:
            `${who}${leaver.jobTitle ? ` (${leaver.jobTitle})` : ""} finishes on ${when}. ` +
            (w.days === 1
              ? "Collect equipment and confirm access has been revoked."
              : w.days === 7
              ? "Book the handover and confirm who takes their caseload."
              : "Plan the handover and start the offboarding request."),
          type: "OFFBOARDING_COUNTDOWN",
          link: `/hr/employees/${leaver.id}`,
          urgent: w.days <= 7,
        });
        summary.raised++;
      }
    }
  }

  await digest.flush({
    heading: "Departures",
    intro: "these colleagues are leaving soon.",
  });

  return summary;
}

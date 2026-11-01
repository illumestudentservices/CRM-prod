import { db } from "@/lib/db";
import { notifyAdmins } from "@/lib/admin-alerts";

/**
 * Report that a scheduled (cron) job failed.
 *
 * The daily jobs log their error to a file and exit non-zero, but nobody is
 * told — and this codebase has a history of reminder jobs that looked set up
 * and silently were not running. Each runner now calls this from its catch so a
 * failure (a) leaves an AUTOMATION_FAILED audit row, and (b) emails the super
 * admins. Best-effort: it must never throw out of the catch that calls it, so
 * the original failure still surfaces in the log and the exit code.
 */
export async function reportAutomationFailure(job: string, err: unknown): Promise<void> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  try {
    await db.auditLog.create({
      data: { userId: null, action: "AUTOMATION_FAILED", entity: "CronJob", entityId: job, changes: { message } },
    });
  } catch (e) {
    console.error("[reportAutomationFailure] audit write failed:", e);
  }
  try {
    await notifyAdmins({
      action: "AUTOMATION_FAILED",
      actorName: "System (scheduled job)",
      actorEmail: "system",
      summary: `Scheduled job "${job}" failed to complete — check the server log.`,
      detail: [["Job", job], ["Error", message]],
    });
  } catch (e) {
    console.error("[reportAutomationFailure] admin alert failed:", e);
  }
}

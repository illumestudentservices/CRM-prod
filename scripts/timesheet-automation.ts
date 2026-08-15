/**
 * Daily timesheet housekeeping, run from the VPS crontab.
 *
 *   node --import tsx scripts/timesheet-automation.ts [--dry-run]
 *
 * Opens the current period for everyone with Timesheet Required, refreshes the
 * calculated hours on open sheets (approved leave changes after a period opens),
 * sends submission reminders, and escalates overdue sheets to their approver.
 *
 * Local-only with no HTTP surface, matching lead-automation.ts: nothing to
 * expose, no secret to rotate, no auth exception to carve out.
 *
 * Safe to run repeatedly. Period creation is idempotent on the unique index
 * (employeeId, periodStart), and both reminder types dedupe on their own event
 * rows, so an hourly cron will not nag anyone twelve times.
 */
// Next.js loads .env itself; a standalone script does not, and without this
// DATABASE_URL is undefined and Prisma fails on an empty password.
import "dotenv/config";
import { runTimesheetAutomation } from "@/lib/timesheet-automation";

const dryRun = process.argv.includes("--dry-run");

runTimesheetAutomation({ dryRun })
  .then((s) => {
    // One line per run so `tail` on the log stays readable.
    console.log(
      `[timesheet-automation] ${s.ranAt}${s.dryRun ? " (dry run)" : ""} — ` +
        `eligible=${s.generation.eligibleEmployees} ` +
        `opened=${s.generation.created} ` +
        `existing=${s.generation.alreadyExisted} ` +
        `refreshed=${s.refreshed} ` +
        `reminders=${s.remindersSent} ` +
        `overdue=${s.overdueNotified}` +
        (s.generation.skippedNoFrequency.length
          ? ` noFrequency=${s.generation.skippedNoFrequency.join("/")}`
          : "") +
        (s.overdueWithNoApprover.length
          ? ` noApprover=${s.overdueWithNoApprover.join("/")}`
          : "")
    );
    process.exit(0);
  })
  .catch((e) => {
    // Print the code explicitly: a dead DB connection surfaces as a Prisma error
    // with an EMPTY message, and without this the log line says nothing at all.
    console.error("[timesheet-automation] FAILED", e?.code ?? "", e?.message ?? "(empty message)");
    console.error(e);
    process.exit(1);
  });

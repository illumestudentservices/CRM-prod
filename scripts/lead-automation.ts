/**
 * Nightly pipeline automation, run from the VPS crontab.
 *
 *   node --import tsx scripts/lead-automation.ts [--dry-run]
 *
 * Runs locally on the server with no HTTP surface, so there is no endpoint to
 * expose, no secret to rotate, and nothing for the auth proxy to make an
 * exception for.
 */
// Next.js loads .env itself; a standalone script does not, and without this
// DATABASE_URL is undefined and Prisma fails on an empty password.
import "dotenv/config";
import { runLeadAutomation } from "@/lib/lead-automation";

const dryRun = process.argv.includes("--dry-run");

runLeadAutomation({ dryRun })
  .then((summary) => {
    // One line per run so `tail` on the log stays readable.
    console.log(
      `[lead-automation] ${summary.ranAt}${summary.dryRun ? " (dry run)" : ""} — ` +
        `reminders=${summary.inactivityReminders} ` +
        `escalations=${summary.inactivityEscalations} ` +
        `offerExpiry=${summary.offerExpiryWarnings} ` +
        `depositDue=${summary.depositDeadlineWarnings} ` +
        `reopened=${summary.deferredReopened}` +
        (summary.unassigned.length ? ` unassigned=${summary.unassigned.length}` : "")
    );
    process.exit(0);
  })
  .catch((err) => {
    // Non-zero exit so cron mail and monitoring notice a failed run.
    console.error("[lead-automation] FAILED", err);
    process.exit(1);
  });

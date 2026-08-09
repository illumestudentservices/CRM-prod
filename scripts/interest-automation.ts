/**
 * Nightly per-Institution-Interest automation. Sister script to
 * lead-automation.ts — this one iterates open interests instead of leads.
 *
 *   node --import tsx scripts/interest-automation.ts [--dry-run]
 *
 * Add to crontab alongside the lead script; both are safe to run in the same
 * window. Once the split cutover is complete, remove lead-automation.ts.
 */
import "dotenv/config";
import { runInterestAutomation } from "@/lib/interest-automation";

const dryRun = process.argv.includes("--dry-run");

runInterestAutomation({ dryRun })
  .then((summary) => {
    console.log(
      `[interest-automation] ${summary.ranAt}${summary.dryRun ? " (dry run)" : ""} — ` +
        `reminders=${summary.inactivityReminders} ` +
        `escalations=${summary.inactivityEscalations} ` +
        `deferredReopened=${summary.deferredReopened}`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("[interest-automation] failed", err);
    process.exit(1);
  });

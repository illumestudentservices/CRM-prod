/**
 * Overdue client-issue alert cron (roadmap 2c).
 *
 * Runs once daily on the VPS. Finds open client issues past their resolution
 * deadline and notifies only the issue's primary owner.
 *
 * Usage:
 *   node --import tsx scripts/overdue-issue-alerts.ts            # live
 *   node --import tsx scripts/overdue-issue-alerts.ts --dry-run  # log-only
 */

// Next.js loads .env itself; a standalone script does not.
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { runOverdueIssueAlerts } from "@/lib/overdue-issue-alerts";

const dryRun = process.argv.includes("--dry-run");

runOverdueIssueAlerts({ dryRun })
  .then((summary) => {
    console.log("[overdue-issue-alerts]", JSON.stringify(summary, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("[overdue-issue-alerts] fatal", err);
    await reportAutomationFailure("overdue-issue-alerts", err);
    process.exit(2);
  });

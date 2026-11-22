/**
 * Enrolment-target-at-risk alert cron (roadmap 2b).
 *
 * Runs once daily on the VPS. Near year-end, finds institutions whose yearly
 * enrolment target is well short and notifies only the account manager.
 * A no-op outside the final stretch of the year.
 *
 * Usage:
 *   node --import tsx scripts/target-at-risk-alerts.ts            # live
 *   node --import tsx scripts/target-at-risk-alerts.ts --dry-run  # log-only
 */

// Next.js loads .env itself; a standalone script does not.
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { runTargetAtRiskAlerts } from "@/lib/target-at-risk-alerts";

const dryRun = process.argv.includes("--dry-run");

runTargetAtRiskAlerts({ dryRun })
  .then((summary) => {
    console.log("[target-at-risk-alerts]", JSON.stringify(summary, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("[target-at-risk-alerts] fatal", err);
    await reportAutomationFailure("target-at-risk-alerts", err);
    process.exit(2);
  });

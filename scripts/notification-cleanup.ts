/**
 * Removes new-hire notifications older than a week.
 *
 *   node --import tsx scripts/notification-cleanup.ts [--dry-run]
 *
 * Runs locally on the server from crontab, like the other automations — no HTTP
 * surface, nothing exposed. See lib/notification-cleanup.ts for what it targets.
 */
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { cleanupNewHireNotifications, NEW_HIRE_NOTIFICATION_TTL_DAYS } from "@/lib/notification-cleanup";

const dryRun = process.argv.includes("--dry-run");

cleanupNewHireNotifications({ dryRun })
  .then((s) => {
    console.log(
      `[notif-cleanup] ${new Date().toISOString()}${s.dryRun ? " (dry run)" : ""} — ` +
        `ttl=${NEW_HIRE_NOTIFICATION_TTL_DAYS}d cutoff=${s.cutoff.slice(0, 10)} ` +
        `${s.dryRun ? "would remove" : "removed"}=${s.deleted}`
    );
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[notif-cleanup] FAILED", err);
    await reportAutomationFailure("notification-cleanup", err);
    process.exit(1);
  });

/**
 * Task reminder + escalation cron.
 *
 * Called from crontab on the VPS at ~08:00 daily. Spec Tasks §8.
 *
 * Usage:
 *   node --import tsx scripts/task-reminders.ts            # live
 *   node --import tsx scripts/task-reminders.ts --dry-run  # log-only
 *
 * The job is intentionally separate from `network-automation.ts` so a
 * failure in one automation domain never masks the other.
 */

import { runTaskReminders } from "@/lib/task-reminders";

const dryRun = process.argv.includes("--dry-run");

runTaskReminders({ dryRun })
  .then((summary) => {
    console.log("[task-reminders]", JSON.stringify(summary, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("[task-reminders] fatal", err);
    process.exit(2);
  });

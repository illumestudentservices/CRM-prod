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

// Next.js loads .env itself; a standalone script does not, and without this
// DATABASE_URL is undefined and Prisma fails on an empty password.
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { runTaskReminders } from "@/lib/task-reminders";

const dryRun = process.argv.includes("--dry-run");

runTaskReminders({ dryRun })
  .then((summary) => {
    console.log("[task-reminders]", JSON.stringify(summary, null, 2));
    process.exit(summary.errors > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("[task-reminders] fatal", err);
    await reportAutomationFailure("task-reminders", err);
    process.exit(2);
  });

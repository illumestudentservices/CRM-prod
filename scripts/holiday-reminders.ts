/**
 * Daily public-holiday notice, run from the VPS crontab.
 *
 *   node --import tsx scripts/holiday-reminders.ts [--dry-run]
 *
 * Runs locally on the server with no HTTP surface, matching the other
 * automations: no endpoint to expose, no secret to rotate, and nothing for the
 * auth proxy to make an exception for.
 *
 * --dry-run reports what WOULD be sent, including which holidays reach nobody,
 * without sending anything or recording a send. Safe to run at any time.
 */
// Next.js loads .env itself; a standalone script does not, and without this
// DATABASE_URL is undefined and Prisma fails on an empty password.
import "dotenv/config";
import { runHolidayReminders } from "@/lib/holiday-reminders";

const dryRun = process.argv.includes("--dry-run");

runHolidayReminders({ dryRun })
  .then((s) => {
    // One line per run so `tail` on the shared log stays readable.
    console.log(
      `[holiday-reminders] ${s.ranAt}${s.dryRun ? " (dry run)" : ""} — ` +
        `matched=${s.matched} emailed=${s.emailed} alreadySent=${s.alreadySent}`
    );
    // Printed separately and in full: this is the line that explains why
    // someone added a holiday and nobody heard about it.
    for (const h of s.reachedNobody) {
      console.warn(
        `[holiday-reminders] REACHED NOBODY — "${h.name}" on ${h.date}: ${h.reason}`
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[holiday-reminders] FAILED:", err);
    process.exit(1);
  });

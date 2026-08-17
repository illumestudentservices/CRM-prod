/**
 * Daily due-date reminders for ICR Transition reports (spec §28).
 *
 *   node --import tsx scripts/transition-reminders.ts
 *
 * Runs once a day from cron. Idempotent in effect but not in output: running it
 * twice in one day sends every reminder twice, so it is scheduled once.
 *
 * Written as a promise chain rather than top-level await, and importing
 * "dotenv/config" rather than relying on --env-file, to match the other cron
 * scripts. tsx transforms .ts to CJS on the server, which rejects top-level
 * await — a script written that way runs locally and then fails every night in
 * cron with nothing in the log but a transform error.
 */
import "dotenv/config";
import { sendDueDateReminders } from "@/lib/transition-notifications";
import { db } from "@/lib/db";

sendDueDateReminders()
  .then(async (summary) => {
    console.log("[transition-reminders]", JSON.stringify(summary));
    await db.$disconnect().catch(() => {});
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[transition-reminders] fatal", err);
    await db.$disconnect().catch(() => {});
    process.exit(2);
  });

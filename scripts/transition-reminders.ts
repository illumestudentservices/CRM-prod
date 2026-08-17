/**
 * Daily due-date reminders for ICR Transition reports (spec §28).
 *
 *   node --import tsx --env-file=.env scripts/transition-reminders.ts
 *
 * Intended to run once a day from cron, alongside the other scheduled jobs.
 * Idempotent in effect but not in output: running it twice in one day sends the
 * reminders twice, so schedule it once.
 */
import { sendDueDateReminders } from "../lib/transition-notifications";
import { db } from "../lib/db";

const result = await sendDueDateReminders();
console.log(
  `[transition-reminders] approaching=${result.approaching} dueToday=${result.dueToday} overdue=${result.overdue}`
);
await db.$disconnect();

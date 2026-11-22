import { db } from "@/lib/db";

/**
 * New-hire ("Welcome to Illume") notifications are a transient courtesy — once
 * everyone has seen that someone joined, keeping the bell entry around for
 * months is just clutter. This removes them a week after they were posted.
 *
 * Targets both the new dedicated `NEW_HIRE` type and the legacy ones that were
 * posted as generic `ANNOUNCEMENT` with the "Welcome to Illume" title, so the
 * existing backlog ages out too. Other announcements are left alone.
 */

export const NEW_HIRE_NOTIFICATION_TTL_DAYS = 7;

export async function cleanupNewHireNotifications({ dryRun = false }: { dryRun?: boolean } = {}) {
  const cutoff = new Date(Date.now() - NEW_HIRE_NOTIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    createdAt: { lt: cutoff },
    OR: [
      { type: "NEW_HIRE" },
      { type: "ANNOUNCEMENT", title: { startsWith: "Welcome to Illume" } },
    ],
  };

  if (dryRun) {
    const deleted = await db.notification.count({ where });
    return { deleted, dryRun: true, cutoff: cutoff.toISOString() };
  }
  const { count } = await db.notification.deleteMany({ where });
  return { deleted: count, dryRun: false, cutoff: cutoff.toISOString() };
}

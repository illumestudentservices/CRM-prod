import { db } from "@/lib/db";

/**
 * Advance notice of public holidays.
 *
 * Runs once each morning from the VPS crontab. Anyone the holiday applies to
 * gets one email three days beforehand, so a deadline landing on a closed day
 * is noticed while there is still time to move it.
 *
 * ★ A HOLIDAY WITH NO AUDIENCE IS THE FAILURE MODE TO WATCH.
 *
 * A holiday reaches people in one of two ways: `isGlobal`, or a `regionId`
 * matching a user's own. Measured on production, only 6 of 16 active users
 * have a region at all, and four of the eight regions contain nobody. So a
 * holiday added for, say, North America would notify NOT ONE PERSON — and
 * would do it silently, because a query that matches nobody raises no error.
 *
 * Every run therefore reports its empty sends. `sentCount: 0` is recorded
 * rather than skipped, and the summary names the holidays that reached nobody,
 * so "I added the holiday and nothing happened" has an answer on the log.
 */

/** How far ahead the notice goes out. */
export const HOLIDAY_NOTICE_DAYS = 3;

export type HolidayReminderSummary = {
  ranAt: string;
  dryRun: boolean;
  /// Holidays that fell in the notice window this morning.
  matched: number;
  /// Notices sent, one per person.
  emailed: number;
  /// Holidays skipped because a notice had already gone out for that date.
  alreadySent: number;
  /// Holidays whose audience was empty. These are the ones worth reading.
  reachedNobody: Array<{ name: string; date: string; reason: string }>;
};

/** Midnight UTC for a date, so day arithmetic cannot drift with the clock. */
function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** "Friday, 25 December 2026" — written out, because a bare date is ambiguous
 *  across the markets this goes to (25/12 vs 12/25). */
export function formatHolidayDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export async function runHolidayReminders(
  { dryRun = false, now = new Date() }: { dryRun?: boolean; now?: Date } = {}
): Promise<HolidayReminderSummary> {
  const today = utcDay(now);
  const target = new Date(today.getTime() + HOLIDAY_NOTICE_DAYS * 86_400_000);
  const dayAfter = new Date(target.getTime() + 86_400_000);

  const summary: HolidayReminderSummary = {
    ranAt: now.toISOString(),
    dryRun,
    matched: 0,
    emailed: 0,
    alreadySent: 0,
    reachedNobody: [],
  };

  const holidays = await db.holiday.findMany({
    // A half-open range, not an equality test: the column is DATE but Prisma
    // hands back a DateTime, and an `equals` on a midnight boundary is exactly
    // the kind of comparison that works until a server's timezone changes.
    where: { date: { gte: target, lt: dayAfter } },
    select: {
      id: true, name: true, date: true, description: true,
      isGlobal: true, regionId: true,
      region: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });
  summary.matched = holidays.length;
  if (holidays.length === 0) return summary;

  const { sendHolidayReminderEmail } = await import("@/lib/email");

  for (const holiday of holidays) {
    // Already announced for this date? The unique index is the real guarantee;
    // this check just avoids the pointless work and the caught error.
    const already = await db.holidayReminder.findUnique({
      where: { holidayId_forDate: { holidayId: holiday.id, forDate: holiday.date } },
      select: { id: true },
    });
    if (already) {
      summary.alreadySent++;
      continue;
    }

    // Who it applies to. A global holiday reaches everyone; otherwise only the
    // region's own members. External client contacts are never included —
    // Illume's office calendar is not their business.
    const audience = holiday.isGlobal
      ? await db.user.findMany({
          where: { isActive: true, deletedAt: null, role: { not: "INSTITUTION_CLIENT" } },
          select: { id: true, email: true, name: true },
        })
      : holiday.regionId
      ? await db.user.findMany({
          where: {
            isActive: true, deletedAt: null, role: { not: "INSTITUTION_CLIENT" },
            regionId: holiday.regionId,
          },
          select: { id: true, email: true, name: true },
        })
      : [];

    if (audience.length === 0) {
      summary.reachedNobody.push({
        name: holiday.name,
        date: holiday.date.toISOString().slice(0, 10),
        reason: holiday.isGlobal
          ? "marked global, but there are no active internal users"
          : holiday.regionId
          ? `no active users are assigned to ${holiday.region?.name ?? "that region"}`
          : "not global and no region set, so it applies to nobody",
      });
    }

    if (dryRun) continue;

    // Reserve the send FIRST. If the process dies part-way through a large
    // region, the next run must not start the broadcast again from the top.
    // A concurrent run loses the race on the unique index and skips.
    try {
      await db.holidayReminder.create({
        data: { holidayId: holiday.id, forDate: holiday.date, sentCount: audience.length },
      });
    } catch {
      summary.alreadySent++;
      continue;
    }

    const when = formatHolidayDate(holiday.date);
    for (const person of audience) {
      if (!person.email) continue;
      await sendHolidayReminderEmail({
        to: person.email,
        recipientName: person.name ?? "there",
        holidayName: holiday.name,
        holidayDate: when,
        daysAway: HOLIDAY_NOTICE_DAYS,
        scope: holiday.isGlobal ? "Company-wide" : holiday.region?.name ?? "Your region",
        description: holiday.description ?? undefined,
      });
      summary.emailed++;
    }

    // In-app too, so it is visible to anyone who does not read email closely.
    await db.notification.createMany({
      data: audience.map((p) => ({
        userId: p.id,
        title: `${holiday.name} — ${when}`,
        message: `A public holiday is ${HOLIDAY_NOTICE_DAYS} days away.`,
        type: "HOLIDAY_REMINDER",
        link: "/hr",
      })),
    }).catch(() => { /* the email is the primary channel */ });
  }

  return summary;
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { displayName } from "@/lib/person-name";

/**
 * GET /api/reports/weekly-report?icrId=&year=&month=&weekOfMonth=
 *
 * Generates a read-only weekly report summary for a given ICR.
 * Not a stored entity — assembled on the fly from WeeklyActivity + Activity data.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { searchParams } = req.nextUrl;
    const icrId = searchParams.get("icrId");
    const year = parseInt(searchParams.get("year") ?? "");
    const month = parseInt(searchParams.get("month") ?? "");
    const weekOfMonth = parseInt(searchParams.get("weekOfMonth") ?? "");

    if (!icrId || isNaN(year) || isNaN(month) || isNaN(weekOfMonth)) {
      return NextResponse.json(
        { error: "Missing or invalid query params: icrId, year, month, weekOfMonth" },
        { status: 400 }
      );
    }

    // Access control: ICR can only see their own; RM sees their region; HQ sees all
    if (role === "ICR" && icrId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role === "REGIONAL_MANAGER") {
      const targetUser = await db.user.findUnique({
        where: { id: icrId },
        select: { regionId: true },
      });
      if (!targetUser || targetUser.regionId !== regionId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // ── Compute the date range for this week-of-month ──────────────────────
    // weekOfMonth 1 = days 1-7, 2 = 8-14, 3 = 15-21, 4 = 22-end
    const weekStart = new Date(year, month - 1, (weekOfMonth - 1) * 7 + 1);
    const weekEnd =
      weekOfMonth === 4
        ? new Date(year, month, 0, 23, 59, 59) // last day of month
        : new Date(year, month - 1, weekOfMonth * 7, 23, 59, 59);

    // Next week range (for upcoming activities)
    const nextWeekStart = new Date(weekEnd.getTime() + 1);
    const nextWeekEnd = new Date(nextWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    // ── Fetch data in parallel ─────────────────────────────────────────────
    const [weeklyActivities, activities, upcomingActivities, leadChanges] =
      await Promise.all([
        // WeeklyActivity entries for this specific week
        db.weeklyActivity.findMany({
          where: { icrId, year, month, weekOfMonth },
          orderBy: { type: "asc" },
        }),

        // Activity entries for this week's date range
        db.activity.findMany({
          where: {
            userId: icrId,
            deletedAt: null,
            date: { gte: weekStart, lte: weekEnd },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            type: true,
            title: true,
            date: true,
            outcomes: true,
            cost: true,
            leadsGenerated: true,
            studentsEngaged: true,
            institution: { select: { id: true, name: true } },
          },
        }),

        // Upcoming activities for next week
        db.activity.findMany({
          where: {
            userId: icrId,
            deletedAt: null,
            date: { gte: nextWeekStart, lte: nextWeekEnd },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            type: true,
            title: true,
            date: true,
            institution: { select: { id: true, name: true } },
          },
        }),

        // Lead stage changes this week (leads updated within this week)
        db.lead.findMany({
          where: {
            assignedICRId: icrId,
            deletedAt: null,
            updatedAt: { gte: weekStart, lte: weekEnd },
          },
          select: {
            id: true,
            firstName: true, lastName: true,
            stage: true,
            updatedAt: true,
            institution: { select: { name: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 50,
        }),
      ]);

    // ── Aggregate outcomes ─────────────────────────────────────────────────
    const outcomes = activities
      .filter((a) => a.outcomes)
      .map((a) => ({ activity: a.title, outcome: a.outcomes }));

    // ── Build response ─────────────────────────────────────────────────────
    return NextResponse.json({
      icrId,
      year,
      month,
      weekOfMonth,
      dateRange: {
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
      },
      activitiesCompleted: {
        count: activities.length,
        list: activities.map((a) => ({
          id: a.id,
          type: a.type,
          title: a.title,
          date: a.date,
          cost: a.cost,
          leadsGenerated: a.leadsGenerated,
          studentsEngaged: a.studentsEngaged,
          institution: a.institution?.name ?? null,
        })),
      },
      weeklyActivityTracker: weeklyActivities.map((wa) => ({
        type: wa.type,
        target: wa.target,
        completed: wa.completed,
        detail: wa.detail,
      })),
      outcomes,
      pipelineUpdates: leadChanges.map((l) => ({
        leadId: l.id,
        name: displayName(l),
        currentStage: l.stage,
        institution: l.institution?.name ?? null,
        updatedAt: l.updatedAt,
      })),
      upcomingActivities: upcomingActivities.map((a) => ({
        id: a.id,
        type: a.type,
        title: a.title,
        date: a.date,
        institution: a.institution?.name ?? null,
      })),
    });
  } catch (error) {
    console.error("[weekly-report] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

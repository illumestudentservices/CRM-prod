import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import {
  WEEKLY_ACTIVITY_TYPES,
  WEEKS_OF_MONTH,
  canViewWeeklyActivities,
} from "@/lib/weekly-activities";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2035),
  month: z.coerce.number().int().min(1).max(12),
  icrId: z.string().min(1).optional(),
});

const upsertSchema = z.object({
  year: z.number().int().min(2020).max(2035),
  month: z.number().int().min(1).max(12),
  weekOfMonth: z.number().int().refine((w) => (WEEKS_OF_MONTH as readonly number[]).includes(w), {
    message: "Invalid week of month",
  }),
  type: z.enum(WEEKLY_ACTIVITY_TYPES),
  target: z.number().int().min(0).max(999),
  completed: z.number().int().min(0).max(999),
  detail: z.string().max(2000).optional().nullable(),
});

type SessionUser = { role: Role; id: string; regionId: string | null };

// GET /api/reports/weekly-activities?year=&month=&icrId=
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { role, id: userId, regionId } = session.user as SessionUser;

    if (!canViewWeeklyActivities(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = querySchema.safeParse({
      year: req.nextUrl.searchParams.get("year"),
      month: req.nextUrl.searchParams.get("month"),
      icrId: req.nextUrl.searchParams.get("icrId") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query", details: parsed.error.flatten() }, { status: 400 });
    }
    const { year, month, icrId } = parsed.data;

    // Scope: ICR can only ever see their own. RM is bound to their region.
    const where: {
      year: number;
      month: number;
      icrId?: string;
      regionId?: string;
    } = { year, month };

    if (role === "ICR") {
      where.icrId = userId;
    } else if (role === "REGIONAL_MANAGER") {
      if (regionId) where.regionId = regionId;
      if (icrId) where.icrId = icrId;
    } else {
      // SUPER_ADMIN — all, optionally narrowed to one ICR
      if (icrId) where.icrId = icrId;
    }

    const activities = await db.weeklyActivity.findMany({
      where,
      include: { icr: { select: { id: true, name: true } } },
      orderBy: [{ icrId: "asc" }, { weekOfMonth: "asc" }],
    });

    return NextResponse.json({ activities });
  } catch (error) {
    console.error("[weekly-activities] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/reports/weekly-activities — upsert a single (week × activity) cell.
// Only ICRs log their own activities.
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { role, id: userId, regionId } = session.user as SessionUser;

    if (role !== "ICR") {
      return NextResponse.json(
        { error: "Only ICRs can log weekly activities" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }
    const { year, month, weekOfMonth, type, target, completed, detail } = parsed.data;

    const activity = await db.weeklyActivity.upsert({
      where: {
        icrId_year_month_weekOfMonth_type: { icrId: userId, year, month, weekOfMonth, type },
      },
      create: {
        icrId: userId,
        regionId: regionId ?? undefined,
        year,
        month,
        weekOfMonth,
        type,
        target,
        completed,
        detail: detail ?? undefined,
      },
      update: {
        target,
        completed,
        detail: detail ?? null,
        // keep region in sync in case the ICR moved regions
        regionId: regionId ?? undefined,
      },
    });

    return NextResponse.json({ activity }, { status: 200 });
  } catch (error) {
    console.error("[weekly-activities] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

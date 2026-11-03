import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createHolidaySchema = z.object({
  name: z.string().min(1, "Name is required"),
  date: z.string().transform((v) => new Date(v)),
  // Optional end of a multi-day holiday (e.g. a week-long festival). When
  // given, one holiday row is created per day from `date` to `endDate`
  // inclusive. Omitted = a single day, exactly as before.
  endDate: z.string().transform((v) => new Date(v)).optional().nullable(),
  description: z.string().optional().nullable(),
  regionId: z.string().min(1).optional().nullable(),
  isGlobal: z.boolean().default(false),
});

// ─── GET /api/hr/holidays ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const regionId = searchParams.get("regionId");

  // Determine which holidays the user can see
  // HR/Admin see everything; others see global + their region
  const isHR = HR_ROLES.includes(session.user.role as Role);

  let where: Record<string, unknown> = {};

  if (!isHR) {
    // Get user's region
    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { regionId: true },
    });
    const userRegionId = user?.regionId;

    where = {
      OR: [
        { isGlobal: true },
        ...(userRegionId ? [{ regionId: userRegionId }] : []),
      ],
    };
  } else if (regionId) {
    where = {
      OR: [{ isGlobal: true }, { regionId }],
    };
  }

  const holidays = await db.holiday.findMany({
    where,
    include: {
      region: { select: { id: true, name: true } },
    },
    orderBy: { date: "asc" },
  });

  return NextResponse.json({ holidays });
}

// ─── POST /api/hr/holidays ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HR_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createHolidaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  // Build the list of days this request covers. No end date = a single day.
  const toUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const start = toUtcDay(data.date);
  const end = data.endDate ? toUtcDay(data.endDate) : start;

  if (end.getTime() < start.getTime()) {
    return NextResponse.json({ error: "End date must be on or after the start date." }, { status: 422 });
  }

  const dates: Date[] = [];
  for (let cur = new Date(start); cur.getTime() <= end.getTime(); cur.setUTCDate(cur.getUTCDate() + 1)) {
    dates.push(new Date(cur));
    if (dates.length > 60) {
      // A guard against a mistyped year turning into thousands of rows.
      return NextResponse.json({ error: "That range is over 60 days — please add it in smaller spans." }, { status: 422 });
    }
  }

  // Single day: create and return the row (unchanged shape). Range: bulk create.
  if (dates.length === 1) {
    const holiday = await db.holiday.create({
      data: {
        name: data.name,
        date: dates[0],
        description: data.description ?? null,
        regionId: data.regionId ?? null,
        isGlobal: data.isGlobal,
        createdById: session.user.id,
      },
      include: { region: { select: { id: true, name: true } } },
    });
    void logActivity(session.user.id, "CREATE", "Holiday", holiday.id, { route: "hr/holidays" });
    return NextResponse.json({ holiday, count: 1 }, { status: 201 });
  }

  await db.holiday.createMany({
    data: dates.map((d) => ({
      name: data.name,
      date: d,
      description: data.description ?? null,
      regionId: data.regionId ?? null,
      isGlobal: data.isGlobal,
      createdById: session.user.id,
    })),
  });
  void logActivity(session.user.id, "CREATE", "Holiday", "range", {
    route: "hr/holidays",
    name: data.name,
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
    count: dates.length,
  });

  return NextResponse.json({ count: dates.length }, { status: 201 });
}

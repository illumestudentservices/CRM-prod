import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createHolidaySchema = z.object({
  name: z.string().min(1, "Name is required"),
  date: z.string().transform((v) => new Date(v)),
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

  const holiday = await db.holiday.create({
    data: {
      name: data.name,
      date: data.date,
      description: data.description ?? null,
      regionId: data.regionId ?? null,
      isGlobal: data.isGlobal,
      createdById: session.user.id,
    },
    include: {
      region: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ holiday }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

// ─── GET /api/hr/leave/balances ────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  if (!isHR) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const year = parseInt(new URL(req.url).searchParams.get("year") ?? String(new Date().getFullYear()));

  const balances = await db.leaveBalance.findMany({
    where: { year },
    include: {
      employee: {
        include: {
          user: { select: { id: true, name: true, image: true } },
          department: { select: { name: true } },
        },
      },
    },
    orderBy: [{ employee: { user: { name: "asc" } } }, { leaveType: "asc" }],
  });

  return NextResponse.json({ balances });
}

// ─── PATCH /api/hr/leave/balances ─────────────────────────────────────────────

const updateSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.enum(["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "COMP_OFF"]),
  year: z.number().int(),
  totalDays: z.number().min(0).max(365),
  reason: z.string().min(1, "Reason is required"),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  if (!isHR) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }

  const { employeeId, leaveType, year, totalDays, reason } = parsed.data;

  const balance = await db.leaveBalance.upsert({
    where: { employeeId_leaveType_year: { employeeId, leaveType, year } },
    update: { totalDays },
    create: { employeeId, leaveType, year, totalDays, usedDays: 0, pendingDays: 0 },
  });

  // Log to audit trail
  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "LEAVE",
      entityId: balance.id,
      changes: { leaveType, year, totalDays, reason },
    },
  });

  return NextResponse.json({ balance });
}

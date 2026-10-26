import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import type { LeaveTypeKey } from "@/lib/leave-policy";
import { leavePolicyTable, defaultPolicyRow } from "@/lib/leave-policy-resolver";

/**
 * Per-region leave policy numbers. SUPER_ADMIN and HR_MANAGER only.
 *
 * A region row overrides the editable numbers (days, waiting period, cap) of the
 * default policy in lib/leave-policy.ts. Submitting values equal to the default
 * removes the override, so a region only carries rows where it actually differs.
 * Entitlement is computed on read, so a save takes effect immediately.
 */

const EDITORS = ["SUPER_ADMIN", "HR_MANAGER"] as const;
function canEdit(role: string): boolean {
  return (EDITORS as readonly string[]).includes(role);
}

// ─── GET: every region's effective numbers + the defaults ───────────────────
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEdit(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await leavePolicyTable());
}

// ─── PUT: save one region's numbers ─────────────────────────────────────────
const itemSchema = z.object({
  leaveType: z.enum(["VACATION_PAID", "SICK", "MATERNITY", "PATERNITY"]),
  accrualDays: z.number().min(0).max(366),
  waitingPeriodValue: z.number().int().min(0).max(366),
  waitingPeriodUnit: z.enum(["days", "months"]),
  maxBalance: z.number().min(0).max(366).nullable(),
});
const putSchema = z.object({
  regionId: z.string().min(1),
  items: z.array(itemSchema).min(1),
});

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canEdit(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }
  const { regionId, items } = parsed.data;

  const region = await db.region.findUnique({ where: { id: regionId }, select: { id: true } });
  if (!region) return NextResponse.json({ error: "Region not found" }, { status: 404 });

  for (const item of items) {
    const d = defaultPolicyRow(item.leaveType as LeaveTypeKey);
    const equalsDefault =
      item.accrualDays === d.accrualDays &&
      item.waitingPeriodValue === d.waitingPeriodValue &&
      item.waitingPeriodUnit === d.waitingPeriodUnit &&
      (item.maxBalance ?? null) === (d.maxBalance ?? null);

    if (equalsDefault) {
      // Back to default → drop any override so the region stays on the baseline.
      await db.leavePolicy.deleteMany({ where: { regionId, leaveType: item.leaveType } });
    } else {
      await db.leavePolicy.upsert({
        where: { regionId_leaveType: { regionId, leaveType: item.leaveType } },
        update: {
          accrualDays: item.accrualDays,
          waitingPeriodValue: item.waitingPeriodValue,
          waitingPeriodUnit: item.waitingPeriodUnit,
          maxBalance: item.maxBalance,
          updatedById: session.user.id,
        },
        create: {
          regionId,
          leaveType: item.leaveType,
          accrualDays: item.accrualDays,
          waitingPeriodValue: item.waitingPeriodValue,
          waitingPeriodUnit: item.waitingPeriodUnit,
          maxBalance: item.maxBalance,
          updatedById: session.user.id,
        },
      });
    }
  }

  void logActivity(session.user.id, "UPDATE", "LeavePolicy", regionId, {
    region: regionId,
    changed: items.map((i) => i.leaveType),
  });

  return NextResponse.json(await leavePolicyTable());
}

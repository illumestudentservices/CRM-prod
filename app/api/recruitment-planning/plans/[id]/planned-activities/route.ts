import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Planned field activities on a quarterly plan — "how many school visits do we
 * intend to do this quarter", not the visits themselves.
 *
 * PlannedFieldActivity is displayed on the plan and is wired into activation:
 * approving a plan materialises stub Field Operation rows from these. There was
 * no way to CREATE one, so the intended quantities could never be recorded and
 * the plan could not be compared against what actually happened.
 */

/**
 * The activity types a plan can commit to.
 *
 * `activityType` is a free String on the model, with the intended values only
 * in a doc comment. It is constrained here so the planned quantities can be
 * grouped and compared against delivery — a free-text type cannot be reported
 * on, which is the same reason LeadLostReason and WorkCategory are enums.
 */
export const PLANNED_ACTIVITY_TYPES = [
  "SCHOOL_VISIT",
  "AGENT_MEETING",
  "COUNSELLOR_TRAINING",
  "STUDENT_PRESENTATION",
  "WEBINAR",
  "CLIENT_MEETING",
  "OTHER",
] as const;

const createSchema = z.object({
  activityType: z.enum(PLANNED_ACTIVITY_TYPES),
  plannedCount: z.number().int().positive("Plan at least one"),
  notes: z.string().max(2000).optional().nullable(),
});

async function loadWritablePlan(id: string) {
  const plan = await db.quarterlyRecruitmentPlan.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!plan) {
    return { error: NextResponse.json({ error: "Plan not found" }, { status: 404 }) };
  }
  if (["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"].includes(plan.status)) {
    return {
      error: NextResponse.json(
        { error: "Plan is locked. Use a Variation Request to change planned activities." },
        { status: 409 }
      ),
    };
  }
  return { plan };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const rows = await db.plannedFieldActivity.findMany({
      where: { planId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET planned-activities]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const gate = await loadWritablePlan(id);
    if (gate.error) return gate.error;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const d = parsed.data;

    // One row per type per plan. Two "SCHOOL_VISIT" rows would make the planned
    // total ambiguous and double-materialise stubs at activation.
    const existing = await db.plannedFieldActivity.findFirst({
      where: { planId: id, activityType: d.activityType },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "That activity type is already planned. Edit the existing row instead.", rowId: existing.id },
        { status: 409 }
      );
    }

    const created = await db.plannedFieldActivity.create({
      data: {
        planId: id,
        activityType: d.activityType,
        plannedCount: d.plannedCount,
        notes: d.notes?.trim() || null,
      },
    });
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (err) {
    console.error("[POST planned-activities]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const rowId = req.nextUrl.searchParams.get("rowId");
    if (!rowId) return NextResponse.json({ error: "rowId is required" }, { status: 400 });

    const gate = await loadWritablePlan(id);
    if (gate.error) return gate.error;

    const row = await db.plannedFieldActivity.findFirst({
      where: { id: rowId, planId: id },
      select: { id: true, activatedAt: true },
    });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.activatedAt) {
      return NextResponse.json(
        { error: "This has already been activated into field operations and cannot be removed here." },
        { status: 409 }
      );
    }

    await db.plannedFieldActivity.delete({ where: { id: rowId } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[DELETE planned-activities]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

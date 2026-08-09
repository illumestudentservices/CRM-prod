import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const createSchema = z.object({
  type: z.enum([
    "ADD_TRAVEL", "CANCEL_TRAVEL", "ADD_RECRUITMENT_EVENT", "CANCEL_RECRUITMENT_EVENT",
    "INCREASE_BUDGET", "DECREASE_BUDGET", "ADD_FIELD_ACTIVITY", "REMOVE_FIELD_ACTIVITY", "OTHER",
  ]),
  reason: z.string().min(5),
  incrementalCost: z.number().optional(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const rows = await db.variationRequest.findMany({
      where: { planId: id },
      orderBy: { requestedAt: "desc" },
      include: {
        requestedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error("[GET variations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const plan = await db.quarterlyRecruitmentPlan.findUnique({ where: { id }, select: { status: true } });
    if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (!["APPROVED", "ACTIVE"].includes(plan.status)) {
      return NextResponse.json({ error: "Variation Requests only apply to APPROVED or ACTIVE plans" }, { status: 409 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const variation = await db.variationRequest.create({
      data: {
        planId: id,
        type: parsed.data.type,
        reason: parsed.data.reason,
        requestedById: userId,
        incrementalCost: parsed.data.incrementalCost,
        status: "SUBMITTED",
      },
    });
    return NextResponse.json(variation, { status: 201 });
  } catch (err) {
    console.error("[POST variations]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

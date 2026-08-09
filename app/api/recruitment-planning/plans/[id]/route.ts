import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const updateSchema = z.object({
  reportingCurrency: z.string().length(3).optional(),
  objectives: z.any().optional(),
  regionalManagerId: z.string().optional().nullable(),
  accountManagerId: z.string().optional().nullable(),
  vpReviewerId: z.string().optional().nullable(),
});

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const plan = await db.quarterlyRecruitmentPlan.findUnique({
      where: { id },
      include: {
        icr: { select: { id: true, name: true, email: true } },
        regionalManager: { select: { id: true, name: true } },
        accountManager: { select: { id: true, name: true } },
        vpReviewer: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true, country: true } },
        market: { select: { id: true, name: true, code: true } },
        plannedTravel: { include: { linkedEvent: { select: { id: true, name: true, date: true } } } },
        plannedEvents: { include: { event: { select: { id: true, name: true, date: true } }, institutionRepresented: { select: { id: true, name: true } } } },
        plannedFieldActivities: true,
        budgetItems: true,
        variationRequests: {
          orderBy: { requestedAt: "desc" },
          include: { requestedBy: { select: { id: true, name: true } }, approvedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(plan);
  } catch (err) {
    console.error("[GET /api/recruitment-planning/plans/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const plan = await db.quarterlyRecruitmentPlan.findUnique({ where: { id }, select: { status: true, icrId: true } });
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Ownership check FIRST — an ICR who does not own this plan should get 403
    // regardless of the plan's lock state (avoids leaking APPROVED-vs-DRAFT to
    // an unauthorised user).
    if (role === "ICR" && plan.icrId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Spec §3: once APPROVED the plan is read-only.
    if (["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"].includes(plan.status)) {
      return NextResponse.json({ error: "Plan is locked. Submit a Variation Request instead." }, { status: 409 });
    }

    // ICRs may only edit their own DRAFT/RETURNED plans (ownership already checked above)
    if (role === "ICR") {
      if (!["DRAFT", "RETURNED"].includes(plan.status)) {
        return NextResponse.json({ error: "ICRs can only edit DRAFT or RETURNED plans" }, { status: 409 });
      }
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patchData: any = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) patchData[k] = v;
    }

    const updated = await db.quarterlyRecruitmentPlan.update({ where: { id }, data: patchData });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PATCH /api/recruitment-planning/plans/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

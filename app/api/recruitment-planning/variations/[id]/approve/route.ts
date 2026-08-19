import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { hasCapability } from "@/lib/granular-permissions";

const schema = z.object({
  decision: z.enum(["APPROVED", "RETURNED"]),
  reviewNotes: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "recruitment_planning", "approve"))) {
      return NextResponse.json({ error: "Forbidden — approval permission required" }, { status: 403 });
    }
    // The finer control, which until now existed only on the Security screen.
    // Its default is exactly the set the coarse check above already allows, so
    // this withdraws nothing by itself.
    if (!(await hasCapability(role as Role, "recruitment_planning.approve_variation"))) {
      return NextResponse.json(
        { error: "Your role is not permitted to approve variation requests" },
        { status: 403 }
      );
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const variation = await db.variationRequest.findUnique({ where: { id }, select: { status: true } });
    if (!variation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (variation.status !== "SUBMITTED") {
      return NextResponse.json({ error: "Only SUBMITTED variations can be reviewed" }, { status: 409 });
    }

    const updated = await db.variationRequest.update({
      where: { id },
      data: {
        status: parsed.data.decision,
        approvedById: userId,
        approvedAt: new Date(),
        reviewNotes: parsed.data.reviewNotes,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST variations/[id]/approve]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

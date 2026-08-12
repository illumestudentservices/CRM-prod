import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { trashRecord } from "@/lib/recycle-bin";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { institutionIdsForUser } from "@/lib/lead-access";

const updateQBRSchema = z.object({
  executiveSummary: z.string().optional(),
  strategicRecommendations: z.string().optional(),
  status: z.enum(["DRAFT", "SUBMITTED", "APPROVED"]).optional(),
});

/**
 * GET /api/reports/qbr/[id]
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Was signed-in-only: any role could read any client's QBR by id, while
    // PATCH and DELETE in this same file each required a different role list.
    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "reports", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const qbr = await db.quarterlyBusinessReview.findUnique({
      where: { id },
      include: {
        institution: { select: { id: true, name: true, country: true } },
      },
    });

    if (!qbr) {
      return NextResponse.json({ error: "QBR not found" }, { status: 404 });
    }

    // INSTITUTION_CLIENT holds reports:read, so the permission alone would let
    // one client read another's review. 404 rather than 403 so an id cannot be
    // probed for existence.
    if (role === "INSTITUTION_CLIENT") {
      const allowed = await institutionIdsForUser(session.user.id, role);
      if (!allowed.includes(qbr.institutionId)) {
        return NextResponse.json({ error: "QBR not found" }, { status: 404 });
      }
    }

    return NextResponse.json(qbr);
  } catch (error) {
    console.error("[qbr/id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PATCH /api/reports/qbr/[id]
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = session.user as { role: Role };

    if (!["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const qbr = await db.quarterlyBusinessReview.findUnique({ where: { id } });
    if (!qbr) {
      return NextResponse.json({ error: "QBR not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateQBRSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.executiveSummary !== undefined) updateData.executiveSummary = parsed.data.executiveSummary;
    if (parsed.data.strategicRecommendations !== undefined) updateData.strategicRecommendations = parsed.data.strategicRecommendations;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

    const updated = await db.quarterlyBusinessReview.update({
      where: { id },
      data: updateData,
      include: {
        institution: { select: { id: true, name: true, country: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[qbr/id] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/reports/qbr/[id]
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = session.user as { role: Role };

    if (!["SUPER_ADMIN", "HQ_EXECUTIVE"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const qbr = await db.quarterlyBusinessReview.findUnique({ where: { id } });
    if (!qbr) {
      return NextResponse.json({ error: "QBR not found" }, { status: 404 });
    }

    await trashRecord({ entityType: "QuarterlyBusinessReview", entityId: id, userId: session.user.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[qbr/id] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { trashRecord } from "@/lib/recycle-bin";

const updateReportSchema = z.object({
  engagementNotes: z.string().optional(),
  challengesOpportunities: z.string().optional(),
  nextMonthPlan: z.string().optional(),
  successStories: z.string().optional(),
  marketInsights: z.string().optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW"]).optional(),
});

function canAccessReport(
  role: Role,
  userId: string,
  regionId: string | null,
  report: { icrId: string; regionId: string | null }
): boolean {
  if (["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role)) return true;
  if (role === "REGIONAL_MANAGER") {
    return regionId !== null && report.regionId === regionId;
  }
  if (role === "ICR") return report.icrId === userId;
  return false;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id, deletedAt: null },
      include: {
        icr: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true, country: true } },
        region: { select: { id: true, name: true } },
        approvals: {
          orderBy: { createdAt: "desc" },
          include: { user: { select: { id: true, name: true, role: true } } },
        },
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (!canAccessReport(role, userId, regionId, report)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("[reports/id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    const { id } = await params;

    const report = await db.monthlyReport.findFirst({
      where: { id, deletedAt: null },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (!canAccessReport(role, userId, regionId, report)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ICR can only edit DRAFT or RETURNED reports
    if (role === "ICR" && !["DRAFT", "RETURNED"].includes(report.status)) {
      return NextResponse.json({ error: "Report cannot be edited in current status" }, { status: 400 });
    }

    const body = await req.json();
    const parsed = updateReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.engagementNotes !== undefined) updateData.engagementNotes = parsed.data.engagementNotes;
    if (parsed.data.challengesOpportunities !== undefined) updateData.challengesOpportunities = parsed.data.challengesOpportunities;
    if (parsed.data.nextMonthPlan !== undefined) updateData.nextMonthPlan = parsed.data.nextMonthPlan;
    if (parsed.data.successStories !== undefined) updateData.successStories = parsed.data.successStories;
    if (parsed.data.marketInsights !== undefined) updateData.marketInsights = parsed.data.marketInsights;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

    const updated = await db.monthlyReport.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[reports/id] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId } = session.user as { role: Role; id: string; regionId: string | null };

    const { id } = await params;

    const report = await db.monthlyReport.findFirst({ where: { id, deletedAt: null } });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    // Only the ICR who owns it (if DRAFT) or SUPER_ADMIN can delete
    if (role !== "SUPER_ADMIN" && !(role === "ICR" && report.icrId === userId && report.status === "DRAFT")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await trashRecord({ entityType: "MonthlyReport", entityId: id, userId: session.user.id });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[reports/id] DELETE error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

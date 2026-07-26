import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── Validation ───────────────────────────────────────────────────────────────

const actionItemSchema = z.object({
  title: z.string().min(1),
  assignee: z.string().optional(),
  dueDate: z.string().optional(),
  completed: z.boolean().default(false),
});

const updateActivitySchema = z.object({
  type: z.enum(["SCHOOL_VISIT", "AGENT_MEETING", "STUDENT_EVENT", "FAIR", "PARTNER_MEETING"]).optional(),
  title: z.string().min(2).optional(),
  description: z.string().optional().nullable(),
  date: z.string().optional(),
  endDate: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  studentsEngaged: z.number().int().min(0).optional().nullable(),
  counsellorsEngaged: z.number().int().min(0).optional().nullable(),
  leadsGenerated: z.number().int().min(0).optional().nullable(),
  applicationsGenerated: z.number().int().min(0).optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  outcomes: z.string().optional().nullable(),
  followUp: z.string().optional().nullable(),
  actionItems: z.array(actionItemSchema).optional().nullable(),
  topics: z.string().optional().nullable(),
  institutionId: z.string().min(1).optional().nullable(),
  marketId: z.string().min(1).optional().nullable(),
  schoolId: z.string().min(1).optional().nullable(),
  sourceId: z.string().min(1).optional().nullable(),
});

// ─── GET /api/activities/[id] ─────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "activities", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const activity = await db.activity.findFirst({
      where: { id, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, image: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
        school: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        attendees: true,
        _count: { select: { attendees: true } },
      },
    });

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    return NextResponse.json({ data: activity });
  } catch (error) {
    console.error("[GET /api/activities/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/activities/[id] ───────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "activities", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.activity.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = updateActivitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // Determine final type and cost/leads for ROI calculation
    const finalType = data.type ?? existing.type;
    const finalCost = data.cost !== undefined ? data.cost : existing.cost;
    const finalLeads = data.leadsGenerated !== undefined ? data.leadsGenerated : existing.leadsGenerated;

    // Auto-calculate ROI for fairs
    let roi: number | null = existing.roi;
    if (finalType === "FAIR" && finalCost && finalCost > 0 && finalLeads && finalLeads > 0) {
      roi = finalLeads / finalCost;
    } else if (finalType === "FAIR") {
      roi = null;
    }

    const updateData: Record<string, unknown> = { roi };
    if (data.type !== undefined) updateData.type = data.type;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.date !== undefined) updateData.date = new Date(data.date);
    if (data.endDate !== undefined) updateData.endDate = data.endDate ? new Date(data.endDate) : null;
    if (data.location !== undefined) updateData.location = data.location;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.country !== undefined) updateData.country = data.country;
    if (data.studentsEngaged !== undefined) updateData.studentsEngaged = data.studentsEngaged;
    if (data.counsellorsEngaged !== undefined) updateData.counsellorsEngaged = data.counsellorsEngaged;
    if (data.leadsGenerated !== undefined) updateData.leadsGenerated = data.leadsGenerated;
    if (data.applicationsGenerated !== undefined) updateData.applicationsGenerated = data.applicationsGenerated;
    if (data.cost !== undefined) updateData.cost = data.cost;
    if (data.outcomes !== undefined) updateData.outcomes = data.outcomes;
    if (data.followUp !== undefined) updateData.followUp = data.followUp;
    if (data.actionItems !== undefined) updateData.actionItems = data.actionItems;
    if (data.topics !== undefined) updateData.topics = data.topics;
    if (data.institutionId !== undefined) updateData.institution = data.institutionId ? { connect: { id: data.institutionId } } : { disconnect: true };
    if (data.marketId !== undefined) updateData.market = data.marketId ? { connect: { id: data.marketId } } : { disconnect: true };
    if (data.schoolId !== undefined) updateData.school = data.schoolId ? { connect: { id: data.schoolId } } : { disconnect: true };
    if (data.sourceId !== undefined) updateData.source = data.sourceId ? { connect: { id: data.sourceId } } : { disconnect: true };

    const updated = await db.activity.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, image: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
        school: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
        attendees: true,
        _count: { select: { attendees: true } },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error("[PATCH /api/activities/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/activities/[id] — soft delete ────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "activities", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.activity.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 });
    }

    await db.activity.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/activities/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── Validation ───────────────────────────────────────────────────────────────

const updateLeadSchema = z.object({
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(6).optional(),
  nationality: z.string().min(2).optional(),
  countryOfResidence: z.string().min(2).optional(),
  interestedProgram: z.string().min(2).optional(),
  faculty: z.string().optional().nullable(),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]).optional(),
  intakeYear: z.number().int().min(2020).max(2035).optional(),
  intakeMonth: z.number().int().min(1).max(12).optional(),
  notes: z.string().optional().nullable(),
  regionId: z.string().min(1).optional().nullable(),
  assignedICRId: z.string().min(1).optional().nullable(),
  institutionId: z.string().min(1).optional().nullable(),
  sourceId: z.string().min(1).optional().nullable(),
  eventId: z.string().min(1).optional().nullable(),
  lastContactedAt: z.string().datetime().optional().nullable(),
});

// ─── Access control helper ────────────────────────────────────────────────────

async function canAccessLead(
  leadId: string,
  userId: string,
  regionId: string | null,
  role: Role
): Promise<{ allowed: boolean; lead?: Awaited<ReturnType<typeof fetchLead>> }> {
  const lead = await fetchLead(leadId);

  if (!lead) return { allowed: false };

  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
      return { allowed: true, lead };
    case "REGIONAL_MANAGER":
      return { allowed: !regionId || lead.regionId === regionId, lead };
    case "ICR":
      return { allowed: lead.assignedICRId === userId, lead };
    case "INSTITUTION_CLIENT":
      return { allowed: !!lead.institutionId, lead };
    default:
      return { allowed: false };
  }
}

async function fetchLead(id: string) {
  return db.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      region: { select: { id: true, name: true, code: true } },
      assignedICR: { select: { id: true, name: true, email: true, image: true } },
      institution: { select: { id: true, name: true, country: true, type: true, accountStatus: true } },
      source: { select: { id: true, name: true, type: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      notesLog: {
        orderBy: { createdAt: "desc" },
        select: { id: true, content: true, authorId: true, createdAt: true },
      },
      documents: {
        orderBy: { uploadedAt: "desc" },
        select: { id: true, name: true, url: true, type: true, size: true, uploadedAt: true, uploadedBy: true },
      },
    },
  });
}

// ─── GET /api/leads/[id] ──────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    if (!(await effectiveHasPermission(role as Role, "leads", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { allowed, lead } = await canAccessLead(id, userId, regionId, role);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({ data: lead });
  } catch (error) {
    console.error("[GET /api/leads/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/leads/[id] ────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { allowed, lead } = await canAccessLead(id, userId, regionId, role);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Stage moves must go through PATCH /api/leads/[id]/stage, which enforces
    // the pipeline gate. Accepting `stage` here would bypass every requirement
    // in the pipeline spec, so refuse it loudly rather than ignoring it.
    if (body && typeof body === "object" && "stage" in body) {
      return NextResponse.json(
        {
          error:
            "Stage cannot be changed here. Use PATCH /api/leads/[id]/stage, which enforces the pipeline requirements.",
        },
        { status: 400 }
      );
    }

    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const updates = parsed.data;

    const updatedLead = await db.lead.update({
      where: { id },
      data: updates,
      include: {
        region: { select: { id: true, name: true } },
        assignedICR: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId,
        action: "UPDATE",
        entity: "Lead",
        entityId: id,
        changes: updates,
      },
    });

    return NextResponse.json({ data: updatedLead });
  } catch (error) {
    console.error("[PATCH /api/leads/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/leads/[id] — soft delete ─────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    if (!(await effectiveHasPermission(role as Role, "leads", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { allowed, lead } = await canAccessLead(id, userId, regionId, role);

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await db.lead.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await db.auditLog.create({
      data: {
        userId,
        action: "DELETE",
        entity: "Lead",
        entityId: id,
        changes: { deletedAt: new Date().toISOString() },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/leads/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

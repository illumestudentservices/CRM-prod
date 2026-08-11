import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";
import { institutionIdsForUser } from "@/lib/lead-access";
import { redactFields, checkFieldWrites } from "@/lib/granular-permissions";

// ─── Validation ───────────────────────────────────────────────────────────────

const updateLeadSchema = z.object({
  // min(1) to match the create schema — a one-letter given name is real, and
  // the schema is `.strict()`, so leaving `fullName` here would have made the
  // edit form's firstName/lastName a 422 and the name uneditable.
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
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

  // ─── Pipeline capture fields ──────────────────────────────────────────
  // The gate blocks progression on these, so they must be writable. Omitting
  // them meant the API accepted them, returned 200, and silently discarded
  // them — the caller believed the data was saved and the gate kept blocking.
  intendedDestination: z.string().min(1).optional().nullable(),
  preferredCountry: z.string().min(1).optional().nullable(),
  budgetRange: z
    .enum(["UNDER_10K", "FROM_10K_TO_20K", "FROM_20K_TO_35K", "FROM_35K_TO_50K", "OVER_50K", "UNDECIDED"])
    .optional()
    .nullable(),
  currentQualification: z.string().min(1).optional().nullable(),
  counsellingOutcome: z.string().min(1).optional().nullable(),
  academicQualification: z.string().min(1).optional().nullable(),
  englishStatus: z
    .enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "MOI", "NATIVE_SPEAKER", "NOT_TAKEN", "EXEMPT"])
    .optional()
    .nullable(),
  eligibilityConfirmedAt: z.string().datetime().optional().nullable(),
  enrolmentDate: z.string().datetime().optional().nullable(),

  // Nullable so an answer can be withdrawn back to "never asked" — a student
  // who asks to be forgotten should not leave a standing "declined" record
  // behind. The schema is .strict(), so omitting this would make the consent
  // control on the edit form a 422.
  marketingConsent: z.boolean().optional().nullable(),
})
  // Reject unknown keys rather than dropping them. Silently discarding a field
  // while returning 200 is worse than refusing it: the caller has no way to
  // know the write did not happen.
  .strict();

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
    case "INSTITUTION_CLIENT": {
      // Scope to the institutions this client is actually assigned to.
      // Previously `!!lead.institutionId`, which let any client read any
      // other client's students by id.
      if (!lead.institutionId) return { allowed: false, lead };
      const ids = await institutionIdsForUser(userId, role);
      return { allowed: ids.includes(lead.institutionId), lead };
    }
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

    // Field-level read control (Phase 10). Columns the role may not read are
    // deleted from the payload rather than nulled — a null would read as "no
    // passport on file", which is a different and misleading claim.
    return NextResponse.json({ data: await redactFields(role, "leads", lead) });
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

    // Field-level write control (Phase 10). Reject the whole request rather
    // than silently dropping the offending keys — a caller who thinks they
    // updated a passport number and didn't is worse off than one who got an
    // error naming the field.
    const writeCheck = await checkFieldWrites(role as Role, "leads", updates);
    if (!writeCheck.ok) {
      return NextResponse.json(
        {
          error: `Your role cannot change: ${writeCheck.rejected.join(", ")}`,
          fields: writeCheck.rejected,
        },
        { status: 403 }
      );
    }

    // The timestamp is what makes the consent record defensible, so it moves
    // with the flag rather than being set independently. Clearing consent back
    // to "never asked" clears the date too, so a stale date cannot be read as
    // evidence of an answer that no longer exists.
    const consentStamp =
      "marketingConsent" in updates
        ? { marketingConsentAt: updates.marketingConsent === null ? null : new Date() }
        : {};

    const updatedLead = await db.lead.update({
      where: { id },
      data: { ...updates, ...consentStamp },
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

    await trashRecord({ entityType: "Lead", entityId: id, userId: session.user.id });

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

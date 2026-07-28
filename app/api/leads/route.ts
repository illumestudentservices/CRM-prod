import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createLeadSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Phone number is required"),
  nationality: z.string().min(2, "Nationality is required"),
  countryOfResidence: z.string().min(2, "Country of residence is required"),
  interestedProgram: z.string().min(2, "Interested program is required"),
  faculty: z.string().optional(),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]),
  intakeYear: z.number().int().min(2020).max(2035),
  intakeMonth: z.number().int().min(1).max(12),
  notes: z.string().optional(),
  regionId: z.preprocess(v => (!v || v === "none") ? undefined : v, z.string().min(1).optional()),
  assignedICRId: z.preprocess(v => (!v || v === "none") ? undefined : v, z.string().min(1).optional()),
  institutionId: z.preprocess(v => (!v || v === "none") ? undefined : v, z.string().min(1).optional()),
  sourceId: z.preprocess(v => (!v || v === "none") ? undefined : v, z.string().min(1).optional()),
  eventId: z.preprocess(v => (!v || v === "none") ? undefined : v, z.string().min(1).optional()),
});

const listLeadsQuerySchema = z.object({
  stage: z.string().optional(),
  institutionId: z.string().optional(),
  assignedICRId: z.string().optional(),
  regionId: z.string().optional(),
  sourceId: z.string().optional(),
  country: z.string().optional(),        // filters countryOfResidence (exact, case-insensitive)
  nationality: z.string().optional(),    // filters nationality
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(["createdAt", "updatedAt", "fullName", "stage"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Role-based scope helper ──────────────────────────────────────────────────

function buildScopeFilter(
  role: Role,
  userId: string,
  regionId: string | null
): Record<string, unknown> {
  switch (role) {
    case "ICR":
      return { assignedICRId: userId };
    case "REGIONAL_MANAGER":
      return regionId ? { regionId } : {};
    case "INSTITUTION_CLIENT":
      // Institution clients can only read — handled at route level
      return {};
    default:
      // SUPER_ADMIN, HQ_EXECUTIVE, HQ_ANALYTICS: see all
      return {};
  }
}

// ─── GET /api/leads ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    if (!await effectiveHasPermission(role as Role, "leads", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const queryResult = listLeadsQuerySchema.safeParse(
      Object.fromEntries(searchParams.entries())
    );

    if (!queryResult.success) {
      return NextResponse.json(
        { error: "Invalid query parameters", details: queryResult.error.flatten() },
        { status: 400 }
      );
    }

    const { stage, institutionId, assignedICRId, regionId: filterRegionId, sourceId, country, nationality, search, page, limit, sortBy, sortOrder } =
      queryResult.data;

    const scopeFilter = buildScopeFilter(role, userId, regionId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {
      ...scopeFilter,
      deletedAt: null,
      ...(stage && { stage: stage as never }),
      ...(institutionId && { institutionId }),
      ...(assignedICRId && { assignedICRId }),
      ...(filterRegionId && { regionId: filterRegionId }),
      ...(sourceId && { sourceId }),
      ...(country && { countryOfResidence: { equals: country, mode: "insensitive" } }),
      ...(nationality && { nationality: { equals: nationality, mode: "insensitive" } }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: "insensitive" } },
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { interestedProgram: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [leads, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          nationality: true,
          countryOfResidence: true,
          interestedProgram: true,
          studyLevel: true,
          intakeYear: true,
          intakeMonth: true,
          stage: true,
          isDuplicate: true,
          createdAt: true,
          updatedAt: true,
          lastContactedAt: true,
          lastProgressedAt: true,
          region: { select: { id: true, name: true, code: true } },
          assignedICR: { select: { id: true, name: true, email: true, image: true } },
          institution: { select: { id: true, name: true, country: true } },
          source: { select: { id: true, name: true, type: true } },
        },
      }),
      db.lead.count({ where }),
    ]);

    return NextResponse.json({
      data: leads,
      meta: {
        total,
        page,
        limit,
        pageCount: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("[GET /api/leads]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/leads ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;

    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const data = parsed.data;

    // ── Deduplication check ──────────────────────────────────────────────────
    const duplicate = await db.lead.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: data.email },
          { fullName: data.fullName, phone: data.phone },
        ],
      },
      select: { id: true, fullName: true, email: true },
    });

    // Inherit region from session if not provided (for ICR/RM)
    const effectiveRegionId =
      data.regionId ??
      (role === "ICR" || role === "REGIONAL_MANAGER" ? regionId ?? undefined : undefined);

    const lead = await db.lead.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        nationality: data.nationality,
        countryOfResidence: data.countryOfResidence,
        interestedProgram: data.interestedProgram,
        faculty: data.faculty,
        studyLevel: data.studyLevel,
        intakeYear: data.intakeYear,
        intakeMonth: data.intakeMonth,
        notes: data.notes,
        stage: "NEW_LEAD",
        createdById: userId,
        regionId: effectiveRegionId,
        assignedICRId: data.assignedICRId ?? (role === "ICR" ? userId : undefined),
        institutionId: data.institutionId,
        sourceId: data.sourceId,
        eventId: data.eventId,
        isDuplicate: !!duplicate,
        duplicateOfId: duplicate?.id,
      },
      include: {
        region: { select: { id: true, name: true } },
        assignedICR: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
      },
    });

    // Create initial stage activity
    await db.leadActivity.create({
      data: {
        leadId: lead.id,
        userId,
        type: "STAGE_CHANGE",
        description: `Lead created and placed in New Lead stage`,
        metadata: { from: null, to: "NEW_LEAD" },
      },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userId,
        action: "CREATE",
        entity: "Lead",
        entityId: lead.id,
        changes: { stage: "NEW_LEAD", email: data.email },
      },
    });

    return NextResponse.json(
      {
        data: lead,
        ...(duplicate && {
          warning: `Possible duplicate detected: matches lead "${duplicate.fullName}" (${duplicate.email})`,
          duplicateOf: duplicate,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/leads]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

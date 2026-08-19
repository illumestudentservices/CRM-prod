import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { displayName, nameOrder, nameSearchFilter } from "@/lib/person-name";
import { LeadStage } from "@prisma/client";
import { redactFields } from "@/lib/granular-permissions";
import { institutionIdsForUser } from "@/lib/lead-access";
import { regionScope } from "@/lib/region-scope";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";

// ─── Validation schemas ───────────────────────────────────────────────────────

/**
 * An untouched optional input arrives as "" or null. The rules below use
 * min(1), so a blank has to become "not provided" rather than be validated as
 * a too-short string.
 */
const blankToUndefined = (v: unknown) =>
  v === "" || v === null || v === "none" ? undefined : v;

const createLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Phone number is required"),
  nationality: z.string().min(2, "Nationality is required"),
  countryOfResidence: z.string().min(2, "Country of residence is required"),
  // Spec §2 dedup keys. Optional at capture; forms should ask for them where
  // possible (offline booth can't always).
  dateOfBirth: z.preprocess(blankToUndefined, z.string().datetime().optional()),
  passportNumber: z.preprocess(blankToUndefined, z.string().min(3).optional()),
  // Spec Recruitment Network — how the lead entered the CRM.
  channel: z.preprocess(
    blankToUndefined,
    z.enum([
      "AGENT_REFERRAL", "SCHOOL_REFERRAL", "WEBSITE", "WALK_IN",
      "STUDENT_REFERRAL", "STAFF_REFERRAL", "GOOGLE_ADS", "META_ADS",
      "ORGANIC_SOCIAL", "QR_CODE", "OTHER"
    ]).optional()
  ),
  // Spec §16 — first-touch date, defaults to server-now if the form doesn't
  // send it (which is right for online capture; offline uploads pass a
  // back-dated timestamp).
  firstTouchDate: z.preprocess(blankToUndefined, z.string().datetime().optional()),
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

  // Pipeline capture, accepted at creation as well as on update. A lead
  // captured with its destination already known should not have to be saved
  // and then immediately edited just to satisfy the first stage gate.
  intendedDestination: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  preferredCountry: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  currentQualification: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  counsellingOutcome: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  academicQualification: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  budgetRange: z.preprocess(
    blankToUndefined,
    z.enum(["UNDER_10K", "FROM_10K_TO_20K", "FROM_20K_TO_35K", "FROM_35K_TO_50K", "OVER_50K", "UNDECIDED"]).optional()
  ),
  englishStatus: z.preprocess(
    blankToUndefined,
    z.enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "MOI", "NATIVE_SPEAKER", "NOT_TAKEN", "EXEMPT"]).optional()
  ),
  enrolmentDate: z.preprocess(blankToUndefined, z.string().datetime().optional()),

  // Optional, and left undefined rather than defaulted to false when the form
  // does not send it: an unanswered consent question is not a refusal.
  marketingConsent: z.boolean().optional(),
});

const listLeadsQuerySchema = z.object({
  // Must be a real LeadStage. As a free string it was passed straight into
  // `where.stage`, and Prisma answered 500 for anything outside the enum —
  // so a hand-edited URL crashed the endpoint instead of 422-ing.
  stage: z.nativeEnum(LeadStage).optional(),
  institutionId: z.string().optional(),
  assignedICRId: z.string().optional(),
  regionId: z.string().optional(),
  sourceId: z.string().optional(),
  country: z.string().optional(),        // filters countryOfResidence (exact, case-insensitive)
  nationality: z.string().optional(),    // filters nationality
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sortBy: z.enum(["createdAt", "updatedAt", "lastName", "stage"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// ─── Role-based scope helper ──────────────────────────────────────────────────

/**
 * Row scope for the lead list.
 *
 * This MUST agree with canAccessLead() in lib/lead-access.ts, which gates every
 * individual lead. It did not. The INSTITUTION_CLIENT branch returned {} with
 * the comment "handled at route level", but the route only checks whether the
 * caller holds leads:read — never which rows — so a client of the business
 * listed every student of every other client, program and destination
 * institution included. canAccessLead had already been fixed for the same bug
 * on the single-record path; the list was left behind.
 *
 * The `default:` branch was unscoped for the same reason. ACCOUNT_MANAGER,
 * ADMISSIONS_SUPPORT and VP_GLOBAL_SALES all hold leads:read and all land here,
 * so all three listed the entire table — while canAccessLead returns false for
 * them, meaning they could not open a single row of what they were shown. It
 * now fails closed, matching both canAccessLead and the identical decision in
 * app/api/institution-interests/route.ts.
 */
async function buildScopeFilter(
  role: Role,
  userId: string,
  regionId: string | null
): Promise<Record<string, unknown>> {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
      return {};
    case "ICR":
      return { assignedICRId: userId };
    case "REGIONAL_MANAGER":
      // No region means no students, on the same reading as the
      // INSTITUTION_CLIENT case below. This used to fall back to `{}`, which
      // returned every student in every region. See lib/region-scope.ts.
      return regionScope(regionId);
    case "INSTITUTION_CLIENT": {
      const allowed = await institutionIdsForUser(userId, role);
      // No assignment means no students, not all of them. `in: []` matches
      // nothing, which is the intended reading of "this client has no
      // institutions yet".
      return { institutionId: { in: allowed } };
    }
    default:
      // Fail closed: a role holding leads:read but with no defined row scope
      // sees nothing, rather than everything.
      return { id: "__no_access__" };
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

    const scopeFilter = await buildScopeFilter(role as Role, userId, regionId);

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
          ...(nameSearchFilter(search) ? [nameSearchFilter(search)!] : []),
          { email: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
          { interestedProgram: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [leads, total] = await Promise.all([
      db.lead.findMany({
        where,
        orderBy: sortBy === "lastName" ? nameOrder(sortOrder) : { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          firstName: true, lastName: true,
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
      // Field-level read control (Phase 10) — applied to the list as well as
      // the detail view, otherwise a column withheld on one screen leaks from
      // the other.
      data: await redactFields(session.user.role as Role, "leads", leads),
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

    // A NUL byte in any string reaches Postgres intact — Zod's .string() allows
    // it — and comes back as a 500 rather than a validation error. This route
    // reads req.json() directly, so it does not get the check that
    // readJsonBody() applies.
    try {
      assertNoNulBytes(body);
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
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
    // Both parts must match, which is the same test the single `fullName`
    // equality made before the split — "Mei Ling Tan" only ever equalled
    // another "Mei Ling Tan". Matching one part alone would flag every lead
    // sharing a common surname as a duplicate of the first one entered.
    const duplicate = await db.lead.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { email: data.email },
          { firstName: data.firstName, lastName: data.lastName, phone: data.phone },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    // Inherit region from session if not provided (for ICR/RM)
    const effectiveRegionId =
      data.regionId ??
      (role === "ICR" || role === "REGIONAL_MANAGER" ? regionId ?? undefined : undefined);

    // Spec §4 (Student Pipeline) — first-response SLA. Default 24h from capture
    // to first contact; the inactivity cron reads this and escalates if
    // firstContactAt is still null when we cross it.
    const FIRST_RESPONSE_SLA_HOURS = 24;
    const capturedAt = new Date();
    const firstResponseDueAt = new Date(
      capturedAt.getTime() + FIRST_RESPONSE_SLA_HOURS * 60 * 60 * 1000
    );

    const lead = await db.lead.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        nationality: data.nationality,
        countryOfResidence: data.countryOfResidence,
        // Spec §2 — dedup keys captured at creation.
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined,
        passportNumber: data.passportNumber,
        interestedProgram: data.interestedProgram,
        faculty: data.faculty,
        studyLevel: data.studyLevel,
        intakeYear: data.intakeYear,
        intakeMonth: data.intakeMonth,
        notes: data.notes,
        stage: "NEW_LEAD",
        createdById: userId,
        regionId: effectiveRegionId,
        // If the caller didn't pick an ICR, assign the creator by default.
        // Previously this only applied when role === "ICR", which meant
        // SUPER_ADMINs / RMs / HQ users who created a lead without picking
        // an ICR ended up with an unassigned row — invisible on every
        // personal dashboard until an admin fixed it in the DB.
        assignedICRId: data.assignedICRId ?? userId,
        institutionId: data.institutionId,
        sourceId: data.sourceId,
        eventId: data.eventId,
        // Spec §16 — pin the original attribution. Never overwritten by later
        // engagements. sourceId/eventId above remain mutable (current
        // relationship owner); these are the audit trail.
        originalSourceId: data.sourceId,
        originalEventId: data.eventId,
        firstTouchDate: data.firstTouchDate ? new Date(data.firstTouchDate) : capturedAt,
        channel: data.channel,
        isDuplicate: !!duplicate,
        duplicateOfId: duplicate?.id,

        // Spec §4 — first-response SLA clock starts now.
        firstResponseDueAt,

        // Mapped explicitly like everything else above; spreading `data` here
        // would quietly widen what a caller can set on creation.
        intendedDestination: data.intendedDestination,
        preferredCountry: data.preferredCountry,
        currentQualification: data.currentQualification,
        counsellingOutcome: data.counsellingOutcome,
        academicQualification: data.academicQualification,
        budgetRange: data.budgetRange,
        englishStatus: data.englishStatus,
        enrolmentDate: data.enrolmentDate ? new Date(data.enrolmentDate) : undefined,
        marketingConsent: data.marketingConsent,
        // Stamped only when an answer was actually given, so the timestamp
        // always means "this is when they were asked" rather than "this is when
        // the row happened to be created".
        marketingConsentAt: data.marketingConsent === undefined ? undefined : new Date(),
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
      
        ...(await auditOrigin()),
      },
    });

    // Spec §4 (Student Pipeline) System Automation — "Notify the assigned
    // owner". Only fire if the owner is someone other than the person creating
    // the lead (an ICR creating their own lead doesn't need to be told about
    // it). Best-effort: silent failure keeps the create response 201.
    if (lead.assignedICRId && lead.assignedICRId !== userId) {
      try {
        await db.notification.create({
          data: {
            userId: lead.assignedICRId,
            title: "New lead assigned",
            message: `"${displayName(lead)}" was captured and assigned to you`,
            type: "LEAD_ASSIGNED",
            link: `/students/${lead.id}`,
          },
        });
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json(
      {
        data: lead,
        ...(duplicate && {
          warning: `Possible duplicate detected: matches lead "${displayName(duplicate)}" (${duplicate.email})`,
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

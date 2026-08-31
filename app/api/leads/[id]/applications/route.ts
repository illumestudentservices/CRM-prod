import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canAccessLead, institutionIdsForUser } from "@/lib/lead-access";
import { logActivity } from "@/lib/activity-logger";
import {
  ACCEPTANCE_STATUS_LABELS,
  APPLICATION_STATUS_LABELS,
  DEPOSIT_STATUS_LABELS,
  OFFER_TYPE_LABELS,
  STUDENT_DECISION_LABELS,
  SUBMISSION_METHOD_LABELS,
  enumValues,
} from "@/lib/application-options";

/**
 * Applications made on a student's behalf.
 *
 * A student can hold several over their lifetime — rejected by one institution,
 * then offered by another — which is why these are rows rather than columns on
 * the lead. Stage 4, 6 and 7 all read their required fields from the active
 * application, so without this endpoint a student could enter Application
 * Submitted and never leave it.
 */

/**
 * Every enum below is derived from the label maps in lib/application-options.ts
 * rather than hand-listed here. Hand-listing is what made this route the
 * narrowest of three disagreeing lists, silently refusing values the database
 * and the specification both allow.
 */
const submissionMethodEnum = z.enum(enumValues(SUBMISSION_METHOD_LABELS));
const offerTypeEnum = z.enum(enumValues(OFFER_TYPE_LABELS));
const studentDecisionEnum = z.enum(enumValues(STUDENT_DECISION_LABELS));
const acceptanceStatusEnum = z.enum(enumValues(ACCEPTANCE_STATUS_LABELS));
const applicationStatusEnum = z.enum(enumValues(APPLICATION_STATUS_LABELS));
const depositStatusEnum = z.enum(enumValues(DEPOSIT_STATUS_LABELS));

const createSchema = z.object({
  institutionId: z.string().min(1),
  program: z.string().min(1).max(200),
  applicationNumber: z.string().max(100).optional(),
  submissionMethod: submissionMethodEnum.optional(),
  submissionDate: z.string().datetime().optional(),
});

const updateSchema = z.object({
  applicationId: z.string().min(1),
  applicationNumber: z.string().max(100).optional().nullable(),
  submissionMethod: submissionMethodEnum.optional().nullable(),
  submissionDate: z.string().datetime().optional().nullable(),
  status: applicationStatusEnum.optional(),
  // Stage 6
  offerType: offerTypeEnum.optional().nullable(),
  offerReceivedAt: z.string().datetime().optional().nullable(),
  offerExpiryDate: z.string().datetime().optional().nullable(),
  offerConditions: z.string().max(2000).optional().nullable(),
  studentDecision: studentDecisionEnum.optional().nullable(),
  depositDeadline: z.string().datetime().optional().nullable(),
  /** Records that a deposit deadline genuinely doesn't apply, rather than being unfilled. */
  depositDeadlineNotApplicable: z.boolean().optional(),
  // Stage 7
  depositPaid: z.boolean().optional(),
  depositDate: z.string().datetime().optional().nullable(),
  acceptanceStatus: acceptanceStatusEnum.optional().nullable(),
  /**
   * Spec §10 — the categorical deposit lifecycle. Absent from this schema
   * until now, so all six of the specification's deposit statuses were
   * unreachable and deposit state could only be expressed by the boolean.
   */
  depositStatus: depositStatusEnum.optional().nullable(),
  depositAmount: z.number().nonnegative().max(1_000_000).optional().nullable(),
  depositCurrency: z.string().min(3).max(3).optional().nullable(),
  /** Spec §10 — when the acceptance was recorded (migration 037). */
  acceptanceDate: z.string().datetime().optional().nullable(),
  // Spec §8 Stage 5 (migration 037). None of these existed, which is why the
  // Awaiting Decision gate had nothing to ask for.
  lastInstitutionUpdateAt: z.string().datetime().optional().nullable(),
  expectedDecisionDate: z.string().datetime().optional().nullable(),
  outstandingRequirement: z.string().max(2000).optional().nullable(),
  /**
   * Spec §7 — the alternative to an application reference. The gate accepts
   * either this or `applicationNumber`, which is what lets an application
   * submitted by email progress.
   */
  submissionEvidence: z.string().max(2000).optional().nullable(),
});

async function authorise(id: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { role, id: userId, regionId } = session.user;
  if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, regionId: true, assignedICRId: true, institutionId: true },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  if (!canAccessLead(lead, userId, regionId, role as Role, await institutionIdsForUser(userId, role as Role))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { lead, userId };
}

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;

  const applications = await db.leadApplication.findMany({
    where: { leadId: id },
    include: { institution: { select: { id: true, name: true } } },
    orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ applications });
}

// ─── POST: submit an application, or an alternative after a rejection ────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;
  const { userId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  const application = await db.$transaction(async (tx) => {
    // A new application supersedes the previous one rather than deleting it —
    // the history of where a student was rejected is the point.
    await tx.leadApplication.updateMany({
      where: { leadId: id, isActive: true },
      data: { isActive: false },
    });

    const created = await tx.leadApplication.create({
      data: {
        leadId: id,
        institutionId: d.institutionId,
        program: d.program,
        applicationNumber: d.applicationNumber ?? null,
        submissionMethod: d.submissionMethod ?? null,
        submissionDate: d.submissionDate ? new Date(d.submissionDate) : null,
        // The spec asks for both a user-entered submission date and a system
        // timestamp; they answer different questions.
        submissionRecordedAt: new Date(),
        isActive: true,
      },
      include: { institution: { select: { id: true, name: true } } },
    });

    await tx.lead.update({
      where: { id },
      data: { activeApplicationId: created.id, institutionId: d.institutionId },
    });

    await tx.leadActivity.create({
      data: {
        leadId: id,
        userId,
        kind: "SYSTEM",
        type: "APPLICATION_CREATED",
        description: `Application to ${created.institution.name} for ${d.program}${d.applicationNumber ? ` (${d.applicationNumber})` : ""}`,
        metadata: { applicationId: created.id },
      },
    });

    return created;
  });

  void logActivity(userId, "CREATE", "LeadApplication", application.id, { leadId: id });
  return NextResponse.json({ application }, { status: 201 });
}

// ─── PATCH: record submission, offer, or deposit details ─────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(id);
  if ("error" in ctx) return ctx.error;
  const { userId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { applicationId, ...rest } = parsed.data;

  const existing = await db.leadApplication.findFirst({
    where: { id: applicationId, leadId: id },
  });
  if (!existing) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  // Zod hands back ISO strings; Prisma wants Dates.
  const dateKeys = [
    "submissionDate",
    "offerReceivedAt",
    "offerExpiryDate",
    "depositDeadline",
    "depositDate",
    "acceptanceDate",
    "lastInstitutionUpdateAt",
    "expectedDecisionDate",
  ] as const;
  const data: Record<string, unknown> = { ...rest };
  for (const k of dateKeys) {
    if (data[k] !== undefined) data[k] = data[k] ? new Date(data[k] as string) : null;
  }

  // Recording an offer implies the date it arrived, if not given explicitly.
  if (rest.offerType && !rest.offerReceivedAt && !existing.offerReceivedAt) {
    data.offerReceivedAt = new Date();
  }

  // Recording an acceptance implies the date it happened, if not given —
  // mirrors the offer rule above, and spec §10 makes the date a required field.
  if (rest.acceptanceStatus && !rest.acceptanceDate && !existing.acceptanceDate) {
    data.acceptanceDate = new Date();
  }

  // Any institution-side status change IS news from the institution, so it
  // stamps the update date unless one was given explicitly. Without this the
  // gate would ask the user to record the same fact twice.
  if (rest.status && !rest.lastInstitutionUpdateAt) {
    data.lastInstitutionUpdateAt = new Date();
  }

  // `depositStatus` and `depositPaid` describe the same thing at different
  // resolutions, and plenty of readers still use the boolean. Deriving it here
  // means the two can never disagree — recording a deposit as Waived must not
  // leave `depositPaid` reading true from an earlier save.
  if (rest.depositStatus !== undefined) {
    data.depositPaid = rest.depositStatus === "PAID";
  }

  // Currency codes are compared and displayed, so store them one way.
  if (typeof rest.depositCurrency === "string") {
    data.depositCurrency = rest.depositCurrency.toUpperCase();
  }

  const application = await db.leadApplication.update({
    where: { id: applicationId },
    data,
    include: { institution: { select: { id: true, name: true } } },
  });

  void logActivity(userId, "UPDATE", "LeadApplication", applicationId, {
    leadId: id,
    fields: Object.keys(rest),
  });

  return NextResponse.json({ application });
}

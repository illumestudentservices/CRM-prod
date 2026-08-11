import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canAccessLead, institutionIdsForUser } from "@/lib/lead-access";
import { logActivity } from "@/lib/activity-logger";

/**
 * Applications made on a student's behalf.
 *
 * A student can hold several over their lifetime — rejected by one institution,
 * then offered by another — which is why these are rows rather than columns on
 * the lead. Stage 4, 6 and 7 all read their required fields from the active
 * application, so without this endpoint a student could enter Application
 * Submitted and never leave it.
 */

const createSchema = z.object({
  institutionId: z.string().min(1),
  program: z.string().min(1).max(200),
  applicationNumber: z.string().max(100).optional(),
  submissionMethod: z
    .enum(["ONLINE_PORTAL", "EMAIL", "AGENT", "DIRECT", "OTHER"])
    .optional(),
  submissionDate: z.string().datetime().optional(),
});

const updateSchema = z.object({
  applicationId: z.string().min(1),
  applicationNumber: z.string().max(100).optional().nullable(),
  submissionMethod: z.enum(["ONLINE_PORTAL", "EMAIL", "AGENT", "DIRECT", "OTHER"]).optional().nullable(),
  submissionDate: z.string().datetime().optional().nullable(),
  status: z
    .enum(["SUBMITTED", "AWAITING_DECISION", "OFFER_RECEIVED", "ACCEPTED", "REJECTED", "WITHDRAWN"])
    .optional(),
  // Stage 6
  offerType: z.enum(["UNCONDITIONAL", "CONDITIONAL", "SCHOLARSHIP", "REJECTED"]).optional().nullable(),
  offerReceivedAt: z.string().datetime().optional().nullable(),
  offerExpiryDate: z.string().datetime().optional().nullable(),
  offerConditions: z.string().max(2000).optional().nullable(),
  studentDecision: z.enum(["ACCEPTED", "DECLINED", "UNDECIDED"]).optional().nullable(),
  depositDeadline: z.string().datetime().optional().nullable(),
  /** Records that a deposit deadline genuinely doesn't apply, rather than being unfilled. */
  depositDeadlineNotApplicable: z.boolean().optional(),
  // Stage 7
  depositPaid: z.boolean().optional(),
  depositDate: z.string().datetime().optional().nullable(),
  acceptanceStatus: z.enum(["ACCEPTED", "DEFERRED", "WITHDRAWN"]).optional().nullable(),
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
  ] as const;
  const data: Record<string, unknown> = { ...rest };
  for (const k of dateKeys) {
    if (data[k] !== undefined) data[k] = data[k] ? new Date(data[k] as string) : null;
  }

  // Recording an offer implies the date it arrived, if not given explicitly.
  if (rest.offerType && !rest.offerReceivedAt && !existing.offerReceivedAt) {
    data.offerReceivedAt = new Date();
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

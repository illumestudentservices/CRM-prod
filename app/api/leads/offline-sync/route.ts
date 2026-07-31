import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { OFFLINE_CAPTURE_LIMIT } from "@/lib/offline-capture";

/**
 * Uploads a batch of leads captured on a device with no connection.
 *
 * Deliberately NOT one transaction. A booth batch is a hundred independent
 * students, and wrapping them together means one malformed row discards the
 * other ninety-nine — the ICR would have no way to recover the good ones. Each
 * lead is attempted on its own and reported on individually, so the device can
 * delete what landed and keep only what needs fixing.
 */

const capturedLeadSchema = z.object({
  /// Generated on the device at capture time. The unique index on this column
  /// is what makes a retry after a dropped connection safe.
  captureId: z.string().uuid("captureId must be a UUID"),
  /// Device clock, so it cannot be trusted as an ordering key — kept only to
  /// show the ICR when a lead was taken. The row's createdAt remains server time.
  capturedAt: z.string().datetime().optional(),

  // Same rules as the online form. Both email and phone are required: that is
  // the intake rule, and relaxing it here would let the booth create leads the
  // office could not.
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Phone number is required"),
  nationality: z.string().min(2, "Nationality is required"),
  countryOfResidence: z.string().min(2, "Country of residence is required"),
  interestedProgram: z.string().min(2, "Interested program is required"),
  studyLevel: z.enum(["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"]),
  intakeYear: z.number().int().min(2020).max(2035),
  intakeMonth: z.number().int().min(1).max(12),

  faculty: z.string().optional(),
  notes: z.string().optional(),
  regionId: z.string().min(1).optional(),
  institutionId: z.string().min(1).optional(),
  sourceId: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  intendedDestination: z.string().min(1).optional(),
  preferredCountry: z.string().min(1).optional(),
  currentQualification: z.string().min(1).optional(),
  counsellingOutcome: z.string().min(1).optional(),
  academicQualification: z.string().min(1).optional(),
  budgetRange: z
    .enum(["UNDER_10K", "FROM_10K_TO_20K", "FROM_20K_TO_35K", "FROM_35K_TO_50K", "OVER_50K", "UNDECIDED"])
    .optional(),
  englishStatus: z
    .enum(["IELTS", "TOEFL", "PTE", "DUOLINGO", "MOI", "NATIVE_SPEAKER", "NOT_TAKEN", "EXEMPT"])
    .optional(),
});

const syncSchema = z.object({
  // Capped at the same number the device refuses to exceed, so a tampered or
  // buggy client cannot post an unbounded batch.
  leads: z.array(capturedLeadSchema).min(1).max(OFFLINE_CAPTURE_LIMIT),
});

type SyncResult = {
  captureId: string;
  status: "created" | "already_synced" | "failed";
  leadId?: string;
  /// Present on "created" when the lead looks like an existing one. The lead is
  /// still created and flagged, matching what the online form does — a booth is
  /// not the place to adjudicate a merge.
  possibleDuplicateOf?: string;
  error?: string;
};

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

    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const { leads } = parsed.data;

    // A device that somehow queued the same capture twice would otherwise get
    // one "created" and one "already_synced" for the same student, which reads
    // like data loss. Refuse the batch so the client can be fixed.
    const ids = leads.map((l) => l.captureId);
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: "Batch contains repeated captureId values" },
        { status: 422 }
      );
    }

    const results: SyncResult[] = [];

    for (const lead of leads) {
      try {
        // Already uploaded on an earlier attempt that lost its response.
        const existing = await db.lead.findUnique({
          where: { captureId: lead.captureId },
          select: { id: true },
        });
        if (existing) {
          results.push({
            captureId: lead.captureId,
            status: "already_synced",
            leadId: existing.id,
          });
          continue;
        }

        const duplicate = await db.lead.findFirst({
          where: {
            deletedAt: null,
            OR: [
              { email: lead.email },
              { firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone },
            ],
          },
          select: { id: true },
        });

        const effectiveRegionId =
          lead.regionId ??
          (role === "ICR" || role === "REGIONAL_MANAGER" ? regionId ?? undefined : undefined);

        const created = await db.lead.create({
          data: {
            captureId: lead.captureId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            nationality: lead.nationality,
            countryOfResidence: lead.countryOfResidence,
            interestedProgram: lead.interestedProgram,
            faculty: lead.faculty,
            studyLevel: lead.studyLevel,
            intakeYear: lead.intakeYear,
            intakeMonth: lead.intakeMonth,
            notes: lead.notes,
            stage: "NEW_LEAD",
            createdById: userId,
            regionId: effectiveRegionId,
            assignedICRId: role === "ICR" ? userId : undefined,
            institutionId: lead.institutionId,
            sourceId: lead.sourceId,
            eventId: lead.eventId,
            isDuplicate: !!duplicate,
            duplicateOfId: duplicate?.id,
            intendedDestination: lead.intendedDestination,
            preferredCountry: lead.preferredCountry,
            currentQualification: lead.currentQualification,
            counsellingOutcome: lead.counsellingOutcome,
            academicQualification: lead.academicQualification,
            budgetRange: lead.budgetRange,
            englishStatus: lead.englishStatus,
          },
          select: { id: true },
        });

        await db.leadActivity.create({
          data: {
            leadId: created.id,
            userId,
            type: "STAGE_CHANGE",
            description: lead.capturedAt
              ? `Lead captured offline on ${new Date(lead.capturedAt).toLocaleString("en-GB")} and uploaded`
              : `Lead captured offline and uploaded`,
            metadata: { from: null, to: "NEW_LEAD", offlineCapture: true },
          },
        });

        results.push({
          captureId: lead.captureId,
          status: "created",
          leadId: created.id,
          ...(duplicate && { possibleDuplicateOf: duplicate.id }),
        });
      } catch (err) {
        // One bad row must not end the batch. It stays on the device with the
        // reason attached so the ICR can correct and resend just that one.
        console.error(`[POST /api/leads/offline-sync] captureId=${lead.captureId}`, err);
        results.push({
          captureId: lead.captureId,
          status: "failed",
          error: err instanceof Error ? err.message : "Could not save this lead",
        });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const alreadySynced = results.filter((r) => r.status === "already_synced").length;
    const failed = results.filter((r) => r.status === "failed").length;

    // One audit row for the batch rather than per lead — the individual
    // creations are already on each lead's own activity trail.
    await db.auditLog.create({
      data: {
        userId,
        action: "LEADS_OFFLINE_SYNC",
        entity: "Lead",
        entityId: results[0]?.leadId ?? "BATCH",
        changes: { submitted: leads.length, created, alreadySynced, failed },
      },
    });

    return NextResponse.json({
      summary: { submitted: leads.length, created, alreadySynced, failed },
      results,
    });
  } catch (error) {
    console.error("[POST /api/leads/offline-sync]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

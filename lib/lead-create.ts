import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import type { ImportChannelValue, StudyLevelValue } from "@/lib/lead-import";

/**
 * Shared lead-creation core, so the bulk import creates leads through exactly
 * the same path as the single POST /api/leads form: the Prisma client (so the
 * field-encryption extension encrypts passportNumber and maintains
 * passportNumberHash), the same two-part duplicate test, the same initial
 * stage activity and the same audit row.
 *
 * Deliberately does NOT send per-lead notification emails — a thousand-row
 * import must not fan out a thousand messages. The caller summarizes instead.
 */

export interface CreateLeadInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  nationality: string;
  countryOfResidence: string;
  interestedProgram: string;
  studyLevel: StudyLevelValue;
  intakeYear: number;
  intakeMonth: number;
  dateOfBirth?: string | null;
  passportNumber?: string | null;
  faculty?: string | null;
  intendedDestination?: string | null;
  channel?: ImportChannelValue | null;
  notes?: string | null;
  institutionId: string;
  regionId?: string | null;
  assignedICRId?: string | null;
}

const FIRST_RESPONSE_SLA_HOURS = 24;

export async function createLeadRecord(
  input: CreateLeadInput,
  actor: { userId: string }
): Promise<{ leadId: string; duplicate: boolean }> {
  // Same two-part duplicate test as POST /api/leads: email, OR the full name
  // together with the phone. One part alone would flag every shared surname.
  const duplicate = await db.lead.findFirst({
    where: {
      deletedAt: null,
      OR: [
        { email: input.email },
        { firstName: input.firstName, lastName: input.lastName, phone: input.phone },
      ],
    },
    select: { id: true },
  });

  const capturedAt = new Date();
  const firstResponseDueAt = new Date(
    capturedAt.getTime() + FIRST_RESPONSE_SLA_HOURS * 60 * 60 * 1000
  );

  const lead = await db.lead.create({
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      nationality: input.nationality,
      countryOfResidence: input.countryOfResidence,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
      passportNumber: input.passportNumber ?? undefined,
      interestedProgram: input.interestedProgram,
      faculty: input.faculty ?? undefined,
      studyLevel: input.studyLevel,
      intakeYear: input.intakeYear,
      intakeMonth: input.intakeMonth,
      notes: input.notes ?? undefined,
      stage: "NEW_LEAD",
      createdById: actor.userId,
      regionId: input.regionId ?? undefined,
      assignedICRId: input.assignedICRId ?? undefined,
      institutionId: input.institutionId,
      firstTouchDate: capturedAt,
      channel: input.channel ?? undefined,
      intendedDestination: input.intendedDestination ?? undefined,
      isDuplicate: !!duplicate,
      duplicateOfId: duplicate?.id,
      firstResponseDueAt,
    },
    select: { id: true },
  });

  await db.leadActivity.create({
    data: {
      leadId: lead.id,
      userId: actor.userId,
      type: "STAGE_CHANGE",
      description: "Lead created via import and placed in New Lead stage",
      metadata: { from: null, to: "NEW_LEAD", source: "import" },
    },
  });

  await db.auditLog.create({
    data: {
      userId: actor.userId,
      action: "CREATE",
      entity: "Lead",
      entityId: lead.id,
      changes: { stage: "NEW_LEAD", email: input.email, via: "import" },
      ...(await auditOrigin()),
    },
  });

  return { leadId: lead.id, duplicate: !!duplicate };
}

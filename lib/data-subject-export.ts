import { db } from "@/lib/db";

/**
 * Data-subject export — GDPR Article 15 (right of access) and Article 20
 * (portability).
 *
 * Gathers EVERYTHING the system holds about one person, in a portable,
 * machine-readable shape (JSON), so a Data Subject Access Request can be
 * fulfilled in one step instead of assembled by hand against the one-month
 * deadline.
 *
 * ★ COMPLETENESS IS THE WHOLE POINT.
 *
 * A partial export is a compliance failure, so each subject's full footprint is
 * walked deliberately: the main record, every child record that is about them,
 * their attachments (polymorphic, so queried by parent), and the processing
 * history recorded against them in the audit log. When a new table starts
 * holding personal data, it must be added here.
 *
 * ★ WHAT IS DELIBERATELY NOT HERE.
 *
 * Other people's data. A lead's record names the staff member who created it and
 * the ICR it is assigned to; those are included as plain ids/names because they
 * are part of the processing record about the subject, not a second person's
 * profile. We never widen the export into unrelated records.
 *
 * The caller is responsible for authorisation and for logging the export — it is
 * itself a disclosure of a complete personal profile and must be access-gated
 * and audited by the route/script that invokes it.
 */

export interface DataSubjectExport {
  exportedAt: string;
  subjectType: "LEAD" | "EMPLOYEE";
  subjectId: string;
  subject: Record<string, unknown>;
  related: Record<string, unknown[]>;
  attachments: Array<Record<string, unknown>>;
  processingHistory: Array<Record<string, unknown>>;
  note: string;
}

/** Attachment metadata only — never the file bytes, which bloat the export and
 * are retrievable separately. Names/sizes/types are the personal-data part. */
const ATTACHMENT_META = {
  id: true, name: true, mimeType: true, size: true, parentType: true,
  parentId: true, createdAt: true, uploadedById: true,
} as const;

async function attachmentsFor(parentType: string, parentIds: string[]) {
  if (parentIds.length === 0) return [];
  return db.attachment.findMany({
    where: { parentType: parentType as never, parentId: { in: parentIds }, deletedAt: null },
    select: ATTACHMENT_META,
  });
}

/** Processing history: every audit entry recorded against this entity id. */
async function processingHistoryFor(entityId: string) {
  return db.auditLog.findMany({
    where: { entityId },
    select: { action: true, entity: true, changes: true, createdAt: true, ipAddress: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * A prospective student. The primary GDPR data subject — holds nationality,
 * date of birth, passport number, visa history and contact-consent flags.
 */
export async function exportLeadData(leadId: string): Promise<DataSubjectExport | null> {
  const lead = await db.lead.findUnique({
    where: { id: leadId },
    include: {
      activities: true,
      notesLog: true,
      documents: true,
      applications: true,
      checklistItems: true,
      institutionInterests: true,
      fieldActivities: true,
      whatsappConversations: true,
      region: { select: { name: true } },
      institution: { select: { name: true } },
      assignedICR: { select: { name: true, email: true } },
      createdBy: { select: { name: true, email: true } },
    },
  });
  if (!lead) return null;

  // Attachments hang off the lead and off each of its notes (polymorphic).
  const noteIds = lead.notesLog.map((n) => n.id);
  const attachments = [
    ...(await attachmentsFor("LEAD", [leadId])),
    ...(await attachmentsFor("LEAD_NOTE", noteIds)),
  ];

  const {
    activities, notesLog, documents, applications, checklistItems,
    institutionInterests, fieldActivities, whatsappConversations, ...core
  } = lead;

  return {
    exportedAt: new Date().toISOString(),
    subjectType: "LEAD",
    subjectId: leadId,
    subject: core as Record<string, unknown>,
    related: {
      activities, notes: notesLog, documents, applications, checklistItems,
      institutionInterests, fieldActivities, whatsappConversations,
    },
    attachments,
    processingHistory: await processingHistoryFor(leadId),
    note:
      "Complete personal-data export for this individual under GDPR Art. 15/20. " +
      "References to Illume staff (creator, assigned counsellor) are part of the " +
      "processing record, not third-party profiles. Attachment file contents are " +
      "available separately on request.",
  };
}

/**
 * A member of staff. Holds gender, home address, emergency contact, and
 * health-adjacent data via sick leave.
 */
export async function exportEmployeeData(employeeId: string): Promise<DataSubjectExport | null> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: { select: {
        id: true, name: true, firstName: true, lastName: true, email: true,
        role: true, isActive: true, createdAt: true, image: true,
        region: { select: { name: true } },
      } },
      leaveRequests: true,
      leaveBalances: true,
      attendances: true,
      worklogs: true,
      travelRequests: true,
      performanceReviews: true,
      trainingRecords: true,
      assetAssignments: { include: { asset: { select: { name: true, type: true, serialNumber: true } } } },
      documents: true,
      department: { select: { name: true } },
    },
  });
  if (!employee) return null;

  // Staff-record files live in the Attachment table under EMPLOYEE_DOCUMENT
  // (parentId is the Employee.id) — there is no "EMPLOYEE" parent type.
  const attachments = await attachmentsFor("EMPLOYEE_DOCUMENT", [employeeId]);

  const {
    leaveRequests, leaveBalances, attendances, worklogs, travelRequests,
    performanceReviews, trainingRecords, assetAssignments, documents, ...core
  } = employee;

  return {
    exportedAt: new Date().toISOString(),
    subjectType: "EMPLOYEE",
    subjectId: employeeId,
    subject: core as Record<string, unknown>,
    related: {
      leaveRequests, leaveBalances, attendances, worklogs, travelRequests,
      performanceReviews, trainingRecords, assetAssignments, documents,
    },
    attachments,
    processingHistory: await processingHistoryFor(employee.userId),
    note:
      "Complete personal-data export for this staff member under GDPR Art. 15/20. " +
      "Leave records may include health-related (sick-leave) data (Art. 9). " +
      "Attachment file contents are available separately on request.",
  };
}

/** Dispatch by subject type. */
export async function exportDataSubject(
  type: "LEAD" | "EMPLOYEE",
  id: string,
): Promise<DataSubjectExport | null> {
  return type === "LEAD" ? exportLeadData(id) : exportEmployeeData(id);
}

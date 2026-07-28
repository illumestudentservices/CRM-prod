import type { LeadChecklistCategory, StudyLevel } from "@prisma/client";

/**
 * Checklist templates.
 *
 * The pipeline generates a document checklist when a student reaches Qualified,
 * and visa / pre-departure / accommodation lists once a deposit is paid.
 *
 * Requirements genuinely vary by destination and study level, so these are
 * resolved through a function rather than a flat constant. The defaults are
 * hardcoded for now, but every caller goes through `resolveChecklist()`, so
 * moving them into database-backed templates later is a change in one place
 * rather than a hunt through the codebase.
 */

export interface ChecklistTemplateItem {
  label: string;
  isRequired: boolean;
}

const BASE_DOCUMENTS: ChecklistTemplateItem[] = [
  { label: "Passport (photo page)", isRequired: true },
  { label: "Academic transcripts", isRequired: true },
  { label: "Degree / graduation certificate", isRequired: true },
  { label: "English language test result", isRequired: true },
  { label: "Personal statement", isRequired: true },
  { label: "Reference letter", isRequired: true },
  { label: "CV / résumé", isRequired: false },
  { label: "Passport-size photograph", isRequired: false },
];

/** Undergraduate applicants are assessed on school results, not a degree. */
const UNDERGRADUATE_OVERRIDES: Record<string, Partial<ChecklistTemplateItem>> = {
  "Degree / graduation certificate": { isRequired: false },
  "CV / résumé": { isRequired: false },
};

const DESTINATION_DOCUMENTS: Record<string, ChecklistTemplateItem[]> = {
  "united kingdom": [{ label: "ATAS certificate (if applicable)", isRequired: false }],
  canada: [{ label: "Proof of funds (GIC or bank statement)", isRequired: true }],
  australia: [{ label: "Genuine Student (GS) statement", isRequired: true }],
  ireland: [{ label: "Proof of funds", isRequired: true }],
};

const VISA_ITEMS: Record<string, ChecklistTemplateItem[]> = {
  "united kingdom": [
    { label: "CAS issued by institution", isRequired: true },
    { label: "Tuberculosis test certificate", isRequired: true },
    { label: "Immigration Health Surcharge paid", isRequired: true },
    { label: "Student visa application submitted", isRequired: true },
    { label: "Biometrics appointment attended", isRequired: true },
  ],
  canada: [
    { label: "Letter of Acceptance received", isRequired: true },
    { label: "Provincial Attestation Letter (PAL)", isRequired: true },
    { label: "Study permit application submitted", isRequired: true },
    { label: "Medical examination completed", isRequired: true },
    { label: "Biometrics submitted", isRequired: true },
  ],
  australia: [
    { label: "Confirmation of Enrolment (CoE)", isRequired: true },
    { label: "Overseas Student Health Cover arranged", isRequired: true },
    { label: "Subclass 500 visa lodged", isRequired: true },
    { label: "Health examination completed", isRequired: true },
  ],
};

const VISA_FALLBACK: ChecklistTemplateItem[] = [
  { label: "Offer / acceptance letter received", isRequired: true },
  { label: "Visa application submitted", isRequired: true },
  { label: "Proof of funds prepared", isRequired: true },
  { label: "Medical examination completed", isRequired: false },
];

const PRE_DEPARTURE_ITEMS: ChecklistTemplateItem[] = [
  { label: "Flights booked", isRequired: true },
  { label: "Airport pickup arranged", isRequired: false },
  { label: "Travel insurance arranged", isRequired: true },
  { label: "Pre-departure briefing attended", isRequired: true },
  { label: "Tuition balance settled", isRequired: true },
  { label: "Bank account / forex arranged", isRequired: false },
];

const ACCOMMODATION_ITEMS: ChecklistTemplateItem[] = [
  { label: "Accommodation type decided", isRequired: false },
  { label: "Application submitted", isRequired: false },
  { label: "Deposit paid", isRequired: false },
  { label: "Tenancy agreement signed", isRequired: false },
];

function normalise(country: string | null | undefined): string {
  return (country ?? "").trim().toLowerCase();
}

/**
 * Items for one category, tailored to the student where we know enough to do so.
 * Returns them already ordered.
 */
export function resolveChecklist(
  category: LeadChecklistCategory,
  ctx: { destination?: string | null; studyLevel?: StudyLevel | null } = {}
): Array<ChecklistTemplateItem & { order: number }> {
  const dest = normalise(ctx.destination);
  let items: ChecklistTemplateItem[];

  switch (category) {
    case "DOCUMENT": {
      items = BASE_DOCUMENTS.map((item) => {
        const override =
          ctx.studyLevel === "UNDERGRADUATE" || ctx.studyLevel === "FOUNDATION"
            ? UNDERGRADUATE_OVERRIDES[item.label]
            : undefined;
        return override ? { ...item, ...override } : item;
      });
      const extra = DESTINATION_DOCUMENTS[dest];
      if (extra) items = [...items, ...extra];
      break;
    }
    case "VISA":
      items = VISA_ITEMS[dest] ?? VISA_FALLBACK;
      break;
    case "PRE_DEPARTURE":
      items = PRE_DEPARTURE_ITEMS;
      break;
    case "ACCOMMODATION":
      // Optional throughout — the spec marks accommodation tasks as optional.
      items = ACCOMMODATION_ITEMS;
      break;
    default:
      items = [];
  }

  return items.map((item, i) => ({ ...item, order: i }));
}

/** Categories generated on entering a given stage. */
export const CHECKLIST_TRIGGERS: Partial<Record<string, LeadChecklistCategory[]>> = {
  QUALIFIED: ["DOCUMENT"],
  DEPOSIT_PAID: ["VISA", "PRE_DEPARTURE", "ACCOMMODATION"],
};

export const CHECKLIST_LABELS: Record<LeadChecklistCategory, string> = {
  DOCUMENT: "Document checklist",
  VISA: "Visa checklist",
  PRE_DEPARTURE: "Pre-departure checklist",
  ACCOMMODATION: "Accommodation",
};

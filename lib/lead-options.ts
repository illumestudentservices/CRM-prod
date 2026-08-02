/**
 * The dropdown options shared by the online lead form and the offline capture
 * screen.
 *
 * Shared rather than duplicated because both forms post to endpoints validating
 * against the same Prisma enums. Two copies would drift the moment an enum
 * gains a value, and the failure is quiet: a mismatched value is rejected by zod
 * and reads to the user as the field simply not saving.
 *
 * Values must match the BudgetRange, EnglishStatus and StudyLevel enums exactly.
 */

export const BUDGET_RANGES = [
  { value: "UNDER_10K", label: "Under $10,000" },
  { value: "FROM_10K_TO_20K", label: "$10,000 - $20,000" },
  { value: "FROM_20K_TO_35K", label: "$20,000 - $35,000" },
  { value: "FROM_35K_TO_50K", label: "$35,000 - $50,000" },
  { value: "OVER_50K", label: "Over $50,000" },
  { value: "UNDECIDED", label: "Undecided" },
] as const;

export const ENGLISH_STATUSES = [
  { value: "IELTS", label: "IELTS" },
  { value: "TOEFL", label: "TOEFL" },
  { value: "PTE", label: "PTE" },
  { value: "DUOLINGO", label: "Duolingo" },
  { value: "MOI", label: "Medium of Instruction letter" },
  { value: "NATIVE_SPEAKER", label: "Native speaker" },
  { value: "NOT_TAKEN", label: "Not taken yet" },
  { value: "EXEMPT", label: "Exempt" },
] as const;

export const STUDY_LEVELS = [
  { value: "UNDERGRADUATE", label: "Undergraduate" },
  { value: "POSTGRADUATE", label: "Postgraduate" },
  { value: "PATHWAY", label: "Pathway" },
  { value: "FOUNDATION", label: "Foundation" },
] as const;

export const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

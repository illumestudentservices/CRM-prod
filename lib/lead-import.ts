import type { Role } from "@/lib/permissions";

/**
 * Bulk lead import — the single source of truth for which columns the CSV has,
 * which are mandatory, and how each raw string is validated.
 *
 * Used by three places so they can never drift apart:
 *   - GET  /api/leads/import/template   (builds the downloadable CSV header + example)
 *   - POST /api/leads/import            (server-side validation of every row)
 *   - the import page's on-screen field guide (imports IMPORT_FIELDS directly)
 *
 * Validation is a pure function (validateImportRow) with no database access, so
 * it can be unit-tested and also run in the browser for the live preview.
 */

export const STUDY_LEVELS = ["UNDERGRADUATE", "POSTGRADUATE", "PATHWAY", "FOUNDATION"] as const;
export type StudyLevelValue = (typeof STUDY_LEVELS)[number];

export const IMPORT_CHANNELS = [
  "AGENT_REFERRAL", "SCHOOL_REFERRAL", "WEBSITE", "WALK_IN", "STUDENT_REFERRAL",
  "STAFF_REFERRAL", "GOOGLE_ADS", "META_ADS", "ORGANIC_SOCIAL", "QR_CODE", "OTHER",
] as const;
export type ImportChannelValue = (typeof IMPORT_CHANNELS)[number];

/** The maximum rows accepted in one import, to bound memory and run time. */
export const IMPORT_MAX_ROWS = 1000;

/** Roles allowed to import for ANY university. Everyone else is limited to the
 *  universities they are assigned to via InstitutionUser. */
export const IMPORT_ADMIN_ROLES: readonly Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE"] as const;
export function isImportAdmin(role: Role): boolean {
  return IMPORT_ADMIN_ROLES.includes(role);
}

export interface ImportField {
  /** CSV column header, exactly. */
  key: string;
  label: string;
  required: boolean;
  /** Shown in the on-screen guide and the template's example notes. */
  notes: string;
  /** A sample value for the example row in the template. */
  example: string;
}

/**
 * The columns of the import file, in order. Keep `key` in sync with the parser
 * below — the keys are matched case-insensitively against the CSV header.
 */
export const IMPORT_FIELDS: ImportField[] = [
  { key: "firstName", label: "First name", required: true, notes: "Given name.", example: "Maria" },
  { key: "lastName", label: "Last name", required: true, notes: "Family name.", example: "Garcia" },
  { key: "email", label: "Email", required: true, notes: "A valid email address. Used to detect duplicates.", example: "maria.garcia@example.com" },
  { key: "phone", label: "Phone", required: true, notes: "At least 6 characters. Include country code.", example: "+15145551234" },
  { key: "nationality", label: "Nationality", required: true, notes: "Citizenship.", example: "Mexican" },
  { key: "countryOfResidence", label: "Country of residence", required: true, notes: "Where they currently live.", example: "Mexico" },
  { key: "interestedProgram", label: "Interested program", required: true, notes: "Program or course of interest.", example: "Computer Science" },
  { key: "studyLevel", label: "Study level", required: true, notes: `One of: ${STUDY_LEVELS.join(", ")}.`, example: "POSTGRADUATE" },
  { key: "intakeYear", label: "Intake year", required: true, notes: "Year, 2020–2035.", example: "2026" },
  { key: "intakeMonth", label: "Intake month", required: true, notes: "Month number, 1–12.", example: "9" },
  { key: "university", label: "University", required: false, notes: "The university this lead is for. Admins: required, must match a university name exactly. Recruiters: leave blank to use your own university; required only if you represent more than one.", example: "University of Windsor" },
  { key: "dateOfBirth", label: "Date of birth", required: false, notes: "Format YYYY-MM-DD.", example: "2001-05-14" },
  { key: "passportNumber", label: "Passport number", required: false, notes: "Stored encrypted. At least 3 characters.", example: "" },
  { key: "faculty", label: "Faculty", required: false, notes: "Faculty or department.", example: "Engineering" },
  { key: "intendedDestination", label: "Intended destination", required: false, notes: "Destination country.", example: "Canada" },
  { key: "channel", label: "Channel", required: false, notes: `How the lead came in. One of: ${IMPORT_CHANNELS.join(", ")}.`, example: "WEBSITE" },
  { key: "notes", label: "Notes", required: false, notes: "Free text.", example: "Met at Mexico City fair" },
];

export const IMPORT_HEADERS: string[] = IMPORT_FIELDS.map((f) => f.key);

// ─── Pure validation ──────────────────────────────────────────────────────────

export interface NormalizedLeadRow {
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
  /** Raw university name as typed; resolved to an id separately (needs DB). */
  university: string | null;
  dateOfBirth: string | null; // ISO
  passportNumber: string | null;
  faculty: string | null;
  intendedDestination: string | null;
  channel: ImportChannelValue | null;
  notes: string | null;
}

export type RowValidation =
  | { ok: true; data: NormalizedLeadRow }
  | { ok: false; errors: string[] };

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

/** Collapses a header to letters+digits only, so "First Name", "first_name"
 *  and "firstName" all match the same field. */
function keyNorm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Looks a key up in a raw row, tolerant of case, spaces and separators. */
function pick(raw: Record<string, unknown>, key: string): string {
  const want = keyNorm(key);
  for (const k of Object.keys(raw)) {
    if (keyNorm(k) === want) return clean(raw[k]);
  }
  return "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and normalizes one raw CSV row. Pure — no database. University is
 * carried through as a trimmed string (or null); turning it into an institution
 * id is done by the caller, which needs the DB and the actor's allowed set.
 */
export function validateImportRow(raw: Record<string, unknown>): RowValidation {
  const errors: string[] = [];

  const firstName = pick(raw, "firstName");
  const lastName = pick(raw, "lastName");
  const email = pick(raw, "email");
  const phone = pick(raw, "phone");
  const nationality = pick(raw, "nationality");
  const countryOfResidence = pick(raw, "countryOfResidence");
  const interestedProgram = pick(raw, "interestedProgram");
  const studyLevelRaw = pick(raw, "studyLevel").toUpperCase();
  const intakeYearRaw = pick(raw, "intakeYear");
  const intakeMonthRaw = pick(raw, "intakeMonth");
  const university = pick(raw, "university");
  const dobRaw = pick(raw, "dateOfBirth");
  const passportNumber = pick(raw, "passportNumber");
  const faculty = pick(raw, "faculty");
  const intendedDestination = pick(raw, "intendedDestination");
  const channelRaw = pick(raw, "channel").toUpperCase().replace(/\s+/g, "_");
  const notes = pick(raw, "notes");

  if (!firstName) errors.push("First name is required");
  if (!lastName) errors.push("Last name is required");
  if (!email) errors.push("Email is required");
  else if (!EMAIL_RE.test(email)) errors.push("Email is not a valid address");
  if (!phone) errors.push("Phone is required");
  else if (phone.length < 6) errors.push("Phone must be at least 6 characters");
  if (nationality.length < 2) errors.push("Nationality is required");
  if (countryOfResidence.length < 2) errors.push("Country of residence is required");
  if (interestedProgram.length < 2) errors.push("Interested program is required");

  if (!STUDY_LEVELS.includes(studyLevelRaw as StudyLevelValue)) {
    errors.push(`Study level must be one of: ${STUDY_LEVELS.join(", ")}`);
  }

  const intakeYear = Number(intakeYearRaw);
  if (!Number.isInteger(intakeYear) || intakeYear < 2020 || intakeYear > 2035) {
    errors.push("Intake year must be a whole number between 2020 and 2035");
  }
  const intakeMonth = Number(intakeMonthRaw);
  if (!Number.isInteger(intakeMonth) || intakeMonth < 1 || intakeMonth > 12) {
    errors.push("Intake month must be a whole number between 1 and 12");
  }

  let dob: string | null = null;
  if (dobRaw) {
    // Accept only an unambiguous YYYY-MM-DD; anything else is rejected rather
    // than guessed, because a wrong date of birth corrupts duplicate matching.
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobRaw);
    const d = m ? new Date(`${dobRaw}T00:00:00.000Z`) : null;
    if (!d || Number.isNaN(d.getTime())) errors.push("Date of birth must be in format YYYY-MM-DD");
    else dob = d.toISOString();
  }

  if (passportNumber && passportNumber.length < 3) {
    errors.push("Passport number must be at least 3 characters");
  }

  let channel: ImportChannelValue | null = null;
  if (channelRaw) {
    if (!IMPORT_CHANNELS.includes(channelRaw as ImportChannelValue)) {
      errors.push(`Channel must be one of: ${IMPORT_CHANNELS.join(", ")}`);
    } else {
      channel = channelRaw as ImportChannelValue;
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      firstName, lastName, email, phone, nationality, countryOfResidence,
      interestedProgram,
      studyLevel: studyLevelRaw as StudyLevelValue,
      intakeYear, intakeMonth,
      university: university || null,
      dateOfBirth: dob,
      passportNumber: passportNumber || null,
      faculty: faculty || null,
      intendedDestination: intendedDestination || null,
      channel,
      notes: notes || null,
    },
  };
}

// ─── Institution scope ──────────────────────────────────────────────────────
//
// `importableInstitutions` (the DB lookup of which universities a user may
// import for) lives in lib/lead-import-scope.ts so this module stays free of
// server-only imports and can be used in the browser for the live preview.

export interface ImportableInstitution {
  id: string;
  name: string;
}

/** Normalizes a university name for tolerant matching (case, spacing, punctuation). */
export function normalizeInstitutionName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ") // drop "(Vancouver)" etc.
    .replace(/\s-\s[A-Za-z]{2,}\b/g, " ") // drop " - UNBC" style tails
    .replace(/[^A-Za-z0-9]+/g, " ")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Resolves the university for one row against the actor's allowed set.
 *
 * - Admin, blank university        -> error (admins must say which university)
 * - Admin, named university        -> must match an institution (any)
 * - Non-admin, blank, one allowed  -> that one
 * - Non-admin, blank, many allowed -> error (ambiguous, must name it)
 * - Non-admin, named               -> must be one of their allowed universities
 */
export function resolveInstitutionForRow(
  rowUniversity: string | null,
  allowed: ImportableInstitution[],
  isAdmin: boolean
): { ok: true; institutionId: string; institutionName: string } | { ok: false; error: string } {
  if (!rowUniversity) {
    if (isAdmin) return { ok: false, error: "University is required (admins must name the university for each row)" };
    if (allowed.length === 1) return { ok: true, institutionId: allowed[0].id, institutionName: allowed[0].name };
    if (allowed.length === 0) return { ok: false, error: "You are not assigned to any university, so you cannot import leads" };
    return { ok: false, error: "You represent more than one university — fill in the University column" };
  }
  const target = normalizeInstitutionName(rowUniversity);
  const match = allowed.find((i) => normalizeInstitutionName(i.name) === target);
  if (!match) {
    if (isAdmin) return { ok: false, error: `Unknown university "${rowUniversity}"` };
    return { ok: false, error: `"${rowUniversity}" is not one of your universities` };
  }
  return { ok: true, institutionId: match.id, institutionName: match.name };
}

// ─── Template ─────────────────────────────────────────────────────────────────

/** Builds the downloadable CSV: a header row and one example row. */
export function buildTemplateCsv(): string {
  const header = IMPORT_HEADERS.join(",");
  const example = IMPORT_FIELDS.map((f) => csvCell(f.example)).join(",");
  return `${header}\r\n${example}\r\n`;
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Turn an API error body into a reason a person can act on.
 *
 * Our routes answer a bad request with
 *
 *   { error: "Validation failed", details: <zod error.flatten()> }
 *
 * where `details` is `{ formErrors: string[], fieldErrors: Record<string, string[]> }`.
 *
 * The forms used to read only `fieldErrors`, so a FORM-level problem collapsed
 * to a bare "Validation failed" that named nothing. The commonest form-level
 * error is `.strict()`'s "Unrecognized key: …" — exactly the case where the user
 * most needs to be told which field, because nothing on screen looks wrong. This
 * reads both, field errors first by their field name, so the message always
 * points somewhere.
 */

type ZodFlatten = {
  formErrors?: unknown;
  fieldErrors?: Record<string, unknown>;
};

export function apiErrorMessage(data: unknown, fallback = "Something went wrong"): string {
  if (!data || typeof data !== "object") return fallback;
  const d = data as { error?: unknown; details?: ZodFlatten };

  const parts: string[] = [];

  // Field-level first: "regionId: Required" is more use than a generic form note.
  const fields = d.details?.fieldErrors;
  if (fields && typeof fields === "object") {
    for (const [field, msgs] of Object.entries(fields)) {
      const first = Array.isArray(msgs) ? msgs.find((m) => typeof m === "string" && m) : undefined;
      if (typeof first === "string" && first) parts.push(`${field}: ${first}`);
    }
  }

  // Form-level: unknown keys, cross-field refinements, etc.
  const form = d.details?.formErrors;
  if (Array.isArray(form)) {
    for (const m of form) if (typeof m === "string" && m) parts.push(m);
  }

  if (parts.length) return parts.join(", ");
  if (typeof d.error === "string" && d.error) return d.error;
  return fallback;
}

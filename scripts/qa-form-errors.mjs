/**
 * apiErrorMessage turns an API error body into a reason a person can act on —
 * surfacing BOTH zod field errors and FORM errors (the "Unrecognized key" case
 * that used to collapse to a bare "Error" on the student edit form).
 *
 *   node --import tsx scripts/qa-form-errors.mjs
 */
const { apiErrorMessage } = await import("../lib/form-errors.ts");

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};
const has = (name, got, needle) => {
  if (typeof got === "string" && got.includes(needle)) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      got: ${JSON.stringify(got)}\n      expected to contain: ${needle}`); }
};

for (let round = 1; round <= 3; round++) {
  console.log(`\n── round ${round} ──`);

  // Form-level error (the real-world bug: strict() unknown key) — must be shown.
  has("form-level 'Unrecognized key' is surfaced",
    apiErrorMessage({ error: "Validation failed", details: { formErrors: ["Unrecognized key: \"foo\""], fieldErrors: {} } }),
    "Unrecognized key");

  // Field-level error → "field: message".
  eq("field error becomes 'field: message'",
    apiErrorMessage({ error: "Validation failed", details: { formErrors: [], fieldErrors: { regionId: ["Required"] } } }),
    "regionId: Required");

  // Both present → field first, then form, joined.
  has("both kinds are joined (field shown)",
    apiErrorMessage({ error: "Validation failed", details: { formErrors: ["Unrecognized key: \"x\""], fieldErrors: { email: ["Invalid email"] } } }),
    "email: Invalid email");
  has("both kinds are joined (form shown)",
    apiErrorMessage({ error: "Validation failed", details: { formErrors: ["Unrecognized key: \"x\""], fieldErrors: { email: ["Invalid email"] } } }),
    "Unrecognized key");

  // No details → fall back to the plain error string.
  eq("plain error string is used when there are no details",
    apiErrorMessage({ error: "Lead not found" }), "Lead not found");

  // Nothing usable → the fallback.
  eq("empty object → fallback", apiErrorMessage({}, "Could not save"), "Could not save");
  eq("null data → fallback", apiErrorMessage(null, "Could not save"), "Could not save");
  eq("default fallback when none given", apiErrorMessage(undefined), "Something went wrong");

  // Malformed details must not throw.
  eq("malformed fieldErrors → fallback, no throw",
    apiErrorMessage({ details: { fieldErrors: "oops" } }, "fb"), "fb");
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

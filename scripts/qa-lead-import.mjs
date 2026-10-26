/**
 * Tests for bulk lead import (Phase: CSV import).
 *
 *   Pure logic (no DB):   node --import tsx scripts/qa-lead-import.mjs
 *   Full (needs TEST DB): node --import tsx --env-file=.env.local scripts/qa-lead-import.mjs --db
 *
 * The --db pass sets up a scenario in the TEST database and exercises
 * importableInstitutions + createLeadRecord (incl. passport encryption) + scope.
 * NEVER run the --db pass against production.
 */
import assert from "node:assert";
// tsx transpiles these libs to CJS, so the whole module lands on `.default`.
// (The real Next build uses named imports directly; tsc already verifies them.)
import LI from "@/lib/lead-import";
const {
  validateImportRow,
  resolveInstitutionForRow,
  normalizeInstitutionName,
  buildTemplateCsv,
  IMPORT_HEADERS,
} = LI;

let pass = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

const GOOD = {
  firstName: "Maria", lastName: "Garcia", email: "maria@example.com",
  phone: "+15145551234", nationality: "Mexican", countryOfResidence: "Mexico",
  interestedProgram: "Computer Science", studyLevel: "postgraduate",
  intakeYear: "2026", intakeMonth: "9", university: "University of Windsor",
  dateOfBirth: "2001-05-14", channel: "website",
};

console.log("── Pure validation ──────────────────────────────");

check("valid row is accepted and normalized", () => {
  const r = validateImportRow(GOOD);
  assert(r.ok, "should be ok");
  assert.equal(r.data.studyLevel, "POSTGRADUATE");
  assert.equal(r.data.intakeYear, 2026);
  assert.equal(r.data.intakeMonth, 9);
  assert.equal(r.data.channel, "WEBSITE");
  assert.equal(r.data.university, "University of Windsor");
  assert(r.data.dateOfBirth.startsWith("2001-05-14"));
});

check("missing email is rejected", () => {
  const r = validateImportRow({ ...GOOD, email: "" });
  assert(!r.ok);
  assert(r.errors.some((e) => /email is required/i.test(e)));
});

check("malformed email is rejected", () => {
  const r = validateImportRow({ ...GOOD, email: "not-an-email" });
  assert(!r.ok && r.errors.some((e) => /valid address/i.test(e)));
});

check("short phone is rejected", () => {
  const r = validateImportRow({ ...GOOD, phone: "123" });
  assert(!r.ok && r.errors.some((e) => /phone/i.test(e)));
});

check("bad study level is rejected", () => {
  const r = validateImportRow({ ...GOOD, studyLevel: "masters" });
  assert(!r.ok && r.errors.some((e) => /study level/i.test(e)));
});

check("intake year out of range is rejected", () => {
  assert(!validateImportRow({ ...GOOD, intakeYear: "1999" }).ok);
  assert(!validateImportRow({ ...GOOD, intakeYear: "2099" }).ok);
  assert(!validateImportRow({ ...GOOD, intakeMonth: "13" }).ok);
});

check("bad date format is rejected, blank date is allowed", () => {
  assert(!validateImportRow({ ...GOOD, dateOfBirth: "14/05/2001" }).ok);
  const r = validateImportRow({ ...GOOD, dateOfBirth: "" });
  assert(r.ok && r.data.dateOfBirth === null);
});

check("unknown channel is rejected", () => {
  assert(!validateImportRow({ ...GOOD, channel: "carrier-pigeon" }).ok);
});

check("headers (case/space) matched tolerantly", () => {
  const r = validateImportRow({ " First Name ": "Ann", lastName: "Lee", email: "a@b.co",
    phone: "+1999999", nationality: "Canadian", countryOfResidence: "Canada",
    interestedProgram: "Law", studyLevel: "UNDERGRADUATE", intakeYear: "2027", intakeMonth: "1" });
  assert(r.ok, "tolerant header match for 'First Name'");
  assert.equal(r.data.firstName, "Ann");
});

console.log("── Scope resolution ─────────────────────────────");

const ALLOWED = [
  { id: "inst-windsor", name: "University of Windsor" },
  { id: "inst-fdu", name: "Fairleigh Dickinson University (Vancouver)" },
];

check("admin blank university is rejected", () => {
  const r = resolveInstitutionForRow(null, ALLOWED, true);
  assert(!r.ok && /required/i.test(r.error));
});

check("admin named match works", () => {
  const r = resolveInstitutionForRow("University of Windsor", ALLOWED, true);
  assert(r.ok && r.institutionId === "inst-windsor");
});

check("admin unknown university rejected", () => {
  const r = resolveInstitutionForRow("Hogwarts", ALLOWED, true);
  assert(!r.ok && /unknown/i.test(r.error));
});

check("non-admin blank + single allowed uses it", () => {
  const r = resolveInstitutionForRow(null, [ALLOWED[0]], false);
  assert(r.ok && r.institutionId === "inst-windsor");
});

check("non-admin blank + multiple allowed is ambiguous", () => {
  const r = resolveInstitutionForRow(null, ALLOWED, false);
  assert(!r.ok && /more than one/i.test(r.error));
});

check("non-admin cannot pick a university outside their set", () => {
  const r = resolveInstitutionForRow("University of Toronto", [ALLOWED[0]], false);
  assert(!r.ok && /not one of your/i.test(r.error));
});

check("non-admin named match is case/spacing tolerant", () => {
  const r = resolveInstitutionForRow("  university  of windsor ", [ALLOWED[0]], false);
  assert(r.ok && r.institutionId === "inst-windsor");
});

check("name normalization drops parenthetical/suffix", () => {
  const r = resolveInstitutionForRow("Fairleigh Dickinson University", ALLOWED, true);
  assert(r.ok && r.institutionId === "inst-fdu");
  assert.equal(normalizeInstitutionName("St.  Francis Xavier University"),
    normalizeInstitutionName("St. Francis Xavier University"));
});

console.log("── Template ─────────────────────────────────────");
check("template has the right header row", () => {
  const csv = buildTemplateCsv();
  const firstLine = csv.split(/\r?\n/)[0];
  assert.equal(firstLine, IMPORT_HEADERS.join(","));
  assert(csv.split(/\r?\n/).filter(Boolean).length === 2, "header + 1 example");
});

// ─── Optional DB pass ─────────────────────────────────────────────────────────
if (process.argv.includes("--db")) {
  await runDbTests();
}

console.log(`\n${process.exitCode ? "SOME TESTS FAILED" : "ALL PURE TESTS PASSED"} (${pass} checks)`);

async function runDbTests() {
  console.log("\n── DB pass (TEST database) ──────────────────────");
  const grab = (m, name) => m[name] ?? m.default?.[name];
  const dbMod = await import("@/lib/db");
  const db = grab(dbMod, "db");
  const importableInstitutions = grab(await import("@/lib/lead-import-scope"), "importableInstitutions");
  const createLeadRecord = grab(await import("@/lib/lead-create"), "createLeadRecord");

  // Guard: refuse to run against a URL that is not clearly the test DB.
  const url = process.env.DATABASE_URL ?? "";
  assert(/test|5433|localhost|127\.0\.0\.1/i.test(url), "DATABASE_URL must be the TEST db");

  const stamp = Date.now();
  const inst = await db.institution.create({
    data: { name: `QA Uni ${stamp}`, country: "Canada", type: "University", createdById: await anyUserId(db) },
  });
  const other = await db.institution.create({
    data: { name: `QA Other ${stamp}`, country: "Canada", type: "University", createdById: await anyUserId(db) },
  });

  // A recruiter assigned only to `inst`.
  const recruiter = await db.user.create({
    data: { name: `QA Rec ${stamp}`, email: `qa.rec.${stamp}@example.com`, role: "ICR", isActive: true },
  });
  await db.institutionUser.create({
    data: { institutionId: inst.id, userId: recruiter.id, assignmentStatus: "ACTIVE" },
  });

  const allowed = await importableInstitutions(recruiter.id, "ICR");
  check("recruiter sees only their assigned university", () => {
    assert.equal(allowed.length, 1);
    assert.equal(allowed[0].id, inst.id);
  });

  const adminAllowed = await importableInstitutions(recruiter.id, "SUPER_ADMIN");
  check("admin sees many institutions", () => assert(adminAllowed.length >= 2));

  // Create a lead with a passport number and verify encryption round-trips.
  const passport = `QA${stamp}`;
  const { leadId } = await createLeadRecord(
    { firstName: "Qa", lastName: "Lead", email: `qa.lead.${stamp}@example.com`,
      phone: "+1999999999", nationality: "Testian", countryOfResidence: "Testland",
      interestedProgram: "Testing", studyLevel: "POSTGRADUATE", intakeYear: 2027, intakeMonth: 3,
      passportNumber: passport, institutionId: inst.id, assignedICRId: recruiter.id },
    { userId: recruiter.id }
  );
  // The extension decrypts on read AND strips the internal hash from results,
  // so the Prisma read proves decryption; the raw query proves at-rest state.
  const roundTrip = await db.lead.findUnique({ where: { id: leadId }, select: { passportNumber: true, institutionId: true } });
  check("passport decrypts back to the original", () => {
    assert.equal(roundTrip.passportNumber, passport, "decrypts to original");
    assert.equal(roundTrip.institutionId, inst.id);
  });

  // Raw columns: passport must be ciphertext, and the blind-index hash must be set.
  const rawRows = await db.$queryRawUnsafe(
    `select "passportNumber", "passportNumberHash" from leads where id = $1`, leadId
  );
  check("passport stored encrypted at rest, with blind-index hash set", () => {
    assert(rawRows[0].passportNumber !== passport, "raw column must not equal plaintext");
    assert(rawRows[0].passportNumberHash, "blind-index hash must be set for dedup");
  });

  // Cleanup
  await db.leadActivity.deleteMany({ where: { leadId } });
  await db.auditLog.deleteMany({ where: { entityId: leadId } });
  await db.lead.delete({ where: { id: leadId } });
  await db.institutionUser.deleteMany({ where: { userId: recruiter.id } });
  await db.user.delete({ where: { id: recruiter.id } });
  await db.institution.deleteMany({ where: { id: { in: [inst.id, other.id] } } });
  await db.$disconnect();
  console.log("  (cleaned up QA rows)");
}

async function anyUserId(db) {
  const u = await db.user.findFirst({ select: { id: true } });
  return u.id;
}

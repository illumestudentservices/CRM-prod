/**
 * Confirms the newly-catalogued visa-refusal fields are role-gated by
 * redactFields(), same as passport. Reads granular overrides from the test DB
 * (tunnel on 5433); no dev server needed. 3 rounds.
 *
 *   npx tsx --env-file=.env.local scripts/qa-visa-redaction.ts
 */
import { redactFields } from "@/lib/granular-permissions";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, extra = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${extra}`); } };

function lead() {
  return {
    id: "L1", firstName: "A", lastName: "B",
    email: "stu@x.com", phone: "123", nationality: "Indian",
    dateOfBirth: new Date("2000-01-01"),
    passportNumber: "P123456",
    visaRefusalReason: "Insufficient funds shown at interview",
    visaRefusalDate: new Date("2026-03-01"),
    budgetRange: "20-30k",
  };
}
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

async function run(round: number) {
  console.log(`\n── round ${round} ──`);

  // ICR — casework role: keeps visa fields + passport.
  const icr = await redactFields("ICR" as Role, "leads", lead()) as Record<string, unknown>;
  ok("ICR keeps visaRefusalReason", has(icr, "visaRefusalReason"));
  ok("ICR keeps visaRefusalDate", has(icr, "visaRefusalDate"));
  ok("ICR keeps passportNumber", has(icr, "passportNumber"));

  // ACCOUNT_MANAGER — not a casework role: visa + passport stripped, email kept.
  const am = await redactFields("ACCOUNT_MANAGER" as Role, "leads", lead()) as Record<string, unknown>;
  ok("Account Manager: visaRefusalReason REMOVED", !has(am, "visaRefusalReason"));
  ok("Account Manager: visaRefusalDate REMOVED", !has(am, "visaRefusalDate"));
  ok("Account Manager: passportNumber REMOVED (unchanged behaviour)", !has(am, "passportNumber"));
  ok("Account Manager: email kept (ALL_STAFF)", has(am, "email"));

  // HQ_ANALYTICS — not casework: visa stripped.
  const an = await redactFields("HQ_ANALYTICS" as Role, "leads", lead()) as Record<string, unknown>;
  ok("HQ Analytics: visa fields REMOVED", !has(an, "visaRefusalReason") && !has(an, "visaRefusalDate"));

  // INSTITUTION_CLIENT (partner) — not ALL_STAFF: every controlled field gone.
  const cl = await redactFields("INSTITUTION_CLIENT" as Role, "leads", lead()) as Record<string, unknown>;
  ok("Partner: visa + passport + email all REMOVED",
    !has(cl, "visaRefusalReason") && !has(cl, "visaRefusalDate") && !has(cl, "passportNumber") && !has(cl, "email"));

  // SUPER_ADMIN — keeps everything.
  const sa = await redactFields("SUPER_ADMIN" as Role, "leads", lead()) as Record<string, unknown>;
  ok("Super Admin keeps visa fields", has(sa, "visaRefusalReason") && has(sa, "visaRefusalDate"));

  // Array form redacts every row.
  const arr = await redactFields("ACCOUNT_MANAGER" as Role, "leads", [lead(), lead()]) as Record<string, unknown>[];
  ok("array: visa stripped from every row", arr.length === 2 && arr.every((r) => !has(r, "visaRefusalReason")));

  // Writes unaffected: ICR can still write (close-lead flow). Sanity on canWrite.
}

async function main() {
  try {
    for (let r = 1; r <= 3; r++) await run(r);
  } catch (e) {
    fail++; console.error("CRASH:", (e as Error)?.stack || e);
  } finally {
    await db.$disconnect().catch(() => {});
    console.log(`\n  ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }
}
main();

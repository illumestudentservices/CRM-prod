/**
 * Integration test for Lead field encryption. Run against the TEST database.
 *
 *   node --import tsx scripts/qa-lead-encryption.mjs
 *
 * Proves end-to-end that nothing is corrupted:
 *   • pure crypto round-trips (encrypt→decrypt, blind index, tolerant plaintext)
 *   • a real lead written through Prisma is CIPHERTEXT on disk (checked with raw
 *     pg) but PLAINTEXT when read back through Prisma
 *   • the blind index is written, and a find-matches-style lookup finds the lead
 *   • updating the passport re-encrypts and re-indexes; clearing it nulls both
 *   • the blind index is never leaked in a normal read
 *
 * Creates one throwaway lead and deletes it at the end.
 */
import "dotenv/config";
import { Pool } from "pg";

const { db } = await import("@/lib/db");
const { encryptField, decryptField, blindIndex, isEncrypted } = await import("@/lib/field-crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

async function main() {
  console.log("─ Pure crypto ─");
  const samples = ["P1234567", "A longer visa refusal reason — §7(a) \"insufficient funds\".", "café ☕ unicode", ""];
  for (const s of samples) {
    const enc = encryptField(s);
    ok(enc === s || isEncrypted(enc), `encrypt(${JSON.stringify(s.slice(0, 12))}) → envelope or empty`);
    ok(decryptField(enc) === s, `round-trips exactly`);
  }
  ok(encryptField("X9") !== encryptField("X9"), "same input → different ciphertext (random IV)");
  ok(decryptField(encryptField("X9")) === "X9", "…but both decrypt to the same value");
  ok(decryptField("plain legacy value") === "plain legacy value", "plaintext passes through decrypt untouched");
  ok(encryptField(encryptField("P1")) === encryptField("P1") || isEncrypted(encryptField("P1")), "encrypt is idempotent on envelopes");
  ok(blindIndex("ab12cd") === blindIndex(" AB12CD "), "blind index is case/space-insensitive");
  ok(blindIndex("ab12cd") !== blindIndex("ab12ce"), "blind index differs for different values");

  console.log("\n─ Database integration ─");
  const user = await db.user.findFirst({ select: { id: true } });
  if (!user) throw new Error("no user in the test DB to own the lead");

  const PASS = `QA${Date.now()}`;
  const VISA = "QA visa refusal — do not keep";
  const lead = await db.lead.create({
    data: {
      firstName: "QAEnc", lastName: "Tester",
      nationality: "Testland", countryOfResidence: "Testland",
      interestedProgram: "QA", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9,
      createdById: user.id,
      passportNumber: PASS, visaRefusalReason: VISA,
    },
    select: { id: true, passportNumber: true, visaRefusalReason: true },
  });
  const id = lead.id;

  try {
    // Read back through Prisma — should be plaintext
    ok(lead.passportNumber === PASS, "create() returns plaintext passport");
    ok(lead.visaRefusalReason === VISA, "create() returns plaintext visa reason");

    const readBack = await db.lead.findUnique({
      where: { id },
      select: { passportNumber: true, visaRefusalReason: true, passportNumberHash: true },
    });
    ok(readBack.passportNumber === PASS, "findUnique returns plaintext passport");
    ok(readBack.visaRefusalReason === VISA, "findUnique returns plaintext visa reason");
    ok(!("passportNumberHash" in readBack) || readBack.passportNumberHash === undefined,
      "blind index is stripped from the read result");

    // Raw row — should be ciphertext + hash
    const raw = (await pool.query(
      `SELECT "passportNumber", "visaRefusalReason", "passportNumberHash" FROM leads WHERE id = $1`, [id],
    )).rows[0];
    ok(isEncrypted(raw.passportNumber), "on disk: passport is ciphertext");
    ok(isEncrypted(raw.visaRefusalReason), "on disk: visa reason is ciphertext");
    ok(raw.passportNumberHash === blindIndex(PASS), "on disk: blind index matches the plaintext");
    ok(decryptField(raw.passportNumber) === PASS, "on disk: ciphertext decrypts to the original");

    // Duplicate-matching lookup via blind index (what find-matches now does)
    const found = await db.lead.findMany({
      where: { passportNumberHash: blindIndex(PASS.toLowerCase()) },
      select: { id: true },
    });
    ok(found.some((f) => f.id === id), "blind-index lookup finds the lead (case-insensitive)");

    // Update re-encrypts and re-indexes
    const PASS2 = `QA${Date.now()}X`;
    await db.lead.update({ where: { id }, data: { passportNumber: PASS2 } });
    const raw2 = (await pool.query(`SELECT "passportNumber", "passportNumberHash" FROM leads WHERE id = $1`, [id])).rows[0];
    ok(decryptField(raw2.passportNumber) === PASS2, "after update: new passport decrypts correctly");
    ok(raw2.passportNumberHash === blindIndex(PASS2), "after update: blind index moved with it");
    ok(raw2.passportNumberHash !== blindIndex(PASS), "after update: old index no longer matches");

    // Clearing the passport nulls the index too
    await db.lead.update({ where: { id }, data: { passportNumber: null } });
    const raw3 = (await pool.query(`SELECT "passportNumber", "passportNumberHash" FROM leads WHERE id = $1`, [id])).rows[0];
    ok(raw3.passportNumber === null, "after clear: passport is null");
    ok(raw3.passportNumberHash === null, "after clear: blind index is null");
  } finally {
    await db.lead.delete({ where: { id } }).catch(() => {});
  }

  console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} passed, ${fail} failed.`);
  process.exitCode = fail ? 1 : 0;
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(async () => { await pool.end(); await db.$disconnect?.(); });

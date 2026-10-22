/**
 * Verify the at-rest encryption of Lead fields across the WHOLE table.
 *
 *   node --import tsx scripts/verify-lead-encryption.mjs
 *
 * Reads every lead directly from Postgres (not through Prisma) and checks:
 *   1. every encrypted field decrypts cleanly (GCM tag verifies) — no corruption
 *   2. every non-empty passport has a blind index, and that index MATCHES the
 *      decrypted value (so duplicate matching will actually find it)
 *   3. reports anything still in plaintext (expected only before the backfill)
 *
 * Exit code is non-zero if any decryption fails or any index is inconsistent —
 * i.e. if anything is corrupted. This is the check to run before and after the
 * production backfill.
 */
import "dotenv/config";
import { Pool } from "pg";

const { decryptField, blindIndex, isEncrypted } = await import("@/lib/field-crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, "passportNumber", "visaRefusalReason", "passportNumberHash" FROM leads`,
  );

  let passEnc = 0, passPlain = 0, visaEnc = 0, visaPlain = 0;
  const failures = [];

  for (const r of rows) {
    // passportNumber
    if (r.passportNumber != null && r.passportNumber !== "") {
      if (isEncrypted(r.passportNumber)) {
        passEnc++;
        try {
          const plain = decryptField(r.passportNumber);
          if (!r.passportNumberHash) {
            failures.push(`lead ${r.id}: passport encrypted but no blind index`);
          } else if (blindIndex(plain) !== r.passportNumberHash) {
            failures.push(`lead ${r.id}: blind index does NOT match decrypted passport`);
          }
        } catch (e) {
          failures.push(`lead ${r.id}: passport FAILED to decrypt — ${e.message}`);
        }
      } else {
        passPlain++;
      }
    }

    // visaRefusalReason
    if (r.visaRefusalReason != null && r.visaRefusalReason !== "") {
      if (isEncrypted(r.visaRefusalReason)) {
        visaEnc++;
        try {
          decryptField(r.visaRefusalReason);
        } catch (e) {
          failures.push(`lead ${r.id}: visaRefusalReason FAILED to decrypt — ${e.message}`);
        }
      } else {
        visaPlain++;
      }
    }
  }

  console.log(`Leads scanned: ${rows.length}`);
  console.log(`  passportNumber:    ${passEnc} encrypted, ${passPlain} plaintext`);
  console.log(`  visaRefusalReason: ${visaEnc} encrypted, ${visaPlain} plaintext`);
  console.log(`  decryption/index failures: ${failures.length}`);
  for (const f of failures) console.log(`    ✗ ${f}`);

  if (failures.length) {
    console.log(`\nFAIL — ${failures.length} problem(s). Nothing is corrupted by reading; investigate before proceeding.`);
    process.exitCode = 1;
  } else if (passPlain || visaPlain) {
    console.log(`\nOK so far, but ${passPlain + visaPlain} field(s) still plaintext — run the backfill (or it has not run yet).`);
  } else {
    console.log(`\nPASS — every sensitive field is encrypted, decrypts cleanly, and indexes are consistent.`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => pool.end());

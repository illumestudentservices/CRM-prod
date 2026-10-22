/**
 * EMERGENCY ROLLBACK: turn encrypted Lead fields back into plaintext.
 *
 *   node --import tsx scripts/decrypt-lead-fields.mjs            # dry run
 *   node --import tsx scripts/decrypt-lead-fields.mjs --commit   # apply
 *
 * The inverse of encrypt-lead-fields.mjs. Use only if the encryption rollout
 * must be undone. Needs the SAME FIELD_ENCRYPTION_KEY the data was encrypted
 * with. Decrypts passportNumber and visaRefusalReason in place and clears the
 * blind index. Idempotent: a value that is already plaintext is left alone.
 */
import "dotenv/config";
import { Pool } from "pg";

const COMMIT = process.argv.includes("--commit");
const { decryptField, isEncrypted } = await import("@/lib/field-crypto");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, "passportNumber", "visaRefusalReason" FROM leads`,
  );
  let pass = 0, visa = 0, updated = 0;
  for (const r of rows) {
    const sets = [], vals = [];
    if (isEncrypted(r.passportNumber)) {
      vals.push(decryptField(r.passportNumber)); sets.push(`"passportNumber" = $${vals.length}`);
      sets.push(`"passportNumberHash" = NULL`);
      pass++;
    }
    if (isEncrypted(r.visaRefusalReason)) {
      vals.push(decryptField(r.visaRefusalReason)); sets.push(`"visaRefusalReason" = $${vals.length}`);
      visa++;
    }
    if (!sets.length) continue;
    updated++;
    if (COMMIT) {
      vals.push(r.id);
      await pool.query(`UPDATE leads SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    }
  }
  console.log(`${COMMIT ? "APPLIED" : "DRY RUN"}: passport ${pass}, visa ${visa}, rows ${updated}`);
  if (!COMMIT) console.log("Re-run with --commit to apply.");
}
main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; }).finally(() => pool.end());

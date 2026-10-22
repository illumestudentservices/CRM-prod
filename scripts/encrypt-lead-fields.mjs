/**
 * Backfill: encrypt existing plaintext Lead fields in place.
 *
 *   node --import tsx scripts/encrypt-lead-fields.mjs            # dry run
 *   node --import tsx scripts/encrypt-lead-fields.mjs --commit   # apply
 *
 * Encrypts passportNumber and visaRefusalReason, and populates passportNumberHash
 * (the blind index) for every lead that has a passport. Talks to Postgres
 * directly with `pg` — NOT through Prisma — so what is written is exactly what
 * this script computes, with no extension in the middle.
 *
 * ★ IDEMPOTENT. A value that is already an `enc:` envelope is left alone, so a
 *   second run is a no-op and a half-finished run can simply be re-run.
 *
 * ★ SAFE ORDER. Run AFTER the passportNumberHash column exists (prisma db push)
 *   and AFTER a database backup. A plaintext row reads correctly whether or not
 *   it has been migrated, so there is no stop-the-world window.
 *
 * ★ REVERSIBLE. scripts/decrypt-lead-fields.mjs turns this back into plaintext
 *   using the same key, should that ever be needed.
 */
import "dotenv/config";
import { Pool } from "pg";

const COMMIT = process.argv.includes("--commit");

const { encryptField, blindIndex, isEncrypted } = await import("@/lib/field-crypto");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query(
    `SELECT id, "passportNumber", "visaRefusalReason", "passportNumberHash" FROM leads`,
  );
  console.log(`Scanning ${rows.length} lead(s)…\n`);

  let passEnc = 0, hashSet = 0, visaEnc = 0, already = 0, updated = 0;

  for (const r of rows) {
    const sets = [];
    const vals = [];
    let touched = false;

    // passportNumber -> ciphertext, and its blind index
    if (r.passportNumber != null && r.passportNumber !== "") {
      if (!isEncrypted(r.passportNumber)) {
        vals.push(encryptField(r.passportNumber));
        sets.push(`"passportNumber" = $${vals.length}`);
        vals.push(blindIndex(r.passportNumber));
        sets.push(`"passportNumberHash" = $${vals.length}`);
        passEnc++; hashSet++; touched = true;
      } else if (r.passportNumberHash == null) {
        // Encrypted already but missing its index (older partial state): we
        // cannot recompute the hash from ciphertext, so flag it loudly.
        console.warn(`  ! lead ${r.id}: passport encrypted but hash missing — needs manual attention`);
      } else {
        already++;
      }
    }

    // visaRefusalReason -> ciphertext
    if (r.visaRefusalReason != null && r.visaRefusalReason !== "") {
      if (!isEncrypted(r.visaRefusalReason)) {
        vals.push(encryptField(r.visaRefusalReason));
        sets.push(`"visaRefusalReason" = $${vals.length}`);
        visaEnc++; touched = true;
      }
    }

    if (!touched) continue;
    updated++;
    if (COMMIT) {
      vals.push(r.id);
      await pool.query(`UPDATE leads SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
    }
  }

  console.log(`${COMMIT ? "APPLIED" : "DRY RUN — nothing written"}:`);
  console.log(`  passportNumber encrypted:    ${passEnc}`);
  console.log(`  passportNumberHash set:      ${hashSet}`);
  console.log(`  visaRefusalReason encrypted: ${visaEnc}`);
  console.log(`  rows updated:                ${updated}`);
  console.log(`  already encrypted (skipped): ${already}`);
  if (!COMMIT) console.log(`\nRe-run with --commit to apply.`);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => pool.end());

/**
 * One-time: encrypt existing plaintext users.twoFactorSecret at rest.
 * Idempotent (skips already-encrypted rows) and self-verifying (only writes a
 * row whose ciphertext decrypts back to the original with THIS env's key — so a
 * wrong key is caught before any write). Reads already tolerate plaintext, so
 * running or not running this never breaks logins.
 *
 * TEST:  npx tsx --env-file=.env.local scripts/migrate-encrypt-2fa-secrets.ts
 * PROD:  (on the VPS) npx tsx --env-file=.env scripts/migrate-encrypt-2fa-secrets.ts
 */
import { db } from "@/lib/db";
import { encryptField, decryptField, isEncrypted } from "@/lib/field-crypto";

async function main() {
  const users = await db.user.findMany({ where: { twoFactorSecret: { not: null } }, select: { id: true, twoFactorSecret: true } });
  let encrypted = 0, already = 0, failed = 0;
  for (const u of users) {
    const s = u.twoFactorSecret!;
    if (isEncrypted(s)) { already++; continue; }
    const enc = encryptField(s);
    if (!isEncrypted(enc) || decryptField(enc) !== s) { failed++; console.error(`round-trip FAILED for ${u.id} — not writing`); continue; }
    await db.user.update({ where: { id: u.id }, data: { twoFactorSecret: enc } });
    encrypted++;
  }
  console.log(`[migrate-2fa] total=${users.length} encrypted=${encrypted} already-encrypted=${already} failed=${failed}`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

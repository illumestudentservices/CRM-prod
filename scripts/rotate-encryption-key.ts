/**
 * Re-encrypt every encrypted field under the CURRENT FIELD_ENCRYPTION_KEY.
 *
 * Safe key rotation (zero downtime, no lockout):
 *   1. Generate NEW key:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *   2. On the app env set  FIELD_ENCRYPTION_KEY = NEW,  FIELD_ENCRYPTION_KEY_OLD = OLD  and restart.
 *      The app now WRITES with NEW and still READS both (field-crypto tries NEW then OLD).
 *   3. Run this script with the SAME env — it rewrites every row under NEW and
 *      recomputes the key-derived blind index (passportNumberHash):
 *        (VPS)  sudo -u illume bash -lc "cd /var/www/illume-crm && npx --no-install tsx --env-file=.env scripts/rotate-encryption-key.ts"
 *   4. When it reports 0 remaining-on-old, drop FIELD_ENCRYPTION_KEY_OLD and restart.
 *
 * Encrypted fields (keep in step with lib/lead-encryption.ts + 2fa/enable):
 *   Lead.passportNumber (+ passportNumberHash), Lead.visaRefusalReason,
 *   User.twoFactorSecret.
 *
 * Leads go through the app db extension: reading returns plaintext (decrypted
 * with NEW-or-OLD), writing the plaintext back re-encrypts with NEW and
 * recomputes the hash. twoFactorSecret has no extension, so it is handled with
 * explicit decrypt/encrypt. Every write is self-verified (re-read decrypts to
 * the original) and a key canary runs first.  --dry-run reports without writing.
 */
import { db } from "@/lib/db";
import { encryptField, decryptField, isEncrypted } from "@/lib/field-crypto";

const DRY = process.argv.includes("--dry-run");

async function main() {
  console.log(`[rotate] ${DRY ? "DRY RUN — no writes" : "LIVE"} | old keys set: ${process.env.FIELD_ENCRYPTION_KEY_OLD ? "yes" : "NO (nothing to rotate from)"}`);

  // ── Canary: confirm the current env can read existing data before writing.
  const probe = await db.lead.findFirst({ where: { passportNumber: { not: null } }, select: { passportNumber: true } }).catch(() => null);
  if (probe?.passportNumber != null) {
    console.log("[rotate] canary OK — read an existing encrypted passport with the current key set");
  } else {
    console.warn("[rotate] no encrypted passport to canary against — proceeding");
  }

  // ── Leads (via the db extension: read = plaintext, write = re-encrypt NEW).
  const leads = await db.lead.findMany({
    where: { OR: [{ passportNumber: { not: null } }, { visaRefusalReason: { not: null } }] },
    select: { id: true, passportNumber: true, visaRefusalReason: true },
  });
  let leadsDone = 0, leadsFail = 0;
  for (const l of leads) {
    if (DRY) { leadsDone++; continue; }
    try {
      await db.lead.update({ where: { id: l.id }, data: { passportNumber: l.passportNumber, visaRefusalReason: l.visaRefusalReason } });
      const back = await db.lead.findUnique({ where: { id: l.id }, select: { passportNumber: true, visaRefusalReason: true } });
      if (back?.passportNumber === l.passportNumber && back?.visaRefusalReason === l.visaRefusalReason) leadsDone++;
      else { leadsFail++; console.error(`[rotate] lead ${l.id} self-verify MISMATCH`); }
    } catch (e) { leadsFail++; console.error(`[rotate] lead ${l.id} failed:`, (e as Error).message); }
  }

  // ── User.twoFactorSecret (no extension — explicit decrypt/encrypt).
  const users = await db.user.findMany({ where: { twoFactorSecret: { not: null } }, select: { id: true, twoFactorSecret: true } });
  let usersDone = 0, usersSkip = 0, usersFail = 0;
  for (const u of users) {
    const raw = u.twoFactorSecret!;
    let plain: string;
    try { plain = decryptField(raw); } catch (e) { usersFail++; console.error(`[rotate] user ${u.id} decrypt failed:`, (e as Error).message); continue; }
    const reenc = encryptField(plain);
    if (!isEncrypted(reenc) || decryptField(reenc) !== plain) { usersFail++; console.error(`[rotate] user ${u.id} self-verify failed`); continue; }
    if (DRY) { usersDone++; continue; }
    await db.user.update({ where: { id: u.id }, data: { twoFactorSecret: reenc } });
    usersDone++;
  }

  console.log(`[rotate] leads: done=${leadsDone} fail=${leadsFail} / ${leads.length}`);
  console.log(`[rotate] users(2FA): done=${usersDone} skip=${usersSkip} fail=${usersFail} / ${users.length}`);
  await db.$disconnect();
  process.exit(leadsFail + usersFail ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

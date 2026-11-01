/** Read-only: confirm migrated twoFactorSecret rows decrypt to valid TOTP seeds
 *  with THIS env's key. Run on the VPS as the app user with --env-file=.env. */
import { db } from "@/lib/db";
import { decryptField, isEncrypted } from "@/lib/field-crypto";
import { generate as totpGenerate } from "otplib";
import { totpVerify } from "@/lib/totp";
async function main() {
  const users = await db.user.findMany({ where: { twoFactorSecret: { not: null }, twoFactorEnabled: true }, select: { id: true, twoFactorSecret: true }, take: 5 });
  let good = 0, bad = 0, plain = 0;
  for (const u of users) {
    const s = u.twoFactorSecret!;
    if (!isEncrypted(s)) { plain++; continue; }
    try {
      const secret = decryptField(s);
      const code = await totpGenerate({ secret });
      if (await totpVerify(secret, code)) good++; else bad++;
    } catch { bad++; }
  }
  console.log(`[verify-2fa] sampled=${users.length} decrypt+totp_ok=${good} bad=${bad} stillPlaintext=${plain}`);
  await db.$disconnect();
  process.exit(bad ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

import { db, createAndLogin, destroyUser, BASE, Jar } from "./qa-lib.mjs";
import { encryptField, decryptField, isEncrypted } from "@/lib/field-crypto";
import { generate as totpGenerate } from "otplib";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

async function getCsrf() { const jar = new Jar(); const r = await fetch(`${BASE}/api/auth/csrf`); jar.ingest(r.headers); const { csrfToken } = await r.json(); return { csrfToken, jar }; }
async function pwLogin(email: string, password: string) {
  const { csrfToken, jar } = await getCsrf();
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }) });
  jar.ingest(r.headers); return jar;
}
async function verify(jar: Jar, code: string) { const r = await fetch(`${BASE}/api/auth/2fa/verify`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.header() }, body: JSON.stringify({ code }) }); let j: Record<string, unknown> = {}; try { j = await r.json(); } catch {/* */} return { status: r.status, json: j }; }

async function main() {
  // Part 1 — unit: encrypt/decrypt round-trip + plaintext passthrough.
  console.log("-- unit --");
  const sample = "JBSWY3DPEHPK3PXP";
  const enc = encryptField(sample);
  ok(isEncrypted(enc) && !isEncrypted(sample), "encryptField produces an encrypted blob");
  ok(decryptField(enc) === sample, "decryptField recovers the secret");
  ok(decryptField(sample) === sample, "decryptField passes legacy plaintext through (backward-compat)");

  for (let run = 1; run <= 3; run++) {
    console.log(`-- integration run ${run} --`);
    const u = await createAndLogin({ role: "EMPLOYEE" });
    try {
      const row = await db.user.findUnique({ where: { id: u.user.id }, select: { twoFactorSecret: true } });
      const secret = row!.twoFactorSecret!; // plaintext from qa-lib
      ok(!isEncrypted(secret), "qa user starts with a legacy plaintext secret");

      // Legacy plaintext still verifies.
      await db.user.update({ where: { id: u.user.id }, data: { lastTotpHash: null, lastTotpAt: null, loginAttempts: 0, mfaAttempts: 0, lockedUntil: null, mfaLockedUntil: null } });
      let j1 = await pwLogin(u.email, u.password);
      let v1 = await verify(j1, await totpGenerate({ secret }));
      ok(v1.status === 200 && v1.json.success === true, "plaintext-secret account verifies (backward-compat)", `${v1.status} ${JSON.stringify(v1.json)}`);

      // Now encrypt the secret at rest, as a new enrollment would store it.
      await db.user.update({ where: { id: u.user.id }, data: { twoFactorSecret: encryptField(secret), lastTotpHash: null, lastTotpAt: null, loginAttempts: 0, mfaAttempts: 0, lockedUntil: null, mfaLockedUntil: null } });
      const stored = (await db.user.findUnique({ where: { id: u.user.id }, select: { twoFactorSecret: true } }))!.twoFactorSecret!;
      ok(isEncrypted(stored), "secret is now encrypted at rest");

      // Encrypted secret still verifies (verify route decrypts it).
      let j2 = await pwLogin(u.email, u.password);
      let v2 = await verify(j2, await totpGenerate({ secret }));
      ok(v2.status === 200 && v2.json.success === true, "encrypted-secret account verifies (route decrypts)", `${v2.status} ${JSON.stringify(v2.json)}`);
    } finally { await destroyUser(u); }
  }
  console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

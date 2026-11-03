/**
 * QA — new-device sign-in detection.
 *
 * Logs ONE user in three times through the real /api/auth flow and asserts:
 *   1. First login (no device cookie)      -> device recorded, NO alert (silent first device)
 *   2. Second login (same device cookie)   -> recognised, NO new device, NO alert
 *   3. Third login (fresh, no cookie)       -> NEW device + NEW_DEVICE_LOGIN audit (alert)
 *
 * Email is forced off (BREVO_API_KEY=); the audit row is the proof the alert path ran.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-new-device.mjs
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { generateSecret, generate as totpGenerate } from "otplib";
import { db, Jar, BASE, TAG } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

/** One full login: csrf -> credentials -> 2fa/verify (code), carrying an optional device token. */
async function login({ email, password, code, deviceToken }) {
  const jar = new Jar();
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
  });
  jar.ingest(loginRes.headers);
  if (deviceToken) jar.cookies.set("illume_device", deviceToken);
  const verifyRes = await fetch(`${BASE}/api/auth/2fa/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ code }),
  });
  jar.ingest(verifyRes.headers);
  const vbody = await verifyRes.json().catch(() => ({}));
  return { ok: verifyRes.ok && vbody.success, device: jar.cookies.get("illume_device") ?? null, status: verifyRes.status, vbody };
}

async function run() {
  console.log(`[qa] target=${BASE}`);
  // Create a user with a known password, TOTP secret and two backup codes.
  const email = `${TAG.toLowerCase()}-dev-${Date.now()}@illume.local`;
  const password = crypto.randomBytes(18).toString("base64url");
  const secret = generateSecret();
  const backups = ["QADEV-AAAAA", "QADEV-BBBBB"];
  const user = await db.user.create({
    data: {
      email, firstName: TAG, lastName: "DEV", name: `${TAG} DEV`,
      password: await bcrypt.hash(password, 12),
      role: "ICR", isActive: true, twoFactorEnabled: true, twoFactorSecret: secret,
      twoFactorBackupCodes: await Promise.all(backups.map((b) => bcrypt.hash(b, 10))),
      passwordChangedAt: new Date(),
    },
  });

  try {
    const auditCount = async () => db.auditLog.count({ where: { userId: user.id, action: "NEW_DEVICE_LOGIN" } });
    const deviceCount = async () => db.knownDevice.count({ where: { userId: user.id } });

    // 1. First login via TOTP, no device cookie -> silent first device
    const l1 = await login({ email, password, code: await totpGenerate({ secret }) });
    expect("login 1 succeeds", l1.ok, `(status ${l1.status})`);
    expect("login 1 set a device cookie", !!l1.device);
    expect("login 1 recorded 1 device", (await deviceCount()) === 1, `(got ${await deviceCount()})`);
    expect("login 1 fired NO alert (first device silent)", (await auditCount()) === 0, `(got ${await auditCount()})`);

    // 2. Second login, SAME device cookie, via backup code -> recognised, no new device
    const l2 = await login({ email, password, code: backups[0], deviceToken: l1.device });
    expect("login 2 succeeds", l2.ok, `(status ${l2.status})`);
    expect("login 2 kept device count at 1 (recognised)", (await deviceCount()) === 1, `(got ${await deviceCount()})`);
    expect("login 2 fired NO alert", (await auditCount()) === 0, `(got ${await auditCount()})`);

    // 3. Third login, FRESH (no cookie) -> new device + alert
    const l3 = await login({ email, password, code: backups[1] });
    expect("login 3 succeeds", l3.ok, `(status ${l3.status})`);
    expect("login 3 recorded a 2nd device", (await deviceCount()) === 2, `(got ${await deviceCount()})`);
    expect("login 3 fired a NEW_DEVICE_LOGIN alert", (await auditCount()) === 1, `(got ${await auditCount()})`);
    expect("login 3 minted a different device token", !!l3.device && l3.device !== l1.device);
  } finally {
    await db.knownDevice.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await db.user.delete({ where: { id: user.id } }).catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

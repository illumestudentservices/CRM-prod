import { db, createAndLogin, destroyUser, BASE, Jar } from "./qa-lib.mjs";
import { generate as totpGenerate } from "otplib";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

async function getCsrf() {
  const jar = new Jar();
  const res = await fetch(`${BASE}/api/auth/csrf`);
  jar.ingest(res.headers);
  const { csrfToken } = await res.json();
  return { csrfToken, jar };
}
async function pwLogin(email: string, password: string) {
  const { csrfToken, jar } = await getCsrf();
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" }),
  });
  jar.ingest(r.headers);
  return jar;
}
async function verify(jar: Jar, code: string) {
  const r = await fetch(`${BASE}/api/auth/2fa/verify`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify({ code }),
  });
  let j: Record<string, unknown> = {}; try { j = await r.json(); } catch { /* */ }
  return { status: r.status, json: j };
}

async function main() {
  for (let run = 1; run <= 3; run++) {
    console.log(`-- run ${run} --`);
    const u = await createAndLogin({ role: "EMPLOYEE" });
    try {
      // Clear the replay state createAndLogin's own verify left behind.
      await db.user.update({ where: { id: u.user.id }, data: { lastTotpHash: null, lastTotpAt: null, loginAttempts: 0, mfaAttempts: 0, lockedUntil: null, mfaLockedUntil: null } });
      const row = await db.user.findUnique({ where: { id: u.user.id }, select: { twoFactorSecret: true } });
      const code = await totpGenerate({ secret: row!.twoFactorSecret! });

      const p1 = await pwLogin(u.email, u.password);
      const v1 = await verify(p1, code);
      ok(v1.status === 200 && v1.json.success === true, "first use of the code succeeds", `${v1.status} ${JSON.stringify(v1.json)}`);

      const p2 = await pwLogin(u.email, u.password);
      const v2 = await verify(p2, code);
      ok(v2.status === 400 && /already used/i.test(String(v2.json.error ?? "")), "replay of the SAME code is blocked (400)", `${v2.status} ${JSON.stringify(v2.json)}`);
    } finally {
      await destroyUser(u);
    }
  }
  console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

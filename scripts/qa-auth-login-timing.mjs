/**
 * Auth pentest fix #3 — login no longer leaks account existence via timing.
 *
 * Before: bcrypt.compare ran only for an existing, active, unlocked account, so
 * an unknown email returned near-instantly and a real one took ~bcrypt time
 * (~hundreds of ms). An attacker could map valid accounts by timing alone. Now
 * one bcrypt comparison runs on EVERY path (a dummy hash when there's no real
 * password), so the timings converge.
 *
 *   npx tsx --env-file=.env.local scripts/qa-auth-login-timing.mjs
 */
import bcrypt from "bcryptjs";
import { db, BASE, startSection, expect, summary } from "./qa-lib.mjs";

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function getCsrf() {
  const r = await fetch(`${BASE}/api/auth/csrf`);
  const set = r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie")].filter(Boolean);
  const cookie = set.map((c) => c.split(";")[0]).join("; ");
  const { csrfToken } = await r.json();
  return { csrfToken, cookie };
}
async function timeLogin(email, password) {
  const { csrfToken, cookie } = await getCsrf();
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: BASE, json: "true" });
  const t0 = performance.now();
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookie },
    body,
  });
  await r.text();
  return performance.now() - t0;
}

let realUser;
try {
  realUser = await db.user.create({
    data: {
      email: `timing.${Date.now()}@example.com`, name: "Timing QA",
      password: bcrypt.hashSync("CorrectHorse!42", 12), role: "EMPLOYEE", isActive: true,
    },
  });

  // Warm the route once so first-hit dev compilation doesn't skew the samples.
  await timeLogin(`warmup.${Date.now()}@example.com`, "x");

  for (let run = 1; run <= 3; run++) {
    startSection(`login timing — enumeration resistance (run ${run})`);
    // Keep the real account unlocked: reset attempts, then stay under the 5-strike cap.
    await db.user.update({ where: { id: realUser.id }, data: { loginAttempts: 0, lockedUntil: null } });

    const real = [];
    for (let i = 0; i < 4; i++) real.push(await timeLogin(realUser.email, "WrongPass!99"));
    const ghost = [];
    for (let i = 0; i < 7; i++) ghost.push(await timeLogin(`ghost.${Date.now()}.${i}@example.com`, "x"));

    const mReal = median(real);
    const mGhost = median(ghost);
    const ratio = Math.max(mReal, mGhost) / Math.max(1, Math.min(mReal, mGhost));

    // Absolute floor: a bcrypt comparison dominates the request (~tens of ms on
    // this host), so both paths are well clear of the sub-10ms no-bcrypt path the
    // unknown-email case used to take. The RATIO is the real test: with the dummy
    // hash both paths now cost the same, so they converge (~1.0). Before the fix
    // the unknown path skipped bcrypt and was markedly faster.
    expect(mGhost >= 20, "unknown-email login runs bcrypt (no instant path)", `ghost median ${mGhost.toFixed(0)}ms`);
    expect(mReal >= 20, "existing-email wrong-password also runs bcrypt", `real median ${mReal.toFixed(0)}ms`);
    expect(ratio <= 1.6, "real vs unknown timings converge (no enumeration signal)", `real ${mReal.toFixed(0)}ms vs ghost ${mGhost.toFixed(0)}ms (ratio ${ratio.toFixed(2)})`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (realUser) await db.user.delete({ where: { id: realUser.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

/**
 * Auth pentest fix #2 — rate limit on POST /api/auth/forgot-password.
 *
 * Before: no limit at all — an attacker could bomb a victim's inbox with reset
 * emails and drain the Brevo quota. Now: max 3 per email / 15 min and 20 per IP
 * / hour; over the limit → 429. The limit is applied BEFORE the user lookup, so
 * it is identical for real and non-existent addresses (no enumeration).
 *
 *   npx tsx --env-file=.env.local scripts/qa-auth-forgot-ratelimit.mjs
 */
import { db, BASE, startSection, expect, summary } from "./qa-lib.mjs";

let c = 0;
const uniq = () => `${Date.now()}-${c++}`;
const fp = async (email, ip) => {
  const res = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({ email }),
  });
  return res.status;
};

try {
  for (let run = 1; run <= 3; run++) {
    startSection(`forgot-password rate limit (run ${run})`);

    // Per-email cap: 3 allowed, the 4th blocked. Unique IP so only the email
    // bucket is the constraint.
    const email = `fp.${uniq()}@example.com`;
    const ip = `ipE-${uniq()}`;
    const codes = [await fp(email, ip), await fp(email, ip), await fp(email, ip)];
    expect(codes.every((s) => s === 200), "first 3 reset requests for an email are accepted (200)", `${codes}`);
    const fourth = await fp(email, ip);
    expect(fourth === 429, "the 4th request for the same email is blocked (429)", `got ${fourth}`);

    // Non-existent address is limited the SAME way (proves it runs before the
    // lookup → no account enumeration).
    const ghost = `nobody.${uniq()}@example.com`;
    const ghostIp = `ipG-${uniq()}`;
    const g = [await fp(ghost, ghostIp), await fp(ghost, ghostIp), await fp(ghost, ghostIp)];
    expect(g.every((s) => s === 200), "a non-existent email is handled identically (200 x3)", `${g}`);
    const gFourth = await fp(ghost, ghostIp);
    expect(gFourth === 429, "4th request for a non-existent email is also blocked (429) — no enumeration", `got ${gFourth}`);

    // A fresh email from a fresh IP is unaffected (the limiter is not globally
    // broken / sticky).
    const fresh = await fp(`fresh.${uniq()}@example.com`, `ipF-${uniq()}`);
    expect(fresh === 200, "a fresh email/IP is still accepted (200)", `got ${fresh}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

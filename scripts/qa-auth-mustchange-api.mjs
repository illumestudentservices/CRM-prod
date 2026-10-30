/**
 * Auth pentest fix #1 — mustChangePassword / expired password enforced on APIs,
 * not just dashboard pages.
 *
 * Before: the forced/expired-password gate lived only in (dashboard)/layout.tsx,
 * so a user with a temp or expired password could drive the whole product via
 * /api/* without ever changing it. Now proxy.ts blocks every non-public route
 * (403 on APIs, redirect on pages) until the password is changed.
 *
 *   npx tsx --env-file=.env.local scripts/qa-auth-mustchange-api.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

const LONG_AGO = new Date(Date.now() - 999 * 24 * 60 * 60 * 1000); // well past any rotation window
let normal, mc, expired;

try {
  normal = await createAndLogin({ role: "ICR" });
  mc = await createAndLogin({ role: "ICR", extra: { mustChangePassword: true } });
  expired = await createAndLogin({ role: "ICR", extra: { passwordChangedAt: LONG_AGO } });

  for (let run = 1; run <= 3; run++) {
    startSection(`mustChangePassword / expiry on APIs (run ${run})`);

    // A normal user is unaffected.
    let r = await api(normal.jar, "GET", "/api/leads");
    expect(r.ok, "normal user can call the API (200)", `got ${r.status}`);

    // THE GAP: a must-change user is blocked on APIs now.
    r = await api(mc.jar, "GET", "/api/leads");
    expect(r.status === 403, "must-change user is blocked on /api/leads (403)", `got ${r.status}`);
    expect(/password change required/i.test(JSON.stringify(r.payload)), "403 says password change required", JSON.stringify(r.payload)?.slice(0, 80));

    // An expired-password user is blocked the same way.
    r = await api(expired.jar, "GET", "/api/leads");
    expect(r.status === 403, "expired-password user is blocked on /api/leads (403)", `got ${r.status}`);

    // But the endpoints needed to actually change the password stay reachable.
    r = await api(mc.jar, "GET", "/api/auth/session");
    expect(r.ok, "must-change user can still reach /api/auth/session", `got ${r.status}`);
    r = await api(mc.jar, "GET", "/api/auth/csrf");
    expect(r.ok, "must-change user can still reach /api/auth/csrf", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const u of [normal, mc, expired]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

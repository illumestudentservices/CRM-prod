/**
 * Point 3: a blocked (5-strike lockout) OR disabled account has its active
 * sessions auto signed out, not just blocked at the login form.
 *
 *   npx tsx --env-file=.env.local scripts/qa-session-kill-on-lock.mjs
 */
import { BASE, db, createAndLogin, destroyUser, Jar, startSection, expect, summary, sleep } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");

async function sessionUser(jar) {
  const r = await fetch(`${B}/api/auth/session`, { headers: { Cookie: jar.header() } });
  const b = await r.json().catch(() => ({}));
  return b?.user ?? null;
}

async function fireWrongLogins(email, n) {
  const jar = new Jar();
  const csrfRes = await fetch(`${B}/api/auth/csrf`);
  jar.ingest(csrfRes.headers);
  const { csrfToken } = await csrfRes.json();
  for (let i = 1; i <= n; i++) {
    await fetch(`${B}/api/auth/callback/credentials`, {
      method: "POST", redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
      body: new URLSearchParams({ csrfToken, email, password: `WRONG-${i}-${Date.now()}`, callbackUrl: B, json: "true" }),
    });
    await sleep(150);
  }
}

let icr, emp;
try {
  // ── LOCKOUT kills the session ───────────────────────────────────────
  startSection("5-strike lockout signs the account out everywhere");
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  expect((await sessionUser(icr.jar)) !== null, "ICR is signed in before lockout");

  await fireWrongLogins(icr.user.email, 5);

  const locked = await db.user.findUnique({
    where: { id: icr.user.id },
    select: { lockedUntil: true, sessionsRevokedAt: true },
  });
  expect(!!locked?.lockedUntil && locked.lockedUntil > new Date(), "account is locked (lockedUntil set)");
  expect(!!locked?.sessionsRevokedAt, "sessionsRevokedAt was stamped on lock");
  expect((await sessionUser(icr.jar)) === null, "the previously-open session is now signed out");

  // ── DISABLE kills the session (regression) ──────────────────────────
  startSection("Admin disable signs the account out");
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  expect((await sessionUser(emp.jar)) !== null, "user is signed in before disable");
  // What the admin disable route does: deactivate + revoke sessions.
  await db.user.update({ where: { id: emp.user.id }, data: { isActive: false, sessionsRevokedAt: new Date() } });
  expect((await sessionUser(emp.jar)) === null, "the open session is signed out after disable");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  // Re-activate so destroyUser can clean emp up cleanly.
  try { if (emp) await db.user.update({ where: { id: emp.user.id }, data: { isActive: true } }); } catch { /* ignore */ }
  if (icr) await destroyUser(icr);
  if (emp) await destroyUser(emp);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

/**
 * Resetting someone's MFA must actually let them back in.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-mfa-reset.mjs
 *
 * The bug this guards, seen on production 2026-08-26:
 *
 * The reset cleared twoFactorEnabled / twoFactorSecret / twoFactorBackupCodes in
 * the database and reported success. But the proxy decides where to send someone
 * from their JWT, and the token-refresh callback re-reads isActive, deletedAt,
 * sessionsRevokedAt, role and regionId — NOT twoFactorEnabled. So a user sitting
 * on /verify-2fa when the reset landed kept a token saying "2FA pending", and was
 * asked for a TOTP or backup code that no longer existed anywhere. Nothing they
 * could type would work, for up to 48 hours.
 *
 * It only reproduces when the victim already holds a pending-2FA session, which
 * is why testing it on a freshly signed-in account showed the correct /setup-2fa
 * behaviour and hid the fault entirely.
 */
import { chromium } from "playwright";
import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const ctxs = [];
const browser = await chromium.launch();

/** Signs in only as far as the password, leaving the session 2FA-pending. */
async function signInToPendingMfa(acct) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/login`,
    { waitUntil: "networkidle", timeout: 60000 });
  await p.locator('input[type="email"]').fill(acct.email);
  await p.locator('input[type="password"]').fill(acct.password);
  await p.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await p.locator('button[type="submit"]').first().click();
  await p.waitForURL(/verify-2fa/, { timeout: 30000 });
  return { ctx, p };
}

async function main() {
  startSection("Fixture");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  ctxs.push(admin);
  const victim = await createAndLogin({ role: "ICR" });
  ctxs.push(victim);
  const row = await db.user.findUnique({
    where: { id: victim.user.id },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  expect(row.twoFactorEnabled && row.twoFactorSecret !== null,
    "victim has MFA enrolled", `enabled=${row.twoFactorEnabled}`);
  ok("Super Admin ready to perform the reset");

  startSection("The victim is mid-way through 2FA when the reset lands");
  const session = await signInToPendingMfa(victim);
  expect(new URL(session.p.url()).pathname === "/verify-2fa",
    "they are sitting on the 2FA challenge", new URL(session.p.url()).pathname);

  const res = await api(admin.jar, "POST", `/api/settings/users/${victim.user.id}/reset-2fa`);
  expect(res.status === 200, "the reset succeeds", `${res.status} ${JSON.stringify(res.payload)}`);

  startSection("The database is cleared");
  const after = await db.user.findUnique({
    where: { id: victim.user.id },
    select: { twoFactorEnabled: true, twoFactorSecret: true, twoFactorBackupCodes: true, sessionsRevokedAt: true },
  });
  expect(after.twoFactorEnabled === false, "twoFactorEnabled false", String(after.twoFactorEnabled));
  expect(after.twoFactorSecret === null, "secret gone", String(after.twoFactorSecret));
  expect((after.twoFactorBackupCodes ?? []).length === 0, "backup codes gone",
    `${(after.twoFactorBackupCodes ?? []).length}`);
  expect(after.sessionsRevokedAt !== null,
    "*** and their sessions are revoked — without this the stale token keeps " +
    "demanding a code that no longer exists ***",
    String(after.sessionsRevokedAt));

  startSection("Their stale session cannot still demand a code");
  // The whole bug: reload the page they were left on. It must not go on asking
  // for a TOTP or a backup code, because neither exists any more.
  await session.p.reload({ waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await session.p.waitForTimeout(2500);
  const landed = new URL(session.p.url()).pathname;
  const body = (await session.p.locator("body").innerText()).replace(/\s+/g, " ");
  expect(landed !== "/verify-2fa",
    "*** they are no longer held on the 2FA challenge ***", landed);
  expect(!/backup code/i.test(body),
    "*** and are not asked for a backup code they do not have ***",
    body.slice(0, 140));

  startSection("Signing in again lands on enrolment, not on a dead challenge");
  const fresh = await browser.newContext();
  const fp = await fresh.newPage();
  const BASE = process.env.BASE_URL ?? "http://localhost:3000";
  await fp.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await fp.locator('input[type="email"]').fill(victim.email);
  await fp.locator('input[type="password"]').fill(victim.password);
  await fp.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await fp.locator('button[type="submit"]').first().click();
  await fp.waitForURL((u) => !/\/login$/.test(new URL(u).pathname), { timeout: 45000 }).catch(() => {});
  const freshPath = new URL(fp.url()).pathname;
  expect(freshPath === "/setup-2fa",
    "*** /setup-2fa — a fresh QR code to scan ***", freshPath);
  await fresh.close();
  await session.ctx.close();

  startSection("Resetting MFA on someone who has none is refused");
  const again = await api(admin.jar, "POST", `/api/settings/users/${victim.user.id}/reset-2fa`);
  expect(again.status === 400,
    "400 — there is nothing to reset, and saying so beats a silent no-op",
    `${again.status}`);

  startSection("Only a holder of users.reset_mfa may do it");
  const icr = await createAndLogin({ role: "ICR" });
  ctxs.push(icr);
  const forbidden = await api(icr.jar, "POST", `/api/settings/users/${admin.user.id}/reset-2fa`);
  expect(forbidden.status === 403, "an ICR cannot reset anyone's MFA", `${forbidden.status}`);
  void totpGenerate;
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  await browser.close();
  startSection("Teardown");
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

/**
 * Signing in must not care how you capitalise your own email address.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-email-case.mjs
 *
 * The bug this guards: `lib/auth.ts` looked the user up with
 * `findUnique({ where: { email } })` on the string exactly as typed, and
 * Postgres compares text case-sensitively. An account stored as
 * "Ashley-Jane@..." could only be signed into with that capitalisation; anyone
 * typing their address in lowercase was told their password was wrong.
 *
 * It presented as two unrelated faults and that is why it lasted: the password
 * looked wrong, and two-factor setup looked missing. Both were the same cause —
 * the lookup failed before the password was compared, so `loginAttempts` stayed
 * at 0 and nothing was logged, and MFA enrolment sits behind a successful
 * password check so it never appeared.
 */
import { chromium } from "playwright";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import {
  db, BASE, startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const made = [];
const browser = await chromium.launch();

/** Drives the real login form and reports where it landed. */
async function signInVia(typedEmail, password) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await p.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
    await p.locator('input[type="email"]').fill(typedEmail);
    await p.locator('input[type="password"]').fill(password);
    await p.waitForFunction(
      () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
      { timeout: 20000 });
    await p.locator('button[type="submit"]').first().click();
    // Waited for, not slept through. A fixed 5s sleep failed whichever casing
    // happened to be tried first against a cold dev server — the auth routes
    // and /setup-2fa were still compiling — which reads exactly like a case bug
    // and is not one.
    await p.waitForURL((u) => !/\/login$/.test(new URL(u).pathname), { timeout: 45000 })
      .catch(() => {});
    return new URL(p.url()).pathname;
  } finally { await ctx.close(); }
}

async function makeUser(email) {
  const password = crypto.randomBytes(18).toString("base64url") + "Aa1!";
  const u = await db.user.create({
    data: {
      email, firstName: "Case", lastName: TAG, name: `Case ${TAG}`,
      password: await bcrypt.hash(password, 12), role: "EMPLOYEE",
      isActive: true, twoFactorEnabled: false, passwordChangedAt: new Date(),
    },
    select: { id: true, email: true },
  });
  made.push(u.id);
  return { ...u, password };
}

async function main() {
  startSection("Fixture");
  // Mixed case on purpose — this is the shape four live accounts had.
  const mixed = await makeUser(`${TAG}-MiXeD@illume.local`);
  ok("account stored with mixed-case email", mixed.email);

  // One throwaway attempt so route compilation is not measured as a failure.
  await signInVia("warmup@illume.local", "not-a-password");

  startSection("Capitalisation must not decide whether you can sign in");
  const asStored = await signInVia(mixed.email, mixed.password);
  expect(asStored !== "/login",
    "the exact capitalisation works", asStored);

  const lower = await signInVia(mixed.email.toLowerCase(), mixed.password);
  expect(lower !== "/login",
    "*** all lowercase works too — this is the regression to guard ***", lower);

  const upper = await signInVia(mixed.email.toUpperCase(), mixed.password);
  expect(upper !== "/login", "and all uppercase", upper);

  startSection("MFA enrolment appears, which the bug also hid");
  expect(asStored === "/setup-2fa" && lower === "/setup-2fa",
    "*** an account without MFA lands on /setup-2fa whichever case was typed ***",
    `${asStored} / ${lower}`);

  startSection("A wrong password is still a wrong password");
  const bad = await signInVia(mixed.email.toLowerCase(), "definitely-not-the-password");
  expect(bad === "/login", "refused", bad);
  const after = await db.user.findUnique({
    where: { id: mixed.id }, select: { loginAttempts: true } });
  expect(after.loginAttempts > 0,
    "*** and it now COUNTS as an attempt — under the bug this stayed 0, so a " +
    "wrong password and an unmatched address were indistinguishable ***",
    `loginAttempts=${after.loginAttempts}`);

  startSection("Two accounts differing only by case cannot be created");
  let refused = false;
  try {
    await makeUser(mixed.email.toLowerCase());
  } catch (e) {
    refused = /unique|constraint|P2002/i.test(e.message);
  }
  expect(refused,
    "*** the lower(email) unique index from migration 036 refuses it ***",
    refused ? "" : "a case-variant duplicate was created — the index is missing");

  startSection("Forgotten password uses the same matching as sign-in");
  // The endpoint always answers 200 so it cannot be used to enumerate accounts,
  // which means the response says nothing about whether the address matched.
  // createMagicLink deletes every prior token for the user before issuing one,
  // so counting rows says nothing either — a fresh token each time is the signal.
  const issued = [];
  for (const [label, typed] of [["as stored", mixed.email], ["lowercase", mixed.email.toLowerCase()]]) {
    await db.passwordResetToken.deleteMany({ where: { userId: mixed.id } });
    const res = await fetch(`${BASE}/api/auth/forgot-password`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: typed }),
    });
    expect(res.status === 200, `${label}: answers 200 (no enumeration)`, `${res.status}`);
    // Polled rather than slept: the send is fire-and-forget.
    let t = null;
    for (let i = 0; i < 25 && !t; i++) {
      await new Promise((r) => setTimeout(r, 400));
      t = await db.passwordResetToken.findFirst({ where: { userId: mixed.id }, select: { token: true } });
    }
    issued.push({ label, got: !!t });
  }
  expect(issued.every((i) => i.got),
    "*** both casings produced a reset link — reset and sign-in agree on who you are ***",
    JSON.stringify(issued));
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  await browser.close();
  startSection("Teardown");
  for (const id of made) {
    for (const m of ["session", "account", "passwordHistory", "passwordResetToken", "auditLog", "notification"])
      if (db[m]?.deleteMany) await db[m].deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  const left = await db.user.count({ where: { email: { contains: TAG } } });
  expect(left === 0, "fixtures removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

/**
 * The setup screen's "email my codes instead" path, driven in a real browser.
 *
 *   npx tsx --env-file=.env scripts/qa-email-enrol-ui.mjs
 *
 * The API suite proves the route. This proves a person can actually reach it:
 * an account with no second factor is sent to /setup-2fa, and the alternative
 * has to be visible and usable there or the route may as well not exist.
 *
 * localhost, never 127.0.0.1 — on the IP, Next treats the request as
 * cross-origin dev, hydration never happens, and every control sits dead while
 * the page still returns 200.
 */
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { BASE, db, startSection, ok, fail, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const { issueEmailOtp } = await import("../lib/mfa.ts");

const PASSWORD = "QaEnrolUi!2026-longenough";
let browser, user;

try {
  startSection("a person with no second factor can choose email");

  user = await db.user.create({
    data: {
      email: `qa-enrolui-${Date.now()}@illume.local`,
      firstName: "QA", lastName: "EnrolUi", name: "QA EnrolUi",
      password: await bcrypt.hash(PASSWORD, 12),
      role: "HQ_EXECUTIVE", isActive: true, twoFactorEnabled: false,
      passwordChangedAt: new Date(),
    },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));

  await page.goto(`${BROWSER_BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();

  await page.waitForURL(/setup-2fa/, { timeout: 60000 });
  ok("an account with no second factor is sent to the setup page");

  const emailOption = page.getByRole("button", { name: /email my codes instead/i });
  await emailOption.waitFor({ state: "visible", timeout: 15000 });
  ok("the email option is on screen");

  const body = await page.locator("body").innerText();
  expect(
    /less secure/i.test(body),
    "the screen says plainly that email is weaker than an app",
    "the trade-off is invisible to the person choosing it"
  );

  // ── With no mail provider configured, the screen must say so ─────────────
  //
  // There is no BREVO_API_KEY in dev, so the send genuinely fails and the route
  // returns 502. The correct behaviour is to STAY PUT and say so — telling
  // someone "check your email" when nothing was sent leaves them waiting for a
  // message that does not exist. Asserted here because it is a real state, not
  // a test artefact: the same thing happens in production if mail breaks.
  await emailOption.click();
  await page.getByText(/could not send your code/i).first().waitFor({ state: "visible", timeout: 30000 });
  ok("when mail cannot be sent, the screen says so and does not pretend");
  const stuckOnIntro = await page.getByRole("button", { name: /email my codes instead/i }).isVisible();
  expect(stuckOnIntro, "it does not advance to the code screen on a failed send");

  // ── Now the code screen, with the SEND stubbed ───────────────────────────
  //
  // Only the send is faked, standing in for a working mail provider. The
  // confirm below is NOT stubbed — it hits the real route, checks a real code
  // and really turns on two-factor, which is the part worth proving.
  await page.route("**/api/auth/2fa/enroll-email", async (route) => {
    const body = route.request().postDataJSON?.() ?? {};
    if (body.action === "send") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sentTo: "q•••••i@illume.local" }),
      });
    }
    return route.continue();
  });

  await page.getByRole("button", { name: /email my codes instead/i }).click();
  await page.getByText(/check your email/i).first().waitFor({ state: "visible", timeout: 30000 });
  ok("choosing email moves to the code screen");

  const masked = await page.locator("body").innerText();
  expect(masked.includes("•"), "the destination address is shown masked");

  // The browser cannot read the mailbox, so the code comes from the library —
  // the same value the route would have posted to the mailer.
  await db.user.update({ where: { id: user.id }, data: { emailOtpSentAt: null } });
  const issued = await issueEmailOtp(user.id);

  await page.locator('input[inputmode="numeric"]').fill(issued.code);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /turn on two-factor/i }).click();

  await page.getByText(/backup/i).first().waitFor({ state: "visible", timeout: 30000 });
  ok("the backup codes screen appears");

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { twoFactorEnabled: true, mfaMethod: true, twoFactorSecret: true, twoFactorBackupCodes: true },
  });
  expect(row.twoFactorEnabled === true, "two-factor is on for the account");
  expect(row.mfaMethod === "EMAIL", "the account is on email codes", `it is on ${row.mfaMethod}`);
  expect(row.twoFactorSecret === null, "no authenticator secret was ever created");
  expect(row.twoFactorBackupCodes.length === 8, "8 backup codes were saved");

  expect(
    jsErrors.length === 0,
    "no page errors",
    jsErrors.join(" | ")
  );
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (user) {
    try {
      await db.auditLog.deleteMany({ where: { userId: user.id } });
      await db.user.delete({ where: { id: user.id } });
    } catch { /* best effort */ }
  }
  await db.$disconnect();
  summary();
}

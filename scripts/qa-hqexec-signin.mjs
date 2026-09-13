/**
 * Focused re-test of the one failure in qa-all-roles: HQ_EXECUTIVE's browser
 * sign-in timing out.
 *
 * Ten of eleven roles passed the identical code path, which argues the page is
 * not broken — but the verify-2fa page was modified in the same change, so
 * "probably flake" is not good enough. This signs in three times through the
 * real browser and reports what actually happens, including how long each step
 * takes, so the answer is measured rather than assumed.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, ok, fail, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const { totpGenerate } = await import("../lib/totp.ts");

const made = [];
let browser;

try {
  startSection(`HQ_EXECUTIVE browser sign-in × ${process.env.ATTEMPTS ?? 3}`);
  browser = await chromium.launch();

  // Sample count is an argument because three runs cannot tell 2/3 from 3/3,
  // and the question here is precisely whether an intermittent failure is real.
  const ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const acct = await createAndLogin({ role: "HQ_EXECUTIVE" });
    made.push(acct);
    const row = await db.user.findUnique({
      where: { id: acct.user.id },
      select: { twoFactorSecret: true, mfaMethod: true },
    });

    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));

    const t0 = Date.now();
    try {
      await page.goto(`${BROWSER_BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
      await page.locator('input[type="email"]').fill(acct.email);
      await page.locator('input[type="password"]').fill(acct.password);
      await page.waitForFunction(
        () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
        { timeout: 20000 }
      );
      await page.locator('button[type="submit"]').first().click();

      const tLogin = Date.now();
      await page.waitForURL(/verify-2fa/, { timeout: 30000 });
      const tVerifyPage = Date.now();

      // The exact selector qa-all-roles uses. If the modified page ever renders
      // this input as inputmode="text" on first paint, this is where it breaks —
      // and it would break for every role, not one.
      const numeric = page.locator('input[inputmode="numeric"]');
      await numeric.waitFor({ state: "visible", timeout: 10000 });
      ok(`attempt ${attempt}: the numeric code input is present`);

      expect(
        row.mfaMethod === "TOTP",
        `attempt ${attempt}: the account is on TOTP`,
        `it is on ${row.mfaMethod}`
      );

      await numeric.fill(await totpGenerate(row.twoFactorSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
      const tDone = Date.now();

      ok(
        `attempt ${attempt}: signed in`,
        `login→verify ${tVerifyPage - tLogin}ms, verify→dashboard ${tDone - tVerifyPage}ms, total ${tDone - t0}ms`
      );
      expect(jsErrors.length === 0, `attempt ${attempt}: no page errors`, jsErrors.join(" | "));
    } catch (e) {
      fail(
        `attempt ${attempt}: sign-in failed after ${Date.now() - t0}ms`,
        `${String(e).split("\n")[0]} — landed on ${page.url()}`
      );
    } finally {
      await ctx.close();
    }
  }
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  for (const a of made) { try { await destroyUser(a); } catch { /* best effort */ } }
  await db.$disconnect();
  summary();
}

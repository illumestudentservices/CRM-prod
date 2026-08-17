/**
 * Proves the Forecasting module is reachable by a real person on production,
 * through the real login path including MFA. Read-only: it creates no business
 * data, because production is a live system and an empty forecasting screen
 * that renders is the thing being checked.
 *
 *   node scripts/prod-verify-forecasting.mjs <email> <password> <totpSecret>
 */
import { chromium } from "playwright";
// The app's own wrapper, so the code this test types is generated the same way
// the login route verifies it.
const { totpGenerate } = await import("../lib/totp.ts");

const [email, password, secret] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|DevTools/i.test(m.text())) errs.push(m.text());
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  check(true, "password step accepted, MFA challenged (not bypassed)");

  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
  check(true, "MFA accepted, signed in to production");

  // The nav entry — how a person would actually find this.
  const nav = await page.locator("nav, aside").first().innerText().catch(() => "");
  check(/Forecasting/i.test(nav), "*** Forecasting appears in the sidebar for an ICR ***",
    nav.replace(/\n/g, " ").slice(0, 80));

  await page.goto(`${BASE}/forecasting`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  check(!/\/login/.test(new URL(page.url()).pathname), "not bounced back to login",
    page.url());

  const body = await page.locator("body").innerText();
  check(/Forecasting/i.test(body), "*** the Forecasting screen renders on production ***");
  check(/Monthly enrolment forecasts/i.test(body), "the page description renders");
  check(/No forecasts in progress/i.test(body), "correct empty state (production has no forecasts yet)");
  check(!/Application error|500|Internal Server Error/i.test(body),
    "no server error on the page", body.slice(0, 100).replace(/\n/g, " "));

  // The API behind it, through the same authenticated session.
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/forecasts");
    return { status: r.status, body: (await r.text()).slice(0, 160) };
  });
  check(api.status === 200, "*** GET /api/forecasts returns 200 for an ICR ***", `status ${api.status}`);
  check(/"forecasts"|"data"/.test(api.body), "and returns a forecast payload", api.body.slice(0, 90));

  check(errs.length === 0, "no uncaught client errors", errs.slice(0, 2).join(" | "));
} catch (e) {
  check(false, "verification run completed", String(e.message).slice(0, 160));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

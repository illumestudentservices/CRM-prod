/**
 * Offboarding tab — browser check.
 *
 * Radix Tabs does not mount inactive tab content, so grepping the server HTML for
 * "Offboarding" gives a false negative. This drives a real browser, deep-links to
 * ?tab=offboarding, and asserts the panel actually rendered.
 *
 *   node --import tsx --env-file=.env scripts/qa-offboarding-ui.mjs
 */

import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, BASE, startSection, expect, ok, summary } from "./qa-lib.mjs";

// os.tmpdir(), not "/tmp" — this repo is developed on Windows, where a literal
// /tmp path silently fails and the screenshot never appears.
const SHOT = path.join(os.tmpdir(), "offboarding-tab.png");
const SHOT_FORM = path.join(os.tmpdir(), "offboarding-form.png");

const created = [];

try {
  startSection("Offboarding tab (browser)");

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });

  // Reuse the harness's already-authenticated cookie jar rather than driving the
  // login form and TOTP again in the browser.
  await ctx.addCookies(
    [...admin.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );

  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/hr?tab=offboarding`, { waitUntil: "networkidle" });

  expect(!page.url().includes("/login"), "Reached /hr without being bounced to login", page.url());

  const trigger = page.getByRole("tab", { name: "Offboarding" });
  expect(await trigger.count() === 1, "The Offboarding tab trigger exists");
  expect(await trigger.getAttribute("data-state") === "active",
    "?tab=offboarding deep-link activates the tab",
    `data-state=${await trigger.getAttribute("data-state")}`);

  // The panel body — proves the component mounted, not just the trigger.
  await page.waitForSelector("text=Raise a departure", { timeout: 15000 });
  ok("Panel rendered with the 'Raise a departure' action");

  const emptyState = await page.locator("text=No departures recorded").count();
  expect(emptyState === 1, "Empty state shown (no departures in the test DB)");

  const stepsHint = await page.locator("text=After approving, IT still does this by hand").count();
  expect(stepsHint === 1, "Reviewer sees the manual-revocation reminder");

  // Open the form and confirm the pieces that come from the API are populated.
  await page.getByRole("button", { name: /Raise a departure/ }).click();
  await page.waitForSelector("text=Who is leaving?", { timeout: 10000 });
  ok("Departure form opens");
  const warns = await page.locator("text=it does not close any access").count();
  expect(warns === 1, "Form states plainly that it revokes nothing");

  // The picker must end up populated for an unscoped reviewer, and must never
  // settle on the "Nobody available" claim while it is merely still loading.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Loading employees…"),
    { timeout: 10000 }
  );
  const nobody = await page.locator("text=Nobody available").count();
  expect(nobody === 0, "SUPER_ADMIN's picker is not empty once loaded");
  await page.getByRole("combobox").first().click();
  const opts = await page.getByRole("option").count();
  expect(opts > 0, "Employee dropdown lists candidates", `${opts} options`);
  ok(`picker shows ${opts} employees`);
  await page.keyboard.press("Escape");

  // The Account Requests tab must still work — the two live in the same TabsList.
  await page.goto(`${BASE}/hr?tab=account-requests`, { waitUntil: "networkidle" });
  const arTrigger = page.getByRole("tab", { name: "Account Requests" });
  expect(await arTrigger.getAttribute("data-state") === "active",
    "Existing Account Requests tab still activates (no regression)");

  // Back to the offboarding tab so the screenshot shows the new feature.
  await page.goto(`${BASE}/hr?tab=offboarding`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=Raise a departure", { timeout: 15000 });
  // Scroll the tab strip up so the panel itself is in frame, not the HR charts.
  await page.getByRole("tab", { name: "Offboarding" }).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT, fullPage: false });
  ok(`screenshot: ${SHOT}`);

  // And the form, which is where most of the new UI lives.
  await page.getByRole("button", { name: /Raise a departure/ }).click();
  await page.waitForSelector("text=Who is leaving?", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOT_FORM, fullPage: false });
  ok(`screenshot: ${SHOT_FORM}`);

  const real = errors.filter((e) => !/favicon|Download the React DevTools/i.test(e));
  expect(real.length === 0, "No console errors on the page", real.slice(0, 3).join(" | "));

  await browser.close();
} finally {
  for (const c of created) await destroyUser(c);
  await db.$disconnect();
}
summary();

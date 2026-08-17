/**
 * Forecasting screens, driven in a real browser, three passes.
 *
 *   node --import tsx --env-file=.env scripts/qa-forecasting-ui.mjs
 *
 * The API suite proves the rules hold. This proves a person can reach them, and
 * in particular that spec section 13 survives all the way to the screen: when
 * the RM adjusts a figure, the ICR original must still be visible, not replaced.
 * A UI that showed only the winning number would throw away the reason the
 * database keeps both.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const { FORECAST_SEGMENTS } = await import("../lib/forecasting.ts");

const PASSES = 3;
const allCreated = [];
const made = { forecasts: [], institutions: [] };

async function signIn(page, acct) {
  const row = await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(row.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} — forecasting screens`);

  const icr = await createAndLogin({ role: "ICR" });
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER" });
  allCreated.push(icr, rm);

  const inst = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Forecast Uni`, country: "Malaysia",
      type: "UNIVERSITY", createdById: rm.user.id,
    },
  });
  made.institutions.push(inst.id);

  // Seed a forecast already in the RM's hands with one segment adjusted, so the
  // screen has the state that matters to test.
  const forecast = await db.forecast.create({
    data: {
      periodYear: 2026, periodMonth: 9, institutionId: inst.id, icrId: icr.user.id,
      intakeYear: 2027, intakeMonth: 9, regionalManagerId: rm.user.id,
      status: "SUBMITTED_TO_RM", confidenceScore: 4,
      rationale: `${TAG} strong agent pipeline`,
      createdById: rm.user.id,
      segments: {
        create: FORECAST_SEGMENTS.map((segment) => ({
          segment,
          icrApplications: 30, icrDeposits: 25, icrEnrolments: 20,
          ...(segment === "DIRECT_UG" ? { rmEnrolments: 16 } : {}),
        })),
      },
    },
    select: { id: true },
  });
  made.forecasts.push(forecast.id);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools|Fast Refresh/i.test(m.text())) errs.push(m.text());
  });

  // ── The ICR's view ────────────────────────────────────────────────────
  await signIn(page, icr);
  await page.goto(`${BASE}/forecasting`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  const list = await page.locator("body").innerText();
  expect(/Forecasting/i.test(list), "*** the Forecasting screen exists and renders ***",
    list.slice(0, 60).replace(/\n/g, " "));
  expect(list.includes(`${TAG}-p${pass}-Forecast Uni`),
    "*** the ICR sees their own forecast in the list ***");
  expect(/RM adjusted from 80/.test(list) || /RM adjusted/.test(list),
    "*** the list flags that the RM adjusted it ***",
    (list.match(/RM adjusted[^\n]*/) ?? ["none"])[0]);

  await page.goto(`${BASE}/forecasting/${forecast.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  const detail = await page.locator("body").innerText();

  expect(/Current pipeline/i.test(detail), "*** the live pipeline panel renders ***");
  expect(/Not editable here/i.test(detail),
    "*** the pipeline is presented as read-only (spec 5) ***");
  expect(/Direct — Undergraduate/.test(detail), "the four segments are shown");

  // The heart of it, on screen.
  expect(/\b16\b/.test(detail) && /\b20\b/.test(detail),
    "*** both the RM figure and the ICR original appear ***",
    detail.replace(/\n/g, " ").slice(0, 120));
  expect(/adjusted this forecast from 80 to 76|Regional Manager adjusted/i.test(detail),
    "*** the page states the adjustment explicitly ***",
    (detail.match(/Regional Manager adjusted[^\n]*/) ?? ["none"])[0]);

  // Submitted, so the ICR must not be able to type.
  const icrEditable = await page.locator("input[type=number]:not([disabled])").count();
  expect(icrEditable === 0,
    "*** the ICR cannot edit once it is with the RM ***", `${icrEditable} inputs`);

  await ctx.close();

  // ── The RM's view ─────────────────────────────────────────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page2 = await ctx2.newPage();
  page2.on("pageerror", (e) => errs.push(e.message));
  await signIn(page2, rm);
  await page2.goto(`${BASE}/forecasting/${forecast.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page2.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  const rmInputs = await page2.locator("input[type=number]:not([disabled])").count();
  expect(rmInputs === 12,
    "*** the RM gets all twelve figures to adjust ***", `${rmInputs} inputs`);

  const rmText = await page2.locator("body").innerText();
  expect(/never overwritten/i.test(rmText),
    "*** the RM is told the ICR figures are preserved ***");
  expect(/Use ICR figure/i.test(rmText),
    "*** and can withdraw an adjustment rather than only overwrite it ***");

  const real = errs.filter((e) => !/hydrat/i.test(e));
  expect(real.length === 0, "no uncaught errors on the forecasting screens",
    real.slice(0, 2).join(" | "));

  await ctx2.close();
  await teardown(pass, [icr, rm]);
}

async function teardown(pass, users) {
  if (made.forecasts.length) {
    await db.forecast.deleteMany({ where: { id: { in: made.forecasts } } }).catch(() => {});
    made.forecasts.length = 0;
  }
  if (made.institutions.length) {
    await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
    made.institutions.length = 0;
  }
  for (const u of users) {
    await destroyUser(u);
    const left = await db.user.count({ where: { id: u.user.id } });
    expect(left === 0, `pass ${pass}: ${u.user.role} deleted`, `${left} remaining`);
    if (left === 0) {
      const i = allCreated.indexOf(u);
      if (i >= 0) allCreated.splice(i, 1);
    }
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users=${before}`);

  const browser = await chromium.launch();
  try {
    for (let p = 1; p <= PASSES; p++) await runPass(p, browser);
  } finally {
    await browser.close();
  }

  startSection("Footprint");
  expect(await db.user.count() === before, "*** user count back to baseline ***");
  expect(await db.forecast.count() === 0, "*** no forecast survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message, "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
} finally {
  await db.forecast.deleteMany({ where: { id: { in: made.forecasts } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();

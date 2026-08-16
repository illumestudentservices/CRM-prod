/**
 * Manual walkthrough of every screen, three times, as a hostile tester.
 *
 *   node --import tsx --env-file=.env scripts/qa-breakin-sweep.mjs
 *
 * Signs in through the real login form — email, password, then a TOTP code
 * generated from the account's own secret — and then visits all 32 dashboard
 * routes the way a person would, watching for what a status code alone will not
 * show: React error boundaries, hydration mismatches, uncaught exceptions, and
 * pages that return 200 while rendering nothing.
 *
 * Hydration mismatches are called out separately. One on /students was waved
 * away as a flake twice before it turned out to be dnd-kit's id counter
 * restarting between server and client, so anything in that family is reported
 * rather than filtered.
 *
 * Each pass uses a brand-new account which is destroyed, and confirmed gone,
 * before the next pass begins.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];

const ROUTES = [
  "/dashboard", "/students", "/students/offline", "/institutions", "/markets",
  "/market-intelligence", "/stakeholders", "/recruitment-network",
  "/recruitment-network/partners", "/recruitment-network/campaigns",
  "/recruitment-network/events", "/recruitment-network/performance",
  "/field-operations", "/events", "/tasks", "/recruitment-planning",
  "/activities", "/activity-log", "/analytics", "/reports", "/reports/new",
  "/reports/qbr", "/reports/auto-populate", "/travel", "/risk-compliance",
  "/knowledge", "/whatsapp", "/search", "/hr", "/settings", "/account",
  "/recycle-bin",
];

/** Console noise that is not a defect. Everything else is reported. */
const IGNORABLE =
  /favicon|Download the React DevTools|Fast Refresh|\[Fast Refresh\]|webpack-hmr|net::ERR_ABORTED.*_next\/static/i;

async function signIn(page, email, password, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const submit = page.locator('button[type="submit"]').first();
  await submit.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 15000 }
  );
  await submit.click();
  await page.waitForURL(/verify-2fa/, { timeout: 20000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 25000 });
}

async function runPass(pass, browser) {
  startSection(`PASS ${pass} of ${PASSES} — walking every screen`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  allCreated.push(admin);
  const row = await db.user.findUnique({
    where: { id: admin.user.id },
    select: { twoFactorSecret: true },
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();

  let bucket = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORABLE.test(m.text())) bucket.push(m.text());
  });
  page.on("pageerror", (e) => bucket.push("UNCAUGHT: " + e.message));

  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  expect(!/login|verify-2fa/.test(new URL(page.url()).pathname),
    "signed in through the real login form", page.url());

  const broken = [];
  const hydration = [];
  const blank = [];

  for (const route of ROUTES) {
    bucket = [];
    let status = 0;
    try {
      const res = await page.goto(`${BASE}${route}`, {
        waitUntil: "domcontentloaded", timeout: 40000,
      });
      status = res?.status() ?? 0;
      // Wait for the page's own fetches to finish BEFORE moving on. Navigating
      // away mid-request aborts it, which surfaces as "TypeError: Failed to
      // fetch" and looks exactly like a broken screen. That produced a
      // consistent false positive on /reports for three passes — the error
      // reported against /reports/qbr even named a component from the
      // previously-visited route. qa-breakin-reports.mjs confirmed those
      // screens are clean when allowed to settle.
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
    } catch (e) {
      broken.push(`${route} — navigation failed: ${e.message.slice(0, 90)}`);
      continue;
    }

    const text = (await page.locator("body").innerText().catch(() => "")) ?? "";

    if (status >= 400) broken.push(`${route} — HTTP ${status}`);

    // Next's error boundary and dev overlay both surface as visible text.
    if (/Application error|Unhandled Runtime Error|This page could not be found|Internal Server Error/i.test(text)) {
      broken.push(`${route} — error boundary rendered`);
    }

    const hy = bucket.filter((b) =>
      /hydrat|did not match|Text content does not match|server rendered HTML/i.test(b));
    if (hy.length) hydration.push(`${route} — ${hy[0].slice(0, 130)}`);

    const other = bucket.filter((b) => !hy.includes(b));
    if (other.length) broken.push(`${route} — console: ${other[0].slice(0, 130)}`);

    // A 200 that renders almost nothing is a broken screen wearing a good status.
    if (status === 200 && text.trim().length < 120) {
      blank.push(`${route} — rendered ${text.trim().length} chars`);
    }
  }

  expect(broken.length === 0,
    `*** no screen threw an error (${ROUTES.length} routes walked) ***`,
    broken.slice(0, 6).join(" | "));
  expect(hydration.length === 0,
    "*** no hydration mismatches ***",
    hydration.slice(0, 6).join(" | "));
  expect(blank.length === 0,
    "*** no screen returned 200 while rendering nothing ***",
    blank.slice(0, 6).join(" | "));

  if (broken.length) {
    process.stdout.write("\n     BROKEN SCREENS:\n");
    for (const b of broken) process.stdout.write(`       · ${b}\n`);
  }
  if (hydration.length) {
    process.stdout.write("\n     HYDRATION:\n");
    for (const h of hydration) process.stdout.write(`       · ${h}\n`);
  }
  if (blank.length) {
    process.stdout.write("\n     BLANK:\n");
    for (const b of blank) process.stdout.write(`       · ${b}\n`);
  }

  await ctx.close();

  await destroyUser(admin);
  const left = await db.user.count({ where: { id: admin.user.id } });
  expect(left === 0, `pass ${pass}: disposable account deleted`, `${left} remaining`);
  if (left === 0) {
    const i = allCreated.indexOf(admin);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users before: ${before}`);

  const browser = await chromium.launch();
  try {
    for (let p = 1; p <= PASSES; p++) await runPass(p, browser);
  } finally {
    await browser.close();
  }

  startSection("Footprint");
  expect(await db.user.count() === before,
    "*** user count back to baseline — no account survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message));
} finally {
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();

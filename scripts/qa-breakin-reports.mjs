/**
 * Are the /reports "Failed to fetch" errors real, or an artefact of the sweep?
 *
 *   node --import tsx --env-file=.env scripts/qa-breakin-reports.mjs
 *
 * qa-breakin-sweep.mjs reported "TypeError: Failed to fetch" on /reports and
 * /reports/qbr on all three passes. That is suspicious rather than conclusive:
 * the sweep moves to the next route after 1.2s, and navigating away aborts any
 * request still in flight, which surfaces as exactly this error. The give-away
 * is that the error blamed on /reports/qbr names `fetchInstitutions` in a
 * component called `NewRep` — that belongs to /reports/new, the route visited
 * immediately before.
 *
 * So: sit on each report screen, let the network settle, and record every
 * request the page actually makes and what came back. A real failure shows a
 * non-2xx response or a request that never completes while the page is idle.
 */

import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = 3;
const allCreated = [];
const SCREENS = ["/reports", "/reports/new", "/reports/qbr", "/reports/auto-populate"];

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
  startSection(`PASS ${pass} — report screens, network settled`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  allCreated.push(admin);
  const row = await db.user.findUnique({
    where: { id: admin.user.id }, select: { twoFactorSecret: true },
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  await signIn(page, admin.email, admin.password, row.twoFactorSecret);
  ok("signed in through the real login form");

  for (const screen of SCREENS) {
    const failedReq = [];
    const badStatus = [];
    const consoleErrs = [];

    const onReqFailed = (r) => failedReq.push(`${r.method()} ${new URL(r.url()).pathname} — ${r.failure()?.errorText ?? "?"}`);
    const onResponse = (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") && r.status() >= 400) {
        badStatus.push(`${u.pathname} -> ${r.status()}`);
      }
    };
    const onConsole = (m) => {
      if (m.type() === "error" && !/favicon|DevTools|Fast Refresh/i.test(m.text())) {
        consoleErrs.push(m.text().split("\n")[0].slice(0, 120));
      }
    };

    page.on("requestfailed", onReqFailed);
    page.on("response", onResponse);
    page.on("console", onConsole);

    await page.goto(`${BASE}${screen}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Let every client fetch finish while we are still ON the page — this is
    // the whole point: nothing is aborted by navigating away.
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);

    page.off("requestfailed", onReqFailed);
    page.off("response", onResponse);
    page.off("console", onConsole);

    expect(badStatus.length === 0, `${screen}: every API call returned OK`,
      badStatus.join(", "));
    expect(failedReq.length === 0, `${screen}: no request failed while the page sat idle`,
      failedReq.join(", "));
    expect(consoleErrs.length === 0, `${screen}: no console errors when left to settle`,
      consoleErrs.join(" | "));
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
  expect(await db.user.count() === before, "*** user count back to baseline ***");
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

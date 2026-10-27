/**
 * Verifies ICR is barred from Recruitment Network → Network Performance while
 * keeping Recruitment Partners, and that a management role (REGIONAL_MANAGER)
 * still has Network Performance.
 *
 *   npx tsx --env-file=.env.local scripts/qa-network-performance-icr.mjs
 *
 * Disposable users, browser login, torn down in `finally`.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const PERF = "/recruitment-network/performance";
const PARTNERS = "/recruitment-network/partners";

let browser, icr, rm;

async function ctxFor(login) {
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await bctx.addCookies(
    [...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  return bctx;
}

/** Status + location without following redirects. */
async function head(reqCtx, path) {
  const res = await reqCtx.get(`${BROWSER_BASE}${path}`, { maxRedirects: 0 });
  return { status: res.status(), location: res.headers()["location"] ?? "" };
}

try {
  browser = await chromium.launch();

  // ── ICR ──────────────────────────────────────────────────────────────
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const icrCtx = await ctxFor(icr);
  const icrReq = icrCtx.request;

  startSection("ICR — barred from Network Performance, keeps Partners");
  const perf = await head(icrReq, PERF);
  expect(perf.status === 307 || perf.status === 302, `ICR /performance redirects (got ${perf.status})`, String(perf.status));
  expect(/\/recruitment-network\/partners/.test(perf.location), "ICR redirected to Partners", perf.location);

  const part = await head(icrReq, PARTNERS);
  expect(part.status === 200, `ICR can still open Partners (${part.status})`, String(part.status));

  // Tab hidden in the layout for ICR.
  const icrPage = await icrCtx.newPage();
  await icrPage.goto(`${BROWSER_BASE}${PARTNERS}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await icrPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  expect((await icrPage.locator(`a[href="${PARTNERS}"]`).count()) >= 1, "ICR sees the Partners tab");
  expect((await icrPage.locator(`a[href="${PERF}"]`).count()) === 0, "ICR does NOT see the Network Performance tab");

  // ── REGIONAL_MANAGER (control) ────────────────────────────────────────
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const rmCtx = await ctxFor(rm);
  const rmReq = rmCtx.request;

  startSection("REGIONAL_MANAGER — keeps Network Performance");
  const rmPerf = await head(rmReq, PERF);
  expect(rmPerf.status === 200, `RM can open Network Performance (${rmPerf.status})`, String(rmPerf.status));

  const rmPage = await rmCtx.newPage();
  await rmPage.goto(`${BROWSER_BASE}${PERF}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await rmPage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  expect((await rmPage.locator(`a[href="${PERF}"]`).count()) >= 1, "RM sees the Network Performance tab");
  expect((await rmPage.getByText("Agent Rankings", { exact: false }).count()) >= 1, "RM sees the performance content");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

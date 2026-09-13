/**
 * The detail pages the page sweep skips.
 *
 *   npx tsx --env-file=.env scripts/qa-detail-routes.mjs
 *
 * `qa-page-sweep.mjs` walks every `page.tsx` but cannot visit a `[id]` route
 * without an id, so it reports six as skipped and they have never been opened
 * by any check. Each is a real screen someone reaches by clicking a row.
 *
 * This finds a genuine id for each from the database and opens it, watching for
 * a 5xx, an error boundary, or a page that renders nothing. Where there is no
 * row to point at, it says so rather than passing quietly — an untested page
 * and a passing page must not look the same.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, ok, fail, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, browser;

/** route template → how to find one id for it. */
const ROUTES = [
  { path: (id) => `/events/${id}`, find: () => db.event.findFirst({ where: { deletedAt: null }, select: { id: true } }), name: "/events/[id]" },
  { path: (id) => `/forecasting/${id}`, find: () => db.forecast.findFirst({ select: { id: true } }), name: "/forecasting/[id]" },
  { path: (id) => `/hr/employees/${id}`, find: () => db.employee.findFirst({ select: { id: true } }), name: "/hr/employees/[id]" },
  { path: (id) => `/icr-transition/${id}`, find: () => db.transitionReport.findFirst({ select: { id: true } }), name: "/icr-transition/[id]" },
  { path: (id) => `/markets/${id}`, find: () => db.market.findFirst({ select: { id: true } }), name: "/markets/[id]" },
  { path: (id) => `/recruitment-planning/${id}`, find: () => db.quarterlyRecruitmentPlan.findFirst({ select: { id: true } }), name: "/recruitment-planning/[id]" },
];

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();

  startSection("detail pages the sweep cannot reach");

  for (const route of ROUTES) {
    let row = null;
    try { row = await route.find(); } catch { /* model may not exist */ }

    if (!row) {
      // Not a pass. Nothing on the mirror to point the page at, so the page is
      // still untested and saying otherwise would be a lie.
      fail(`${route.name}: NO ROW to open it with`, "still untested — seed one to cover this page");
      continue;
    }

    const serverErrors = [];
    const pageErrors = [];
    const onResponse = (r) => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); };
    const onPageError = (e) => pageErrors.push(String(e).slice(0, 120));
    page.on("response", onResponse);
    page.on("pageerror", onPageError);

    const url = `${BROWSER_BASE}${route.path(row.id)}`;
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null);
    await page.waitForTimeout(2500);

    const status = res?.status() ?? 0;
    const body = await page.locator("body").innerText().catch(() => "");
    const boundary = /something went wrong|application error|unhandled|digest:/i.test(body);
    const landed = new URL(page.url()).pathname;

    page.off("response", onResponse);
    page.off("pageerror", onPageError);

    const problems = [];
    if (status >= 400) problems.push(`HTTP ${status}`);
    if (boundary) problems.push("error boundary");
    if (serverErrors.length) problems.push(`5xx: ${serverErrors.join(", ")}`);
    if (pageErrors.length) problems.push(`page error: ${pageErrors[0]}`);
    if (body.trim().length < 200) problems.push("rendered almost nothing");

    if (problems.length) {
      fail(`${route.name}`, `${problems.join(" | ")} (landed on ${landed})`);
    } else {
      ok(`${route.name} — ${status}, ${body.trim().length} chars${landed !== new URL(url).pathname ? `, redirected to ${landed}` : ""}`);
    }
  }
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

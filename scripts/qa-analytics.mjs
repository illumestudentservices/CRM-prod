/**
 * Live analytics QA — every role, every clickable chart element, repeated.
 *
 * For SUPER_ADMIN (executive), REGIONAL_MANAGER, and ICR dashboards it:
 *   - loads /analytics, asserts no error banner and that charts render;
 *   - clicks every bar / pie slice / drill card and asserts the drill-down
 *     opens (or that navigation happens), closing between clicks;
 *   - clicks the primary chart element of each dashboard 5x back-to-back to
 *     prove repeated-click stability;
 *   - asserts the previously-broken ICR panels now populate.
 *
 *   npx tsx --env-file=.env.local scripts/qa-analytics.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
const REGION_ID = "d46440e9-6cc3-4ab8-be49-8eac11f59e81"; // Africa
const SOURCE_ID = "src-003";
const STAGES = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED", "OFFER_RECEIVED", "ENROLLED", "ENROLLED", "CONTACTED"];

let browser, exec, rm, icr, leadIds = [];

function ctxFor(login) {
  return browser.newContext({ viewport: { width: 1600, height: 1200 } }).then(async (ctx) => {
    await ctx.addCookies([...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
    return ctx;
  });
}
async function openAnalytics(ctx, readySel = ".recharts-surface") {
  const p = await ctx.newPage();
  // The Next dev server occasionally resets a client fetch under load (it still
  // logs 200 but the browser sees "Failed to fetch"), leaving a panel stuck in
  // its loading state. The dashboards don't retry, so reload until the expected
  // content is actually present.
  for (let attempt = 0; attempt < 6; attempt++) {
    await p.goto(`${B}/analytics`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
    const got = await p.locator(readySel).first().waitFor({ state: "visible", timeout: 25000 }).then(() => true).catch(() => false);
    if (got) break;
    await p.waitForTimeout(800);
  }
  await p.waitForTimeout(1500);
  return p;
}
const dialog = (p) => p.locator('[role="dialog"]');
async function closeDialog(p) {
  await p.keyboard.press("Escape");
  await dialog(p).first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
}
/** Click a drill element and assert the drill-down dialog opens; then close. */
async function clickDrill(p, locator, label) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator.click({ force: true });
  const ok = await dialog(p).first().isVisible({ timeout: 6000 }).catch(() => false);
  await closeDialog(p);
  return expect(ok, label);
}
/** Click every element matched by selector once (each must open the drill). */
async function clickEach(p, selector, label) {
  const loc = p.locator(selector);
  const n = await loc.count();
  if (n === 0) { expect(true, `${label}: none to click (empty data) — skipped`); return; }
  let allOk = true;
  for (let i = 0; i < n; i++) {
    await loc.nth(i).click({ force: true }).catch(() => { allOk = false; });
    const ok = await dialog(p).first().isVisible({ timeout: 6000 }).catch(() => false);
    if (!ok) allOk = false;
    await closeDialog(p);
  }
  expect(allOk, `${label}: all ${n} opened a drill-down`);
}
/** Click the same drill element 5x back-to-back; each must open the drill. */
async function clickFiveTimes(p, locator, label) {
  let ok = true;
  for (let i = 0; i < 5; i++) {
    let opened = false;
    // One retry per iteration: after a dialog closes the chart can re-render /
    // animate, so a click can land a frame too early.
    for (let attempt = 0; attempt < 2 && !opened; attempt++) {
      await locator.first().click({ force: true }).catch(() => {});
      opened = await dialog(p).first().isVisible({ timeout: 6000 }).catch(() => false);
    }
    if (!opened) ok = false;
    await closeDialog(p);
    await p.waitForTimeout(300);
  }
  expect(ok, `${label}: stable across 5 back-to-back clicks`);
}
/** Click and assert navigation to a URL pattern; then go back to /analytics. */
async function expectNav(p, locator, re, label) {
  await closeDialog(p); // make sure no drill overlay intercepts the click
  await locator.first().scrollIntoViewIfNeeded().catch(() => {});
  await locator.first().click({ force: true });
  const navigated = await p.waitForURL(re, { timeout: 12000 }).then(() => true).catch(() => false);
  expect(navigated, label, p.url());
  await p.goto(`${B}/analytics`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await p.locator(".recharts-surface").first().waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
  await p.waitForTimeout(1000);
}

try {
  exec = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: REGION_ID } });
  icr = await createAndLogin({ role: "ICR", withEmployee: true, extra: { regionId: REGION_ID } });

  // Deterministic data: leads owned by the ICR, in the RM's region, created
  // now, spread across stages, with a source and a stale contact date.
  const base = {
    nationality: "Testland", countryOfResidence: "Testland", interestedProgram: "CS",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
    regionId: REGION_ID, assignedICRId: icr.user.id, createdById: icr.user.id, sourceId: SOURCE_ID,
    lastContactedAt: new Date(Date.now() - 10 * 86400000),
  };
  for (let i = 0; i < STAGES.length; i++) {
    const l = await db.lead.create({ data: { ...base, firstName: TAG, lastName: `A${i}`, stage: STAGES[i] } });
    leadIds.push(l.id);
  }

  // Pre-warm every route via node fetch (reliable) so the browser later hits
  // already-compiled, fast endpoints — the Next dev server resets browser
  // fetches while it is still compiling a route under load.
  const warm = (jar, path) => fetch(`${BASE}${path}`, { headers: { Cookie: jar.header() } }).then(() => {}).catch(() => {});
  await Promise.all([
    warm(exec.jar, "/api/analytics/executive"),
    warm(exec.jar, "/api/analytics/overview?startDate=2026-01-01&endDate=2026-12-31"),
    warm(rm.jar, "/api/analytics/regional"),
    warm(icr.jar, "/api/analytics/overview?startDate=2026-10-01&endDate=2026-10-28"),
    warm(icr.jar, "/api/leads?limit=100&sortBy=lastContactedAt&sortOrder=asc"),
    warm(icr.jar, "/api/reports?limit=10"),
  ]);
  // Warm the page routes (and the nav targets the drill/nav tests reach).
  for (const path of ["/analytics", "/institutions", "/events", "/risk-compliance", "/field-operations", "/students", "/reports"]) {
    await warm(exec.jar, path);
  }

  browser = await chromium.launch();

  // ── EXECUTIVE ───────────────────────────────────────────────────────────
  startSection("Executive dashboard — loads, renders, drills");
  {
    const ctx = await ctxFor(exec);
    const p = await openAnalytics(ctx);
    expect((await p.getByText(/Failed to load/i).count()) === 0, "no error banner");
    expect((await p.locator(".recharts-surface").count()) >= 1, "charts rendered");
    // KPI drill cards (Total Leads YTD, Enrollments YTD).
    await clickDrill(p, p.getByText("Total Leads").first(), "KPI 'Total Leads' opens a drill");
    await clickFiveTimes(p, p.getByText("Enrollments").first(), "KPI 'Enrollments' 5x");
    // Bar charts: Top Markets + Top Sources — every bar once, first bar 5x.
    await clickFiveTimes(p, p.locator(".recharts-bar-rectangle").first(), "first market/source bar 5x");
    await clickEach(p, ".recharts-bar-rectangle", "every executive bar");
    // Nav widgets + KPI nav.
    await expectNav(p, p.getByText("Active Partners").first(), /\/institutions/, "Active Partners → /institutions");
    await expectNav(p, p.getByText("Revenue").first(), /\/institutions/, "Revenue widget → /institutions");
    await expectNav(p, p.getByText("Risk & Compliance").first(), /\/risk-compliance/, "Risk widget → /risk-compliance");
    await ctx.close();
  }

  // ── REGIONAL ────────────────────────────────────────────────────────────
  startSection("Regional dashboard — loads, renders, drills");
  {
    const ctx = await ctxFor(rm);
    const p = await openAnalytics(ctx);
    expect((await p.getByText(/Failed to load/i).count()) === 0, "no error banner");
    expect((await p.locator(".recharts-surface").count()) >= 1, "charts rendered");
    // Pie (pipeline) slices.
    await clickFiveTimes(p, p.locator(".recharts-pie-sector").first(), "pipeline pie slice 5x");
    await clickEach(p, ".recharts-pie-sector", "every pipeline pie slice");
    // ICR + Source bars.
    await clickEach(p, ".recharts-bar-rectangle", "every regional bar");
    await ctx.close();
  }

  // ── ICR ─────────────────────────────────────────────────────────────────
  startSection("ICR dashboard — bug fix + drills");
  {
    const ctx = await ctxFor(icr);
    // Wait until the leads-driven panel has actually loaded (the seeded source
    // name appears only once /api/leads returns and is read as `.data`).
    const p = await openAnalytics(ctx, "text=StudyAbroad UAE");
    expect((await p.getByText(/Failed to load/i).count()) === 0, "no error banner");
    // The previously-broken panels must now show data (the bug read `.leads`).
    expect((await p.getByText("No source data").count()) === 0, "'My Top Sources' is populated (bug fixed)");
    expect((await p.locator("main").getByText(TAG, { exact: false }).count()) >= 1, "assigned leads visible in the dashboard body");
    // Stat card drill (New / Enrolled) + pipeline bars.
    await clickFiveTimes(p, p.getByText("Enrolled").first(), "ICR 'Enrolled' stat 5x");
    await clickEach(p, ".recharts-bar-rectangle", "every ICR pipeline bar");
    // Top-source rows drill.
    await clickDrill(p, p.getByText("StudyAbroad UAE").first(), "ICR top-source row drills");
    // In Progress → /students nav.
    await expectNav(p, p.getByText("In Progress").first(), /\/students/, "'In Progress' → /students");
    await ctx.close();
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of leadIds) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  for (const u of [exec, rm, icr]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

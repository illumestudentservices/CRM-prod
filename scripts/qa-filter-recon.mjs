/**
 * RECON PASS over every filter surface in the app.
 *
 *   npx tsx --env-file=.env scripts/qa-filter-recon.mjs
 *
 * This does NOT assert correctness. It walks each list page as a SUPER_ADMIN and
 * reports what is actually on screen: every combobox and its options, every
 * search box, every status tab, and the number of data rows rendered. The point
 * is to find filters that are MISSING, EMPTY or DEAD before writing assertions
 * against them — a filter that renders no options cannot be tested, and a page
 * whose table is empty makes every filter assertion pass trivially.
 *
 * Read-only: one disposable SUPER_ADMIN, destroyed in `finally`. No fixtures.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");

// Pages that carry at least one filter, search box or status tab.
const PAGES = [
  "/students",
  "/institutions",
  "/tasks",
  "/events",
  "/recruitment-network/partners",
  "/recruitment-planning",
  "/recruitment-planning/events",
  "/recruitment-planning/campaigns",
  "/markets",
  "/knowledge",
  "/risk-compliance",
  "/travel",
  "/activity-log",
  "/activities",
  "/stakeholders",
  "/recycle-bin",
  "/analytics",
  "/hr",
];

let ctx, browser;
const report = [];

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  for (const route of PAGES) {
    const entry = { route, ok: true, rows: 0, combos: [], searches: [], tabs: [], notes: [] };
    pageErrors.length = 0;
    try {
      const res = await page.goto(`${BROWSER_BASE}${route}`, {
        waitUntil: "domcontentloaded", timeout: 60000,
      });
      entry.status = res?.status() ?? 0;
      entry.finalUrl = new URL(page.url()).pathname;

      // Wait for loading skeletons to clear rather than a flat sleep — Turbopack
      // compiles the route on first request, so a fixed wait reports an empty
      // page on a cold server and a full one on a warm server.
      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
      await page
        .waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0,
          { timeout: 20000 })
        .catch(() => entry.notes.push("skeletons still visible after 20s"));

      // Data rows. `td[colspan]` is the "no results" row — counting it makes an
      // empty table look like it has one record.
      entry.rows = await page.locator("table tbody tr:not(:has(td[colspan]))").count();
      if (entry.rows === 0) {
        const cards = await page.locator('[data-slot="card"], .grid > a[href]').count();
        if (cards > 0) { entry.rows = cards; entry.notes.push(`card layout (${cards})`); }
      }

      // Every combobox trigger and the options behind it.
      const combos = page.locator('button[role="combobox"]');
      const n = await combos.count();
      for (let i = 0; i < n; i++) {
        const trigger = combos.nth(i);
        const label = (await trigger.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        const aria = await trigger.getAttribute("aria-label").catch(() => null);
        let options = [];
        try {
          await trigger.click({ timeout: 5000 });
          await page.waitForTimeout(450);
          options = await page.getByRole("option").allTextContents();
          await page.keyboard.press("Escape");
          await page.waitForTimeout(200);
        } catch { /* a disabled or detached trigger */ }
        entry.combos.push({ label: aria ?? label, count: options.length, options });
      }

      // Search / text filter inputs.
      const inputs = page.locator('input[type="search"], input[placeholder*="earch" i], input[placeholder*="ilter" i]');
      for (let i = 0; i < await inputs.count(); i++) {
        entry.searches.push(await inputs.nth(i).getAttribute("placeholder"));
      }

      // Status tabs / segmented controls.
      const tabs = page.locator('[role="tab"], nav a[href*="status="], a[href*="type="]');
      const seen = new Set();
      for (let i = 0; i < Math.min(await tabs.count(), 25); i++) {
        const t = (await tabs.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (t && !seen.has(t)) { seen.add(t); entry.tabs.push(t); }
      }

      if (pageErrors.length) entry.notes.push(`JS ERROR: ${pageErrors[0].slice(0, 120)}`);
      await page.screenshot({
        path: `screenshots/recon-${route.replace(/\//g, "_")}.png`,
      });
    } catch (e) {
      entry.ok = false;
      entry.notes.push(`FAILED: ${e.message.slice(0, 160)}`);
    }
    report.push(entry);

    // Print as we go, so a crash mid-sweep still leaves usable output.
    const c = entry.combos.map((x) => `${x.label || "?"}[${x.count}]`).join(" ");
    console.log(
      `\n${route}  status=${entry.status ?? "?"}  rows=${entry.rows}` +
      (entry.finalUrl !== route ? `  -> ${entry.finalUrl}` : "")
    );
    if (entry.searches.length) console.log(`    search : ${entry.searches.join(" | ")}`);
    if (entry.tabs.length)     console.log(`    tabs   : ${entry.tabs.join(" | ")}`);
    if (c)                     console.log(`    combos : ${c}`);
    for (const combo of entry.combos) {
      if (combo.count === 0) console.log(`      !! "${combo.label}" rendered ZERO options`);
    }
    for (const note of entry.notes) console.log(`    note   : ${note}`);
  }

  // ── Roll-up ────────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(72)}\n  RECON SUMMARY\n${"═".repeat(72)}`);
  const empties = [], noRows = [], broken = [];
  for (const e of report) {
    if (!e.ok || (e.status && e.status >= 400)) broken.push(e.route);
    if (e.rows === 0) noRows.push(e.route);
    for (const c of e.combos) if (c.count === 0) empties.push(`${e.route} → "${c.label}"`);
  }
  console.log(`  pages walked           : ${report.length}`);
  console.log(`  total filter controls  : ${report.reduce((s, e) => s + e.combos.length + e.searches.length, 0)}`);
  if (broken.length)  console.log(`\n  BROKEN PAGES (${broken.length}):\n    ${broken.join("\n    ")}`);
  if (noRows.length)  console.log(`\n  PAGES WITH ZERO ROWS — filters here cannot be meaningfully tested (${noRows.length}):\n    ${noRows.join("\n    ")}`);
  if (empties.length) console.log(`\n  DROPDOWNS WITH ZERO OPTIONS (${empties.length}):\n    ${empties.join("\n    ")}`);
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
}

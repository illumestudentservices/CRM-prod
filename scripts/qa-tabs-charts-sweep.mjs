/**
 * Every tab and every chart in the dashboard, three times over.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-tabs-charts-sweep.mjs [passes]
 *
 * ★ WHY THREE PASSES.
 *
 * Twice this week a check reported a working feature broken and a broken one
 * working, and both times the cause was timing rather than code: a dev server
 * serving a stale module, a chart judged before its data landed, a table read
 * while skeleton rows were still up. A single green run proves less than it
 * appears to.
 *
 * So each route is visited N times (three by default) and a problem counts if
 * it appears in ANY pass. A failure in one of three is not noise to be
 * rounded away — it is a thing that happens to one user in three.
 *
 * ★ WHAT IT ACTUALLY DOES.
 *
 * For every page under app/(dashboard):
 *   - loads it and listens for uncaught page errors
 *   - counts charts, and checks each one drew something rather than an empty
 *     frame, because an axis with no series still renders a chart
 *   - finds every tab, CLICKS each one, and checks the panel behind it
 *     renders without throwing — the Performance Reviews tab took the whole
 *     HR page down for a day and no suite noticed, because none of them ever
 *     pressed a tab
 */
import { readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";
const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = Number(process.argv[2] ?? 3) || 3;

// ── Routes, from disk, so a new page cannot be missed ────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}
const ROOT = join(process.cwd(), "app", "(dashboard)");
const routes = walk(ROOT)
  .map((f) => {
    const rel = f.split(`(dashboard)${sep}`)[1].replace(`${sep}page.tsx`, "").replace("page.tsx", "");
    return rel.split(sep).filter((s) => s && !s.startsWith("_"));
  })
  // Dynamic segments need a real id; the page sweep covers those. This one is
  // about tabs and charts, which live on the list pages.
  .filter((segs) => !segs.some((s) => s.startsWith("[")))
  .map((segs) => "/" + segs.join("/"))
  .filter((r, i, a) => a.indexOf(r) === i)
  .sort();

const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
const sec = await db.user.findUnique({
  where: { id: admin.user.id }, select: { twoFactorSecret: true },
});

/** route -> { charts, emptyCharts, tabs, problems: Set } */
const results = new Map();
const note = (route, msg) => {
  const r = results.get(route);
  if (r) r.problems.add(msg);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();

let errors = [];
page.on("pageerror", (e) => errors.push(e.message.split(String.fromCharCode(10))[0].slice(0, 110)));

async function signIn() {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(admin.email);
  await page.locator('input[type="password"]').fill(admin.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(sec.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((x) => !/verify-2fa|login/.test(x.pathname), { timeout: 30000 });
}

/** A chart that drew data, not just axes. */
async function chartStats(route) {
  const total = await page.locator("svg.recharts-surface").count().catch(() => 0);
  let empty = 0;
  for (let i = 0; i < total; i++) {
    const marks = await page.locator("svg.recharts-surface").nth(i)
      .locator(".recharts-bar-rectangle, .recharts-line-curve, .recharts-area-area, .recharts-pie-sector, .recharts-sector, .recharts-radial-bar-sector")
      .count().catch(() => 0);
    if (marks === 0) empty++;
  }
  /**
   * A chart with no series is only a problem when nothing SAYS so. Several
   * cards here render "No training data" instead of a chart when there is
   * none, which is correct behaviour and must not be reported as a fault.
   */
  if (empty > 0) {
    const saysSo = await page.getByText(/no .*(data|records|results)/i).count().catch(() => 0);
    if (saysSo > 0) note(route, `${empty} chart(s) drew nothing, but the page says so — not a fault`);
    else note(route, `${empty} chart(s) drew an empty frame with no explanation`);
  }
  return { total, empty };
}

try {
  await signIn();
  console.log(`signed in — ${routes.length} route(s), ${PASSES} pass(es)\n`);
  for (const r of routes) results.set(r, { charts: 0, emptyCharts: 0, tabs: 0, problems: new Set() });

  for (let pass = 1; pass <= PASSES; pass++) {
    console.log(`── pass ${pass} of ${PASSES} ${"─".repeat(40)}`);
    for (const route of routes) {
      const rec = results.get(route);
      errors = [];
      try {
        const res = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 60000 });
        if (res && res.status() >= 400) note(route, `HTTP ${res.status()} on load`);
        await page.waitForTimeout(4500);

        if (errors.length) note(route, `page error on load: ${errors[0]}`);

        const c = await chartStats(route);
        rec.charts = Math.max(rec.charts, c.total);
        rec.emptyCharts = Math.max(rec.emptyCharts, c.empty);

        // ── Tabs ──────────────────────────────────────────────────────────
        const tabs = page.getByRole("tab");
        const tabCount = await tabs.count();
        rec.tabs = Math.max(rec.tabs, tabCount);

        for (let i = 0; i < tabCount; i++) {
          const label = (await tabs.nth(i).innerText().catch(() => `#${i}`)).trim().slice(0, 28);
          errors = [];
          try {
            await tabs.nth(i).click({ timeout: 10000 });
            await page.waitForTimeout(1800);
          } catch (e) {
            note(route, `tab "${label}" could not be clicked: ${String(e.message).slice(0, 50)}`);
            continue;
          }
          if (errors.length) note(route, `tab "${label}" threw: ${errors[0]}`);

          /**
           * The ACTIVE panel, not the last one.
           *
           * Radix renders every tabpanel and marks the inactive ones hidden
           * with no text, so .last() read a hidden panel and reported twenty
           * working tabs across five pages as "selects but its panel is
           * empty". Twenty false alarms on screens in daily use.
           */
          const panel = await page.locator('[role="tabpanel"][data-state="active"]')
            .first().innerText().catch(() => "");
          if (panel.trim().length === 0) {
            note(route, `tab "${label}" selects but its panel is empty`);
          }
          const stillThere = await page.getByRole("tab").count();
          if (stillThere === 0) {
            note(route, `tab "${label}" destroyed the tab bar — the page unmounted`);
            break;
          }
        }
      } catch (e) {
        note(route, `threw: ${String(e.message).slice(0, 70)}`);
      }
    }
    console.log(`   done`);
  }
} catch (e) {
  console.error("\nFATAL:", e.message);
} finally {
  await ctx.close();
  await browser.close();
  await destroyUser(admin);
  await db.$disconnect();

  const bad = [...results.entries()].filter(([, r]) => r.problems.size > 0);
  const emptyCharts = [...results.entries()].filter(([, r]) => r.emptyCharts > 0);

  console.log("\n" + "=".repeat(72));
  console.log(`  routes checked:        ${results.size}  (${PASSES} passes each)`);
  console.log(`  charts found:          ${[...results.values()].reduce((a, r) => a + r.charts, 0)}`);
  console.log(`  tabs clicked:          ${[...results.values()].reduce((a, r) => a + r.tabs, 0)} per pass`);
  console.log(`  routes with problems:  ${bad.length}`);
  console.log(`  routes with an EMPTY chart: ${emptyCharts.length}`);

  if (bad.length) {
    console.log("\n  PROBLEMS (appeared in at least one pass):");
    for (const [route, r] of bad) {
      console.log(`\n    ${route}`);
      for (const p of r.problems) console.log(`      - ${p}`);
    }
  }
  if (emptyCharts.length) {
    console.log("\n  CHARTS THAT DREW NO DATA (a frame with no series):");
    for (const [route, r] of emptyCharts) {
      console.log(`    ${route.padEnd(34)} ${r.emptyCharts} of ${r.charts}`);
    }
  }
  console.log("=".repeat(72));
  process.exit(bad.length ? 1 : 0);
}

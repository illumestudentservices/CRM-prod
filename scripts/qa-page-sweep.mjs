/**
 * Drives every dashboard page in a real browser and reports what actually broke.
 *
 * Enumerates app/(dashboard)/**\/page.tsx from disk, so a new page cannot be
 * missed. For each route it records: HTTP status, uncaught page errors, console
 * errors, Next.js error-overlay text, failed network requests, visible
 * error/empty states, and how many charts rendered.
 *
 * Charts matter here: the analytics bug on 2026-08-12 was a chart and KPI showing
 * zero while the underlying row existed, so "page returned 200" proves very
 * little. This counts rendered <svg class="recharts-surface"> elements and
 * distinguishes "chart drew data" from "chart drew an empty axis".
 *
 * Dynamic segments are filled from the database, so /students/[id] is exercised
 * against a real record rather than skipped.
 *
 * Usage:
 *   node --env-file=.env scripts/qa-page-sweep.mjs
 *   BASE_URL=https://illumestudentservices.cloud ALLOW_PROD_QA=yes-i-mean-it \
 *     node --env-file=.env scripts/qa-page-sweep.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

// ── Enumerate dashboard routes ───────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}

const ROOT = join(process.cwd(), "app", "(dashboard)");
const rawRoutes = walk(ROOT).map((f) => {
  const rel = f.split(`(dashboard)${sep}`)[1].replace(`${sep}page.tsx`, "").replace("page.tsx", "");
  const segs = rel.split(sep).filter((s) => s && !s.startsWith("_"));
  return { file: f, segs };
});

// ── Real ids for dynamic segments ────────────────────────────────────────────
const ids = {};
{
  const [lead, inst, report, market, plan, event, partner] = await Promise.all([
    db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.monthlyReport.findFirst({ where: { deletedAt: null }, select: { id: true } }),
    db.market.findFirst({ select: { id: true } }).catch(() => null),
    db.quarterlyRecruitmentPlan.findFirst({ select: { id: true } }).catch(() => null),
    db.recruitmentEvent?.findFirst?.({ select: { id: true } }).catch(() => null) ?? null,
    db.recruitmentPartner.findFirst({ where: { deletedAt: null }, select: { id: true } }).catch(() => null),
  ]);
  Object.assign(ids, {
    students: lead?.id, institutions: inst?.id, reports: report?.id,
    "market-intelligence": market?.id, "recruitment-planning": plan?.id,
    events: event?.id, partners: partner?.id,
  });
}

/** Fill a [param] segment using the id belonging to the closest known parent. */
function resolve(segs) {
  const out = [];
  let skipped = null;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.startsWith("[")) { out.push(s); continue; }
    const parent = segs.slice(0, i).reverse().find((x) => ids[x]);
    const id = parent ? ids[parent] : undefined;
    if (!id) { skipped = `no id for parent of ${s}`; break; }
    out.push(id);
  }
  return { path: "/" + out.join("/"), skipped };
}

const routes = rawRoutes.map((r) => ({ ...r, ...resolve(r.segs) }));

// ── Drive ────────────────────────────────────────────────────────────────────
const IGNORE_CONSOLE = [
  /Download the React DevTools/i,
  /DeprecationWarning/i,
  /favicon/i,
  /Each child in a list should have a unique "key"/i, // noisy, not a failure
];

let ctx;
const results = [];
try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const host = new URL(BASE).hostname;
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: host, path: "/" }))
  );

  console.log(`page sweep target : ${BASE}`);
  console.log(`routes discovered : ${routes.length}\n`);

  for (const r of routes) {
    if (r.skipped) {
      results.push({ path: "/" + r.segs.join("/"), status: "SKIP", note: r.skipped, charts: 0, errors: [] });
      console.log(`  SKIP  /${r.segs.join("/")}  (${r.skipped})`);
      continue;
    }
    const page = await bctx.newPage();
    const errors = [];
    const failedReqs = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (IGNORE_CONSOLE.some((re) => re.test(t))) return;
      errors.push(`console: ${t.slice(0, 160)}`);
    });
    page.on("requestfailed", (req) => failedReqs.push(`${req.method()} ${req.url().replace(BASE, "")}`));
    page.on("response", (res) => {
      const u = res.url();
      if (u.includes("/api/") && res.status() >= 500) failedReqs.push(`${res.status()} ${u.replace(BASE, "")}`);
    });

    let status = 0;
    try {
      const resp = await page.goto(`${BASE}${r.path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = resp?.status() ?? 0;
      // A fixed 3.5s wait reported charts=0 on /analytics, which renders 5 of them:
      // at 2s the page was still showing 32 loading skeletons. Wait for the
      // skeletons to clear instead of guessing, with a ceiling so a genuinely
      // stuck page still gets recorded rather than hanging the sweep.
      await page.waitForFunction(
        () => document.querySelectorAll(".animate-pulse").length === 0,
        { timeout: 20000 }
      ).catch(() => errors.push("still showing loading skeletons after 20s"));
      await page.waitForTimeout(1500); // let recharts paint after data lands
    } catch (e) {
      errors.push(`navigation: ${e.message.slice(0, 120)}`);
    }

    // Next.js dev error overlay / thrown boundary
    const overlay = await page.locator("nextjs-portal, [data-nextjs-dialog], text=/Unhandled Runtime Error|Application error/i").count().catch(() => 0);
    // Charts: recharts renders an <svg class="recharts-surface">
    const charts = await page.locator("svg.recharts-surface").count().catch(() => 0);
    let chartsWithData = 0;
    for (let i = 0; i < charts; i++) {
      const n = await page.locator("svg.recharts-surface").nth(i)
        .locator("path.recharts-bar-rectangle, .recharts-bar-rectangle, path.recharts-line-curve, path.recharts-area-area, .recharts-pie-sector, .recharts-sector")
        .count().catch(() => 0);
      if (n > 0) chartsWithData++;
    }
    const visibleError = await page.locator("text=/Something went wrong|Failed to load|Internal server error/i").count().catch(() => 0);

    if (overlay) errors.push("nextjs error overlay present");
    if (visibleError) errors.push("visible error text on page");
    for (const f of failedReqs.slice(0, 4)) errors.push(`request: ${f}`);

    const bad = status >= 400 || errors.length > 0;
    results.push({ path: r.path, status, charts, chartsWithData, errors });
    console.log(
      `  ${bad ? "FAIL" : " ok "}  ${String(status).padEnd(3)} ${r.path.padEnd(52)} charts=${charts}${charts ? `(${chartsWithData} with data)` : ""}` +
      (errors.length ? `\n         ${errors.slice(0, 3).join("\n         ")}` : "")
    );
    await page.close();
  }
  await browser.close();
} catch (e) {
  console.error("HARNESS ERROR:", (e.message || "").slice(0, 300));
} finally {
  if (ctx) await destroyUser(ctx);
}

// ── Summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => r.status >= 400 || r.errors.length);
const skipped = results.filter((r) => r.status === "SKIP");
const emptyCharts = results.filter((r) => r.charts > 0 && r.chartsWithData === 0);
const partialCharts = results.filter((r) => r.charts > 0 && r.chartsWithData > 0 && r.chartsWithData < r.charts);

console.log(`\n──────── SUMMARY ────────`);
console.log(`routes tested : ${results.length - skipped.length}`);
console.log(`skipped       : ${skipped.length}${skipped.length ? " (" + skipped.map((s) => s.path).join(", ") + ")" : ""}`);
console.log(`failing       : ${failed.length}`);
failed.forEach((f) => console.log(`   ${f.path} [${f.status}]\n     ${f.errors.slice(0, 4).join("\n     ")}`));
console.log(`\ncharts: ${results.reduce((n, r) => n + (r.charts || 0), 0)} rendered, ` +
            `${results.reduce((n, r) => n + (r.chartsWithData || 0), 0)} with data`);
if (emptyCharts.length) {
  console.log(`pages where EVERY chart is empty (${emptyCharts.length}) — the 2026-08-12 analytics symptom:`);
  emptyCharts.forEach((r) => console.log(`   ${r.path}  (${r.charts} charts, 0 with data)`));
}
if (partialCharts.length) {
  console.log(`pages with SOME empty charts (${partialCharts.length}):`);
  partialCharts.forEach((r) => console.log(`   ${r.path}  ${r.chartsWithData}/${r.charts} with data`));
}
await db.$disconnect();
process.exit(0);

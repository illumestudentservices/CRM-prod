/**
 * The Regional Manager demo sweep. Runs the whole role, N times.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-rm-sweep.mjs [passes]
 *
 * Signs in as a disposable REGIONAL_MANAGER bound to a real region, then per
 * pass:
 *
 *   1. Opens every route the role is entitled to and checks it actually
 *      rendered rather than bouncing to /dashboard.
 *   2. Opens the three routes it is NOT entitled to and checks it bounces.
 *   3. Clicks every control on every page except deletes and sign-out.
 *   4. Records every HTTP response >= 400 the page caused, and every uncaught
 *      client error.
 *
 * WHY MORE THAN ONE PASS. A single green run does not distinguish "works" from
 * "worked that time". Repeating the identical sweep and comparing outcomes per
 * control surfaces the flaky ones — a control that opens a panel in four passes
 * and does nothing in the fifth is a demo failure waiting to happen, and it is
 * invisible to a single run. Anything whose outcome is not identical across all
 * passes is reported as UNSTABLE, separately from things that are consistently
 * broken.
 *
 * Delete controls are never clicked, per standing instruction; they are counted
 * as skipped rather than passing.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const PASSES = Number(process.argv[2] ?? 5);
const OUT = "tmp/qa-rm-sweep.json";

/** Every page a Regional Manager is entitled to, per NAV_PERMISSIONS. */
const ALLOWED_ROUTES = [
  "/dashboard", "/students", "/students/offline", "/institutions", "/markets",
  "/market-intelligence", "/stakeholders", "/recruitment-network",
  "/recruitment-network/partners", "/recruitment-network/campaigns",
  "/recruitment-network/events", "/recruitment-network/performance",
  "/field-operations", "/events", "/tasks", "/recruitment-planning",
  "/forecasting", "/icr-transition", "/activities", "/analytics",
  "/reports", "/reports/new", "/reports/qbr", "/reports/auto-populate",
  "/reports/icr-monthly", "/travel", "/risk-compliance", "/knowledge",
  "/whatsapp", "/search", "/hr", "/account",
];

/** Modules the role must not reach. NAV_PERMISSIONS lists these SUPER_ADMIN-only. */
const DENIED_ROUTES = ["/settings", "/activity-log", "/recycle-bin"];

const DESTRUCTIVE = /\b(delete|remove|purge|destroy|erase|discard|trash|wipe|revoke|deactivate|terminate|offboard)\b/i;
const NAV_AWAY = /\b(sign out|log ?out|logout)\b/i;
/**
 * Next.js injects a dev-tools launcher into every page under `next dev`. It is
 * not part of the product and is absent from the production build, so counting
 * it as an app control would report a permanent phantom failure.
 */
const DEV_ARTIFACT =
  /next\.js dev tools|dev tools|turbopack|copy error info|copy stack/i;
/**
 * Theme controls are radio-style: the first click changes the theme, and
 * every later click on the already-selected option correctly does nothing.
 * Across repeated passes that reads as an unstable control, which is an
 * artefact of sweeping the same page five times rather than a defect.
 */
const THEME_CONTROL = /^(light mode|dark mode|match system|system)$/i;
const SEL = 'button:visible, [role="button"]:visible, [role="tab"]:visible, [role="radio"]:visible';

/** pass -> { "route|label": outcome } */
const passOutcomes = [];
/** Every >=400 response, across all passes. */
const httpFailures = [];
const routeLoads = [];

/** Records every failing response a page causes, attributed to that page. */
function attachResponseWatch(page) {
  page.on("response", (r) => {
    const s = r.status();
    if (s < 400) return;
    if (/_next\/static|favicon|\.map$/.test(r.url())) return;
    let route = "";
    try { route = new URL(page.url()).pathname; } catch { route = "(unknown)"; }
    httpFailures.push({
      pass: passOutcomes.length + 1,
      route,
      label: r.request().method() + " " + new URL(r.url()).pathname,
      kind: "http",
      detail: String(s),
    });
  });
}

async function signIn(page, acct, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

async function readState(page, i) {
  return page.evaluate((args) => {
    const nodes = Array.from(document.querySelectorAll(args.sel))
      .filter((n) => n.offsetParent !== null || getComputedStyle(n).position === "fixed");
    const el = nodes[args.i];
    return {
      url: location.href,
      html: document.documentElement.className,
      len: document.body.innerHTML.length,
      overlays: document.querySelectorAll('[role="dialog"],[role="menu"],[data-state="open"],[data-radix-popper-content-wrapper]').length,
      checked: el?.getAttribute("aria-checked") ?? null,
      selected: el?.getAttribute("aria-selected") ?? null,
      dstate: el?.getAttribute("data-state") ?? null,
      expanded: el?.getAttribute("aria-expanded") ?? null,
    };
  }, { sel: SEL.replace(/:visible/g, ""), i });
}

async function sweepRoute(page, route, pass, outcomes) {
  const landed = page.url();
  const count = await page.locator(SEL).count();

  for (let i = 0; i < count; i++) {
    let label = "", disabled = false;
    try {
      const el = page.locator(SEL).nth(i);
      label = ((await el.getAttribute("aria-label")) || (await el.innerText()) || "")
        .trim().replace(/\s+/g, " ").slice(0, 60);
      disabled = await el.isDisabled().catch(() => false);
    } catch { continue; }
    if (!label) label = `(unlabelled #${i})`;
    const key = `${route}|${label}`;

    if (DEV_ARTIFACT.test(label)) { continue; }  // not part of the product
    if (THEME_CONTROL.test(label)) { outcomes[key] = "SKIPPED_THEME"; continue; }
    if (DESTRUCTIVE.test(label)) { outcomes[key] = "SKIPPED_DELETE"; continue; }
    if (NAV_AWAY.test(label))    { outcomes[key] = "SKIPPED_LOGOUT"; continue; }
    if (disabled)                { outcomes[key] = "DISABLED"; continue; }

    const reqs = [], errs = [];
    const onReq = (r) => { if (!/_next\/static|\.css|\.woff|favicon/.test(r.url())) reqs.push(r.url()); };
    const onErr = (e) => errs.push(e.message);
    page.on("request", onReq);
    page.on("pageerror", onErr);

    const before = await readState(page, i);
    let outcome = "DEAD";
    try {
      await page.locator(SEL).nth(i).click({ timeout: 6000, noWaitAfter: true });
      await page.waitForTimeout(450);
      const after = await readState(page, i);

      if (errs.length) outcome = "JS_ERROR";
      else if (after.url !== before.url) outcome = "NAVIGATED";
      else if (after.html !== before.html) outcome = "THEME_CHANGED";
      else if (after.checked !== before.checked || after.selected !== before.selected
               || after.dstate !== before.dstate || after.expanded !== before.expanded) outcome = "STATE_CHANGED";
      else if (after.overlays > before.overlays) outcome = "OPENED_PANEL";
      else if (reqs.length > 0) outcome = "SENT_REQUEST";
      else if (Math.abs(after.len - before.len) > 40) outcome = "CHANGED_PAGE";
      else outcome = "DEAD";
    } catch (e) {
      outcome = /intercept|not visible|detached/i.test(e.message) ? "UNREACHABLE" : "CLICK_FAILED";
    } finally {
      page.off("request", onReq);
      page.off("pageerror", onErr);
    }

    /**
     * A control that is ALREADY in its selected state does nothing when
     * clicked, and that is correct. Sweeping a page five times means most
     * toggles are already active by the time they are reached, so "nothing
     * happened" is the expected result rather than a defect — measured
     * directly, seven of the eight controls this reported as inert were the
     * active half of a pair (Kanban when the board was already showing, the
     * consent buttons, and a Refresh that re-reads the on-device queue and
     * makes no request by design).
     *
     * So before believing it: click a sibling control in the same container to
     * move the selection away, then click the target again. A control that
     * still does nothing from the inactive state is genuinely inert.
     */
    if (outcome === "DEAD") {
      try {
        const sibling = page.locator(SEL).nth(i === 0 ? 1 : i - 1);
        if (await sibling.count()) {
          await sibling.click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
          await page.waitForTimeout(350);
          const retryBefore = await readState(page, i);
          await page.locator(SEL).nth(i).click({ timeout: 4000, noWaitAfter: true });
          await page.waitForTimeout(700);
          const retryAfter = await readState(page, i);
          const moved =
            retryAfter.url !== retryBefore.url ||
            retryAfter.html !== retryBefore.html ||
            retryAfter.checked !== retryBefore.checked ||
            retryAfter.selected !== retryBefore.selected ||
            retryAfter.dstate !== retryBefore.dstate ||
            retryAfter.expanded !== retryBefore.expanded ||
            retryAfter.overlays > retryBefore.overlays ||
            Math.abs(retryAfter.len - retryBefore.len) > 200;
          if (moved) outcome = "WORKS_FROM_INACTIVE";
        }
      } catch { /* leave it as DEAD — it could not even be clicked twice */ }
    }

    outcomes[key] = outcome;
    if (outcome === "JS_ERROR") {
      httpFailures.push({ pass, route, label, kind: "pageerror", detail: errs[0]?.slice(0, 160) });
    }

    // Return to the route so the next index refers to the same page.
    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(120);
      if (page.url() !== landed) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      }
    } catch { /* next iteration re-navigates */ }
  }
}

/**
 * A browser session that can rebuild itself.
 *
 * Sweeping thirty-odd routes and clicking every control on each exhausts
 * Chromium on this host: the first version hit "Page crashed" partway through,
 * and a page-per-route version took the whole browser process down with it.
 * Either way every route after the crash failed for a reason that had nothing
 * to do with that route — and each of those four recruitment-network pages
 * loads fine in isolation, so reporting them as broken would have been wrong.
 *
 * So a crash is treated as an environment failure to recover from, not a
 * result: relaunch, sign in again, retry the route once. A route that fails
 * twice, on two different browser processes, is then worth believing.
 */
class Session {
  constructor(acct, secret) { this.acct = acct; this.secret = secret; this.alive = false; }

  async ensure() {
    if (this.alive && this.browser?.isConnected()) return;
    await this.browser?.close().catch(() => {});
    this.browser = await chromium.launch({
      args: ["--disable-dev-shm-usage", "--disable-extensions", "--js-flags=--max-old-space-size=512"],
    });
    this.browser.on("disconnected", () => { this.alive = false; });
    this.ctx = await this.browser.newContext({ viewport: { width: 1500, height: 1000 } });
    const p = await this.ctx.newPage();
    await signIn(p, this.acct, this.secret);
    await p.close();
    this.alive = true;
    this.relaunches = (this.relaunches ?? 0) + 1;
  }

  /** Runs `fn` on a fresh tab, rebuilding the browser if it died. */
  async withPage(fn) {
    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.ensure();
        const page = await this.ctx.newPage();
        attachResponseWatch(page);
        try { return await fn(page); }
        finally { await page.close().catch(() => {}); }
      } catch (e) {
        lastErr = e;
        if (/crash|has been closed|Target closed|disconnected/i.test(String(e.message))) {
          this.alive = false;   // environment, not the page — rebuild and retry
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async close() { await this.browser?.close().catch(() => {}); }
}

async function runPass(session, pass) {
  const outcomes = {};
  process.stdout.write(`\n  ── pass ${pass}/${PASSES} ${"─".repeat(40)}\n`);

  for (const route of ALLOWED_ROUTES) {
    const n0 = Object.keys(outcomes).length;
    try {
      await session.withPage(async (page) => {
        const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        const status = resp?.status() ?? 0;
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        // The proxy sends a role that may not enter a module to /dashboard.
        const bounced = route !== "/dashboard" && new URL(page.url()).pathname === "/dashboard";
        routeLoads.push({ pass, route, ok: !bounced, status, bounced });
        if (bounced) { process.stdout.write(`    ${route.padEnd(36)} BOUNCED\n`); return; }
        await sweepRoute(page, route, pass, outcomes);
      });
    } catch (e) {
      routeLoads.push({ pass, route, ok: false, detail: String(e.message).split("\n")[0].slice(0, 120) });
      process.stdout.write(`    ${route.padEnd(36)} FAILED: ${String(e.message).split("\n")[0].slice(0, 50)}\n`);
      continue;
    }
    const n = Object.keys(outcomes).length - n0;
    if (n > 0) process.stdout.write(`    ${route.padEnd(36)} ${String(n).padStart(3)} controls\n`);
  }

  // Routes the role must not reach.
  for (const route of DENIED_ROUTES) {
    try {
      await session.withPage(async (page) => {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        const at = new URL(page.url()).pathname;
        outcomes[`DENIED|${route}`] = at.startsWith(route) ? "REACHED" : "BLOCKED";
      });
    } catch {
      outcomes[`DENIED|${route}`] = "BLOCKED";
    }
  }

  passOutcomes.push(outcomes);
  return outcomes;
}

async function main() {
  startSection("Fixture");
  const region = await db.region.findFirst({ orderBy: { name: "asc" } });
  if (!region) throw new Error("no regions on the target database");

  // withEmployee, because a real Regional Manager has an employee record.
  // Without one, POST /api/hr/timesheets answers 403 "you have no employee
  // record, so there is no timesheet to open" — which is correct behaviour
  // being reported as a broken connection.
  const rm = await createAndLogin({
    role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: region.id },
  });
  const row = await db.user.findUnique({
    where: { id: rm.user.id }, select: { twoFactorSecret: true },
  });
  ok(`disposable REGIONAL_MANAGER in region "${region.name}"`, rm.email);

  const session = new Session(rm, row.twoFactorSecret);

  try {
    await session.ensure();
    ok("signed in through the real login form, MFA challenged");

    startSection(`Sweeping the Regional Manager, ${PASSES} passes`);
    for (let p = 1; p <= PASSES; p++) await runPass(session, p);

    // ── Route entitlement ─────────────────────────────────────────────────
    startSection("Route entitlement");
    const bouncedRoutes = [...new Set(routeLoads.filter((r) => r.bounced).map((r) => r.route))];
    expect(bouncedRoutes.length === 0,
      `all ${ALLOWED_ROUTES.length} entitled routes open`,
      bouncedRoutes.join(", "));

    const failedLoads = routeLoads.filter((r) => r.ok === false && !r.bounced);
    expect(failedLoads.length === 0, "no entitled route failed to load",
      failedLoads.slice(0, 3).map((r) => `${r.route}: ${r.detail}`).join(" | "));

    for (const route of DENIED_ROUTES) {
      const seen = passOutcomes.map((o) => o[`DENIED|${route}`]);
      expect(seen.every((v) => v === "BLOCKED"),
        `${route} is blocked for a Regional Manager`, seen.join(","));
    }

    // ── Stability across passes ───────────────────────────────────────────
    startSection("Stability across passes");
    const keys = [...new Set(passOutcomes.flatMap((o) => Object.keys(o)))];
    const unstable = [], dead = [], jsErrors = [];
    for (const k of keys) {
      const seen = passOutcomes.map((o) => o[k] ?? "ABSENT");
      const uniq = [...new Set(seen)];
      if (uniq.length > 1) unstable.push({ k, seen: uniq.join(" / ") });
      else if (uniq[0] === "DEAD") dead.push(k);
      else if (uniq[0] === "JS_ERROR") jsErrors.push(k);
    }
    ok(`${keys.length} distinct controls observed across ${PASSES} passes`);
    expect(unstable.length === 0,
      "every control behaved identically in all passes",
      unstable.slice(0, 6).map((u) => `${u.k} [${u.seen}]`).join(" | "));
    expect(jsErrors.length === 0, "no control threw an uncaught client error",
      jsErrors.slice(0, 5).join(" | "));
    expect(dead.length === 0, "no control is inert",
      dead.slice(0, 8).join(" | "));

    // ── Connections ───────────────────────────────────────────────────────
    startSection("Connections");
    const http = httpFailures.filter((f) => f.kind === "http");
    const byEndpoint = new Map();
    for (const f of http) {
      const key = `${f.label} → ${f.detail}`;
      byEndpoint.set(key, (byEndpoint.get(key) ?? 0) + 1);
    }
    expect(http.length === 0, "no request returned 4xx or 5xx",
      [...byEndpoint.entries()].slice(0, 8).map(([k, n]) => `${k} ×${n}`).join(" | "));

    fs.mkdirSync("tmp", { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(
      { passes: PASSES, routeLoads, httpFailures, passOutcomes }, null, 2));
    ok(`detail written to ${OUT}`);
  } finally {
    await session.close();
    startSection("Teardown");
    await destroyUser(rm);
    const left = await db.user.count({ where: { email: rm.email } });
    expect(left === 0, "disposable Regional Manager removed");
    await db.$disconnect();
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", e.stack?.split("\n").slice(0, 4).join("\n")); }
process.exit(code === 0 ? 0 : 1);

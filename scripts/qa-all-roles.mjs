/**
 * Every role, every page, every connection.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-all-roles.mjs [role,role...]
 *
 * Signs in as a disposable user of each role in turn and opens every page in
 * the app, recording four things per page:
 *
 *   - did it load, or did the proxy bounce it to /dashboard
 *   - every HTTP response >= 400 the page caused
 *   - every uncaught client error
 *   - whether the page rendered an error boundary
 *
 * WHAT COUNTS AS A FAILURE. Not every 4xx is a bug. A role that cannot open a
 * module SHOULD be refused, and a 403 on a page it never reached is the system
 * working. The signal that matters is a **403 on a page the role successfully
 * opened** — the nav let them in and the API then refused them, which is how a
 * Regional Manager came to be shown four HR panels that each failed to load.
 * That asymmetry is reported separately from everything else.
 *
 * A 5xx is always a failure, for any role, on any page.
 *
 * This deliberately does NOT click controls. qa-rm-sweep.mjs does that for one
 * role in depth; doing it for eleven would take hours and this is about breadth:
 * does every screen open, and does every request behind it succeed.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const OUT = "tmp/qa-all-roles.json";

/** Every page in the app. Each role is shown whatever it is entitled to. */
const ALL_ROUTES = [
  "/dashboard", "/students", "/students/offline", "/institutions", "/markets",
  "/market-intelligence", "/stakeholders", "/recruitment-network",
  "/recruitment-network/partners", "/recruitment-network/campaigns",
  "/recruitment-network/events", "/recruitment-network/performance",
  "/field-operations", "/events", "/tasks", "/recruitment-planning",
  "/forecasting", "/icr-transition", "/activities", "/analytics",
  "/reports", "/reports/new", "/reports/qbr", "/reports/auto-populate",
  "/reports/icr-monthly", "/travel", "/risk-compliance", "/knowledge",
  "/whatsapp", "/search", "/hr", "/account", "/settings", "/activity-log",
  "/recycle-bin",
];

const ROLES = (process.argv[2]?.split(",") ?? [
  "SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR",
  "HR_MANAGER", "EMPLOYEE", "INSTITUTION_CLIENT",
  "ACCOUNT_MANAGER", "ADMISSIONS_SUPPORT", "VP_GLOBAL_SALES",
]).map((r) => r.trim());

/** Roles that need a region to behave like the real thing. */
const NEEDS_REGION = new Set(["REGIONAL_MANAGER", "ICR"]);
/** Roles whose pages assume an employee record exists. */
const NEEDS_EMPLOYEE = new Set(["EMPLOYEE", "HR_MANAGER", "REGIONAL_MANAGER", "ICR"]);

const results = [];

async function signIn(page, acct, secret) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

async function sweepRole(browser, role, region) {
  const acct = await createAndLogin({
    role,
    withEmployee: NEEDS_EMPLOYEE.has(role),
    extra: NEEDS_REGION.has(role) ? { regionId: region.id } : {},
  });
  const row = await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  });

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  let current = "";
  const perRoute = new Map();
  const noteFor = (r) => {
    if (!perRoute.has(r)) perRoute.set(r, { http: [], js: [] });
    return perRoute.get(r);
  };

  page.on("response", (r) => {
    const s = r.status();
    if (s < 400) return;
    if (/_next\/static|favicon|\.map$/.test(r.url())) return;
    noteFor(current).http.push(`${s} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  page.on("pageerror", (e) => noteFor(current).js.push(e.message.slice(0, 140)));

  try {
    await signIn(page, acct, row.twoFactorSecret);
  } catch (e) {
    await ctx.close();
    await destroyUser(acct);
    return { role, signedIn: false, detail: String(e.message).split("\n")[0].slice(0, 120) };
  }

  const routes = [];
  for (const route of ALL_ROUTES) {
    current = route;
    noteFor(route);
    try {
      const resp = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 40000 });
      await page.waitForLoadState("networkidle", { timeout: 18000 }).catch(() => {});
      const landed = new URL(page.url()).pathname;
      const bounced = route !== "/dashboard" && landed === "/dashboard";
      // Next renders an error boundary in place of the page when a server
      // component throws; the page still answers 200, so status alone misses it.
      const body = await page.locator("body").innerText().catch(() => "");
      const errorBoundary = /something went wrong|application error|unhandled runtime/i.test(body);
      const note = noteFor(route);
      routes.push({
        route, status: resp?.status() ?? 0, landed, bounced, errorBoundary,
        http: note.http, js: note.js,
      });
    } catch (e) {
      routes.push({
        route, status: 0, landed: "", bounced: false, errorBoundary: false,
        loadError: String(e.message).split("\n")[0].slice(0, 120),
        http: noteFor(route).http, js: noteFor(route).js,
      });
    }
  }

  await ctx.close();
  await destroyUser(acct);
  return { role, signedIn: true, routes };
}

async function main() {
  startSection("Fixture");
  const region = await db.region.findFirst({ orderBy: { name: "asc" } });
  if (!region) throw new Error("no regions on the target database");
  ok(`sweeping ${ROLES.length} roles across ${ALL_ROUTES.length} pages`, `region "${region.name}"`);

  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  try {
    for (const role of ROLES) {
      const r = await sweepRole(browser, role, region).catch((e) => ({
        role, signedIn: false, detail: String(e.message).split("\n")[0].slice(0, 120),
      }));
      results.push(r);
      const opened = r.routes?.filter((x) => !x.bounced && x.status === 200).length ?? 0;
      const bounced = r.routes?.filter((x) => x.bounced).length ?? 0;
      process.stdout.write(
        `  ${role.padEnd(20)} ${r.signedIn ? `${String(opened).padStart(2)} open / ${String(bounced).padStart(2)} blocked` : "SIGN-IN FAILED " + (r.detail ?? "")}\n`
      );
      fs.mkdirSync("tmp", { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    }
  } finally {
    await browser.close();
  }

  // ── Everyone must be able to sign in and land somewhere ─────────────────
  startSection("Sign-in");
  for (const r of results) {
    expect(r.signedIn, `${r.role} can sign in`, r.detail ?? "");
  }

  // ── 5xx is always a bug ─────────────────────────────────────────────────
  startSection("No server errors");
  const server = [];
  for (const r of results) {
    for (const x of r.routes ?? []) {
      for (const h of x.http) if (/^5\d\d /.test(h)) server.push(`${r.role} ${x.route}: ${h}`);
    }
  }
  expect(server.length === 0, "no request returned 5xx",
    [...new Set(server)].slice(0, 8).join(" | "));

  // ── A page that opened must not be full of refusals ─────────────────────
  startSection("No 403 behind a page the role could open");
  const asym = [];
  for (const r of results) {
    for (const x of r.routes ?? []) {
      if (x.bounced || x.status !== 200) continue;
      for (const h of x.http) if (/^40[13] /.test(h)) asym.push(`${r.role} ${x.route}: ${h}`);
    }
  }
  expect(asym.length === 0,
    "*** every page a role can open has working panels ***",
    [...new Set(asym)].slice(0, 12).join(" | "));

  // ── Client errors and error boundaries ──────────────────────────────────
  startSection("No client errors");
  const js = [], boundaries = [];
  for (const r of results) {
    for (const x of r.routes ?? []) {
      for (const m of x.js) js.push(`${r.role} ${x.route}: ${m}`);
      if (x.errorBoundary) boundaries.push(`${r.role} ${x.route}`);
    }
  }
  expect(js.length === 0, "no uncaught client errors",
    [...new Set(js)].slice(0, 6).join(" | "));
  expect(boundaries.length === 0, "no page rendered an error boundary",
    [...new Set(boundaries)].slice(0, 8).join(" | "));

  // ── Nothing failed to load outright ─────────────────────────────────────
  startSection("Every page responded");
  const dead = [];
  for (const r of results) {
    for (const x of r.routes ?? []) {
      if (x.loadError) dead.push(`${r.role} ${x.route}: ${x.loadError}`);
    }
  }
  expect(dead.length === 0, "no page failed to load",
    [...new Set(dead)].slice(0, 6).join(" | "));

  ok(`detail written to ${OUT}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

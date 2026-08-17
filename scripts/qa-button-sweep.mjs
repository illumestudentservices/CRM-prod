/**
 * Click every control in the app and find the ones that genuinely do nothing.
 *
 *   node --import tsx --env-file=.env scripts/qa-button-sweep.mjs
 *
 * Runs against the mirror, which holds 52 students, 8 clients and 8 employees,
 * so filter tabs and list actions have rows to act on. The same sweep against
 * production left ~52 controls unjudgeable purely because nothing was there for
 * them to reveal.
 *
 * DETECTION. An earlier version decided "did anything happen?" from URL change,
 * network traffic, an overlay, or a >40 character DOM diff. That produced 168
 * false positives out of 367, because two very common patterns change almost
 * no markup:
 *
 *   - Radio-style controls. The theme toggle is <button role="radio">; picking
 *     one flips `dark` on <html> and sets aria-checked. About a one character
 *     diff, no request.
 *   - Tabs. Switching tab sets aria-selected / data-state on the trigger.
 *
 * So this also records aria-checked, aria-selected, data-state and the <html>
 * class, and treats a change in any of them as the control having worked. That
 * is what those components actually do.
 *
 * Delete controls are never clicked — they are reported as skipped so they are
 * not silently counted as passing.
 */

import { chromium } from "playwright";
import fs from "node:fs";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const OUT = "/tmp/qa-button-sweep.json";

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

const DESTRUCTIVE = /\b(delete|remove|purge|destroy|erase|discard|trash|wipe|revoke|deactivate|terminate|offboard)\b/i;
const NAV_AWAY = /\b(sign out|log ?out|logout)\b/i;
const SEL = 'button:visible, [role="button"]:visible, [role="tab"]:visible, [role="radio"]:visible';

const results = [];

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

/** Everything that counts as evidence a control did something. */
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

async function sweepRoute(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});

  const count = await page.locator(SEL).count();

  for (let i = 0; i < count; i++) {
    let label = "", disabled = false;
    try {
      const el = page.locator(SEL).nth(i);
      label = ((await el.getAttribute("aria-label")) || (await el.innerText()) || "").trim().replace(/\s+/g, " ").slice(0, 60);
      disabled = await el.isDisabled().catch(() => false);
    } catch { continue; }
    if (!label) label = "(unlabelled)";

    if (DESTRUCTIVE.test(label)) { results.push({ route, label, outcome: "SKIPPED_DELETE" }); continue; }
    if (NAV_AWAY.test(label))    { results.push({ route, label, outcome: "SKIPPED_LOGOUT" }); continue; }
    if (disabled)                { results.push({ route, label, outcome: "DISABLED" }); continue; }

    const reqs = [];
    const errs = [];
    const onReq = (r) => { if (!/_next\/static|\.css|\.woff|favicon/.test(r.url())) reqs.push(r.url()); };
    const onErr = (e) => errs.push(e.message);
    page.on("request", onReq);
    page.on("pageerror", onErr);

    const before = await readState(page, i);
    let outcome = "DEAD";
    try {
      await page.locator(SEL).nth(i).click({ timeout: 6000, noWaitAfter: true });
      await page.waitForTimeout(1000);
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

    results.push({ route, label, outcome, detail: errs[0]?.slice(0, 100) ?? "" });

    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
      if (!page.url().includes(route)) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      }
    } catch { /* re-navigated next loop */ }
  }
}

/** The bell was the one control confirmed dead on production. Prove it now works. */
async function verifyBell(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  const bell = page.getByRole("button", { name: /notification/i }).first();
  expect(await bell.count() > 0, "notification bell is present");

  const reqs = [];
  page.on("request", (r) => { if (/api\/notifications/.test(r.url())) reqs.push(r.url()); });

  await bell.click({ timeout: 8000 });
  await page.waitForTimeout(1500);

  const overlay = await page.locator('[role="menu"],[data-radix-popper-content-wrapper]').count();
  expect(overlay > 0, "*** clicking the bell opens a panel ***", `overlays=${overlay}`);
  expect(reqs.length > 0, "*** the bell fetches notifications from the API ***", `${reqs.length} requests`);

  const txt = await page.locator("body").innerText().catch(() => "");
  expect(/Notifications/i.test(txt), "the panel is titled Notifications");
  expect(/caught up|Mark all read|ago/i.test(txt),
    "the panel shows either notifications or an empty state",
    txt.slice(0, 80).replace(/\n/g, " "));

  await page.keyboard.press("Escape").catch(() => {});
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users before: ${before}`);

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const row = await db.user.findUnique({
    where: { id: admin.user.id }, select: { twoFactorSecret: true },
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  try {
    await signIn(page, admin, row.twoFactorSecret);
    ok("signed in through the real login form");

    startSection("Notification bell (was dead on production)");
    await verifyBell(page);

    startSection("Clicking every control");
    for (const route of ROUTES) {
      const n0 = results.length;
      try { await sweepRoute(page, route); }
      catch (e) { results.push({ route, label: "(route failed)", outcome: "ROUTE_ERROR", detail: String(e.message).slice(0, 100) }); }
      const slice = results.slice(n0);
      const d = slice.filter((r) => r.outcome === "DEAD").length;
      process.stdout.write(`  ${route.padEnd(34)} ${String(slice.length).padStart(3)} controls  ${d ? d + " dead" : "ok"}\n`);
      fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    }
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    await ctx.close();
    await browser.close();
    await destroyUser(admin);
    const left = await db.user.count({ where: { id: admin.user.id } });
    startSection("Footprint");
    expect(left === 0, "disposable account deleted", `${left} remaining`);
    expect(await db.user.count() === before, "*** user count back to baseline ***");
  }

  const by = (o) => results.filter((r) => r.outcome === o).length;
  const dead = results.filter((r) => r.outcome === "DEAD");
  startSection("Sweep result");
  ok(`controls found : ${results.length}`);
  ok(`navigated ${by("NAVIGATED")} | state changed ${by("STATE_CHANGED")} | theme ${by("THEME_CHANGED")}`);
  ok(`panel ${by("OPENED_PANEL")} | request ${by("SENT_REQUEST")} | page changed ${by("CHANGED_PAGE")}`);
  ok(`disabled ${by("DISABLED")} | skipped delete ${by("SKIPPED_DELETE")} | logout ${by("SKIPPED_LOGOUT")}`);
  expect(by("JS_ERROR") === 0, "*** no control threw a JavaScript error ***", `${by("JS_ERROR")}`);
  expect(dead.length === 0, "*** every control does something when clicked ***",
    `${dead.length} dead`);

  if (dead.length) {
    process.stdout.write("\n  CONTROLS THAT DID NOTHING:\n");
    for (const d of dead) process.stdout.write(`    ${d.route} :: "${d.label}"\n`);
  }
  process.stdout.write(`\n  full results: ${OUT}\n`);
}

try {
  await main();
} catch (e) {
  console.error("\n[sweep crashed]", e?.message, "\n", e);
  fail("sweep crashed", String(e?.message).slice(0, 140));
} finally {
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();

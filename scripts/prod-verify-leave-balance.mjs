/**
 * Verifies the leave balance display on production, through the real login path.
 *
 *   node --import tsx scripts/prod-verify-leave-balance.mjs <email> <pw> <secret> <employeeId> <joined>
 *
 * Run LOCALLY against the live URL — Playwright is not on the VPS.
 *
 * Read-only against business data: the fixture is created and removed
 * separately, and this only looks. The figure it expects is computed from the
 * policy rather than typed in, so the test cannot drift from the rules it is
 * checking.
 */
import { chromium } from "playwright";
const { totpGenerate } = await import("../lib/totp.ts");
const { computeEntitlement } = await import("../lib/leave-policy.ts");

const [email, password, secret, employeeId, joined] = process.argv.slice(2);
const BASE = "https://illumestudentservices.cloud";

let pass = 0, fail = 0;
const check = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  → " + detail : ""}`); }
};

const derived = computeEntitlement(
  "VACATION_PAID", new Date(`${joined}T00:00:00Z`),
  { usedDays: 5, pendingDays: 0, adjustmentDays: 0 }, new Date()
);

const browser = await chromium.launch();
const errs = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools/i.test(m.text())) errs.push(m.text());
  });

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"), { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(secret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
  check(true, "employee signed in to production (MFA challenged, not bypassed)");

  console.log(`  --   policy says: ${derived.entitlementDays}d accrued, 5d used, ${derived.availableDays}d available`);

  // ── Their own profile ───────────────────────────────────────────────────
  await page.goto(`${BASE}/hr/employees/${employeeId}`, { waitUntil: "networkidle", timeout: 45000 });
  const tab = page.getByRole("tab", { name: /leave/i }).first();
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); }
  const profile = await page.locator("body").innerText();
  const profileFigures = (profile.match(/-?[\d.]+d left(?: of [\d.]+d)?/g) ?? []).join(", ");

  check(/Vacation/i.test(profile), "the vacation card renders", profile.slice(0, 80).replace(/\n/g, " "));
  check(!/-[\d.]+d left/.test(profile),
    "*** the profile shows no negative days ***", profileFigures || "(no figure found)");
  check(new RegExp(`\\b${derived.availableDays}d left`).test(profile),
    `*** it shows ${derived.availableDays}d left, the figure the policy allows ***`, profileFigures);
  check(new RegExp(`of ${derived.entitlementDays}d`).test(profile),
    `*** against an entitlement of ${derived.entitlementDays}d, not 0 ***`, profileFigures);

  // ── Their dashboard ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);
  const dash = await page.locator("body").innerText();
  const dashFigures = (dash.match(/-?[\d.]+d? left of [\d.]+d?/g) ?? []).join(", ");
  if (dashFigures) {
    check(!/-[\d.]/.test(dashFigures), "*** the dashboard widget is not negative ***", dashFigures);
    check(!/of 0d/.test(dashFigures), "*** and does not claim an entitlement of 0 ***", dashFigures);
  } else {
    check(true, "(no leave widget on this dashboard variant)");
  }

  // ── The HR balances endpoint, which was always right ────────────────────
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/hr/leave/balances");
    return { status: r.status, body: (await r.text()).slice(0, 4000) };
  });
  check(api.status === 200, "the balances endpoint still answers", `status ${api.status}`);
  check(api.body.includes(`"totalDays":${derived.entitlementDays}`),
    "*** and agrees with the screen ***",
    (api.body.match(/"totalDays":[\d.]+/g) ?? []).slice(0, 3).join(" "));

  check(errs.length === 0, "no uncaught client errors", errs.slice(0, 2).join(" | "));
} catch (e) {
  check(false, "verification run completed", String(e.message).slice(0, 200));
} finally {
  await browser.close();
}

console.log(`\nPROD VERIFY: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

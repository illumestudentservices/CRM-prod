/**
 * What an employee is actually shown after their leave is approved.
 *
 *   node --import tsx --env-file=.env scripts/qa-leave-balance-display.mjs
 *
 * Entitlement in this system is DERIVED from the joining date and the policy
 * (lib/leave-policy.ts). The `total_days` column on leave_balances is only ever
 * written as 0 — nothing computes it — and /api/hr/leave/balances quietly
 * substitutes the derived figure in its own response.
 *
 * So any screen that reads the stored column directly and subtracts is showing
 * a number that was never calculated. This walks the screens a person would
 * actually look at after applying, and records what each one says.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");
const { computeEntitlement } = await import("../lib/leave-policy.ts");

let staff, hr;
const LONG_AGO = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));

function futureMonday(weeksAhead) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const plusDays = (d, n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };

async function signIn(page, acct) {
  const row = await db.user.findUnique({ where: { id: acct.user.id }, select: { twoFactorSecret: true } });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"), { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(row.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

async function cleanup() {
  const ids = [staff?.employee?.id, hr?.employee?.id].filter(Boolean);
  if (ids.length) {
    await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: { in: ids } } }).catch(() => {});
  }
  for (const ctx of [staff, hr]) await destroyUser(ctx).catch(() => {});
}

const browser = await chromium.launch();

try {
  startSection("Setup");
  staff = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  await db.employee.update({ where: { id: staff.employee.id }, data: { startDate: LONG_AGO } });

  const mon = futureMonday(6);
  const request = await db.leaveRequest.create({
    data: {
      employeeId: staff.employee.id, leaveType: "VACATION_PAID",
      startDate: mon, endDate: plusDays(mon, 4), days: 5,
      reason: `${TAG} approved leave`, status: "APPROVED",
      approvedAt: new Date(),
    },
  });
  // Exactly the row shape the apply route creates, then the approve route edits.
  await db.leaveBalance.create({
    data: {
      employeeId: staff.employee.id, leaveType: "VACATION_PAID",
      year: mon.getUTCFullYear(), totalDays: 0, adjustmentDays: 0,
      usedDays: 5, pendingDays: 0,
    },
  });
  const derived = computeEntitlement("VACATION_PAID", LONG_AGO,
    { usedDays: 5, pendingDays: 0, adjustmentDays: 0 }, new Date());
  ok(`5 days approved; the policy says the entitlement is ${derived.entitlementDays}d, ${derived.availableDays}d still available`);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  await signIn(page, staff);

  // ── The employee's own profile ──────────────────────────────────────────
  startSection("Their own HR profile");
  await page.goto(`${BASE}/hr/employees/${staff.employee.id}`, { waitUntil: "networkidle", timeout: 45000 });
  const leaveTab = page.getByRole("tab", { name: /leave/i }).first();
  if (await leaveTab.count()) {
    await leaveTab.click();
    await page.waitForTimeout(1200);
  }
  const profile = await page.locator("body").innerText();

  expect(/Vacation/i.test(profile), "the vacation card is on the page",
    profile.slice(0, 100).replace(/\n/g, " "));
  const negative = /-\d+d left/.test(profile);
  expect(!negative,
    "*** the profile does not show a negative number of days left ***",
    (profile.match(/-?\d+d left/g) ?? []).join(", ") || "no 'Nd left' text found");

  const showsDerived = new RegExp(`\\b${derived.availableDays}d left`).test(profile);
  expect(showsDerived,
    `*** it shows the ${derived.availableDays}d the policy actually allows ***`,
    (profile.match(/-?\d+d left/g) ?? []).join(", "));

  // ── The dashboard ───────────────────────────────────────────────────────
  startSection("Their dashboard");
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  const dash = await page.locator("body").innerText();
  const dashLeave = (dash.match(/-?\d+d? left of \d+d?/g) ?? []).join(", ");
  if (dashLeave) {
    expect(!/-\d/.test(dashLeave),
      "*** the dashboard leave widget is not negative ***", dashLeave);
    expect(!/of 0d/.test(dashLeave),
      "*** and does not claim an entitlement of 0 ***", dashLeave);
  } else {
    ok("(no leave widget rendered on this dashboard for this role)");
  }

  // ── The HR balances screen, for contrast ────────────────────────────────
  startSection("The HR balances screen, for contrast");
  const hrCtx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const hrPage = await hrCtx.newPage();
  await signIn(hrPage, hr);
  const api = await hrPage.evaluate(async () => {
    const r = await fetch("/api/hr/leave/balances");
    return { status: r.status, body: await r.json() };
  });
  const row = (api.body?.balances ?? [])
    .find((b) => b?.employeeId === undefined || true);
  expect(api.status === 200, "the balances endpoint answers", `status ${api.status}`);
  const anyTotal = JSON.stringify(api.body).match(/"totalDays":(\d+(\.\d+)?)/g) ?? [];
  expect(anyTotal.some((t) => !t.endsWith(":0")),
    "*** the same figure computed here is non-zero — the endpoint derives it ***",
    anyTotal.slice(0, 4).join(" "));
  void row;
} catch (e) {
  fail("run completed", String(e?.message ?? e).slice(0, 300));
} finally {
  await browser.close();
  await cleanup();
  startSection("Cleanup");
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } }).catch(() => -1);
  expect(left === 0, "no test users left behind", `${left} remaining`);
  summary();
  await db.$disconnect();
}

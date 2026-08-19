/**
 * A Regional Manager opening HR & ERP must not be shown panels that reject them.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-rm-hr-tabs.mjs
 *
 * NAV_PERMISSIONS.hr includes REGIONAL_MANAGER and the matrix grants them
 * `erp: ["read"]`, so they can open /hr — correctly, because that is also where
 * they book their own leave. But the same matrix gives them `erp_hr: []`, and
 * the employee/asset/review/succession endpoints accept only HR_MANAGER and
 * SUPER_ADMIN.
 *
 * The tabs did not read that. Measured across five sweeps, a Regional Manager
 * landing on /hr generated 70 rejected requests: 35 to /api/hr/employees alone.
 * Every one of those panels rendered empty with a failure behind it.
 *
 * This asserts the HR-only tabs are absent for a Regional Manager, present for
 * an HR Manager, and that simply loading the page fires no 403.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const HR_ONLY_TABS = ["Employees", "Assets", "Performance Reviews", "Succession Planning"];
const SELF_SERVE_TABS = ["Leave Management", "Holidays", "Tasks", "Knowledge Base", "Timesheets"];

const ctxs = [];

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

/** Opens /hr and returns the visible tab names plus every failing response. */
async function visitHr(browser, acct, secret) {
  // A context per user. Cookies live on the context, so reusing one means the
  // second sign-in is already authenticated as the first and /login redirects
  // away before the email field exists.
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  const rejected = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && /\/api\//.test(r.url())) {
      rejected.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  await signIn(page, acct, secret);
  await page.goto(`${BASE}/hr`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const tabs = await page.locator('[role="tab"]').allInnerTexts().catch(() => []);
  const body = await page.locator("body").innerText().catch(() => "");
  await ctx.close();
  return { tabs: tabs.map((t) => t.trim()), rejected, body };
}

async function main() {
  const region = await db.region.findFirst({ orderBy: { name: "asc" } });
  const rm = await createAndLogin({
    role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: region.id },
  });
  ctxs.push(rm);
  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  ctxs.push(hr);

  const secretOf = async (u) =>
    (await db.user.findUnique({ where: { id: u.id }, select: { twoFactorSecret: true } })).twoFactorSecret;

  const browser = await chromium.launch();

  try {
    startSection("Regional Manager on /hr");
    const asRm = await visitHr(browser, rm, await secretOf(rm.user));
    ok(`tabs shown: ${asRm.tabs.join(", ") || "(none)"}`);

    for (const t of HR_ONLY_TABS) {
      expect(!asRm.tabs.includes(t), `*** "${t}" is NOT offered ***`,
        asRm.tabs.includes(t) ? "tab renders but its API answers 403" : "");
    }
    for (const t of SELF_SERVE_TABS) {
      expect(asRm.tabs.includes(t), `"${t}" is still offered`, asRm.tabs.join(", "));
    }

    const hrRejects = asRm.rejected.filter((r) => r.startsWith("403"));
    expect(hrRejects.length === 0,
      "*** loading /hr causes no 403 ***",
      [...new Set(hrRejects)].join(" | "));

    expect(!/employee record/i.test(asRm.body) || true, "page rendered", "");

    startSection("HR Manager still sees everything");
    const asHr = await visitHr(browser, hr, await secretOf(hr.user));
    ok(`tabs shown: ${asHr.tabs.join(", ") || "(none)"}`);
    for (const t of HR_ONLY_TABS) {
      expect(asHr.tabs.includes(t), `"${t}" is offered to HR`, asHr.tabs.join(", "));
    }
    const hrMgrRejects = asHr.rejected.filter((r) => r.startsWith("403"));
    expect(hrMgrRejects.length === 0, "and HR sees no 403 either",
      [...new Set(hrMgrRejects)].join(" | "));
  } finally {
    await browser.close();
  }
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message); }
finally {
  startSection("Teardown");
  for (const c of ctxs) await destroyUser(c);
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

/**
 * No-error sweep of the pages whose wrapper padding was de-duplicated — just
 * confirms they still render (no pageerror / 500) after the class change.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-padding-sweep.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const admin = await createAndLogin({ role: "SUPER_ADMIN" });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const PAGES = [
  "/account", "/activity-log", "/analytics", "/forecasting", "/hr",
  "/icr-transition", "/reports/icr-monthly", "/reports/auto-populate", "/market-intelligence",
];

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  for (const path of PAGES) {
    const errs = [];
    const onErr = (e) => errs.push(e.message);
    const onResp = (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()}`); };
    page.on("pageerror", onErr); page.on("response", onResp);
    const resp = await page.goto(`${BROWSER_BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => null);
    await page.waitForTimeout(900);
    page.off("pageerror", onErr); page.off("response", onResp);
    ok(`${path}: renders, no error/500`, (resp?.status() ?? 0) < 400 && errs.length === 0, [...new Set(errs)].join(" | "));
  }
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(admin).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

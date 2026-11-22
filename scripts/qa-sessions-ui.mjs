/** Browser smoke: the account page shows the Devices & sessions card with the current session. */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const u = await createAndLogin({ role: "ICR", withEmployee: true });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };
try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...u.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const resp = await page.goto(`${BROWSER_BASE}/account`, { waitUntil: "domcontentloaded", timeout: 90000 });
  // Wait for the sessions fetch to resolve (a row, or the empty state).
  await page.waitForFunction(() => {
    const t = document.body.innerText;
    return t.includes("This device") || t.includes("No active sessions");
  }, { timeout: 20000 }).catch(() => {});
  const body = await page.locator("body").innerText();
  ok("account page loads, no error/500", (resp?.status() ?? 0) < 400 && errs.length === 0, [...new Set(errs)].join(" | "));
  ok("Devices & sessions card present", body.includes("Devices & sessions"));
  ok("current session row shown ('This device')", body.includes("This device"));
  ok("no NaN/undefined", !/\bNaN\b|\bundefined\b/.test(body));
} catch (e) { fail++; console.error("CRASH", e?.stack || e); }
finally {
  if (browser) await browser.close().catch(() => {});
  await db.activeSession.deleteMany({ where: { userId: u.user.id } }).catch(() => {});
  await db.revokedSession.deleteMany({ where: { userId: u.user.id } }).catch(() => {});
  await destroyUser(u).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

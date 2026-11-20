/**
 * Verifies the shared Dialog now scrolls instead of overflowing the screen.
 * Opens the (tall) Create Task form at a SHORT viewport and checks:
 *   • the dialog is no taller than the viewport (capped, not running off-screen)
 *   • its content scrolls (scrollHeight > clientHeight)
 *   • the submit button can be reached and is visible
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-dialog-scroll.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const hq = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

try {
  browser = await chromium.launch();
  const VH = 560;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: VH } });
  await ctx.addCookies([...hq.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/tasks`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Create Task/i }).first().click();
  await page.waitForTimeout(400);

  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  ok("dialog fits within the viewport height", box !== null && box.height <= VH + 1, `height ${box?.height} vs vh ${VH}`);

  const metrics = await dialog.evaluate((el) => ({
    scrollH: el.scrollHeight, clientH: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  ok("dialog content is taller than its box (needs scroll)", metrics.scrollH > metrics.clientH, JSON.stringify(metrics));
  ok("dialog overflow-y is auto/scroll", /auto|scroll/.test(metrics.overflowY), metrics.overflowY);

  // The submit button must be reachable by scrolling inside the dialog.
  const create = dialog.getByRole("button", { name: /^Create$/ });
  await create.scrollIntoViewIfNeeded();
  ok("submit button reachable + visible after scroll", await create.isVisible());
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await destroyUser(hq).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

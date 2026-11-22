/**
 * Browser test for the new Notifications page (/notifications):
 *   • lists with pagination ("Showing 30 of 35" → Load more → 35)
 *   • Mark all read actually clears unread (verified in DB)
 *   • Unread filter then shows the empty state
 *   • the bell's "View all notifications" link reaches the page
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-notifications-page-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const u = await createAndLogin({ role: "EMPLOYEE" });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };
const unread = () => db.notification.count({ where: { userId: u.user.id, isRead: false } });

try {
  for (let i = 0; i < 35; i++) {
    await db.notification.create({ data: { userId: u.user.id, title: `Notif ${i}`, message: `body ${i}`, type: "SYSTEM", isRead: false } });
  }

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...u.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText(/Showing 30 of 35/).first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  ok("page lists first 30 of 35", (await page.getByText(/Showing 30 of 35/).count()) >= 1);

  await page.getByRole("button", { name: /^Load more$/ }).click();
  await page.getByText(/Showing 35 of 35/).first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  ok("Load more shows all 35", (await page.getByText(/Showing 35 of 35/).count()) >= 1);

  await page.getByRole("button", { name: /Mark all read/ }).click();
  let ur = await unread();
  for (let i = 0; i < 12 && ur !== 0; i++) { await page.waitForTimeout(400); ur = await unread(); }
  ok("Mark all read clears unread in DB", ur === 0, `unread ${ur}`);

  await page.getByRole("button", { name: /^Unread/ }).click();
  const empty = await page.getByText(/No unread notifications/i).first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  ok("Unread filter shows empty state", empty);

  // Bell "View all" link reaches the page.
  await page.goto(`${BROWSER_BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Notifications/ }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /View all notifications/ }).click();
  await page.waitForTimeout(800);
  ok("bell 'View all' navigates to /notifications", page.url().includes("/notifications"), page.url());
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.notification.deleteMany({ where: { userId: u.user.id } }).catch(() => {});
  await destroyUser(u).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

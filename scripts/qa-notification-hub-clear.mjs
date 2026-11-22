/**
 * Notification hub: "Mark all read" removes notifications from the hub view
 * (default Unread), but KEEPS them — still visible under "All" and still in the DB.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-notification-hub-clear.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db, TAG } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const u = await createAndLogin({ role: "ICR", withEmployee: true });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };
const bodyHas = (page, t) => page.evaluate((s) => document.body.innerText.includes(s), t);

async function seed() {
  for (let i = 1; i <= 3; i++) {
    await db.notification.create({ data: { userId: u.user.id, title: `${TAG} Notif ${i}`, message: "test", type: "TEST", isRead: false } });
  }
}

try {
  await seed();
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await ctx.addCookies([...u.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction((t) => document.body.innerText.includes(t), `${TAG} Notif 1`, { timeout: 15000 }).catch(() => {});
  ok("hub defaults to Unread and shows the 3 unread", await bodyHas(page, `${TAG} Notif 1`) && await bodyHas(page, `${TAG} Notif 3`));

  // Mark all read → hub empties. Wait for the button to be enabled, then for the
  // PATCH to actually come back before asserting (it's fired async by the handler).
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Mark all read"));
    return b && !b.disabled;
  }, { timeout: 15000 });
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/notifications") && r.request().method() === "PATCH", { timeout: 15000 }),
    page.getByRole("button", { name: "Mark all read" }).click(),
  ]);
  ok("'Mark all read' fired PATCH all → 200", resp.status() === 200);
  // Wait for the view to SETTLE: empty-state shown AND the items gone (not a
  // mid-transition frame). The dev server is slow, so give it room.
  await page.waitForFunction((t) => {
    const b = document.body.innerText;
    return b.includes("No unread notifications") && !b.includes(t);
  }, `${TAG} Notif 1`, { timeout: 20000 }).catch(() => {});
  ok("after 'Mark all read' the hub is empty", (await bodyHas(page, "No unread notifications")) && !(await bodyHas(page, `${TAG} Notif 1`)));

  // They're KEPT — visible under All
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForFunction((t) => document.body.innerText.includes(t), `${TAG} Notif 1`, { timeout: 10000 }).catch(() => {});
  ok("notifications still kept under 'All'", await bodyHas(page, `${TAG} Notif 1`) && await bodyHas(page, `${TAG} Notif 3`));

  // Still in the DB, now read
  const rows = await db.notification.findMany({ where: { userId: u.user.id, title: { startsWith: TAG } }, select: { isRead: true } });
  ok("all 3 kept in DB", rows.length === 3, `got ${rows.length}`);
  ok("all 3 marked read", rows.every((r) => r.isRead));

  // Reload → default Unread → stays empty (hiding persists)
  await page.goto(`${BROWSER_BASE}/notifications`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction((t) => {
    const b = document.body.innerText;
    return b.includes("No unread notifications") && !b.includes(t);
  }, `${TAG} Notif 1`, { timeout: 20000 }).catch(() => {});
  ok("reload: hub still empty (hiding persists)", (await bodyHas(page, "No unread notifications")) && !(await bodyHas(page, `${TAG} Notif 1`)));
} catch (e) {
  fail++; console.error("CRASH", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.notification.deleteMany({ where: { userId: u.user.id } }).catch(() => {});
  await destroyUser(u).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

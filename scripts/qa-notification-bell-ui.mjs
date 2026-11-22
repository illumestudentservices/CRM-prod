/**
 * Browser test for the notification bell fixes:
 *   • on first page of a session (post-login), unread notifications pop up as
 *     toasts without opening the bell
 *   • the bell badge shows the correct unread count
 *   • the badge refreshes on its own (tab focus) when a new one arrives — no
 *     click needed
 * Seeds notifications for a throwaway user; cleans up.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-notification-bell-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, createAndLogin, destroyUser, db } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const user = await createAndLogin({ role: "EMPLOYEE" });
let browser, fail = 0;
const ok = (n, c, x = "") => { if (c) console.log(`  ✓ ${n}`); else { fail++; console.log(`  ✗ ${n} ${x}`); } };

const tag = Date.now().toString().slice(-6);
const mkNotif = (title) => db.notification.create({
  data: { userId: user.user.id, title, message: `${title} body`, type: "SYSTEM", isRead: false },
});

try {
  await mkNotif(`QA Notif A ${tag}`);
  await mkNotif(`QA Notif B ${tag}`);
  await mkNotif(`QA Notif C ${tag}`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([...user.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  await page.goto(`${BROWSER_BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });

  // Login popup (async fetch on mount): wait for a seeded title to toast.
  const toastShown = await page.getByText(`QA Notif A ${tag}`).first()
    .waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  ok("login popup toasts an unread notification", toastShown);

  // Bell badge shows 3 — now server-rendered, so it's there without a click.
  const bell = page.getByRole("button", { name: /Notifications/ });
  let badge1 = "";
  for (let i = 0; i < 12; i++) {
    badge1 = (await bell.innerText().catch(() => "")).replace(/\s+/g, "");
    if (/3/.test(badge1)) break;
    await page.waitForTimeout(400);
  }
  ok("bell badge shows 3 unread (no click)", /3/.test(badge1), `badge="${badge1}"`);

  // A new notification arrives; the badge updates on tab focus WITHOUT a click.
  await mkNotif(`QA Notif D ${tag}`);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1500);
  const badge2 = (await bell.innerText().catch(() => "")).replace(/\s+/g, "");
  ok("badge refreshes to 4 on focus (no click)", /4/.test(badge2), `badge="${badge2}"`);

  // Opening the bell shows the list.
  await bell.click();
  await page.waitForTimeout(800);
  ok("panel lists the notifications", (await page.getByText(`QA Notif B ${tag}`).count()) >= 1);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.notification.deleteMany({ where: { userId: user.user.id } }).catch(() => {});
  await destroyUser(user).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(fail ? `\n  ${fail} failed` : "\n  all passed");
  process.exit(fail ? 1 : 0);
}

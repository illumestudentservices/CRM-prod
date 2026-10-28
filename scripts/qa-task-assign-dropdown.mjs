/**
 * The assignee dropdown on the Tasks page must list EVERYONE for a super admin,
 * even one with no direct reports — the UI must match the server rule that a
 * super admin can assign to anyone.
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-assign-dropdown.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, admin;
try {
  // A fresh super admin with NO direct reports: before the fix their assignee
  // list would be just themselves, so a large list proves the change.
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const activeEmployees = await db.employee.count({ where: { user: { isActive: true, deletedAt: null } } });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const p = await ctx.newPage();
  await p.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  startSection("Super admin assignee dropdown lists everyone");
  await p.getByRole("button", { name: /Create Task/i }).click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  // Open the assignee select (its trigger shows "Select assignee").
  await dialog.getByText("Select assignee").click();
  await p.getByRole("option").first().waitFor({ state: "visible", timeout: 10000 });
  const optionCount = await p.getByRole("option").count();
  // Options = "Unassigned" + every active employee.
  expect(optionCount > 5, "the list is clearly more than just the admin themselves", `options=${optionCount}`);
  expect(optionCount >= activeEmployees, "the list covers all active employees", `options=${optionCount} active=${activeEmployees}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

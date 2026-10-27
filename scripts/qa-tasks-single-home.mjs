/**
 * Verifies the Tasks tab is removed from HR & ERP, and that a task created via
 * the old HR tasks API still appears on the main Tasks page (same records).
 *
 *   npx tsx --env-file=.env.local scripts/qa-tasks-single-home.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, rm;
const createdTaskIds = [];

try {
  browser = await chromium.launch();
  const region = await db.region.findFirst({ select: { id: true } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: region?.id ?? null } });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  await ctx.addCookies([...rm.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const page = await ctx.newPage();

  // 1. Create a task via the (old) HR tasks API — what the HR tab used to do.
  const title = `QA HR-created task ${TAG}`;
  const post = await ctx.request.post(`${B}/api/hr/tasks`, {
    data: { title, priority: "MEDIUM" }, headers: { "Content-Type": "application/json" },
  });
  const created = await post.json().catch(() => ({}));
  const taskId = created?.task?.id ?? created?.id ?? created?.data?.id;
  if (taskId) createdTaskIds.push(taskId);

  startSection("HR-created task appears on the main Tasks API");
  expect(post.ok(), `POST /api/hr/tasks ok (${post.status()})`, String(post.status()));
  const mainGet = await ctx.request.get(`${B}/api/tasks`);
  const mainBody = await mainGet.json().catch(() => ({}));
  const mainList = mainBody.data ?? mainBody.tasks ?? (Array.isArray(mainBody) ? mainBody : []);
  expect(mainList.some((t) => t.title === title), "task shows in main /api/tasks (own + created scope)");

  // 2. HR & ERP page: no Tasks tab, other tabs intact.
  startSection("HR & ERP no longer has a Tasks tab");
  await page.goto(`${B}/hr`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  expect((await page.getByRole("tab", { name: "Tasks" }).count()) === 0, "no 'Tasks' tab in HR & ERP");
  expect((await page.getByRole("tab", { name: "Leave Management" }).count()) >= 1, "other HR tabs still render");
  expect((await page.getByText("Open Tasks").count()) >= 1, "'Open Tasks' stat card still shown");

  // 3. Clicking the Open Tasks card navigates to the main Tasks page.
  await page.getByText("Open Tasks").first().click().catch(() => {});
  await page.waitForURL(/\/tasks/, { timeout: 15000 }).catch(() => {});
  expect(/\/tasks/.test(page.url()), "Open Tasks card navigates to /tasks", page.url());

  // 4. The HR-created task is visible on the main Tasks page.
  startSection("Main Tasks page shows the HR-created task");
  await page.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  expect((await page.getByText(title, { exact: false }).count()) >= 1, "HR-created task visible on /tasks");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  try { if (createdTaskIds.length) await db.task.deleteMany({ where: { id: { in: createdTaskIds } } }); } catch (e) { console.error("[cleanup]", e?.message); }
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

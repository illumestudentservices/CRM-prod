/**
 * Browser smoke test for the task ticket: a task row is clickable, opens the
 * ticket dialog with its details + notes thread, and a note posted from the UI
 * shows up in the thread.
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-ticket-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
let browser, rm, task;
try {
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  task = await db.task.create({
    data: {
      title: `${TAG} click me`,
      description: "Full description visible in the ticket.",
      createdById: rm.employee.id,
      assigneeId: rm.employee.id,
    },
  });

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([...rm.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const p = await ctx.newPage();
  await p.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

  startSection("Task row opens the ticket");
  const row = p.getByText(`${TAG} click me`, { exact: false }).first();
  expect((await row.count()) >= 1, "the task is listed");
  await row.click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  expect(await dialog.isVisible(), "ticket dialog opened on click");
  expect((await dialog.getByText("Full description visible in the ticket.").count()) >= 1, "full description shown");
  expect((await dialog.getByText("Notes").count()) >= 1, "notes section present");

  startSection("Posting a note from the UI");
  const composer = dialog.getByPlaceholder("Write a note… (Ctrl+Enter to send)");
  await composer.waitFor({ state: "visible", timeout: 10000 });
  const noteText = `UI note ${TAG}`;
  await composer.fill(noteText);
  await composer.press("Control+Enter");
  await p.waitForTimeout(1500);
  expect((await dialog.getByText(noteText).count()) >= 1, "the posted note appears in the thread");

  // And it really persisted.
  const saved = await db.taskComment.count({ where: { taskId: task.id } });
  expect(saved === 1, "note persisted to task_comments", `count=${saved}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (task) await db.task.delete({ where: { id: task.id } }).catch(() => {});
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

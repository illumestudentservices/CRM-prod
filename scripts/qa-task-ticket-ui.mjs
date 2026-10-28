/**
 * Browser smoke test for the task ticket: a task row is clickable, opens the
 * ticket dialog with its details + notes thread, and a note posted from the UI
 * shows up in the thread.
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-ticket-ui.mjs
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, sleep, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");

async function openTicket(ctx, title) {
  const p = await ctx.newPage();
  await p.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const row = p.getByText(title, { exact: false }).first();
  expect((await row.count()) >= 1, "the task is listed");
  await row.click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  return { p, dialog };
}
function ctxFor(browser, login) {
  return browser.newContext({ viewport: { width: 1400, height: 1000 } }).then(async (ctx) => {
    await ctx.addCookies([...login.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
    return ctx;
  });
}

let browser, rm, icr, ownTask, assignedTask;
try {
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  ownTask = await db.task.create({
    data: {
      title: `${TAG} own task`,
      description: "Full description visible in the ticket.",
      createdById: rm.employee.id, assigneeId: rm.employee.id,
    },
  });
  // Created by RM, assigned to ICR → ICR is the assignee (not the creator).
  assignedTask = await db.task.create({
    data: { title: `${TAG} assigned task`, createdById: rm.employee.id, assigneeId: icr.employee.id },
  });

  browser = await chromium.launch();
  const rmCtx = await ctxFor(browser, rm);
  const icrCtx = await ctxFor(browser, icr);

  // ── Creator: clickable, notes work, priority/due editable ───────────────
  startSection("Creator — row opens ticket, notes + edit work");
  const { p, dialog } = await openTicket(rmCtx, `${TAG} own task`);
  expect(await dialog.isVisible(), "ticket opened on click");
  expect((await dialog.getByText("Full description visible in the ticket.").count()) >= 1, "full description shown");
  expect((await dialog.getByText("Notes").count()) >= 1, "notes section present");
  // Priority control is an editable combobox for the creator.
  expect((await dialog.getByRole("combobox").count()) >= 2, "creator sees editable status + priority");

  const composer = dialog.getByPlaceholder(/Write a note/);
  await composer.fill(`UI note ${TAG}`);
  await composer.press("Control+Enter");
  // Wait for the note to render (only happens after the 201 response lands),
  // which also guarantees the DB write is committed before we check it.
  await dialog.getByText(`UI note ${TAG}`).first().waitFor({ state: "visible", timeout: 15000 });
  expect(true, "the posted note appears in the thread");
  let savedCount = 0;
  for (let i = 0; i < 20; i++) {
    savedCount = await db.taskComment.count({ where: { taskId: ownTask.id } });
    if (savedCount >= 1) break;
    await sleep(300);
  }
  expect(savedCount === 1, "note persisted", `count=${savedCount}`);

  // ── Assignee: priority/due are read-only ────────────────────────────────
  startSection("Assignee — priority/due are read-only");
  const { dialog: d2 } = await openTicket(icrCtx, `${TAG} assigned task`);
  expect(await d2.isVisible(), "assignee can open the ticket");
  expect((await d2.getByText("Only the person who raised this task").count()) >= 1, "read-only notice shown to assignee");
  // Only ONE combobox (status). Priority is a static badge, due is static text.
  expect((await d2.getByRole("combobox").count()) === 1, "assignee sees status only (no priority combobox)");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const t of [ownTask, assignedTask]) if (t) await db.task.delete({ where: { id: t.id } }).catch(() => {});
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

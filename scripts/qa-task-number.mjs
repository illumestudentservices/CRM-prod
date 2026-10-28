/**
 * Every task gets a globally-unique, human-readable ticket number (TSK-0001…):
 *   - a newly created task is assigned one automatically, and it increments;
 *   - it appears in the task emails' subject;
 *   - it appears in the list row and the ticket header.
 *
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-task-number.mjs
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, api, startSection, expect, summary, sleep, TAG } from "./qa-lib.mjs";

const B = BASE.replace("127.0.0.1", "localhost");
const fmt = (n) => `TSK-${String(n).padStart(4, "0")}`;

const DEV_LOG = process.env.DEV_LOG;
if (!DEV_LOG || !fs.existsSync(DEV_LOG)) { console.error(`[fatal] DEV_LOG not found: ${DEV_LOG}`); process.exit(1); }
let logOffset = fs.statSync(DEV_LOG).size;
function newEmailLines() {
  const size = fs.statSync(DEV_LOG).size;
  const fd = fs.openSync(DEV_LOG, "r");
  const buf = Buffer.alloc(Math.max(0, size - logOffset));
  if (buf.length) fs.readSync(fd, buf, 0, buf.length, logOffset);
  fs.closeSync(fd);
  logOffset = size;
  return buf.toString("utf8").split("\n").filter((l) => l.includes("[email]"));
}

let browser, admin, icr, taskIds = [];
try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  newEmailLines();

  // ── 1. Auto-assigned + increments ───────────────────────────────────────
  startSection("A new task gets a unique ticket number that increments");
  const t1 = await db.task.create({ data: { title: `${TAG} n1`, createdById: admin.employee.id, assigneeId: admin.employee.id } });
  const t2 = await db.task.create({ data: { title: `${TAG} n2`, createdById: admin.employee.id, assigneeId: admin.employee.id } });
  taskIds.push(t1.id, t2.id);
  expect(typeof t1.taskNumber === "number" && t1.taskNumber > 0, "task 1 has a ticket number", `n=${t1.taskNumber}`);
  expect(typeof t2.taskNumber === "number" && t2.taskNumber > t1.taskNumber, "task 2's number is higher", `${t1.taskNumber} -> ${t2.taskNumber}`);
  const dupes = await db.task.groupBy({ by: ["taskNumber"], _count: { _all: true }, having: { taskNumber: { _count: { gt: 1 } } } });
  expect(dupes.length === 0, "no two tasks share a ticket number");

  // ── 2. Ticket number in the email subject ───────────────────────────────
  startSection("The ticket number appears in task emails");
  const r = await api(admin.jar, "POST", "/api/hr/tasks", { title: `${TAG} emailed`, category: "PERSONAL", priority: "MEDIUM", assigneeId: icr.employee.id });
  expect(r.ok, "admin created + assigned a task to the ICR", `got ${r.status}`);
  const emailedTaskId = r.payload?.task?.id ?? r.payload?.id;
  if (emailedTaskId) taskIds.push(emailedTaskId);
  const emailedTask = await db.task.findUnique({ where: { id: emailedTaskId }, select: { taskNumber: true } });
  await sleep(1500);
  const lines = newEmailLines();
  expect(lines.some((l) => l.includes(`to: ${icr.email}`) && l.includes(fmt(emailedTask.taskNumber))),
    `the assignment email subject carries ${fmt(emailedTask.taskNumber)}`);

  // ── 3. Ticket number shown in the UI ────────────────────────────────────
  startSection("The ticket number shows in the list and the ticket");
  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })));
  const p = await ctx.newPage();
  await p.goto(`${B}/tasks`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const label = fmt(t1.taskNumber);
  expect((await p.getByText(label, { exact: false }).count()) >= 1, `the list shows ${label}`);
  await p.getByText(`${TAG} n1`, { exact: false }).first().click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  expect((await dialog.getByText(label, { exact: false }).count()) >= 1, `the ticket header shows ${label}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const id of taskIds) await db.task.delete({ where: { id } }).catch(() => {});
  if (icr) await destroyUser(icr);
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

/**
 * You see your own tasks and the ones you allocated. Nothing else, by any
 * route, for anyone.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-task-visibility.mjs
 *
 * ★ WHY THIS IS A LONG LIST OF PROBES AND NOT THREE.
 *
 * A visibility rule is only as strong as the widest surface that ignores it,
 * and tasks are read from nine places. Before this, four of them answered
 * freely: GET /api/hr/tasks returned every task in the company to an HR role,
 * GET /api/tasks did the same behind `tasks:approve`, an employee's HR profile
 * listed everything assigned to them, and a field operation listed every task
 * raised from it. Two more let you WRITE without seeing: PATCH and DELETE on
 * /api/tasks/[id] needed a permission and an id, nothing more.
 *
 * So each surface gets its own probe, and the cast is built so that every
 * plausible "but surely THIS person can" is represented: an HR-roled super
 * admin, a line manager who did not allocate the task, and an unrelated
 * colleague.
 *
 *            boss (SUPER_ADMIN, raised the task)
 *              └── worker (EMPLOYEE, holds the task)
 *
 *            other (SUPER_ADMIN, HR role, no relationship)
 *            colleague (EMPLOYEE, no relationship)
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, api, BASE,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const { generate: totpGenerate } = await import("otplib");

const ctxs = [];
let browser;

async function signIn(page, acct) {
  const { twoFactorSecret } = await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 });
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 40000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate({ secret: twoFactorSecret }));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 40000 });
}

/** Does this listing payload mention the secret task? */
const mentions = (payload, title) => JSON.stringify(payload ?? {}).includes(title);

async function main() {
  startSection("One task, and three people with no claim on it");

  const boss = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(boss);
  const worker = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(worker);
  const other = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(other);
  const colleague = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(colleague);

  // `other` is given the worker as a direct report WITHOUT allocating the task,
  // which is the case the attachment gate briefly allowed and this rule does
  // not: being somebody's manager is not the same as having given them this.
  await db.employee.update({
    where: { id: worker.employee.id }, data: { managerId: boss.employee.id },
  });

  const SECRET = `${TAG} confidential errand`;
  const created = await api(boss.jar, "POST", "/api/hr/tasks", {
    title: SECRET,
    description: "Nobody outside this task should ever read this line.",
    assigneeId: worker.employee.id,
    category: "INTERNAL",
    dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
  });
  expect(created.status === 201, "the manager allocates it to their report");
  const taskId = created.payload?.task?.id;
  if (!taskId) throw new Error("no task id");

  // ── The two people who should see it ─────────────────────────────────────
  startSection("The two people on it can see it");

  const asWorker = await api(worker.jar, "GET", "/api/hr/tasks");
  expect(mentions(asWorker.payload, SECRET), "*** the person it is assigned to ***");

  const asBoss = await api(boss.jar, "GET", "/api/hr/tasks");
  expect(mentions(asBoss.payload, SECRET),
    "*** and the person who allocated it — this used to be invisible to them ***");

  const bossOwnOnly = await api(boss.jar, "GET", "/api/tasks?scope=mine");
  expect(!mentions(bossOwnOnly.payload, SECRET),
    "scope=mine still means assigned-to-me only");

  // ── Everybody else ───────────────────────────────────────────────────────
  startSection("An unrelated SUPER_ADMIN with an HR role sees nothing");

  for (const [label, jar] of [["super admin", other.jar], ["colleague", colleague.jar]]) {
    const hr = await api(jar, "GET", "/api/hr/tasks");
    expect(!mentions(hr.payload, SECRET), `GET /api/hr/tasks hides it from the ${label}`,
      JSON.stringify(hr.payload).slice(0, 120));

    const all = await api(jar, "GET", "/api/tasks?scope=all");
    expect(!mentions(all.payload, SECRET), `?scope=all hides it from the ${label}`,
      JSON.stringify(all.payload).slice(0, 120));

    const targeted = await api(jar, "GET", `/api/tasks?scope=all&assigneeId=${worker.employee.id}`);
    expect(!mentions(targeted.payload, SECRET),
      `asking for that employee by id hides it from the ${label}`,
      JSON.stringify(targeted.payload).slice(0, 120));

    const profile = await api(jar, "GET", `/api/hr/employees/${worker.employee.id}`);
    expect(!mentions(profile.payload?.openTasks ?? [], SECRET),
      `their HR profile hides it from the ${label}`,
      JSON.stringify(profile.payload?.openTasks ?? []).slice(0, 120));
  }

  startSection("And cannot write to it either");

  const edit = await api(other.jar, "PATCH", `/api/tasks/${taskId}`, { title: `${TAG} hijacked` });
  expect(edit.status === 404, "*** PATCH /api/tasks/[id] refuses ***", `status ${edit.status}`);

  const editHr = await api(other.jar, "PATCH", `/api/hr/tasks/${taskId}`, { status: "DONE" });
  expect(editHr.status === 404, "*** PATCH /api/hr/tasks/[id] refuses ***", `status ${editHr.status}`);

  const wipe = await api(other.jar, "DELETE", `/api/tasks/${taskId}`);
  expect(wipe.status === 404, "*** DELETE refuses — it used to need only an id ***",
    `status ${wipe.status}`);

  const still = await db.task.findUnique({
    where: { id: taskId }, select: { title: true, status: true, deletedAt: true },
  });
  expect(still?.title === SECRET && still?.status === "TODO" && !still?.deletedAt,
    "the task is untouched after all of that",
    `${still?.title?.slice(0, 30)}, ${still?.status}, deleted=${!!still?.deletedAt}`);

  // ── Who may delete ───────────────────────────────────────────────────────
  startSection("Only the person who allocated it may delete it");

  const assigneeDelete = await api(worker.jar, "DELETE", `/api/tasks/${taskId}`);
  expect(assigneeDelete.status === 403,
    "the assignee cannot delete work that was given to them", `status ${assigneeDelete.status}`);
  expect(/raised this task/i.test(JSON.stringify(assigneeDelete.payload)),
    "and is told why", JSON.stringify(assigneeDelete.payload).slice(0, 120));

  const assigneeStatus = await api(worker.jar, "PATCH", `/api/hr/tasks/${taskId}`, {
    status: "IN_PROGRESS",
  });
  expect(assigneeStatus.status === 200, "but can still report progress on it",
    `status ${assigneeStatus.status}`);

  const assigneeRetitle = await api(worker.jar, "PATCH", `/api/hr/tasks/${taskId}`, {
    title: `${TAG} renamed by assignee`,
  });
  const afterRetitle = await db.task.findUnique({ where: { id: taskId }, select: { title: true } });
  expect(afterRetitle?.title === SECRET,
    "and cannot rewrite what was asked of them",
    `status ${assigneeRetitle.status}, title now ${afterRetitle?.title?.slice(0, 40)}`);

  // ── Attachments follow the task ──────────────────────────────────────────
  startSection("The files follow the task, not the module");

  const { canSeeTask } = await import("../lib/task-visibility.ts");
  const { canAccessParentRow } = await import("../lib/attachment-parent.ts");

  expect(await canSeeTask(worker.user.id, taskId), "the assignee can reach its files");
  expect(await canSeeTask(boss.user.id, taskId), "so can the person who allocated it");
  expect(!(await canAccessParentRow("TASK", taskId, { userId: other.user.id, role: "SUPER_ADMIN" })),
    "*** an unrelated super admin cannot ***");

  const managerNotAllocator = await db.employee.update({
    where: { id: worker.employee.id }, data: { managerId: other.employee.id },
  });
  expect(managerNotAllocator.managerId === other.employee.id, "the worker is re-pointed at a new manager");
  expect(!(await canAccessParentRow("TASK", taskId, { userId: other.user.id, role: "SUPER_ADMIN" })),
    "*** and nor can their line manager, who did not allocate this one ***");
  await db.employee.update({
    where: { id: worker.employee.id }, data: { managerId: boss.employee.id },
  });

  // ── The page, not just the API ───────────────────────────────────────────
  startSection("The screens agree with the rule");

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await signIn(page, other);

  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const tasksPage = await page.locator("main").innerText();
  expect(!tasksPage.includes("confidential errand"),
    "*** the Tasks page does not show it to an unrelated super admin ***",
    tasksPage.replace(/\n/g, " ").slice(0, 200));

  await page.goto(`${BASE}/hr?tab=tasks`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);
  const hrPage = await page.locator("main").innerText();
  expect(!hrPage.includes("confidential errand"),
    "*** nor does the HR task board ***", hrPage.replace(/\n/g, " ").slice(0, 200));

  // The stat card must agree with the board under it, or the difference is
  // itself the disclosure.
  const openCard = hrPage.match(/Open Tasks\s*\n?\s*(\d+)/i);
  expect(openCard ? Number(openCard[1]) === 0 : true,
    "and the Open Tasks card counts only what they can see",
    openCard ? `card reads ${openCard[1]}` : "card not found on this tab");

  await page.context().close();
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  if (browser) await browser.close().catch(() => {});
  for (const c of ctxs) {
    if (c.employee) {
      await db.employee.updateMany({ where: { managerId: c.employee.id }, data: { managerId: null } }).catch(() => {});
    }
  }
  for (const c of ctxs) {
    if (c.employee) {
      const mine = await db.task.findMany({
        where: { OR: [{ createdById: c.employee.id }, { assigneeId: c.employee.id }] },
        select: { id: true },
      }).catch(() => []);
      const ids = mine.map((t) => t.id);
      if (ids.length) {
        await db.attachment.deleteMany({ where: { parentType: "TASK", parentId: { in: ids } } }).catch(() => {});
        await db.taskReminder.deleteMany({ where: { taskId: { in: ids } } }).catch(() => {});
        await db.task.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
      }
    }
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);

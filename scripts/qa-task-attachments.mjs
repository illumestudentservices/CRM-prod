/**
 * Attachments on a task: can you add one, read it back, download it, delete it
 * — and crucially, can somebody who has nothing to do with the task do any of
 * those things?
 *
 *   node --import tsx --env-file=.env.local scripts/qa-task-attachments.mjs
 *
 * The plumbing already existed: `TASK` has been in AttachmentParentType since
 * the polymorphic attachment system was built, and the Tasks screen has had an
 * Attachments item in its row menu. What had never been checked is the gate.
 * `canReadParent(role, "TASK")` asks one question — does this ROLE hold
 * tasks:read — and every role that can see the Tasks page holds it. Whether the
 * caller has anything to do with THIS task was not part of the question.
 *
 * So the probes below are deliberately written from the attacker's side: a
 * second employee, no relationship to the task, holding only the permission
 * every member of staff holds.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, api, BASE,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const { generate: totpGenerate } = await import("otplib");

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

const ctxs = [];

/** multipart upload — `api()` only speaks JSON. */
async function upload(jar, parentType, parentId, filename, content, mime = "text/plain") {
  const form = new FormData();
  form.append("file", new File([content], filename, { type: mime }));
  const res = await fetch(
    `${BASE}/api/attachments?parentType=${parentType}&parentId=${parentId}`,
    { method: "POST", headers: { Cookie: jar.header() }, body: form }
  );
  let payload = null;
  try { payload = await res.json(); } catch { /* empty body */ }
  return { status: res.status, payload };
}

async function download(jar, id) {
  const res = await fetch(`${BASE}/api/attachments/${id}`, { headers: { Cookie: jar.header() } });
  const body = res.ok ? await res.text() : "";
  return { status: res.status, body, headers: res.headers };
}

async function main() {
  startSection("Two people and one task between them");

  const boss = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(boss);
  const worker = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(worker);
  const stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(stranger);

  await db.employee.update({
    where: { id: worker.employee.id },
    data: { managerId: boss.employee.id },
  });

  const created = await api(boss.jar, "POST", "/api/hr/tasks", {
    title: `${TAG} task with paperwork`,
    assigneeId: worker.employee.id,
    category: "INTERNAL",
    dueDate: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10),
  });
  expect(created.status === 201, "the manager raises a task for their report");
  const taskId = created.payload?.task?.id;
  if (!taskId) throw new Error("no task id");

  startSection("The people on the task can use attachments");

  const up = await upload(boss.jar, "TASK", taskId, "brief.txt", "The brief for this task.");
  expect(up.status === 201, "*** the manager can attach a file to the task ***",
    `status ${up.status} ${JSON.stringify(up.payload).slice(0, 140)}`);
  const attId = up.payload?.data?.id;

  const list = await api(boss.jar, "GET", `/api/attachments?parentType=TASK&parentId=${taskId}`);
  expect(list.status === 200 && (list.payload?.data ?? []).length === 1,
    "and see it listed against the task", `${(list.payload?.data ?? []).length} file(s)`);
  expect(list.payload?.data?.[0]?.name === "brief.txt", "under the name they gave it",
    String(list.payload?.data?.[0]?.name));

  const theirs = await upload(worker.jar, "TASK", taskId, "evidence.txt", "Done, see attached.");
  expect(theirs.status === 201, "*** the assignee can attach their own work back ***",
    `status ${theirs.status} ${JSON.stringify(theirs.payload).slice(0, 140)}`);

  const got = await download(worker.jar, attId);
  expect(got.status === 200 && got.body === "The brief for this task.",
    "the assignee can download what the manager attached", `status ${got.status}`);
  expect(/attachment/i.test(got.headers.get("content-disposition") ?? ""),
    "served as a download, never inline",
    got.headers.get("content-disposition") ?? "no header");

  startSection("Somebody with nothing to do with the task");

  const peek = await api(stranger.jar, "GET", `/api/attachments?parentType=TASK&parentId=${taskId}`);
  expect(peek.status === 403 || peek.status === 404,
    "*** cannot list the files on it ***",
    `status ${peek.status}, ${(peek.payload?.data ?? []).length} file(s) returned`);

  const steal = await download(stranger.jar, attId);
  expect(steal.status === 403 || steal.status === 404,
    "*** cannot download one by id ***",
    `status ${steal.status}${steal.body ? `, got ${steal.body.length} bytes of content` : ""}`);

  const push = await upload(stranger.jar, "TASK", taskId, "unwanted.txt", "I was never here.");
  expect(push.status === 403 || push.status === 404,
    "*** and cannot attach anything to it ***",
    `status ${push.status} ${JSON.stringify(push.payload).slice(0, 120)}`);

  const wipe = await fetch(`${BASE}/api/attachments/${attId}`, {
    method: "DELETE", headers: { Cookie: stranger.jar.header() },
  });
  expect(wipe.status === 403 || wipe.status === 404,
    "*** nor delete somebody else's ***", `status ${wipe.status}`);

  const survived = await db.attachment.count({ where: { parentId: taskId, deletedAt: null } });
  expect(survived === 2, "both real files are still there afterwards", `${survived} file(s)`);

  startSection("What the gate refuses outright");

  const nasty = await upload(boss.jar, "TASK", taskId, "payload.html", "<script>alert(1)</script>", "text/html");
  expect(nasty.status === 415, "an HTML file is refused — it would run in the browser",
    `status ${nasty.status} ${JSON.stringify(nasty.payload).slice(0, 120)}`);

  const ghost = await upload(boss.jar, "TASK", "00000000-0000-0000-0000-000000000000", "x.txt", "x");
  expect(ghost.status === 404, "attaching to a task that does not exist is a 404",
    `status ${ghost.status}`);

  // ── The page itself, not just the API ────────────────────────────────────
  //
  // The attachment gate is only worth as much as the page it sits behind. The
  // Tasks screen loaded `where: { deletedAt: null }` — every task in the
  // company — so a stranger could read the title of work that was none of
  // their business even once the files were locked away. Checked in a browser
  // because it is a server component: there is no endpoint to probe.
  startSection("The Tasks page shows a stranger only their own work");

  browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await signIn(page, stranger);

  const ownTask = await api(stranger.jar, "POST", "/api/hr/tasks", {
    title: `${TAG} strangers own errand`,
    assigneeId: stranger.employee.id,
    category: "INTERNAL",
  });
  expect(ownTask.status === 201, "the stranger raises a task of their own");

  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  const shown = await page.locator("main").innerText();

  expect(shown.includes("strangers own errand"),
    "they see their own task on the page");
  expect(!shown.includes("task with paperwork"),
    "*** and not somebody else's, which the page used to list for everyone ***",
    shown.replace(/\n/g, " ").slice(0, 220));

  startSection("The uploader can always remove their own");

  const mine = await db.attachment.findFirst({
    where: { parentId: taskId, uploadedById: worker.user.id, deletedAt: null },
    select: { id: true },
  });
  const delOwn = await fetch(`${BASE}/api/attachments/${mine.id}`, {
    method: "DELETE", headers: { Cookie: worker.jar.header() },
  });
  expect(delOwn.status === 200, "the assignee deletes the file they uploaded",
    `status ${delOwn.status}`);
  const after = await db.attachment.count({ where: { parentId: taskId, deletedAt: null } });
  expect(after === 1, "leaving the manager's brief in place", `${after} file(s)`);
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
        await db.deletedRecord.deleteMany({ where: { entityType: "Attachment" } }).catch(() => {});
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

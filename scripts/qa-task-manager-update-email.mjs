/**
 * Verifies the new rule: when an employee makes a KEY change to a task, the
 * editor's manager gets a "Task updated" email. Minor edits do not notify, and
 * an editor with no manager notifies nobody.
 *
 * Key events: marked complete, cancelled, reassigned, due date changed,
 * priority changed. (See summariseKeyTaskChanges.)
 *
 * Asserts from the dev-server email log (no BREVO_API_KEY → safeSend logs
 * `[email] Skipped … to: <addr>, subject: <subj>` instead of sending).
 *
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-task-manager-update-email.mjs
 */
import fs from "node:fs";
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, sleep, TAG } from "./qa-lib.mjs";

const DEV_LOG = process.env.DEV_LOG;
if (!DEV_LOG || !fs.existsSync(DEV_LOG)) {
  console.error(`[fatal] DEV_LOG not found: ${DEV_LOG}`);
  process.exit(1);
}

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
const emailed = (lines, addr, needle) =>
  lines.some((l) => l.includes(`to: ${addr}`) && l.includes(needle));

async function mkTask(createdByEid, assigneeEid, title, extra = {}) {
  return db.task.create({
    data: { title, createdById: createdByEid, assigneeId: assigneeEid, ...extra },
  });
}

let rm, editor, t1, t2, t3;
try {
  // Manager with NO manager above them (and no region, so resolveManager's
  // region fallback can't find a stand-in) — needed for the negative test.
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  // The editor reports to the RM.
  editor = await createAndLogin({ role: "ICR", withEmployee: true });
  await db.employee.update({ where: { id: editor.employee.id }, data: { managerId: rm.employee.id } });

  // Editor owns (creates + is assigned) their tasks, so the HR route lets them
  // change every field — the realistic "employee working their own task" case.
  t1 = await mkTask(editor.employee.id, editor.employee.id, `${TAG} complete-me`);
  t2 = await mkTask(editor.employee.id, editor.employee.id, `${TAG} edit-me`); // dueDate null
  t3 = await mkTask(rm.employee.id, rm.employee.id, `${TAG} rm-task`);

  newEmailLines(); // drop setup noise

  // ── 1. Mark complete → manager emailed ──────────────────────────────────
  startSection("Employee marks task done → manager emailed");
  let r = await api(editor.jar, "PATCH", `/api/hr/tasks/${t1.id}`, { status: "DONE" });
  expect(r.status === 200, "status change accepted", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
  await sleep(1500);
  expect(emailed(newEmailLines(), rm.email, `Task updated: ${TAG} complete-me`), "manager got the update email");

  // ── 2. Change priority → manager emailed ────────────────────────────────
  startSection("Employee changes priority → manager emailed");
  r = await api(editor.jar, "PATCH", `/api/hr/tasks/${t2.id}`, { priority: "HIGH" });
  expect(r.status === 200, "priority change accepted", `got ${r.status}`);
  await sleep(1500);
  expect(emailed(newEmailLines(), rm.email, `Task updated: ${TAG} edit-me`), "manager got the priority-change email");

  // ── 3. Change due date → manager emailed ────────────────────────────────
  startSection("Employee changes due date → manager emailed");
  r = await api(editor.jar, "PATCH", `/api/hr/tasks/${t2.id}`, { dueDate: new Date(Date.now() + 5 * 86400000).toISOString() });
  expect(r.status === 200, "due date change accepted", `got ${r.status}`);
  await sleep(1500);
  expect(emailed(newEmailLines(), rm.email, `Task updated: ${TAG} edit-me`), "manager got the due-date-change email");

  // ── 4. Minor edit (description) → NO email ───────────────────────────────
  startSection("Minor edit (description only) → manager NOT emailed");
  r = await api(editor.jar, "PATCH", `/api/hr/tasks/${t2.id}`, { description: "just a note, nothing structural" });
  expect(r.status === 200, "description change accepted", `got ${r.status}`);
  await sleep(1500);
  expect(!emailed(newEmailLines(), rm.email, "Task updated"), "no email for a minor edit");

  // ── 5. Editor with no manager (RM edits own task) → nobody emailed ──────
  startSection("Editor has no manager → nobody emailed");
  r = await api(rm.jar, "PATCH", `/api/hr/tasks/${t3.id}`, { status: "DONE" });
  expect(r.status === 200, "RM status change accepted", `got ${r.status}`);
  await sleep(1500);
  expect(!emailed(newEmailLines(), "", "Task updated"), "no 'Task updated' email sent at all");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (editor) await db.employee.update({ where: { id: editor.employee.id }, data: { managerId: null } }).catch(() => {});
  if (editor) await destroyUser(editor);
  if (rm) await destroyUser(rm);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

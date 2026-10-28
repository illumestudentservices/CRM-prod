/**
 * Verifies the task ticket notes thread:
 *   - the two people on a task (creator + assignee) can read and post notes;
 *   - a new note emails the OTHER person (manager ↔ assignee) + logs a bell;
 *   - someone who is neither gets 404 from GET and POST;
 *   - editing status/priority/due via the ticket's PATCH still works.
 *
 * Asserts email recipients from the dev-server log (no BREVO_API_KEY).
 *
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-task-comments.mjs
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

let rm, icr, outsider, task;
try {
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });   // creator / "manager"
  icr = await createAndLogin({ role: "ICR", withEmployee: true });               // assignee
  outsider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });     // neither

  task = await db.task.create({
    data: { title: `${TAG} ticket task`, createdById: rm.employee.id, assigneeId: icr.employee.id },
  });
  const C = `/api/tasks/${task.id}/comments`;
  newEmailLines();

  // ── Access + empty thread ───────────────────────────────────────────────
  startSection("The two people can open the thread; others cannot");
  let r = await api(icr.jar, "GET", C);
  expect(r.status === 200 && Array.isArray(r.payload?.comments) && r.payload.comments.length === 0, "assignee sees an empty thread", `got ${r.status}`);
  r = await api(rm.jar, "GET", C);
  expect(r.status === 200, "creator can read the thread", `got ${r.status}`);
  r = await api(outsider.jar, "GET", C);
  expect(r.status === 404, "an outsider gets 404 on GET", `got ${r.status}`);
  r = await api(outsider.jar, "POST", C, { body: "I should not be able to post" });
  expect(r.status === 404, "an outsider gets 404 on POST", `got ${r.status}`);

  // ── Assignee posts → creator (manager) emailed ──────────────────────────
  startSection("Assignee posts a note → creator emailed");
  r = await api(icr.jar, "POST", C, { body: "Started on this, will update tomorrow." });
  expect(r.status === 201 && r.payload?.comment?.id, "note accepted", `got ${r.status}`);
  await sleep(1500);
  expect(emailed(newEmailLines(), rm.email, `on "${TAG} ticket task"`), "creator got the note email");

  // ── Creator replies → assignee emailed ──────────────────────────────────
  startSection("Creator replies → assignee emailed");
  r = await api(rm.jar, "POST", C, { body: "Thanks — let me know if you are blocked." });
  expect(r.status === 201, "reply accepted", `got ${r.status}`);
  await sleep(1500);
  expect(emailed(newEmailLines(), icr.email, `on "${TAG} ticket task"`), "assignee got the reply email");

  // ── Thread now has both, in order ───────────────────────────────────────
  startSection("Thread returns both notes in order");
  r = await api(icr.jar, "GET", C);
  const bodies = (r.payload?.comments ?? []).map((c) => c.body);
  expect(bodies.length === 2, "two notes present", `got ${bodies.length}`);
  expect(bodies[0]?.startsWith("Started on this"), "oldest note first");

  // ── Priority / due date are creator-only ────────────────────────────────
  startSection("Only the creator may change priority / due date");
  const future = new Date(Date.now() + 3 * 86400000).toISOString();
  // Assignee (ICR) may still move status…
  r = await api(icr.jar, "PATCH", `/api/tasks/${task.id}`, { status: "IN_PROGRESS" });
  expect(r.status === 200, "assignee can change status", `got ${r.status}`);
  // …but NOT priority or due date.
  r = await api(icr.jar, "PATCH", `/api/tasks/${task.id}`, { priority: "HIGH" });
  expect(r.status === 403, "assignee is blocked from changing priority", `got ${r.status}`);
  r = await api(icr.jar, "PATCH", `/api/tasks/${task.id}`, { dueDate: future });
  expect(r.status === 403, "assignee is blocked from changing due date", `got ${r.status}`);
  // The creator (RM) can change both.
  r = await api(rm.jar, "PATCH", `/api/tasks/${task.id}`, { priority: "HIGH", dueDate: future });
  expect(r.status === 200, "creator can change priority + due date", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (task) await db.task.delete({ where: { id: task.id } }).catch(() => {}); // cascades comments
  if (icr) await destroyUser(icr);
  if (rm) await destroyUser(rm);
  if (outsider) await destroyUser(outsider);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

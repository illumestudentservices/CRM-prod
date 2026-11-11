/**
 * Verifies the rule (changed 2026-11-11): a KEY change to a task emails the
 * task's ASSIGNER — the person who created/handed out the task — NOT the
 * editor's line manager.
 *
 * The decisive case: the assigner (A) and the editor's line manager (B) are
 * DIFFERENT people. When the editor makes a key change, A must be emailed and
 * B must NOT — that is the whole point of the change (Duarte, a VP, was being
 * copied on his reports' own self-made tasks).
 *
 * Key events: marked complete, cancelled, reassigned, due date changed,
 * priority changed. (See summariseKeyTaskChanges.)
 *
 * Asserts from the dev-server email log (no BREVO_API_KEY → safeSend logs
 * `[email] Skipped … to: <addr>, subject: <subj>` instead of sending).
 *
 *   DEV_LOG=<path> npx tsx --env-file=.env.local scripts/qa-task-assigner-update-email.mjs
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

let A, B, rep;
try {
  // A assigns tasks. B is the editor's real line manager — a DIFFERENT person,
  // so "assigner" and "line manager" cannot be confused.
  A = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  B = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  rep = await createAndLogin({ role: "ICR", withEmployee: true });
  await db.employee.update({ where: { id: rep.employee.id }, data: { managerId: B.employee.id } });

  for (let round = 1; round <= 3; round++) {
    console.log(`\n==================== round ${round} ====================`);

    const tAssigned = await mkTask(A.employee.id, rep.employee.id, `${TAG}-r${round} assigned-by-A`);
    const tOwn = await mkTask(rep.employee.id, rep.employee.id, `${TAG}-r${round} reps-own`);
    const tAself = await mkTask(A.employee.id, A.employee.id, `${TAG}-r${round} A-self`);

    newEmailLines(); // drop setup noise

    // ── 1. Assignee marks an A-assigned task done → A emailed, B NOT ─────────
    startSection(`r${round}: rep marks A's task done → assigner A emailed, line-manager B not`);
    let r = await api(rep.jar, "PATCH", `/api/hr/tasks/${tAssigned.id}`, { status: "DONE" });
    expect(r.status === 200, "status change accepted", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
    await sleep(1500);
    let lines = newEmailLines();
    expect(emailed(lines, A.email, `${TAG}-r${round} assigned-by-A`), "assigner A got the update email");
    expect(!emailed(lines, B.email, "Task updated"), "line-manager B was NOT emailed");

    // ── 2. Rep updates their OWN self-made task → nobody emailed (Duarte fix) ─
    startSection(`r${round}: rep marks their OWN task done → nobody emailed`);
    r = await api(rep.jar, "PATCH", `/api/hr/tasks/${tOwn.id}`, { status: "DONE" });
    expect(r.status === 200, "status change accepted", `got ${r.status}`);
    await sleep(1500);
    lines = newEmailLines();
    expect(!lines.some((l) => l.includes(`${TAG}-r${round} reps-own`)), "no update email for a self-made task");
    expect(!emailed(lines, B.email, "Task updated"), "rep's line-manager B not emailed on a self-made task");

    // ── 3. Assigner edits their OWN assigned task → no self-email ────────────
    startSection(`r${round}: A edits a task A assigned to themselves → no self-email`);
    r = await api(A.jar, "PATCH", `/api/hr/tasks/${tAself.id}`, { priority: "HIGH" });
    expect(r.status === 200, "priority change accepted", `got ${r.status}`);
    await sleep(1500);
    lines = newEmailLines();
    expect(!emailed(lines, A.email, `${TAG}-r${round} A-self`), "assigner not emailed about their own edit");
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (rep) await db.employee.update({ where: { id: rep.employee.id }, data: { managerId: null } }).catch(() => {});
  if (rep) await destroyUser(rep);
  if (A) await destroyUser(A);
  if (B) await destroyUser(B);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

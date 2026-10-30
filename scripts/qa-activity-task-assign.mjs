/**
 * activities/[id]/tasks assignment guard (pentest MEDIUM).
 *
 * POST /api/activities/[id]/tasks created a Task with assigneeId straight from
 * the body — the one task-creating route that skipped refuseAssignment. So
 * activities:write let a caller drop work onto any employee by id. The rule
 * (shared with POST /api/tasks): you may assign only to yourself or a direct
 * report; SUPER_ADMIN to any active employee; a made-up/inactive id is 404.
 *
 *   npx tsx --env-file=.env.local scripts/qa-activity-task-assign.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

let admin, mgr, report, stranger, activity;
const taskIds = [];
const track = (r) => { const id = r.payload?.task?.id; if (id) taskIds.push(id); return r; };

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  mgr = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });

  // `report` reports directly to `mgr`; `stranger` does not.
  await db.employee.update({ where: { id: report.employee.id }, data: { managerId: mgr.employee.id } });

  activity = await db.activity.create({
    data: { type: "SCHOOL_VISIT", title: `${TAG} activity`, date: new Date(), userId: mgr.user.id },
  });
  const path = `/api/activities/${activity.id}/tasks`;

  for (let run = 1; run <= 3; run++) {
    startSection(`activity task assignment (run ${run})`);

    // Self — always allowed.
    let r = track(await api(mgr.jar, "POST", path, { title: "self task", assigneeId: mgr.employee.id }));
    expect(r.status === 201, "assign to self (201)", `got ${r.status}`);

    // Direct report — allowed.
    r = track(await api(mgr.jar, "POST", path, { title: "report task", assigneeId: report.employee.id }));
    expect(r.status === 201, "assign to a direct report (201)", `got ${r.status}`);

    // THE ATTACK: assign to someone who is not your report → refused.
    r = await api(mgr.jar, "POST", path, { title: "stranger task", assigneeId: stranger.employee.id });
    expect(r.status === 403, "CANNOT assign to a non-report employee (403)", `got ${r.status}`);

    // A made-up employee id → 404 (can't probe ids).
    r = await api(mgr.jar, "POST", path, { title: "ghost task", assigneeId: "00000000-0000-0000-0000-000000000000" });
    expect(r.status === 404, "assign to a non-existent employee is 404", `got ${r.status}`);

    // No assignee → an unassigned task is fine.
    r = track(await api(mgr.jar, "POST", path, { title: "unassigned task" }));
    expect(r.status === 201 && !r.payload?.task?.assigneeId, "unassigned task is allowed", `got ${r.status} assignee=${r.payload?.task?.assigneeId}`);

    // SUPER_ADMIN may assign to anyone active.
    r = track(await api(admin.jar, "POST", path, { title: "admin→stranger", assigneeId: stranger.employee.id }));
    expect(r.status === 201, "SUPER_ADMIN can assign to any active employee (201)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of taskIds) await db.task.delete({ where: { id } }).catch(() => {});
  if (activity) await db.activity.delete({ where: { id: activity.id } }).catch(() => {});
  // report.managerId points at mgr's employee — remove the report first so the
  // FK is gone before mgr is deleted.
  for (const u of [report, stranger, mgr, admin]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

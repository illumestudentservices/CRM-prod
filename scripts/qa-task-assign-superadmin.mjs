/**
 * A SUPER_ADMIN may assign a task to ANY active employee; every other role is
 * still limited to themselves or a direct report. Enforced across the task
 * create + reassign routes (lib/task-assignment.ts refuseAssignment).
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-assign-superadmin.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

const mkTaskBody = (assigneeEid) => ({
  title: "QA assignment test", category: "PERSONAL", priority: "MEDIUM", assigneeId: assigneeEid,
});

let admin, stranger, rm, report, stranger2, createdTaskIds = [];
try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });     // no link to admin
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });        // reports to rm
  stranger2 = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });     // no link to rm
  await db.employee.update({ where: { id: report.employee.id }, data: { managerId: rm.employee.id } });

  // ── Super admin → anyone ────────────────────────────────────────────────
  startSection("Super admin can assign a task to anyone");
  let r = await api(admin.jar, "POST", "/api/hr/tasks", mkTaskBody(stranger.employee.id));
  expect(r.ok, "admin assigns a task to an unrelated employee", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
  const t1 = r.payload?.task?.id ?? r.payload?.id;
  if (t1) createdTaskIds.push(t1);

  // …and can reassign an existing task to another unrelated person.
  if (t1) {
    r = await api(admin.jar, "PATCH", `/api/hr/tasks/${t1}`, { assigneeId: rm.employee.id });
    expect(r.ok, "admin reassigns the task to yet another unrelated employee", `got ${r.status}`);
  }

  // ── Regional manager → only self / direct report ────────────────────────
  startSection("A non-admin is still limited to self + direct reports");
  r = await api(rm.jar, "POST", "/api/hr/tasks", mkTaskBody(stranger2.employee.id));
  expect(r.status === 403, "RM is blocked from assigning to an unrelated employee", `got ${r.status}`);

  r = await api(rm.jar, "POST", "/api/hr/tasks", mkTaskBody(report.employee.id));
  expect(r.ok, "RM can assign to a direct report", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
  if (r.payload?.task?.id ?? r.payload?.id) createdTaskIds.push(r.payload?.task?.id ?? r.payload?.id);

  r = await api(rm.jar, "POST", "/api/hr/tasks", mkTaskBody(rm.employee.id));
  expect(r.ok, "RM can assign to themselves", `got ${r.status}`);
  if (r.payload?.task?.id ?? r.payload?.id) createdTaskIds.push(r.payload?.task?.id ?? r.payload?.id);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of createdTaskIds) await db.task.delete({ where: { id } }).catch(() => {});
  if (report) await db.employee.update({ where: { id: report.employee.id }, data: { managerId: null } }).catch(() => {});
  for (const u of [admin, stranger, rm, report, stranger2]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

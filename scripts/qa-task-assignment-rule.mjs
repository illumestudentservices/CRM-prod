/**
 * You may give a task to yourself, or to someone who reports directly to you.
 * There is no third way.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-task-assignment-rule.mjs
 *
 * The interesting half of this is not that creation is guarded — it is that
 * every OTHER way of setting an assignee is guarded too. A rule applied only at
 * POST /api/hr/tasks is not a rule: raise the task for yourself, PATCH it onto
 * whoever you like, and the restriction has cost one extra request. So each of
 * the five paths is tried here as an attacker would try it, with a real signed-in
 * session rather than a direct database write.
 *
 * The cast is a small org chart:
 *
 *            boss  (SUPER_ADMIN)
 *            /  \
 *      worker    peer          sibling branch:  outsider -> no manager
 *
 * boss -> worker and boss -> peer are allowed. Everything else is not, and
 * "everything else" deliberately includes the super admin reaching one level
 * past their own reports, because no role is exempt.
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
const DAY = 86_400_000;
const dueSoon = () => new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);

/** A task body that needs no parent record. */
const body = (assigneeId, extra = {}) => ({
  title: `${TAG} assignment rule probe`,
  assigneeId,
  category: "INTERNAL",
  dueDate: dueSoon(),
  ...extra,
});

async function main() {
  startSection("Setting up a small org chart");

  const boss = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(boss);
  const worker = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(worker);
  const peer = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(peer);
  const outsider = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  ctxs.push(outsider);
  const grandchild = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(grandchild);

  await db.employee.update({ where: { id: worker.employee.id }, data: { managerId: boss.employee.id } });
  await db.employee.update({ where: { id: peer.employee.id }, data: { managerId: boss.employee.id } });
  await db.employee.update({ where: { id: grandchild.employee.id }, data: { managerId: worker.employee.id } });
  expect(true, "boss has two direct reports; worker has one of their own");

  // ── Allowed ──────────────────────────────────────────────────────────────
  startSection("The two ways that are allowed");

  const own = await api(worker.jar, "POST", "/api/hr/tasks", body(worker.employee.id));
  expect(own.status === 201, "*** an employee can raise a task for themselves ***",
    `status ${own.status} ${JSON.stringify(own.payload).slice(0, 140)}`);

  const forReport = await api(boss.jar, "POST", "/api/hr/tasks", body(worker.employee.id));
  expect(forReport.status === 201, "*** a manager can raise one for their direct report ***",
    `status ${forReport.status} ${JSON.stringify(forReport.payload).slice(0, 140)}`);

  const noAssignee = await api(boss.jar, "POST", "/api/hr/tasks", {
    title: `${TAG} no assignee given`, category: "INTERNAL", dueDate: dueSoon(),
  });
  expect(noAssignee.status === 201, "a task with no assignee is still accepted");
  expect(noAssignee.payload?.task?.assigneeId === boss.employee.id,
    "and lands on the person who raised it, rather than on nobody",
    String(noAssignee.payload?.task?.assigneeId));

  // ── Refused ──────────────────────────────────────────────────────────────
  startSection("Everything else is refused");

  const sideways = await api(worker.jar, "POST", "/api/hr/tasks", body(peer.employee.id));
  expect(sideways.status === 403, "*** an employee cannot hand work to a colleague ***",
    `status ${sideways.status}`);
  expect(/reports directly to you/i.test(JSON.stringify(sideways.payload)),
    "and the refusal says who can", JSON.stringify(sideways.payload).slice(0, 160));

  const upward = await api(worker.jar, "POST", "/api/hr/tasks", body(boss.employee.id));
  expect(upward.status === 403, "nor to their own manager", `status ${upward.status}`);

  const skipLevel = await api(boss.jar, "POST", "/api/hr/tasks", body(grandchild.employee.id));
  expect(skipLevel.status === 403,
    "*** and a SUPER_ADMIN cannot reach past their own reports — no role is exempt ***",
    `status ${skipLevel.status}`);

  const stranger = await api(outsider.jar, "POST", "/api/hr/tasks", body(worker.employee.id));
  expect(stranger.status === 403, "somebody outside the line gets nowhere", `status ${stranger.status}`);

  const invented = await api(boss.jar, "POST", "/api/hr/tasks", body("not-a-real-employee-id"));
  expect(invented.status === 404, "a made-up employee id is a 404, not a 500", `status ${invented.status}`);

  // ── The ways round it ────────────────────────────────────────────────────
  startSection("The ways round it are closed too");

  // 1. Raise it for yourself, then PATCH it onto somebody else.
  const mine = await api(worker.jar, "POST", "/api/hr/tasks", body(worker.employee.id));
  const mineId = mine.payload?.task?.id;
  expect(!!mineId, "a task of one's own exists to try it with");

  const handOff = await api(worker.jar, "PATCH", `/api/hr/tasks/${mineId}`, {
    assigneeId: peer.employee.id,
  });
  expect(handOff.status === 403,
    "*** it cannot then be handed to a colleague through /api/hr/tasks ***",
    `status ${handOff.status} ${JSON.stringify(handOff.payload).slice(0, 120)}`);

  const handOff2 = await api(worker.jar, "PATCH", `/api/tasks/${mineId}`, {
    assigneeId: peer.employee.id,
  });
  expect(handOff2.status === 403,
    "*** nor through the other task endpoint ***",
    `status ${handOff2.status} ${JSON.stringify(handOff2.payload).slice(0, 120)}`);

  const stillMine = await db.task.findUnique({ where: { id: mineId }, select: { assigneeId: true } });
  expect(stillMine?.assigneeId === worker.employee.id,
    "and the task is still on the person who raised it", String(stillMine?.assigneeId));

  // 2. Push it down to a report, which is allowed, and prove the writes land.
  const push = await api(boss.jar, "PATCH", `/api/hr/tasks/${noAssignee.payload.task.id}`, {
    assigneeId: peer.employee.id,
  });
  expect(push.status === 200, "a manager CAN move a task onto their own report",
    `status ${push.status} ${JSON.stringify(push.payload).slice(0, 120)}`);

  // 3. Fire a whole template at somebody.
  const template = await db.taskTemplate.create({
    data: {
      name: `${TAG} probe template`,
      category: "INTERNAL",
      isActive: true,
      itemsJson: [{ title: `${TAG} template item`, offsetDays: 3, priority: "MEDIUM" }],
    },
  });
  const fired = await api(worker.jar, "POST", "/api/tasks/templates/fire", {
    templateId: template.id,
    assigneeId: peer.employee.id,
  });
  expect(fired.status === 403,
    "*** firing a template at a colleague is refused — it is creation in bulk ***",
    `status ${fired.status} ${JSON.stringify(fired.payload).slice(0, 140)}`);

  const firedSelf = await api(worker.jar, "POST", "/api/tasks/templates/fire", {
    templateId: template.id,
  });
  expect(firedSelf.status === 201, "but firing one at yourself still works",
    `status ${firedSelf.status} ${JSON.stringify(firedSelf.payload).slice(0, 140)}`);
  await db.task.deleteMany({ where: { templateId: template.id } }).catch(() => {});
  await db.taskTemplate.delete({ where: { id: template.id } }).catch(() => {});

  // 4. Someone who has left is not a report any more.
  //
  // The flag that decides this is `employee.isActive`, not `user.isActive` —
  // lib/hr-scope.ts draws that distinction on purpose, because a user can be
  // deactivated while still being staff (suspended, long-term leave). Both are
  // asserted here so the next person to touch ACTIVE_EMPLOYEE sees which one
  // this rule leans on.
  startSection("Someone who has left is not a direct report");

  await db.user.update({ where: { id: peer.user.id }, data: { isActive: false } });
  const toSuspended = await api(boss.jar, "POST", "/api/hr/tasks", body(peer.employee.id));
  expect(toSuspended.status === 201,
    "a suspended account is still staff, and can still be given work",
    `status ${toSuspended.status}`);
  await db.user.update({ where: { id: peer.user.id }, data: { isActive: true } });

  await db.employee.update({ where: { id: peer.employee.id }, data: { isActive: false } });
  const toLeaver = await api(boss.jar, "POST", "/api/hr/tasks", body(peer.employee.id));
  expect(toLeaver.status === 404,
    "*** but someone off the headcount can no longer be given any ***",
    `status ${toLeaver.status}`);

  const leaverList = (await (await import("../lib/task-assignment.ts")).assignableEmployees(boss.employee.id));
  expect(!leaverList.map((e) => e.id).includes(peer.employee.id),
    "and they drop out of the dropdown at the same moment");
  await db.employee.update({ where: { id: peer.employee.id }, data: { isActive: true } });

  // ── What the dropdown offers ─────────────────────────────────────────────
  startSection("The dropdown offers exactly what the server allows");
  const { assignableEmployees } = await import("../lib/task-assignment.ts");

  const bossList = (await assignableEmployees(boss.employee.id)).map((e) => e.id);
  expect(bossList.length === 3, "the manager sees themselves plus two reports", `${bossList.length} names`);
  expect(bossList.includes(boss.employee.id), "including themselves");
  expect(!bossList.includes(grandchild.employee.id),
    "and not the report's report — the list matches the rule");

  const workerList = (await assignableEmployees(worker.employee.id)).map((e) => e.id);
  expect(workerList.length === 2 && workerList.includes(grandchild.employee.id),
    "an employee with one report sees two names", `${workerList.length} names`);

  const leafList = (await assignableEmployees(outsider.employee.id)).map((e) => e.id);
  expect(leafList.length === 1 && leafList[0] === outsider.employee.id,
    "somebody with no reports sees only themselves", `${leafList.length} names`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
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

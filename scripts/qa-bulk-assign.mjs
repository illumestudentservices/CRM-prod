/**
 * API test for POST /api/tasks/bulk — assign one task to many people at once.
 * 3 rounds plus auth/validation:
 *   • an HQ Executive creates a task for several reps → 201, one task PER person,
 *     each with the right assignee and createdBy
 *   • duplicate assignee ids are de-duped
 *   • empty title / empty list / a made-up assignee / a parent-required category
 *     without a parent → 422
 *   • a role with tasks:write but NOT bulk rights (Regional Manager, ICR) → 403
 *   • unauthenticated → blocked
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-bulk-assign.mjs
 */
import bcrypt from "bcryptjs";
import { createAndLogin, destroyUser, db, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function makeRep(tag) {
  const u = await db.user.create({
    data: { email: `rep-${tag}@qa.local`, firstName: "Rep", lastName: tag, name: `Rep ${tag}`,
      password: await bcrypt.hash("x", 4), role: "ICR", isActive: true },
  });
  const e = await db.employee.create({
    data: { userId: u.id, employeeId: `REP-${tag}`, jobTitle: "Rep", employmentType: "FULL_TIME", startDate: new Date(), isActive: true },
  });
  return { userId: u.id, empId: e.id };
}

const hq = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
let rm, icr;
const reps = [];
async function cleanupTasksBy(employeeId) {
  await db.task.deleteMany({ where: { createdById: employeeId } }).catch(() => {});
}

try {
  const tagBase = Date.now().toString().slice(-6);
  for (let i = 0; i < 3; i++) reps.push(await makeRep(`${tagBase}${i}`));
  const repIds = reps.map((r) => r.empId);
  const hqEmp = hq.employee?.id;

  for (let r = 1; r <= 3; r++) {
    console.log(`\n── round ${r} ──`);
    const res = await api(hq.jar, "POST", "/api/tasks/bulk", {
      title: `Bulk task r${r}`, category: "INTERNAL", priority: "HIGH", assigneeIds: repIds,
    });
    ok("HQ Exec bulk POST → 201", res.status === 201, `status ${res.status} ${JSON.stringify(res.payload)}`);
    ok("created count = 3", res.payload?.created === 3, `created ${res.payload?.created}`);
    ok("returns 3 task ids", Array.isArray(res.payload?.taskIds) && res.payload.taskIds.length === 3);

    const made = await db.task.findMany({ where: { id: { in: res.payload?.taskIds ?? [] } }, select: { assigneeId: true, createdById: true, title: true, category: true } });
    ok("one task per rep, correct assignees", made.length === 3 && new Set(made.map((t) => t.assigneeId)).size === 3 && made.every((t) => repIds.includes(t.assigneeId)));
    ok("createdBy = the HQ Exec", hqEmp ? made.every((t) => t.createdById === hqEmp) : true);
    await db.task.deleteMany({ where: { id: { in: res.payload?.taskIds ?? [] } } }).catch(() => {});
  }

  // De-dup: same rep twice → one task.
  const dup = await api(hq.jar, "POST", "/api/tasks/bulk", { title: "dup", category: "INTERNAL", assigneeIds: [repIds[0], repIds[0], repIds[1]] });
  ok("duplicate ids de-duped to 2", dup.payload?.created === 2, `created ${dup.payload?.created}`);
  await db.task.deleteMany({ where: { id: { in: dup.payload?.taskIds ?? [] } } }).catch(() => {});

  // Validation.
  ok("empty assignee list → 422", (await api(hq.jar, "POST", "/api/tasks/bulk", { title: "x", assigneeIds: [] })).status === 422);
  ok("empty title → 422", (await api(hq.jar, "POST", "/api/tasks/bulk", { title: "", assigneeIds: repIds })).status === 422);
  ok("made-up assignee → 422", (await api(hq.jar, "POST", "/api/tasks/bulk", { title: "x", category: "INTERNAL", assigneeIds: [repIds[0], "not-a-real-id"] })).status === 422);
  ok("parent-required category without parent → 422", (await api(hq.jar, "POST", "/api/tasks/bulk", { title: "x", category: "REPORTING", assigneeIds: repIds })).status === 422);

  // Authorization: write-but-not-bulk roles are refused.
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const rmRes = await api(rm.jar, "POST", "/api/tasks/bulk", { title: "x", category: "INTERNAL", assigneeIds: repIds });
  ok("Regional Manager (write, not bulk) → 403", rmRes.status === 403, `status ${rmRes.status}`);

  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const icrRes = await api(icr.jar, "POST", "/api/tasks/bulk", { title: "x", category: "INTERNAL", assigneeIds: repIds });
  ok("ICR (write, not bulk) → 403", icrRes.status === 403, `status ${icrRes.status}`);

  // Unauthenticated.
  const anon = await api({ header: () => "" }, "POST", "/api/tasks/bulk", { title: "x", assigneeIds: repIds });
  ok("no session blocked (307 or 401/403)", [307, 401, 403].includes(anon.status), `status ${anon.status}`);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  if (hq.employee?.id) await cleanupTasksBy(hq.employee.id);
  for (const rep of reps) {
    await db.task.deleteMany({ where: { assigneeId: rep.empId } }).catch(() => {});
    await db.employee.deleteMany({ where: { id: rep.empId } }).catch(() => {});
    await db.user.deleteMany({ where: { id: rep.userId } }).catch(() => {});
  }
  if (rm) await destroyUser(rm).catch(() => {});
  if (icr) await destroyUser(icr).catch(() => {});
  await destroyUser(hq).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

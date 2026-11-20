/**
 * Confirms the per-user throttle on POST /api/tasks/bulk: the limit is 10
 * requests per window, so the 11th from the same account is 429. Validation
 * failures still count (the limit is checked before the body is parsed), so a
 * flood of junk requests is throttled too. A different account is unaffected.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-bulk-ratelimit.mjs
 */
import bcrypt from "bcryptjs";
import { createAndLogin, destroyUser, db, api } from "./qa-lib.mjs";

const LIMIT = 10;
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${x}`); } };

async function makeRep(tag) {
  const u = await db.user.create({ data: { email: `rlrep-${tag}@qa.local`, firstName: "RL", lastName: tag, name: `RL ${tag}`, password: await bcrypt.hash("x", 4), role: "ICR", isActive: true } });
  const e = await db.employee.create({ data: { userId: u.id, employeeId: `RLREP-${tag}`, jobTitle: "Rep", employmentType: "FULL_TIME", startDate: new Date(), isActive: true } });
  return { userId: u.id, empId: e.id };
}

const hq = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
let hq2, rep;
try {
  const tag = Date.now().toString().slice(-6);
  rep = await makeRep(tag);

  // Fire LIMIT requests; none should be throttled yet. Mix one real create with
  // junk (empty title → 422) to prove even failed requests consume a slot.
  const statuses = [];
  for (let i = 0; i < LIMIT; i++) {
    const body = i === 0
      ? { title: `rl ${tag}`, category: "INTERNAL", assigneeIds: [rep.empId] }
      : { title: "", assigneeIds: [rep.empId] }; // 422
    const r = await api(hq.jar, "POST", "/api/tasks/bulk", body);
    statuses.push(r.status);
  }
  ok(`first ${LIMIT} requests not throttled (no 429)`, statuses.every((s) => s !== 429), `statuses ${statuses.join(",")}`);
  ok("the one valid request created tasks (201)", statuses[0] === 201, `got ${statuses[0]}`);

  // The next request from the SAME account is throttled.
  const over = await api(hq.jar, "POST", "/api/tasks/bulk", { title: "over", category: "INTERNAL", assigneeIds: [rep.empId] });
  ok(`request #${LIMIT + 1} is throttled (429)`, over.status === 429, `got ${over.status}`);

  // A DIFFERENT account is on its own bucket — not affected.
  hq2 = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  const other = await api(hq2.jar, "POST", "/api/tasks/bulk", { title: `other ${tag}`, category: "INTERNAL", assigneeIds: [rep.empId] });
  ok("a different account is NOT throttled (201)", other.status === 201, `got ${other.status}`);
} catch (e) {
  fail++; console.error("CRASH:", e?.stack || e);
} finally {
  await db.task.deleteMany({ where: { assigneeId: rep?.empId } }).catch(() => {});
  if (rep) { await db.employee.deleteMany({ where: { id: rep.empId } }).catch(() => {}); await db.user.deleteMany({ where: { id: rep.userId } }).catch(() => {}); }
  if (hq2) await destroyUser(hq2).catch(() => {});
  await destroyUser(hq).catch(() => {});
  await db.$disconnect().catch(() => {});
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

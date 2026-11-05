/**
 * QA — leave emails copy the region RM for normal staff, but NOT when the
 * applicant is themselves a Regional Manager.
 *
 * Reads the dev server's email log (DEV_LOG env) for the "[email] … to: <addr>
 * … Leave Request from <name>" lines that safeSend prints. 3×.
 *
 *   DEV_LOG=<dev output file> BREVO_API_KEY= BASE_URL=http://localhost:3000 \
 *     npx tsx --env-file=.env.local scripts/qa-rm-region-cc.mjs
 */
import fs from "node:fs";
import { db, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const iso = (d) => d.toISOString().slice(0, 10);
function weekday(n) { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1); return d; }
const DEV_LOG = process.env.DEV_LOG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Did safeSend log an applied-email to `addr` for applicant `name`? */
function emailedTo(addr, name) {
  if (!DEV_LOG) return false;
  const log = fs.readFileSync(DEV_LOG, "utf8");
  return log.split("\n").some((l) =>
    l.includes("to: " + addr) && l.includes(`Leave Request from ${name}`));
}

async function seedBalance(empId) {
  await db.leaveBalance.create({ data: { employeeId: empId, leaveType: "IN_LIEU", year: new Date().getUTCFullYear(), totalDays: 0, adjustmentDays: 5, usedDays: 0, pendingDays: 0 } });
}

async function runOnce(round) {
  console.log(`\n── round ${round} ──`);
  const uniq = `${Date.now()}-${round}`;
  const region = await db.region.create({ data: { name: `QA Region ${uniq}`, code: `QA-${uniq}`.slice(0, 20) } });
  const regionRM = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: region.id, name: `RegionRM ${uniq}` } });
  const manager = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true, extra: { regionId: region.id, name: `EmpApplicant ${uniq}` } });
  await db.employee.update({ where: { id: emp.employee.id }, data: { managerId: manager.employee.id } });
  await seedBalance(emp.employee.id);
  const book = () => { const d = weekday(2); return { startDate: iso(d), endDate: iso(d) }; };

  const created = [regionRM, manager, emp];
  let rm;
  try {
    // Test 1: normal (EMPLOYEE) applicant → region RM IS copied.
    const a1 = await api(emp.jar, "POST", "/api/hr/leave", { employeeId: emp.employee.id, leaveType: "IN_LIEU", ...book() });
    expect("employee leave applied (201)", a1.status === 201, `(status ${a1.status})`);
    await sleep(2500);
    expect("region RM copied for a normal applicant", emailedTo(regionRM.email, `EmpApplicant ${uniq}`));
    expect("direct manager emailed for the employee", emailedTo(manager.email, `EmpApplicant ${uniq}`));

    // Test 2: RM applicant → region RM NOT copied, direct manager still emailed.
    rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true, extra: { regionId: region.id, name: `RmApplicant ${uniq}` } });
    created.push(rm);
    await db.employee.update({ where: { id: rm.employee.id }, data: { managerId: manager.employee.id } });
    await seedBalance(rm.employee.id);
    const a2 = await api(rm.jar, "POST", "/api/hr/leave", { employeeId: rm.employee.id, leaveType: "IN_LIEU", ...book() });
    expect("RM leave applied (201)", a2.status === 201, `(status ${a2.status})`);
    await sleep(2500);
    expect("region RM NOT copied for an RM applicant", !emailedTo(regionRM.email, `RmApplicant ${uniq}`));
    expect("direct manager still emailed for the RM", emailedTo(manager.email, `RmApplicant ${uniq}`));
  } finally {
    for (const c of created) {
      if (c?.employee) {
        await db.leaveRequest.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
        await db.leaveBalance.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
      }
      await destroyUser(c).catch(() => {});
    }
    await db.region.delete({ where: { id: region.id } }).catch(() => {});
  }
}

async function run() {
  if (!DEV_LOG || !fs.existsSync(DEV_LOG)) { console.error("DEV_LOG not set or missing:", DEV_LOG); process.exit(1); }
  try { for (let r = 1; r <= 3; r++) await runOnce(r); }
  finally { await db.$disconnect().catch(() => {}); }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

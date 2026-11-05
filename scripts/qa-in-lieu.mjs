/**
 * QA — Leave in Lieu (earn → approve → credit → take → enforce).
 *
 *   1. Employee logs 16 extra hours → in-lieu request created (2 days).
 *   2. HR/manager approves → IN_LIEU balance adjustmentDays = 2.
 *   3. Booking 5 IN_LIEU days is refused (only 2 available).
 *   4. Booking 1 IN_LIEU day succeeds; after approval, 1 day remains.
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-in-lieu.mjs
 */
import { db, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const iso = (d) => d.toISOString().slice(0, 10);
/** A weekday `n` days from today (UTC), skipping Sat/Sun. */
function weekday(n) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function runOnce(round) {
  console.log(`\n── round ${round} ──`);
  // SUPER_ADMIN is HR (can approve) and has an employee record (can submit).
  const ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  if (!ctx.employee) throw new Error("no employee record");
  const empId = ctx.employee.id;
  const year = new Date().getUTCFullYear();

  try {
    // 1. Log 16 extra hours → 2 days in lieu
    const create = await api(ctx.jar, "POST", "/api/hr/leave/in-lieu", {
      employeeId: empId, workDate: iso(new Date()), hours: 16, reason: "QA weekend work",
    });
    expect("earn request created (201)", create.status === 201, `(status ${create.status})`);
    const reqId = create.payload?.request?.id;
    expect("earn request has 2 days (16h/8)", create.payload?.request?.days === 2, `(got ${create.payload?.request?.days})`);

    // 2. Approve → balance credited
    const approve = await api(ctx.jar, "PATCH", `/api/hr/leave/in-lieu/${reqId}`, { action: "APPROVED" });
    expect("approve ok", approve.ok, `(status ${approve.status})`);
    const bal = await db.leaveBalance.findUnique({
      where: { employeeId_leaveType_year: { employeeId: empId, leaveType: "IN_LIEU", year } },
    });
    expect("IN_LIEU balance credited 2 days", bal?.adjustmentDays === 2, `(got ${bal?.adjustmentDays})`);

    // 3. Over-balance booking refused (5 working days > 2 available)
    const fiveStart = weekday(7);                 // a weekday next week
    const fiveEnd = new Date(fiveStart); fiveEnd.setUTCDate(fiveEnd.getUTCDate() + 6); // span a full week
    const over = await api(ctx.jar, "POST", "/api/hr/leave", {
      employeeId: empId, leaveType: "IN_LIEU", startDate: iso(fiveStart), endDate: iso(fiveEnd),
    });
    expect("booking 5 in-lieu days refused (422)", over.status === 422, `(status ${over.status})`);
    expect("refusal mentions insufficient", /insufficient/i.test(over.payload?.error ?? ""), `(${over.payload?.error})`);

    // 4. Booking 1 in-lieu day succeeds, then approve → 1 day left
    const one = weekday(2);
    const take = await api(ctx.jar, "POST", "/api/hr/leave", {
      employeeId: empId, leaveType: "IN_LIEU", startDate: iso(one), endDate: iso(one),
    });
    expect("booking 1 in-lieu day created (201)", take.status === 201, `(status ${take.status})`);
    const takeId = take.payload?.request?.id;
    const takeApprove = await api(ctx.jar, "PATCH", `/api/hr/leave/${takeId}`, { action: "APPROVED" });
    expect("take approved", takeApprove.ok, `(status ${takeApprove.status})`);
    const bal2 = await db.leaveBalance.findUnique({
      where: { employeeId_leaveType_year: { employeeId: empId, leaveType: "IN_LIEU", year } },
    });
    // adjustment 2, used 1 → available 1
    expect("after taking 1 day, used=1", bal2?.usedDays === 1, `(got ${bal2?.usedDays})`);
    expect("adjustment still 2", bal2?.adjustmentDays === 2, `(got ${bal2?.adjustmentDays})`);
  } finally {
    await db.leaveRequest.deleteMany({ where: { employeeId: empId } }).catch(() => {});
    await db.inLieuRequest.deleteMany({ where: { employeeId: empId } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: empId } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
  }
}

async function run() {
  try {
    for (let r = 1; r <= 3; r++) await runOnce(r);
  } finally {
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

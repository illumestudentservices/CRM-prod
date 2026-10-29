/**
 * Travel [id] access control:
 *   - the owner (travel:write) CANNOT approve/reject their own trip (self-approval);
 *   - an unrelated user cannot read or edit someone else's trip (IDOR) — 404;
 *   - the owner can read/edit/cancel their OWN trip;
 *   - an approver (HR) can approve someone else's trip, but not their own.
 *
 *   npx tsx --env-file=.env.local scripts/qa-travel-idor.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

let owner, outsider, hr, tripIds = [];
const mkTrip = async (employeeId) => {
  const t = await db.travelRequest.create({
    data: { employeeId, destination: "QA City", purpose: "QA", departDate: new Date(Date.UTC(2027, 0, 10)), returnDate: new Date(Date.UTC(2027, 0, 12)), status: "PENDING" },
  });
  tripIds.push(t.id);
  return t;
};

try {
  owner = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  outsider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });

  // ── Self-approval is blocked (×3) ───────────────────────────────────────
  startSection("Owner cannot approve their own trip (×3)");
  const own = await mkTrip(owner.employee.id);
  for (let i = 1; i <= 3; i++) {
    const r = await api(owner.jar, "PATCH", `/api/travel/${own.id}`, { status: "APPROVED" });
    expect(r.status === 403, `run ${i}: owner self-approve refused (403)`, `got ${r.status}`);
    const row = await db.travelRequest.findUnique({ where: { id: own.id }, select: { status: true } });
    expect(row.status === "PENDING", `run ${i}: trip is still PENDING (not approved)`, row.status);
  }
  // reject-self also blocked
  let r = await api(owner.jar, "PATCH", `/api/travel/${own.id}`, { status: "REJECTED" });
  expect(r.status === 403, "owner cannot reject their own trip either");

  // ── IDOR: outsider can't touch it (×3) ──────────────────────────────────
  startSection("An unrelated user cannot read/edit the trip (×3)");
  for (let i = 1; i <= 3; i++) {
    let rr = await api(outsider.jar, "GET", `/api/travel/${own.id}`);
    expect(rr.status === 404, `run ${i}: outsider GET is 404 (IDOR closed)`, `got ${rr.status}`);
    rr = await api(outsider.jar, "PATCH", `/api/travel/${own.id}`, { notes: "hacked" });
    expect(rr.status === 404, `run ${i}: outsider PATCH is 404`, `got ${rr.status}`);
  }

  // ── Owner can read + edit their own trip's FIELDS, but not its status ────
  startSection("Owner can read / edit own trip, but not change its status");
  r = await api(owner.jar, "GET", `/api/travel/${own.id}`);
  expect(r.ok, "owner can read own trip", `got ${r.status}`);
  r = await api(owner.jar, "PATCH", `/api/travel/${own.id}`, { notes: "my note", purpose: "revised" });
  expect(r.ok, "owner can edit own trip's details", `got ${r.status}`);
  r = await api(owner.jar, "PATCH", `/api/travel/${own.id}`, { status: "COMPLETED" });
  expect(r.status === 403, "owner (travel:write only) cannot change status at all", `got ${r.status}`);
  const stillPending = await db.travelRequest.findUnique({ where: { id: own.id }, select: { status: true } });
  expect(stillPending.status === "PENDING", "status unchanged by the owner", stillPending.status);

  // ── Garbage status is a clean 400, not a 500 ────────────────────────────
  r = await api(hr.jar, "PATCH", `/api/travel/${own.id}`, { status: "WHATEVER" });
  expect(r.status === 400, "an unknown status is rejected with 400 (no Prisma 500)", `got ${r.status}`);

  // ── Approver (HR) can approve / complete someone else's, not their own ──
  startSection("HR can approve/complete another's trip, but not approve their own");
  const forHr = await mkTrip(owner.employee.id);
  r = await api(hr.jar, "PATCH", `/api/travel/${forHr.id}`, { status: "APPROVED" });
  expect(r.ok, "HR approves the employee's trip", `got ${r.status}`);
  const approved = await db.travelRequest.findUnique({ where: { id: forHr.id }, select: { status: true, approvedById: true } });
  expect(approved.status === "APPROVED" && approved.approvedById === hr.user.id, "trip is APPROVED, stamped by HR");
  r = await api(hr.jar, "PATCH", `/api/travel/${forHr.id}`, { status: "COMPLETED" });
  expect(r.ok, "HR can mark the trip COMPLETED", `got ${r.status}`);

  const hrOwn = await mkTrip(hr.employee.id);
  r = await api(hr.jar, "PATCH", `/api/travel/${hrOwn.id}`, { status: "APPROVED" });
  expect(r.status === 403, "HR cannot approve their OWN trip (no self-approval even for approvers)", `got ${r.status}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of tripIds) await db.travelRequest.delete({ where: { id } }).catch(() => {});
  for (const u of [owner, outsider, hr]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

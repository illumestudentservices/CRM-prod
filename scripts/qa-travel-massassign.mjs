/**
 * Travel POST mass-assignment (pentest MEDIUM).
 *
 * POST /api/travel trusted `employeeId` from the body, so any travel:write
 * holder (EMPLOYEE / ICR / REGIONAL_MANAGER, not only HR/admin) could file a
 * trip in a colleague's name — a real cost and approval chain on someone who
 * never asked. Fix: non-admins are pinned to their own employee record (may
 * omit employeeId, must not name another); only HR_MANAGER / SUPER_ADMIN may
 * raise travel for others.
 *
 *   npx tsx --env-file=.env.local scripts/qa-travel-massassign.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

let emp, victim, hr, admin;
const createdTravelIds = [];

const trip = (extra = {}) => ({
  destination: "QA City",
  purpose: "QA conference",
  departDate: "2027-06-01",
  returnDate: "2027-06-05",
  estimatedCost: 1000,
  ...extra,
});
const track = (r) => { const id = r.payload?.travelRequest?.id; if (id) createdTravelIds.push(id); return r; };

try {
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  victim = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  for (let run = 1; run <= 3; run++) {
    startSection(`Travel POST ownership (run ${run})`);

    // 1) An employee can raise their OWN trip.
    let r = track(await api(emp.jar, "POST", "/api/travel", trip({ employeeId: emp.employee.id })));
    expect(r.status === 201, "employee raises their own trip (201)", `got ${r.status}`);
    expect(r.payload?.travelRequest?.employeeId === emp.employee.id, "the trip is owned by the employee", r.payload?.travelRequest?.employeeId);

    // 2) THE ATTACK: an employee names a colleague → refused, nothing created.
    const beforeVictim = await db.travelRequest.count({ where: { employeeId: victim.employee.id } });
    r = await api(emp.jar, "POST", "/api/travel", trip({ employeeId: victim.employee.id }));
    expect(r.status === 403, "employee CANNOT raise a trip for a colleague (403)", `got ${r.status}`);
    const afterVictim = await db.travelRequest.count({ where: { employeeId: victim.employee.id } });
    expect(afterVictim === beforeVictim, "no trip was created against the victim", `${beforeVictim} -> ${afterVictim}`);

    // 3) An employee may omit employeeId — it defaults to their own record.
    r = track(await api(emp.jar, "POST", "/api/travel", trip()));
    expect(r.status === 201, "employee raises a trip with no employeeId (201)", `got ${r.status}`);
    expect(r.payload?.travelRequest?.employeeId === emp.employee.id, "the omitted employeeId defaulted to the caller", r.payload?.travelRequest?.employeeId);

    // 4) HR (admin role) MAY file on behalf of another employee.
    r = track(await api(hr.jar, "POST", "/api/travel", trip({ employeeId: victim.employee.id })));
    expect(r.status === 201, "HR_MANAGER can raise a trip for another employee (201)", `got ${r.status}`);
    expect(r.payload?.travelRequest?.employeeId === victim.employee.id, "HR's trip is owned by the named employee", r.payload?.travelRequest?.employeeId);

    // 5) An admin must still say WHO.
    r = await api(admin.jar, "POST", "/api/travel", trip());
    expect(r.status === 422, "SUPER_ADMIN must provide employeeId (422)", `got ${r.status}`);

    // 6) Missing a core field is still a 422.
    r = await api(emp.jar, "POST", "/api/travel", { purpose: "x", departDate: "2027-06-01", returnDate: "2027-06-05" });
    expect(r.status === 422, "missing destination is rejected (422)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of createdTravelIds) await db.travelRequest.delete({ where: { id } }).catch(() => {});
  for (const u of [emp, victim, hr, admin]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

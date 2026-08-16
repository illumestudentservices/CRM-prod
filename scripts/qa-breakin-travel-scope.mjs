/**
 * Does an ordinary EMPLOYEE see only their own travel, or everyone's?
 *
 *   node --import tsx --env-file=.env scripts/qa-breakin-travel-scope.mjs
 *
 * EMPLOYEE holds travel:["read","write"] deliberately — staff raise their own
 * trip requests. The question is what "read" returns.
 *
 * GET /api/hr/leave narrows non-HR callers to their own employee record, and
 * carries a comment about a bypass that once exposed medical and compassionate
 * leave reasons. GET /api/travel performs the permission check and then builds
 * `where` from query parameters only — there is no equivalent self-scope. If
 * that difference is real, the same class of personal data is protected in one
 * HR module and open in the other.
 *
 * Also re-tests the leave endpoint, to confirm its 200 is an empty list rather
 * than a leak.
 *
 * Three passes, real logins, fixtures and accounts destroyed and confirmed gone.
 */

import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG, sleep,
} from "./qa-lib.mjs";

const PASSES = 3;
const allCreated = [];
const madeTravel = [];

async function get(jar, path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: jar.header() } });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  await sleep(40);
  return { status: res.status, payload };
}

async function runPass(pass) {
  startSection(`PASS ${pass} — EMPLOYEE visibility of colleagues' HR data`);

  // A colleague's trip, owned by somebody else entirely. Without this there is
  // nothing for the attacker to wrongly see, and an empty list would look like
  // a pass.
  const otherEmployee = await db.employee.findFirst({
    select: { id: true, user: { select: { name: true } } },
  });
  if (!otherEmployee) { fail("no employee in mirror to use as the victim"); return; }

  const trip = await db.travelRequest.create({
    data: {
      employeeId: otherEmployee.id,
      destination: `${TAG}-SECRET-SUMMIT-p${pass}`,
      purpose: `${TAG} confidential client negotiation`,
      departDate: new Date(Date.now() + 14 * 86400000),
      returnDate: new Date(Date.now() + 18 * 86400000),
      estimatedCost: 4820.5,
      status: "PENDING",
    },
  }).catch((e) => { fail("could not create victim trip", e.message); return null; });
  if (!trip) return;
  madeTravel.push(trip.id);

  const emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  allCreated.push(emp);

  // ── Travel ────────────────────────────────────────────────────────────
  const t = await get(emp.jar, "/api/travel");
  expect(t.status === 200, "employee may call the travel endpoint", `status=${t.status}`);
  const trips = t.payload?.travelRequests ?? t.payload?.data ?? t.payload ?? [];
  const list = Array.isArray(trips) ? trips : [];
  const foreign = list.filter((x) => x.employeeId && x.employeeId !== emp.employee?.id);
  const sawSecret = list.some((x) => String(x.destination ?? "").includes("SECRET-SUMMIT"));

  ok(`travel endpoint returned ${list.length} trips`);
  expect(!sawSecret,
    "*** employee cannot read a colleague's confidential trip ***",
    sawSecret ? `saw ${TAG}-SECRET-SUMMIT-p${pass}` : "");
  expect(foreign.length === 0,
    "*** employee sees no trips belonging to other staff ***",
    `${foreign.length} foreign trips visible`);

  // ── Leave (control) ───────────────────────────────────────────────────
  const l = await get(emp.jar, "/api/hr/leave");
  const leave = l.payload?.requests ?? [];
  expect(l.status === 200, "employee may call the leave endpoint", `status=${l.status}`);
  const foreignLeave = leave.filter((x) => x.employeeId !== emp.employee?.id);
  expect(foreignLeave.length === 0,
    "leave endpoint exposes no other employee's records",
    `${foreignLeave.length} foreign leave rows`);

  // Direct object reference: ask for the victim's leave explicitly.
  const l2 = await get(emp.jar, `/api/hr/leave?employeeId=${otherEmployee.id}`);
  expect(l2.status === 403,
    "*** asking for a colleague's leave by id is refused ***",
    `status=${l2.status}`);

  // Same trick against travel, which takes the same parameter.
  const t2 = await get(emp.jar, `/api/travel?employeeId=${otherEmployee.id}`);
  const t2list = t2.payload?.travelRequests ?? t2.payload?.data ?? [];
  expect(t2.status === 403 || (Array.isArray(t2list) && t2list.length === 0),
    "*** asking for a colleague's travel by id is refused ***",
    `status=${t2.status}, ${Array.isArray(t2list) ? t2list.length : "?"} rows`);

  // ── Control: an approver must still see everything ────────────────────
  // Scoping travel is only correct if the people who approve trips can still
  // read them. HR_MANAGER holds travel:"approve", so it must keep full sight.
  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  allCreated.push(hr);

  const h = await get(hr.jar, "/api/travel");
  const hrTrips = h.payload?.travelRequests ?? [];
  expect(h.status === 200, "HR manager may call the travel endpoint", `status=${h.status}`);
  expect(hrTrips.some((x) => String(x.destination ?? "").includes("SECRET-SUMMIT")),
    "*** an approver still sees other people's trips ***",
    `${hrTrips.length} trips visible`);

  const h2 = await get(hr.jar, `/api/travel?employeeId=${otherEmployee.id}`);
  const h2list = h2.payload?.travelRequests ?? [];
  expect(h2.status === 200 && h2list.length > 0,
    "*** an approver can still filter to one employee ***",
    `status=${h2.status}, ${h2list.length} rows`);

  await destroyUser(hr);
  {
    const gone = await db.user.count({ where: { id: hr.user.id } });
    expect(gone === 0, "disposable HR manager account deleted", `${gone} remaining`);
    if (gone === 0) {
      const i = allCreated.indexOf(hr); if (i >= 0) allCreated.splice(i, 1);
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────
  await db.travelRequest.deleteMany({ where: { id: trip.id } }).catch(() => {});
  const i0 = madeTravel.indexOf(trip.id); if (i0 >= 0) madeTravel.splice(i0, 1);

  await destroyUser(emp);
  const left = await db.user.count({ where: { id: emp.user.id } });
  expect(left === 0, `pass ${pass}: disposable employee account deleted`, `${left} remaining`);
  if (left === 0) {
    const i = allCreated.indexOf(emp);
    if (i >= 0) allCreated.splice(i, 1);
  }
}

async function main() {
  startSection("Baseline");
  const beforeUsers = await db.user.count();
  const beforeTrips = await db.travelRequest.count();
  ok(`users=${beforeUsers} travelRequests=${beforeTrips}`);

  for (let p = 1; p <= PASSES; p++) await runPass(p);

  startSection("Footprint");
  expect(await db.user.count() === beforeUsers, "*** user count back to baseline ***");
  expect(await db.travelRequest.count() === beforeTrips,
    "*** travel requests back to baseline — no fixture survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message));
} finally {
  if (madeTravel.length) {
    await db.travelRequest.deleteMany({ where: { id: { in: madeTravel } } }).catch(() => {});
  }
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({
    where: { email: { contains: TAG.toLowerCase() } },
  }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();

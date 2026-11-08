/**
 * QA — SEA paid-leave carry-over (grant + expire). Runs the REAL lib functions
 * against the TEST database. 3×.
 *
 * Scenario (one temporary region, five reps):
 *   A — 21d unused 2026  → carries the 5d cap
 *   B —  3d unused 2026  → carries 3d (less than the cap)
 *   C —  0d unused 2026  → carries nothing (skipped)
 *   E — 21d unused 2026  → carries 5d, but books ONLY outside the Jan–Feb window
 *   D — in another region → never touched by the region sweep
 *
 * Asserts: the move (2026 −, 2027 +), the cap, the window/deadline, idempotent
 * re-grant, then — after a window booking for A and an out-of-window booking for
 * E and nothing for B — that expire keeps booked days, erases the rest, and a
 * second expire run is a no-op.
 *
 *   BREVO_API_KEY= npx tsx --env-file=.env.local scripts/qa-leave-carryover.ts
 */
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { grantRegionCarryover, expireCarryovers, carryoverWindow } from "@/lib/leave-carryover";

let pass = 0, fail = 0;
function expect(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const r2 = (n: number) => Math.round(n * 100) / 100;

const FROM = 2026, TO = 2027, CAP = 5;

async function mkRep(tag: string, label: string, regionId: string, usedDays: number) {
  const user = await db.user.create({ data: {
    email: `${tag}-${label}@carryover.local`.toLowerCase(),
    firstName: label, lastName: tag, name: `${label} ${tag}`,
    password: await bcrypt.hash("x", 4), role: "ICR", isActive: true,
    passwordChangedAt: new Date(), regionId,
  } });
  const emp = await db.employee.create({ data: {
    userId: user.id, employeeId: `CO-${tag}-${label}`, jobTitle: "Recruiter",
    startDate: new Date(Date.UTC(2020, 0, 1)), isActive: true,
  } });
  if (usedDays > 0) {
    await db.leaveBalance.create({ data: {
      employeeId: emp.id, leaveType: "VACATION_PAID", year: FROM, usedDays,
    } });
  }
  return { user, emp };
}

async function adj(employeeId: string, year: number): Promise<number> {
  const b = await db.leaveBalance.findUnique({
    where: { employeeId_leaveType_year: { employeeId, leaveType: "VACATION_PAID", year } },
    select: { adjustmentDays: true },
  });
  return b ? r2(b.adjustmentDays) : NaN; // NaN = row absent
}

async function run() {
  const tag = `Q${Date.now().toString().slice(-6)}`;
  const region = await db.region.create({ data: { name: `QA Carryover ${tag}`, code: `QACO${tag}` } });
  const other = await db.region.create({ data: { name: `QA Other ${tag}`, code: `QAOT${tag}` } });

  const A = await mkRep(tag, "A", region.id, 0);   // 21 unused → cap 5
  const B = await mkRep(tag, "B", region.id, 18);  // 3 unused → 3
  const C = await mkRep(tag, "C", region.id, 21);  // 0 unused → skip
  const E = await mkRep(tag, "E", region.id, 0);   // 21 unused → 5, books out of window
  const D = await mkRep(tag, "D", other.id, 0);    // other region → untouched

  const ids = [A, B, C, E, D].map((x) => x.emp.id);
  const win = carryoverWindow(FROM, TO);

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // Clean slate each round: remove any carry-over + the 2027 balances + reset
      // 2026 adjustments the previous round applied.
      await db.leaveCarryover.deleteMany({ where: { employeeId: { in: ids } } });
      await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
      await db.leaveBalance.deleteMany({ where: { employeeId: { in: ids }, year: TO } });
      await db.leaveBalance.updateMany({ where: { employeeId: { in: ids }, year: FROM }, data: { adjustmentDays: 0 } });

      // ── GRANT (apply) ──
      const g = await grantRegionCarryover({ regionId: region.id, fromYear: FROM, toYear: TO, capDays: CAP, dryRun: false });

      expect("window start = 1 Jan 2027", win.windowStart.toISOString().slice(0, 10) === "2027-01-01");
      expect("window end = 28 Feb 2027", win.windowEnd.toISOString().slice(0, 10) === "2027-02-28");
      expect("booking deadline = 31 Dec 2026", win.bookingDeadline.toISOString().slice(0, 10) === "2026-12-31");

      const rowA = g.rows.find((r) => r.employeeId === A.emp.id)!;
      const rowB = g.rows.find((r) => r.employeeId === B.emp.id)!;
      const rowC = g.rows.find((r) => r.employeeId === C.emp.id)!;
      expect("A carries the 5d cap (21d unused)", rowA.carried === 5, `(${rowA.unusedFromYear}/${rowA.carried})`);
      expect("B carries 3d (only 3 unused, under cap)", rowB.carried === 3, `(${rowB.unusedFromYear}/${rowB.carried})`);
      expect("C carries nothing (0 unused)", rowC.carried === 0 && rowC.skipped === "nothing-to-carry");
      expect("D (other region) absent from the sweep", !g.rows.some((r) => r.employeeId === D.emp.id));
      expect("granted count = 3 (A,B,E)", g.granted === 3, `(${g.granted})`);
      expect("total carried = 13d (5+3+5)", g.totalDaysCarried === 13, `(${g.totalDaysCarried})`);

      // Balances moved: 2026 down, 2027 up.
      expect("A 2026 adj = -5", (await adj(A.emp.id, FROM)) === -5);
      expect("A 2027 adj = +5", (await adj(A.emp.id, TO)) === 5);
      expect("B 2026 adj = -3", (await adj(B.emp.id, FROM)) === -3);
      expect("B 2027 adj = +3", (await adj(B.emp.id, TO)) === 3);
      expect("C 2027 balance not created", Number.isNaN(await adj(C.emp.id, TO)));
      expect("D 2026 adj untouched (0)", (await adj(D.emp.id, FROM)) === 0 || Number.isNaN(await adj(D.emp.id, FROM)));

      const coA = await db.leaveCarryover.findFirst({ where: { employeeId: A.emp.id } });
      expect("A carry-over row: days 5, ACTIVE, deadline 2026-12-31", !!coA && coA.days === 5 && coA.status === "ACTIVE" && coA.bookingDeadline.toISOString().slice(0, 10) === "2026-12-31");

      // ── Idempotent re-grant ──
      const g2 = await grantRegionCarryover({ regionId: region.id, fromYear: FROM, toYear: TO, capDays: CAP, dryRun: false });
      expect("re-grant applies to nobody (all already-granted)", g2.granted === 0 && g2.rows.filter((r) => r.skipped === "already-granted").length === 3);
      expect("A 2026 adj still -5 after re-grant (no double move)", (await adj(A.emp.id, FROM)) === -5);
      expect("A 2027 adj still +5 after re-grant", (await adj(A.emp.id, TO)) === 5);

      // ── Bookings ──
      // A books 5d inside the window (15–19 Jan 2027). E books 5d OUTSIDE it (March).
      await db.leaveRequest.create({ data: {
        employeeId: A.emp.id, leaveType: "VACATION_PAID", status: "APPROVED",
        startDate: new Date(Date.UTC(TO, 0, 15)), endDate: new Date(Date.UTC(TO, 0, 19)), days: 5,
      } });
      await db.leaveRequest.create({ data: {
        employeeId: E.emp.id, leaveType: "VACATION_PAID", status: "APPROVED",
        startDate: new Date(Date.UTC(TO, 2, 10)), endDate: new Date(Date.UTC(TO, 2, 14)), days: 5,
      } });
      // B books nothing.

      // ── EXPIRE (as of 2 Jan 2027, past the deadline) ──
      const asOf = new Date(Date.UTC(TO, 0, 2));
      const x = await expireCarryovers({ asOf, dryRun: false });
      expect("expire processed 3 due rows (A,B,E)", x.processed === 3, `(${x.processed})`);

      const exA = x.rows.find((r) => r.employeeId === A.emp.id)!;
      const exB = x.rows.find((r) => r.employeeId === B.emp.id)!;
      const exE = x.rows.find((r) => r.employeeId === E.emp.id)!;
      expect("A: booked 5 in window, erased 0", exA.booked === 5 && exA.erased === 0);
      expect("B: booked 0, erased 3 (nothing booked)", exB.booked === 0 && exB.erased === 3);
      expect("E: March booking is OUTSIDE window → booked 0, erased 5", exE.booked === 0 && exE.erased === 5);
      expect("total erased = 8d (0+3+5)", x.totalErased === 8, `(${x.totalErased})`);

      // 2027 balances after erase.
      expect("A 2027 adj stays +5 (fully booked, kept)", (await adj(A.emp.id, TO)) === 5);
      expect("B 2027 adj clawed back to 0", (await adj(B.emp.id, TO)) === 0);
      expect("E 2027 adj clawed back to 0", (await adj(E.emp.id, TO)) === 0);

      const coA2 = await db.leaveCarryover.findFirst({ where: { employeeId: A.emp.id } });
      expect("A row now EXPIRED with bookedDays 5", !!coA2 && coA2.status === "EXPIRED" && coA2.bookedDays === 5);

      // ── Second expire run = no-op ──
      const x2 = await expireCarryovers({ asOf, dryRun: false });
      expect("second expire processes nothing (all EXPIRED)", x2.processed === 0);
      expect("B 2027 adj still 0 (not clawed twice)", (await adj(B.emp.id, TO)) === 0);
    }
  } finally {
    await db.leaveCarryover.deleteMany({ where: { employeeId: { in: ids } } }).catch(() => {});
    await db.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: { in: ids } } }).catch(() => {});
    await db.employee.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [A, B, C, E, D].map((x) => x.user.id) } } }).catch(() => {});
    await db.region.deleteMany({ where: { id: { in: [region.id, other.id] } } }).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

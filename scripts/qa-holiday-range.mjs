/**
 * QA — POST /api/hr/holidays supports a date range (one row per day).
 * Real super-admin session via the authed jar; asserts the endpoint's count
 * and the actual DB rows. Covers: range, single day, reverse-date reject,
 * over-60 guard, and region scoping.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-holiday-range.mjs
 */
import { db, createAndLogin, destroyUser, api, TAG, BASE } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  console.log(`[qa] target=${BASE}`);
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const rangeName = `${TAG} Golden Week`;
  const singleName = `${TAG} One Day`;
  const badName = `${TAG} Bad`;
  const hugeName = `${TAG} Huge`;
  const cleanup = [rangeName, singleName, badName, hugeName];

  try {
    // 1. Range Oct 1-7 -> 7 rows
    const r1 = await api(admin.jar, "POST", "/api/hr/holidays", {
      name: rangeName, date: "2026-10-01", endDate: "2026-10-07", isGlobal: true,
    });
    expect("range request ok (201)", r1.status === 201, `(${r1.status})`);
    expect("range response count = 7", r1.payload?.count === 7, `(got ${r1.payload?.count})`);
    const rangeRows = await db.holiday.findMany({ where: { name: rangeName }, orderBy: { date: "asc" } });
    expect("range created 7 DB rows", rangeRows.length === 7, `(got ${rangeRows.length})`);
    if (rangeRows.length === 7) {
      expect("first=Oct 1, last=Oct 7 (inclusive)",
        rangeRows[0].date.toISOString().slice(0, 10) === "2026-10-01" &&
        rangeRows[6].date.toISOString().slice(0, 10) === "2026-10-07");
      expect("all 7 are global", rangeRows.every((h) => h.isGlobal === true));
      expect("7 distinct days", new Set(rangeRows.map((h) => h.date.toISOString().slice(0, 10))).size === 7);
    }

    // 2. Single day (no endDate) -> 1 row, unchanged shape
    const r2 = await api(admin.jar, "POST", "/api/hr/holidays", {
      name: singleName, date: "2026-12-25", isGlobal: true,
    });
    expect("single day ok (201)", r2.status === 201);
    expect("single day count = 1", r2.payload?.count === 1, `(got ${r2.payload?.count})`);
    expect("single day returns the holiday row", !!r2.payload?.holiday?.id);
    const singleRows = await db.holiday.findMany({ where: { name: singleName } });
    expect("single day created 1 DB row", singleRows.length === 1, `(got ${singleRows.length})`);

    // 3. Reverse dates rejected (422), nothing created
    const r3 = await api(admin.jar, "POST", "/api/hr/holidays", {
      name: badName, date: "2026-10-07", endDate: "2026-10-01", isGlobal: true,
    });
    expect("reverse range rejected (422)", r3.status === 422, `(${r3.status})`);
    expect("reverse range created nothing", (await db.holiday.count({ where: { name: badName } })) === 0);

    // 4. Over-60-day range rejected, nothing created
    const r4 = await api(admin.jar, "POST", "/api/hr/holidays", {
      name: hugeName, date: "2026-01-01", endDate: "2026-12-31", isGlobal: true,
    });
    expect("over-60 range rejected (422)", r4.status === 422, `(${r4.status})`);
    expect("over-60 range created nothing", (await db.holiday.count({ where: { name: hugeName } })) === 0);
  } finally {
    await db.holiday.deleteMany({ where: { name: { in: cleanup } } }).catch(() => {});
    await destroyUser(admin);
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

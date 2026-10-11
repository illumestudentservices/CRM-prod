/**
 * Put rows into the screens the test database leaves empty.
 *
 *   node --import tsx --env-file=.env.local scripts/seed-test-screens.mjs [--commit]
 *
 * ★ WHY THIS IS NEEDED AT ALL.
 *
 * qa-search-filter-sweep can only judge a table that has something in it, and
 * nine screens had nothing. It reported them as "nothing in the table to
 * search for" — honest, but it meant nine screens of the production app had
 * never been exercised by any test, and a reader skimming a green run would
 * not have known. Untested is not the same as working, and the only way to
 * close the gap is to give those screens rows.
 *
 * ★ TEST DATABASE ONLY, AND IT CHECKS.
 *
 * This writes fixture rows with obviously fake names. Running it against
 * production would put "Seeded Holiday" in a hundred and one people's holiday
 * calendars, so it refuses unless the database is the test one and holds no
 * real Illume addresses.
 *
 * Everything it writes is tagged SEED- or dated 2029 so it can be found and
 * removed again with --clean.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");

const COMMIT = process.argv.includes("--commit");
const CLEAN = process.argv.includes("--clean");
const TAG = "SEED-";

// ── Guard ────────────────────────────────────────────────────────────────────
const url = process.env.DATABASE_URL ?? "";
if (!/illume_crm_test/.test(url)) {
  console.error(`REFUSING: DATABASE_URL is not the test database.\n  ${url.replace(/:[^:@]+@/, ":***@")}`);
  process.exit(2);
}
const reals = await db.user.count({
  where: {
    deletedAt: null,
    OR: [
      { email: { endsWith: "@illumestudentservices.ca" } },
      { email: { endsWith: "@illumestudentservices.cloud" } },
    ],
  },
});
if (reals > 0) {
  console.error(`REFUSING: ${reals} real Illume address(es) here. This is not a safe database to seed.`);
  process.exit(2);
}
console.log("guards passed — test database, no real addresses\n");

// ── Clean ────────────────────────────────────────────────────────────────────
if (CLEAN) {
  const r = {
    holidays: (await db.holiday.deleteMany({ where: { name: { startsWith: TAG } } })).count,
    attendance: (await db.attendance.deleteMany({ where: { notes: { startsWith: TAG } } })).count,
    timesheets: (await db.timesheet.deleteMany({ where: { periodStart: { gte: new Date("2029-01-01") } } })).count,
    reviews: (await db.performanceReview.deleteMany({ where: { period: { startsWith: TAG } } })).count,
  };
  console.log("removed:", JSON.stringify(r));
  await db.$disconnect();
  process.exit(0);
}

const actor = await db.user.findFirst({ where: { deletedAt: null }, select: { id: true } });
const staff = await db.employee.findMany({
  where: { isActive: true, user: { deletedAt: null } },
  select: { id: true, managerId: true, user: { select: { name: true } } },
  take: 12,
});
const regions = await db.region.findMany({ select: { id: true, name: true } });

if (!staff.length) {
  console.error("No employees in the test database — nothing to attach fixtures to.");
  process.exit(2);
}

const plan = [];

// ── Holidays ─────────────────────────────────────────────────────────────────
const holidays = [
  ["New Year's Day", "2029-01-01", true, null],
  ["Good Friday", "2029-03-30", true, null],
  ["Canada Day", "2029-07-02", false, "North America"],
  ["Diwali", "2029-11-05", false, "South Asia"],
  ["Eid al-Fitr", "2029-04-14", false, "Middle East"],
  ["Independence Day Nigeria", "2029-10-01", false, "Africa"],
];
const existingHolidays = new Set(
  (await db.holiday.findMany({ where: { name: { startsWith: TAG } }, select: { name: true } }))
    .map((h) => h.name),
);
for (const [name, date, isGlobal, regionName] of holidays) {
  // Holiday has no unique key, so a repeat run would duplicate these.
  if (existingHolidays.has(`${TAG}${name}`)) continue;
  const regionId = regionName ? regions.find((r) => r.name === regionName)?.id ?? null : null;
  plan.push({
    what: `holiday ${TAG}${name}`,
    run: () => db.holiday.create({
      data: {
        name: `${TAG}${name}`, date: new Date(date + "T00:00:00Z"),
        description: "Seeded so the Holidays screen can be tested.",
        isGlobal: isGlobal || !regionId, regionId: isGlobal ? null : regionId,
        createdById: actor.id,
      },
    }),
  });
}

// ── Attendance ───────────────────────────────────────────────────────────────
for (const [i, e] of staff.slice(0, 8).entries()) {
  for (let d = 0; d < 3; d++) {
    const day = new Date(Date.UTC(2029, 0, 8 + d));
    const inAt = new Date(Date.UTC(2029, 0, 8 + d, 9, 0));
    const outAt = new Date(Date.UTC(2029, 0, 8 + d, 17, 30 + (i % 3) * 10));
    const hours = (outAt - inAt) / 3_600_000;
    plan.push({
      what: `attendance ${e.user.name ?? e.id} day ${d + 1}`,
      run: () => db.attendance.create({
        data: {
          employeeId: e.id, date: day, checkIn: inAt, checkOut: outAt,
          hoursWorked: Number(hours.toFixed(2)),
          overtime: hours > 8 ? Number((hours - 8).toFixed(2)) : 0,
          notes: `${TAG}fixture`,
        },
      }),
    });
  }
}

// ── Timesheets ───────────────────────────────────────────────────────────────
for (const [i, e] of staff.slice(0, 6).entries()) {
  const start = new Date(Date.UTC(2029, 0, 1));
  const end = new Date(Date.UTC(2029, 0, 7));
  const logged = 35 + i;
  plan.push({
    what: `timesheet ${e.user.name ?? e.id}`,
    run: () => db.timesheet.create({
      data: {
        employeeId: e.id, frequency: "WEEKLY", periodStart: start, periodEnd: end,
        expectedHours: 40, loggedHours: logged, approvedLeaveHours: 0,
        totalAccountedHours: logged, variance: logged - 40,
        status: i % 2 === 0 ? "SUBMITTED" : "DRAFT",
        submittedAt: i % 2 === 0 ? new Date() : null,
        // Timesheet carries no notes field, so the 2029 period is the marker
        // --clean uses to find these again.
      },
    }),
  });
}

// ── Performance reviews ──────────────────────────────────────────────────────
for (const [i, e] of staff.slice(0, 5).entries()) {
  const reviewer = staff.find((s) => s.id !== e.id);
  plan.push({
    what: `review ${e.user.name ?? e.id}`,
    run: () => db.performanceReview.create({
      data: {
        employeeId: e.id, reviewerId: e.managerId ?? reviewer.id,
        period: `${TAG}Q${(i % 4) + 1} 2029`,
        score: Number((3 + (i % 5) * 0.4).toFixed(1)),
        strengths: "Dependable with partner institutions and clear in writing.",
        improvements: "Could delegate more of the routine follow-up.",
        goals: "Lead one regional review next quarter.",
        status: i % 3 === 0 ? "COMPLETED" : i % 3 === 1 ? "IN_PROGRESS" : "PENDING",
        completedAt: i % 3 === 0 ? new Date() : null,
      },
    }),
  });
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`${plan.length} fixture row(s) planned`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");
for (const p of plan.slice(0, 8)) console.log(`  ${p.what}`);
if (plan.length > 8) console.log(`  … and ${plan.length - 8} more`);

if (!COMMIT) {
  console.log("\nDry run. Add --commit to write.");
  await db.$disconnect();
  process.exit(0);
}

let made = 0, already = 0;
const failed = [];
for (const p of plan) {
  try { await p.run(); made++; }
  catch (e) {
    // A unique-constraint collision means the row is already seeded, not
    // that anything went wrong. Counting those as failures made a clean
    // re-run look like thirty-five broken fixtures.
    if (/Unique constraint/i.test(e.message)) { already++; continue; }
    failed.push(`${p.what}: ${e.message.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 90)}`);
  }
}
console.log(`\n  written: ${made}`);
console.log(`  already present: ${already}`);
console.log(`  failed:  ${failed.length}`);
for (const f of failed.slice(0, 8)) console.log(`      ${f}`);

console.log("\n  screens now holding rows:");
for (const [label, n] of [
  ["holidays", await db.holiday.count()],
  ["attendance", await db.attendance.count()],
  ["timesheets", await db.timesheet.count()],
  ["performance reviews", await db.performanceReview.count()],
  ["leave balances", await db.leaveBalance.count()],
  ["IT assets", await db.iTAsset.count()],
]) console.log(`      ${String(n).padStart(5)}  ${label}`);

await db.$disconnect();

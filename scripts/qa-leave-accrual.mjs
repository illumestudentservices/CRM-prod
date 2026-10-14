/**
 * Vacation accrual maths, as a pure unit suite.
 *
 *   node --import tsx scripts/qa-leave-accrual.mjs
 *
 * ★ NO SERVER, NO DATABASE, ON PURPOSE.
 *
 * Every other leave suite drives HTTP through qa-lib, which needs a dev server
 * and a reachable database. The accrual rule is pure arithmetic over a joining
 * date, so testing it that way adds two moving parts and tests neither. It also
 * meant the rule itself — the one number every employee reads — had no test at
 * all, which is how a policy change ships unnoticed.
 *
 * ★ WHAT THIS PINS DOWN.
 *
 * The waiting period DEFERS leave, it does not forfeit it. Credits run from the
 * first complete month worked; nothing is spendable until the 3 months are up,
 * and then all three arrive together. Changed 2026-10-14 by decision of the
 * business — the previous rule started counting only after the waiting period,
 * which deleted those months rather than holding them, because the balance
 * resets on 31 December and nothing carries forward.
 *
 * The pre-2026 cases below are regression guards: that change must not move
 * anybody who has already been here a full year.
 */
import LP from "../lib/leave-policy.ts";

const {
  LEAVE_POLICIES,
  computeAccrual,
  computeEntitlement,
  deriveLeaveBalances,
} = LP;

const VACATION = LEAVE_POLICIES.VACATION_PAID;
const d = (s) => new Date(`${s}T00:00:00Z`);

let pass = 0;
let fail = 0;
const failures = [];

function expect(cond, label, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Accrued vacation days for a joining date, as at a given day. */
const vac = (joined, asOf) => computeAccrual(VACATION, d(joined), d(asOf));

// ── The waiting period ───────────────────────────────────────────────────────
section("Nothing is spendable during the first 3 months");

const joinDay = vac("2026-05-11", "2026-05-11");
expect(joinDay.accruedDays === 0, "the joining day itself earns nothing", `${joinDay.accruedDays}`);
expect(joinDay.inWaitingPeriod === true, "and sits in the waiting period");
expect(
  joinDay.eligibleFrom.toISOString().slice(0, 10) === "2026-08-11",
  "which ends 3 months later to the day",
  joinDay.eligibleFrom.toISOString().slice(0, 10)
);

const dayBefore = vac("2026-05-11", "2026-08-10");
expect(dayBefore.accruedDays === 0, "the day before it ends still shows nothing", `${dayBefore.accruedDays}`);
expect(dayBefore.inWaitingPeriod === true, "and is still inside the waiting period");

// ── The three months arrive together ─────────────────────────────────────────
section("*** The 3 waiting months are credited, not forfeited ***");

const dayWaitEnds = vac("2026-05-11", "2026-08-11");
expect(
  dayWaitEnds.accruedDays === 5.25,
  "*** on the day the wait ends, all 3 months land at once (3 x 1.75) ***",
  `${dayWaitEnds.accruedDays} — the waiting months were dropped`
);
expect(dayWaitEnds.creditsToDate === 3, "three credits, one per complete month", `${dayWaitEnds.creditsToDate}`);
expect(dayWaitEnds.inWaitingPeriod === false, "and the wait is over");
expect(
  dayWaitEnds.nextAccrualOn?.toISOString().slice(0, 10) === "2026-09-11",
  "the next credit is a month later",
  dayWaitEnds.nextAccrualOn?.toISOString().slice(0, 10)
);

const monthLater = vac("2026-05-11", "2026-09-11");
expect(monthLater.accruedDays === 7, "a month on, 4 credits = 7 days", `${monthLater.accruedDays}`);

// A real record: ILL-0095, joined 11 May 2026.
const real = vac("2026-05-11", "2026-10-14");
expect(real.accruedDays === 8.75, "a 11 May joiner holds 8.75 days by 14 October", `${real.accruedDays}`);

// ── Pre-2026 joiners must not move ───────────────────────────────────────────
section("Anyone past their first year is untouched by the rule change");

for (const [joined, asOf, want] of [
  ["2019-06-03", "2026-10-14", 17.5],
  ["2021-11-30", "2026-10-14", 15.75],
  ["2024-02-14", "2026-10-14", 17.5],
  ["2025-09-15", "2026-10-14", 15.75],
]) {
  const got = vac(joined, asOf).accruedDays;
  expect(got === want, `joined ${joined} -> ${want} days`, `got ${got}`);
}

// ── The cap, and the year reset ──────────────────────────────────────────────
section("A full year reaches 21 exactly, and never more");

const fullYear = vac("2020-03-15", "2026-12-31");
expect(fullYear.accruedDays === 21, "12 credits in a calendar year = 21 days", `${fullYear.accruedDays}`);
expect(fullYear.nextAccrualOn === null, "and no further accrual is offered once capped");

const capped = vac("2020-01-01", "2026-12-31");
expect(capped.accruedDays <= 21, "*** the 21-day ceiling is never exceeded ***", `${capped.accruedDays}`);

section("The balance resets on 1 January");

const newYear = vac("2026-05-11", "2027-01-01");
expect(newYear.accruedDays === 0, "1 January starts from zero", `${newYear.accruedDays}`);
const janFirstCredit = vac("2026-05-11", "2027-01-11");
expect(janFirstCredit.accruedDays === 1.75, "and the first credit of the new year is 1.75", `${janFirstCredit.accruedDays}`);

// ── Month-end joining dates ──────────────────────────────────────────────────
section("A 31st joining date does not skip February");

const endOfMonth = vac("2026-12-31", "2027-03-31");
expect(
  endOfMonth.eligibleFrom.toISOString().slice(0, 10) === "2027-03-31",
  "the 3-month mark clamps to the shorter month",
  endOfMonth.eligibleFrom.toISOString().slice(0, 10)
);
expect(endOfMonth.accruedDays === 5.25, "and still credits 3 complete months", `${endOfMonth.accruedDays}`);

// ── The other three policies are not affected ────────────────────────────────
section("Sick, maternity and paternity are unchanged");

const sick = computeAccrual(LEAVE_POLICIES.SICK, d("2026-05-11"), d("2026-10-14"));
expect(sick.accruedDays === 3.5, "sick is still 5 days pro-rated to 3.5 for a May joiner", `${sick.accruedDays}`);
expect(sick.prorated === true, "and is flagged as pro-rated");

const mat = computeAccrual(LEAVE_POLICIES.MATERNITY, d("2026-05-11"), d("2026-10-14"));
expect(mat.accruedDays === 22, "maternity is still a flat 22 days", `${mat.accruedDays}`);

const pat = computeAccrual(LEAVE_POLICIES.PATERNITY, d("2026-05-11"), d("2026-10-14"));
// Eligible 11 June, so 7 months of 12 remain: 10 x 7/12 = 5.83, to the half day = 6.
expect(pat.accruedDays === 6, "paternity is still 10 days pro-rated to 6", `${pat.accruedDays}`);

// ── Consumption still comes off the top ──────────────────────────────────────
section("Used and pending days still reduce what can be booked");

const spent = computeEntitlement(
  "VACATION_PAID",
  d("2026-05-11"),
  { usedDays: 2, pendingDays: 1, adjustmentDays: 0.5 },
  d("2026-10-14")
);
expect(spent.entitlementDays === 9.25, "8.75 accrued + 0.5 adjustment = 9.25", `${spent.entitlementDays}`);
expect(spent.availableDays === 6.25, "less 2 used and 1 pending = 6.25", `${spent.availableDays}`);

const overdrawn = computeEntitlement(
  "VACATION_PAID",
  d("2026-05-11"),
  { usedDays: 99, pendingDays: 0 },
  d("2026-10-14")
);
expect(overdrawn.availableDays === 0, "*** available never goes negative ***", `${overdrawn.availableDays}`);

// ── The ceiling binds after the adjustment ───────────────────────────────────
section("*** 21 days is the ceiling, adjustment included ***");

// The real shape that broke this: an opening balance carried over from the
// previous HR system, added on top of a full accrual.
const carried = computeEntitlement(
  "VACATION_PAID",
  d("2026-03-09"),
  { usedDays: 0, pendingDays: 0, adjustmentDays: 10.75 },
  d("2026-10-14")
);
expect(
  carried.entitlementDays === 21,
  "*** 12.25 accrued + 10.75 adjustment is held at 21, not 23 ***",
  `${carried.entitlementDays}`
);
expect(carried.availableDays === 21, "and only 21 days can be booked", `${carried.availableDays}`);
expect(carried.cappedAtMax === true, "and the figure is flagged as capped");

const justUnder = computeEntitlement(
  "VACATION_PAID",
  d("2026-03-09"),
  { usedDays: 0, pendingDays: 0, adjustmentDays: 8.75 },
  d("2026-10-14")
);
expect(justUnder.entitlementDays === 21, "exactly 21 is allowed", `${justUnder.entitlementDays}`);
expect(justUnder.cappedAtMax === false, "and is not flagged as capped");

const capThenSpend = computeEntitlement(
  "VACATION_PAID",
  d("2026-03-09"),
  { usedDays: 4, pendingDays: 1, adjustmentDays: 10.75 },
  d("2026-10-14")
);
expect(
  capThenSpend.availableDays === 16,
  "days already taken come off the capped figure, not the raw one",
  `${capThenSpend.availableDays}`
);

// A negative adjustment must still reduce, never be lifted by the cap.
const docked = computeEntitlement(
  "VACATION_PAID",
  d("2026-02-16"),
  { usedDays: 0, pendingDays: 0, adjustmentDays: -5 },
  d("2026-10-14")
);
expect(docked.entitlementDays === 7.25, "a negative adjustment still applies in full", `${docked.entitlementDays}`);
expect(docked.cappedAtMax === false, "and is not flagged as capped");

// The other three policies have no ceiling and must not gain one.
const bigSick = computeEntitlement(
  "SICK",
  d("2026-05-11"),
  { usedDays: 0, pendingDays: 0, adjustmentDays: 40 },
  d("2026-10-14")
);
expect(bigSick.entitlementDays === 43.5, "*** sick leave has no ceiling and is not capped ***", `${bigSick.entitlementDays}`);
expect(bigSick.cappedAtMax === false, "nor flagged as capped");

const bigMat = computeEntitlement(
  "MATERNITY",
  d("2026-05-11"),
  { usedDays: 0, pendingDays: 0, adjustmentDays: 10 },
  d("2026-10-14")
);
expect(bigMat.entitlementDays === 32, "maternity is likewise uncapped", `${bigMat.entitlementDays}`);

// And the cap reaches the screens, not just the apply route.
const shown = deriveLeaveBalances(
  d("2026-03-09"),
  [{ leaveType: "VACATION_PAID", usedDays: 0, pendingDays: 0, adjustmentDays: 10.75 }],
  "MALE",
  d("2026-10-14")
);
const shownVac = shown.find((b) => b.leaveType === "VACATION_PAID");
expect(shownVac.totalDays === 21, "*** the screens show 21, not 23 ***", `${shownVac.totalDays}`);
expect(shownVac.cappedAtMax === true, "and carry the capped flag through");

// ── Gender still decides which types appear ──────────────────────────────────
section("Gender eligibility is untouched");

const female = deriveLeaveBalances(d("2026-05-11"), [], "FEMALE", d("2026-10-14"));
expect(female.length === 3, "a female employee sees 3 types", `${female.length}`);
expect(!female.some((b) => b.leaveType === "PATERNITY"), "and not paternity");

const unset = deriveLeaveBalances(d("2026-05-11"), [], null, d("2026-10-14"));
expect(
  unset.length === 2 && !unset.some((b) => ["MATERNITY", "PATERNITY"].includes(b.leaveType)),
  "*** an unrecorded gender yields neither parental type ***",
  unset.map((b) => b.leaveType).join(",")
);

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`${pass} passed, ${fail} failed`);
if (fail) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);

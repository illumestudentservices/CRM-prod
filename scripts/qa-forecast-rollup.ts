/**
 * Unit test for rollupForecasts() — the forecasting Summary tab's math.
 * Pure function, no DB needed. Proves, over 3 identical rounds:
 *   • monthly re-forecasts for one intake are counted ONCE (newest wins)
 *   • ARCHIVED rows are excluded
 *   • the EFFECTIVE (RM-adjusted ?? ICR) figure is summed
 *   • by-intake and by-region totals add up and equal the grand total
 *   • null region falls into "No region"
 *
 *   npx tsx scripts/qa-forecast-rollup.ts
 */
import { rollupForecasts, type RollupInput, type SegmentValues } from "@/lib/forecasting";

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

// A one-segment forecast helper. icr* are the ICR figures; rm* (optional) adjust.
function f(opts: {
  status?: RollupInput["status"];
  institutionId: string; icrId: string;
  intakeYear: number; intakeMonth: number;
  region: string | null;
  icrEnr: number; rmEnr?: number | null;
  icrApp?: number; icrDep?: number;
}): RollupInput {
  const seg: SegmentValues = {
    segment: "DIRECT_UG",
    icrApplications: opts.icrApp ?? opts.icrEnr * 4,
    icrDeposits: opts.icrDep ?? opts.icrEnr * 2,
    icrEnrolments: opts.icrEnr,
    rmApplications: null,
    rmDeposits: null,
    rmEnrolments: opts.rmEnr ?? null,
  };
  return {
    status: opts.status ?? "ACCEPTED",
    institutionId: opts.institutionId, icrId: opts.icrId,
    intakeYear: opts.intakeYear, intakeMonth: opts.intakeMonth,
    icr: { region: opts.region === null ? null : { name: opts.region } },
    segments: [seg],
  };
}

function run(round: number) {
  console.log(`\n── round ${round} ──`);

  // Rows are passed NEWEST period first (the caller's contract).
  const rows: RollupInput[] = [
    // Institution A / ICR-1 / Sep 2027: re-forecast — NEWEST says 10 enrolments.
    f({ institutionId: "A", icrId: "1", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 10 }),
    // ...older estimate for the SAME intake (30). Must be dropped.
    f({ institutionId: "A", icrId: "1", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 30 }),
    // Institution B / ICR-2 / Sep 2027: ICR said 20, RM adjusted to 8. Effective = 8.
    f({ institutionId: "B", icrId: "2", intakeYear: 2027, intakeMonth: 9, region: "LATAM", icrEnr: 20, rmEnr: 8 }),
    // Institution C / ICR-3 / Jan 2028: 5, no region.
    f({ institutionId: "C", icrId: "3", intakeYear: 2028, intakeMonth: 1, region: null, icrEnr: 5 }),
    // An ARCHIVED row (another intake) that must be ignored entirely.
    f({ status: "ARCHIVED", institutionId: "D", icrId: "4", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 99 }),
  ];

  const { intakeRows, regionRows, grand } = rollupForecasts(rows);

  // Grand total: 10 (A, newest) + 8 (B, RM) + 5 (C) = 23. ARCHIVED 99 excluded, old 30 excluded.
  expect("grand enrolments = 23 (newest + RM-adjusted, archived excluded)", grand.enrolments === 23, `got ${grand.enrolments}`);
  expect("grand counts 3 forecasts", grand.n === 3, `got ${grand.n}`);

  // By intake.
  const sep = intakeRows.find((r) => r.year === 2027 && r.month === 9);
  const jan = intakeRows.find((r) => r.year === 2028 && r.month === 1);
  expect("Sep 2027 intake = 18 (10+8), n=2", !!sep && sep.enrolments === 18 && sep.n === 2, `got ${sep?.enrolments}/${sep?.n}`);
  expect("Jan 2028 intake = 5, n=1", !!jan && jan.enrolments === 5 && jan.n === 1, `got ${jan?.enrolments}/${jan?.n}`);
  expect("intakes sorted ascending by date", intakeRows[0]?.month === 9 && intakeRows[0]?.year === 2027);

  // By region.
  const china = regionRows.find((r) => r.region === "China");
  const latam = regionRows.find((r) => r.region === "LATAM");
  const none = regionRows.find((r) => r.region === "No region");
  expect("China region = 10 (old 30 & archived 99 gone)", !!china && china.enrolments === 10, `got ${china?.enrolments}`);
  expect("LATAM region = 8 (RM-adjusted)", !!latam && latam.enrolments === 8, `got ${latam?.enrolments}`);
  expect("null region bucketed as 'No region' = 5", !!none && none.enrolments === 5, `got ${none?.enrolments}`);

  // Cross-checks: the breakdowns must each reconcile to the grand total.
  const intakeSum = intakeRows.reduce((s, r) => s + r.enrolments, 0);
  const regionSum = regionRows.reduce((s, r) => s + r.enrolments, 0);
  expect("by-intake sums to grand", intakeSum === grand.enrolments, `${intakeSum} vs ${grand.enrolments}`);
  expect("by-region sums to grand", regionSum === grand.enrolments, `${regionSum} vs ${grand.enrolments}`);

  // Applications/deposits follow effective too (A newest icrApp=40, B rm null so icrApp=80, C=20 => 140).
  expect("grand applications = 140", grand.applications === 40 + 80 + 20, `got ${grand.applications}`);

  // Empty input is safe.
  const empty = rollupForecasts([]);
  expect("empty input => grand.n 0, no rows", empty.grand.n === 0 && empty.intakeRows.length === 0 && empty.regionRows.length === 0);
}

for (let r = 1; r <= 3; r++) run(r);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

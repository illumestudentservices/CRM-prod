/**
 * Unit test for rollupForecasts() — the forecasting Summary ("Projected
 * Enrollment Outlook", Spec Pillar 6). Pure function, no DB. Over 3 rounds:
 *   • monthly re-forecasts for one intake are counted ONCE (newest wins)
 *   • ARCHIVED rows are excluded
 *   • the EFFECTIVE (RM-adjusted ?? ICR) figure is summed
 *   • by-intake, by-region AND by-institution totals add up to the grand total
 *   • null region → "No region"
 *   • confidence-WEIGHTED enrolments = Σ enrolments × (conf/5); null conf = full
 *   • average confidence ignores rows with no score
 *   • Forecast-vs-Actual variance only counts rows that have an actual
 *
 *   npx tsx scripts/qa-forecast-rollup.ts
 */
import {
  rollupForecasts, bucketAvgConfidence, bucketVariance,
  type RollupInput, type SegmentValues,
} from "@/lib/forecasting";

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

function f(opts: {
  status?: RollupInput["status"];
  institutionId: string; institution: string; icrId: string;
  intakeYear: number; intakeMonth: number;
  region: string | null;
  icrEnr: number; rmEnr?: number | null;
  icrApp?: number; icrDep?: number;
  confidence?: number | null;
  actual?: number | null;
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
    institutionId: opts.institutionId,
    institution: { name: opts.institution },
    icrId: opts.icrId,
    intakeYear: opts.intakeYear, intakeMonth: opts.intakeMonth,
    confidenceScore: opts.confidence ?? null,
    actualEnrolments: opts.actual ?? null,
    icr: { region: opts.region === null ? null : { name: opts.region } },
    segments: [seg],
  };
}

function run(round: number) {
  console.log(`\n── round ${round} ──`);

  // Rows passed NEWEST period first (the caller's contract).
  const rows: RollupInput[] = [
    // A / ICR-1 / Sep 2027 China: newest=10, conf 4/5, actual 9 recorded.
    f({ institutionId: "A", institution: "Alpha College", icrId: "1", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 10, confidence: 4, actual: 9 }),
    // ...older estimate same intake (30) — dropped.
    f({ institutionId: "A", institution: "Alpha College", icrId: "1", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 30, confidence: 1 }),
    // B / ICR-2 / Sep 2027 LATAM: ICR 20 → RM 8, conf 3/5, no actual.
    f({ institutionId: "B", institution: "Beta Institute", icrId: "2", intakeYear: 2027, intakeMonth: 9, region: "LATAM", icrEnr: 20, rmEnr: 8, confidence: 3 }),
    // C / ICR-3 / Jan 2028, no region, no confidence (counts in full), no actual.
    f({ institutionId: "C", institution: "Gamma School", icrId: "3", intakeYear: 2028, intakeMonth: 1, region: null, icrEnr: 5 }),
    // ARCHIVED — ignored entirely.
    f({ status: "ARCHIVED", institutionId: "D", institution: "Delta", icrId: "4", intakeYear: 2027, intakeMonth: 9, region: "China", icrEnr: 99, confidence: 5 }),
  ];

  const { intakeRows, regionRows, institutionRows, grand } = rollupForecasts(rows);

  // Grand enrolments: 10 + 8 + 5 = 23.
  expect("grand enrolments = 23", grand.enrolments === 23, `got ${grand.enrolments}`);
  expect("grand counts 3 forecasts", grand.n === 3, `got ${grand.n}`);

  // Weighted: 10×4/5=8 + 8×3/5=4.8 + 5×1(null)=5 => 17.8.
  expect("grand weighted ≈ 17.8", Math.abs(grand.weighted - 17.8) < 1e-9, `got ${grand.weighted}`);

  // Avg confidence over the TWO rows that stated one (4, 3) = 3.5; null excluded.
  expect("grand avg confidence = 3.5 (null excluded)", bucketAvgConfidence(grand) === 3.5, `got ${bucketAvgConfidence(grand)}`);

  // By intake.
  const sep = intakeRows.find((r) => r.year === 2027 && r.month === 9)!;
  const jan = intakeRows.find((r) => r.year === 2028 && r.month === 1)!;
  expect("Sep 2027 intake = 18 (10+8), n=2", sep.enrolments === 18 && sep.n === 2, `got ${sep?.enrolments}/${sep?.n}`);
  expect("Jan 2028 intake = 5, n=1", jan.enrolments === 5 && jan.n === 1, `got ${jan?.enrolments}/${jan?.n}`);

  // By region.
  const china = regionRows.find((r) => r.region === "China")!;
  const latam = regionRows.find((r) => r.region === "LATAM")!;
  const none = regionRows.find((r) => r.region === "No region")!;
  expect("China = 10 (old 30 & archived 99 gone)", china.enrolments === 10, `got ${china?.enrolments}`);
  expect("LATAM = 8 (RM-adjusted)", latam.enrolments === 8, `got ${latam?.enrolments}`);
  expect("null region bucketed 'No region' = 5", none.enrolments === 5, `got ${none?.enrolments}`);

  // By institution — NEW dimension.
  expect("3 institutions listed", institutionRows.length === 3, `got ${institutionRows.length}`);
  const alpha = institutionRows.find((r) => r.institution === "Alpha College")!;
  expect("Alpha College = 10, sorted first (largest)", alpha.enrolments === 10 && institutionRows[0].institution === "Alpha College", `got ${alpha?.enrolments}`);
  const instSum = institutionRows.reduce((s, r) => s + r.enrolments, 0);
  expect("by-institution sums to grand", instSum === grand.enrolments, `${instSum} vs ${grand.enrolments}`);

  // Reconcile all breakdowns.
  expect("by-intake sums to grand", intakeRows.reduce((s, r) => s + r.enrolments, 0) === grand.enrolments);
  expect("by-region sums to grand", regionRows.reduce((s, r) => s + r.enrolments, 0) === grand.enrolments);

  // Forecast vs Actual — only the one row with an actual (A: forecast 10, actual 9).
  const gv = bucketVariance(grand)!;
  expect("grand variance present", gv !== null);
  expect("variance forecast base = 10 (only rows w/ actual)", gv.forecast === 10, `got ${gv?.forecast}`);
  expect("variance actual = 9", gv.actual === 9, `got ${gv?.actual}`);
  expect("variance = -1 (9-10)", gv.variance === -1, `got ${gv?.variance}`);
  expect("variance percent = -10%", gv.percent === -10, `got ${gv?.percent}`);
  // Jan intake has no actual → variance null.
  expect("intake w/o actual has null variance", bucketVariance(jan) === null);

  // Empty input is safe.
  const empty = rollupForecasts([]);
  expect("empty => grand.n 0, no rows, variance null",
    empty.grand.n === 0 && empty.intakeRows.length === 0 && empty.regionRows.length === 0 &&
    empty.institutionRows.length === 0 && bucketVariance(empty.grand) === null);
}

for (let r = 1; r <= 3; r++) run(r);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

/**
 * Unit test for buildOutlookExports() — the datasets behind the Summary's
 * Export button — and the shared CSV/PDF formatters they feed. Pure, no DB.
 *   • correct sections, row counts and formatted values (weighted, confidence)
 *   • Forecast-vs-Actual sections appear only when actuals exist, with the
 *     right variance string
 *   • the PDF builder HTML-escapes a hostile institution name (no live markup)
 *   • the CSV formatter neutralises a formula-triggering value
 *
 *   npx tsx scripts/qa-forecast-export.ts
 */
import { rollupForecasts, buildOutlookExports, type RollupInput, type SegmentValues } from "@/lib/forecasting";
import { toCSV, buildExportPdfHtml } from "@/lib/export-format";

let pass = 0, fail = 0;
const expect = (n: string, c: boolean, extra = "") => {
  if (c) { pass++; console.log(`  ✓ ${n}`); }
  else { fail++; console.log(`  ✗ ${n} ${extra}`); }
};

function f(o: {
  institution: string; institutionId?: string; icrId?: string;
  region: string | null; intakeMonth?: number; intakeYear?: number;
  enr: number; confidence?: number | null; actual?: number | null;
}): RollupInput {
  const seg: SegmentValues = {
    segment: "DIRECT_UG",
    icrApplications: o.enr * 4, icrDeposits: o.enr * 2, icrEnrolments: o.enr,
    rmApplications: null, rmDeposits: null, rmEnrolments: null,
  };
  return {
    status: "ACCEPTED",
    institutionId: o.institutionId ?? o.institution, institution: { name: o.institution },
    icrId: o.icrId ?? "icr1",
    intakeYear: o.intakeYear ?? 2027, intakeMonth: o.intakeMonth ?? 9,
    confidenceScore: o.confidence ?? null, pipelineMaturity: null, actualEnrolments: o.actual ?? null,
    icr: { region: o.region === null ? null : { name: o.region } },
    segments: [seg],
  };
}

function run(round: number) {
  console.log(`\n── round ${round} ──`);

  const rollup = rollupForecasts([
    f({ institution: "Alpha College", icrId: "1", region: "China", enr: 10, confidence: 4, actual: 9 }),
    f({ institution: "Beta Institute", icrId: "2", region: "LATAM", enr: 6, confidence: 2 }),
  ]);
  const sections = buildOutlookExports(rollup);
  const byLabel = (l: string) => sections.find((s) => s.label === l);

  // Four breakdowns always present; three FvA present because one row has an actual.
  expect("has 4 breakdown sections", ["By intake", "By region", "By institution", "By segment"].every(byLabel));
  expect("Forecast-vs-Actual sections present (actual exists)",
    !!byLabel("Forecast vs Actual — intake") && !!byLabel("Forecast vs Actual — region") && !!byLabel("Forecast vs Actual — institution"));

  const region = byLabel("By region")!;
  expect("By region has 2 rows", region.data.length === 2, `got ${region.data.length}`);
  const china = region.data.find((r) => r.group === "China")!;
  expect("China enrolments = 10", china.enrolments === 10, `got ${china.enrolments}`);
  // Weighted China = 10 × 4/5 = 8; confidence "4/5".
  expect("China weighted = 8", china.weighted === 8, `got ${china.weighted}`);
  expect("China confidence label = 4/5", china.confidence === "4/5", `got ${china.confidence}`);

  const fva = byLabel("Forecast vs Actual — institution")!;
  expect("FvA-institution has only the row with an actual", fva.data.length === 1, `got ${fva.data.length}`);
  expect("FvA variance string = -1 (-10%)", fva.data[0].variance === "-1 (-10%)", `got ${fva.data[0].variance}`);

  // CSV is well-formed and the header row matches the columns.
  const csv = toCSV(region.data, region.columns);
  expect("CSV first header is Region", csv.split("\r\n")[0].startsWith('"Region"'), csv.split("\r\n")[0]);

  // ── Safety: a hostile institution name must not run as markup in the PDF window.
  const evil = rollupForecasts([
    f({ institution: "<img src=x onerror=alert(1)>", institutionId: "evil", region: "=cmd|' /c calc'!A1", enr: 3 }),
  ]);
  const evilSections = buildOutlookExports(evil);
  const evilInst = evilSections.find((s) => s.label === "By institution")!;
  const html = buildExportPdfHtml(evilInst.data, evilInst.columns, "Projected Enrollment Outlook", "QA");
  expect("PDF escapes hostile institution name (no raw <img)", !html.includes("<img src=x"), "raw tag leaked");
  expect("PDF keeps escaped form", html.includes("&lt;img src=x"));
  // CSV neutralises the formula-triggering region value.
  const evilRegion = evilSections.find((s) => s.label === "By region")!;
  const evilCsv = toCSV(evilRegion.data, evilRegion.columns);
  expect("CSV prefixes formula value with apostrophe", evilCsv.includes(`"'=cmd`), evilCsv.split("\r\n")[1] ?? "");

  // Empty rollup → only the 5 breakdowns (no Forecast-vs-Actual sections).
  const emptySections = buildOutlookExports(rollupForecasts([]));
  const emptyLabels = emptySections.map((s) => s.label);
  expect("empty rollup → 5 breakdowns, no FvA",
    emptySections.length === 5 && !emptyLabels.some((l) => l.startsWith("Forecast vs Actual")),
    emptyLabels.join(" | "));
  expect("empty rollup includes By pipeline maturity", emptyLabels.includes("By pipeline maturity"));
}

for (let r = 1; r <= 3; r++) run(r);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

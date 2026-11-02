/**
 * Weekly staff-activity report for Super Admins.
 *
 * Called from crontab on the VPS, early on Mondays. Reports the previous
 * window of days, separating staff who did real work from those who only
 * logged in (or never signed in).
 *
 *   node --import tsx scripts/weekly-activity-report.ts            # live, emails Super Admins
 *   node --import tsx scripts/weekly-activity-report.ts --dry-run  # build only, print, send nothing
 *   node --import tsx scripts/weekly-activity-report.ts --test me@x # send only to this address
 *   node --import tsx scripts/weekly-activity-report.ts --days 14  # a different window
 *   node --import tsx scripts/weekly-activity-report.ts --out f.html # also write the HTML to a file
 *
 * Next.js loads .env itself; a standalone script does not.
 */
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { writeFileSync } from "node:fs";
import {
  buildActivityReport,
  renderInteractiveReport,
  buildReportPdf,
  sendWeeklyActivityReport,
  sendRegionalActivityReports,
  sendOwnerRegionReports,
} from "@/lib/activity-report";

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const dryRun = process.argv.includes("--dry-run");
const days = Number(flagValue("--days") ?? 7);
const testTo = flagValue("--test");
const outFile = flagValue("--out");

async function main() {
  // Always build first so --dry-run and --out can show the numbers without sending.
  const report = await buildActivityReport(days);
  console.log(
    `[activity-report] ${report.from.toISOString().slice(0, 10)} -> ${report.to.toISOString().slice(0, 10)}  ` +
      `(${report.windowDays}d)  worked=${report.totals.worked}  logged-in-only=${report.totals.loggedIn}  ` +
      `didnt-sign-in=${report.totals.didntSignIn}  never-signed-in=${report.totals.neverLoggedIn}  of ${report.totals.total}`,
  );

  if (outFile) {
    if (outFile.toLowerCase().endsWith(".pdf")) {
      writeFileSync(outFile, await buildReportPdf(report));
      console.log(`[activity-report] wrote PDF report to ${outFile}`);
    } else {
      writeFileSync(outFile, renderInteractiveReport(report), "utf8");
      console.log(`[activity-report] wrote interactive HTML report to ${outFile}`);
    }
  }

  if (dryRun) {
    console.log("[activity-report] dry run — no email sent. Inactive this week:");
    for (const p of report.people.filter((x) => x.state !== "WORKED")) {
      console.log(`    ${p.state.padEnd(11)} ${(p.employeeId ?? "----").padEnd(9)} ${p.name}`);
    }
    // Show which Regional Managers would get a region-scoped copy.
    const { results, skippedNoRegion } = await sendRegionalActivityReports({ windowDays: days, dryRun: true });
    console.log("[activity-report] regional copies that WOULD be sent:");
    for (const r of results) {
      console.log(`    ${r.region.padEnd(16)} ${String(r.total).padStart(3)} staff -> ${r.recipients.join(", ")}`);
    }
    if (skippedNoRegion.length) {
      console.log(`[activity-report] skipped (no region): ${skippedNoRegion.join(", ")}`);
    }
    const owners = await sendOwnerRegionReports({ windowDays: days, dryRun: true });
    for (const o of owners) {
      console.log(`    ${o.label.padEnd(24)} ${String(o.total).padStart(3)} staff -> ${o.recipients.join(", ")}${o.missingRegions.length ? ` (missing: ${o.missingRegions.join(", ")})` : ""}`);
    }
    return 0;
  }

  const res = await sendWeeklyActivityReport({
    windowDays: days,
    to: testTo ? [testTo] : undefined,
  });
  console.log(
    `[activity-report] ${res.sent ? "SENT" : "NOT SENT"} to ${res.recipients.length} recipient(s): ${res.recipients.join(", ")}`,
  );

  // Regional Managers each get a copy scoped to their own region. Skipped on a
  // --test run, which is a targeted single-recipient check of the org report.
  if (!testTo) {
    const { results, skippedNoRegion } = await sendRegionalActivityReports({ windowDays: days });
    for (const r of results) {
      console.log(
        `[activity-report] region ${r.region}: ${r.sent ? "SENT" : "NOT SENT"} to ${r.recipients.length} manager(s) (${r.total} staff): ${r.recipients.join(", ")}`,
      );
    }
    if (skippedNoRegion.length) {
      console.log(`[activity-report] regional skipped (no region assigned): ${skippedNoRegion.join(", ")}`);
    }

    // HQ owners who span several regions (e.g. Annie — Latin America & China).
    const owners = await sendOwnerRegionReports({ windowDays: days });
    for (const o of owners) {
      console.log(
        `[activity-report] owner ${o.label}: ${o.sent ? "SENT" : "NOT SENT"} to ${o.recipients.join(", ")} (${o.total} staff)` +
          (o.missingRegions.length ? ` — WARNING unresolved regions: ${o.missingRegions.join(", ")}` : ""),
      );
    }
  }

  return res.sent ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch(async (err) => {
    console.error("[activity-report] fatal", err);
    await reportAutomationFailure("weekly-activity-report", err);
    process.exit(2);
  });

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
import { writeFileSync } from "node:fs";
import {
  buildActivityReport,
  renderInteractiveReport,
  buildReportPdf,
  sendWeeklyActivityReport,
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
      `no-sign-in=${report.totals.noSignIn}  of ${report.totals.total}`,
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
    return 0;
  }

  const res = await sendWeeklyActivityReport({
    windowDays: days,
    to: testTo ? [testTo] : undefined,
  });
  console.log(
    `[activity-report] ${res.sent ? "SENT" : "NOT SENT"} to ${res.recipients.length} recipient(s): ${res.recipients.join(", ")}`,
  );
  return res.sent ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[activity-report] fatal", err);
    process.exit(2);
  });

/**
 * Daily countdown to a leaver's last working day, run from the VPS crontab.
 *
 *   node --import tsx scripts/offboarding-countdown.ts [--dry-run]
 *
 * Watches Employee.endDate, which until now was written by HR and read by
 * nothing. Notices go out 30, 7 and 1 days before the date.
 *
 * --dry-run reports what WOULD be raised, including departures nobody would be
 * told about, without sending anything.
 */
import "dotenv/config";
import { runOffboardingCountdown } from "@/lib/offboarding-countdown";

const dryRun = process.argv.includes("--dry-run");

runOffboardingCountdown({ dryRun })
  .then((s) => {
    console.log(
      `[offboarding-countdown] ${s.ranAt}${s.dryRun ? " (dry run)" : ""} — ` +
        `matched=${s.matched} raised=${s.raised}`
    );
    // Its own line: a departure nobody is told about is the failure this job
    // exists to prevent, so it must not be buried in a summary count.
    for (const n of s.noRecipient) {
      console.warn(
        `[offboarding-countdown] NOBODY TOLD — ${n.name} (${n.employeeId}): ${n.reason}`
      );
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[offboarding-countdown] FAILED:", err);
    process.exit(1);
  });

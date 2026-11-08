/**
 * Expire paid-leave carry-overs past their booking deadline — run DAILY from the
 * VPS crontab. A no-op until a deadline passes, then it keeps the days actually
 * booked in the window and erases the rest ("use it or lose it").
 *
 *   node --import tsx scripts/leave-carryover-expire.ts [--dry-run]
 *
 * Safe to run every day: already-expired carry-overs are skipped, so days are
 * never clawed back twice.
 */
import "dotenv/config";
import { reportAutomationFailure } from "@/lib/automation-failure";
import { db } from "@/lib/db";
import { expireCarryovers } from "@/lib/leave-carryover";

const dryRun = process.argv.includes("--dry-run");

expireCarryovers({ dryRun })
  .then(async (s) => {
    console.log(
      `[leave-carryover-expire] ${s.asOf}${s.dryRun ? " (dry run)" : ""} — ` +
        `processed=${s.processed} erased=${s.totalErased}d`
    );
    for (const r of s.rows) {
      console.log(`  • ${(r.name ?? r.email).padEnd(26)} carried=${r.days}d booked=${r.booked}d erased=${r.erased}d`);
    }
    await db.$disconnect();
  })
  .catch(async (e) => {
    console.error("[leave-carryover-expire] failed:", e);
    await reportAutomationFailure("leave-carryover-expire", e).catch(() => {});
    await db.$disconnect().catch(() => {});
    process.exit(1);
  });

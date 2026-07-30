/**
 * Anonymises user accounts whose 30-day recovery window has expired.
 *
 *   node --import tsx scripts/purge-deleted-users.ts [--dry-run]
 *
 * Runs locally on the server from crontab, like the pipeline automation — no
 * HTTP surface, no secret to leak, nothing exposed to the internet.
 *
 * This is irreversible, so --dry-run is worth using before the first real run.
 */
// Next.js loads .env itself; a standalone script does not.
import "dotenv/config";
import { purgeExpiredUsers, RECOVERY_WINDOW_DAYS } from "@/lib/user-lifecycle";

const dryRun = process.argv.includes("--dry-run");

purgeExpiredUsers({ dryRun })
  .then((s) => {
    console.log(
      `[purge-users] ${s.ranAt}${s.dryRun ? " (dry run)" : ""} — ` +
        `window=${RECOVERY_WINDOW_DAYS}d purged=${s.purged.length} skipped=${s.skipped.length}`
    );
    s.purged.forEach((u) =>
      console.log(`  ${s.dryRun ? "would anonymise" : "anonymised"}: ${u.email} (deleted ${u.deletedAt.slice(0, 10)})`)
    );
    s.skipped.forEach((u) => console.log(`  skipped: ${u.email} — ${u.reason}`));
    process.exit(0);
  })
  .catch((err) => {
    // Non-zero exit so cron mail and monitoring notice a failed run.
    console.error("[purge-users] FAILED", err);
    process.exit(1);
  });

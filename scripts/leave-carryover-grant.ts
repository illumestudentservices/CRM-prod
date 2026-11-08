/**
 * Grant the SEA paid-leave carry-over — run ONCE (manually, after a DB backup).
 *
 *   node --import tsx scripts/leave-carryover-grant.ts --region=<code|name> \
 *        [--from=2026] [--to=2027] [--cap=5] [--apply]
 *
 * Without --apply it is a DRY RUN: it prints exactly who would carry how many
 * days and changes nothing. Re-running with --apply is safe — each employee's
 * grant is recorded once and skipped thereafter.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { grantRegionCarryover } from "@/lib/leave-carryover";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const regionKey = arg("region");
  const fromYear = Number(arg("from") ?? "2026");
  const toYear = Number(arg("to") ?? String(fromYear + 1));
  const capDays = Number(arg("cap") ?? "5");
  const apply = process.argv.includes("--apply");

  if (!regionKey) throw new Error("Pass --region=<code or name>, e.g. --region=SEA");
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || !(capDays > 0)) {
    throw new Error("--from/--to must be whole years and --cap a positive number");
  }

  // Resolve the region by code first, then by (case-insensitive) name.
  const region =
    (await db.region.findFirst({ where: { code: regionKey }, select: { id: true, name: true, code: true } })) ??
    (await db.region.findFirst({
      where: { name: { equals: regionKey, mode: "insensitive" } },
      select: { id: true, name: true, code: true },
    }));
  if (!region) throw new Error(`No region matches "${regionKey}" by code or name`);

  const summary = await grantRegionCarryover({
    regionId: region.id,
    fromYear,
    toYear,
    capDays,
    dryRun: !apply,
  });

  console.log(
    `\n[leave-carryover-grant] ${region.name} (${region.code}) — ${fromYear} → ${toYear}, cap ${capDays}d` +
      `${apply ? "" : "  (DRY RUN — nothing written)"}`
  );
  console.log(
    `  window: book by ${summary.window.bookingDeadline.toISOString().slice(0, 10)}, ` +
      `for dates ${summary.window.windowStart.toISOString().slice(0, 10)} … ${summary.window.windowEnd.toISOString().slice(0, 10)}`
  );
  console.log(`  measured unused as of ${summary.asOf}\n`);

  for (const r of summary.rows) {
    const who = `${(r.name ?? r.email).padEnd(26)} ${r.role.padEnd(16)}`;
    if (r.skipped === "already-granted") console.log(`  = ${who} already granted — skipped`);
    else if (r.skipped === "nothing-to-carry") console.log(`  · ${who} unused=${r.unusedFromYear}d → nothing to carry`);
    else console.log(`  ✓ ${who} unused=${r.unusedFromYear}d → carried ${r.carried}d`);
  }

  console.log(
    `\n  ${summary.granted} rep(s) ${apply ? "granted" : "would be granted"}, ` +
      `${summary.totalDaysCarried} day(s) total carried.\n`
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error("[leave-carryover-grant] failed:", e);
    await db.$disconnect().catch(() => {});
    process.exit(1);
  });

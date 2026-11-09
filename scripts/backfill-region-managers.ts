/**
 * One-off: put each existing client's region Regional Manager(s) onto its team.
 * Uses the same add-only rule as the live create/edit path.
 *
 *   node --import tsx scripts/backfill-region-managers.ts [--apply] [--exclude="A,B"]
 *
 * Dry run by default — prints what WOULD be added and changes nothing.
 * --exclude skips any client whose name CONTAINS one of the (case-insensitive)
 * comma-separated substrings, e.g. --exclude="Acadia,Francis Xavier".
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { resolveRegionManagers, syncRegionalManagersForInstitution } from "@/lib/institution-team";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const excludes = (arg("exclude") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isExcluded = (name: string) => excludes.some((e) => name.toLowerCase().includes(e));

  const institutions = await db.institution.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, regionId: true, regions: { select: { regionId: true } } },
    orderBy: { name: "asc" },
  });

  let totalAdded = 0, clientsTouched = 0, skipped = 0;
  for (const inst of institutions) {
    if (isExcluded(inst.name)) { skipped++; console.log(`  ⤬ ${inst.name} — skipped (excluded)`); continue; }
    const regionIds = [
      ...(inst.regionId ? [inst.regionId] : []),
      ...inst.regions.map((r) => r.regionId),
    ].filter((v, i, a) => a.indexOf(v) === i);
    if (regionIds.length === 0) continue;

    if (apply) {
      const added = await db.$transaction((tx) => syncRegionalManagersForInstitution(tx, inst.id, regionIds));
      if (added > 0) { totalAdded += added; clientsTouched++; console.log(`  ✓ ${inst.name} — added ${added} manager(s)`); }
    } else {
      // Report-only: same resolver as the apply path (role RMs + HQ owners),
      // minus the write — so the preview exactly matches what --apply would do.
      const managers = await resolveRegionManagers(db, regionIds);
      if (managers.length === 0) continue;
      const existing = await db.institutionUser.findMany({
        where: { institutionId: inst.id, userId: { in: managers.map((m) => m.id) } },
        select: { userId: true },
      });
      const have = new Set(existing.map((e) => e.userId));
      const toAdd = managers.filter((m) => !have.has(m.id));
      if (toAdd.length > 0) {
        totalAdded += toAdd.length; clientsTouched++;
        console.log(`  · ${inst.name} — would add: ${toAdd.map((m) => m.name).join(", ")}`);
      }
    }
  }

  console.log(
    `\n[backfill-region-managers] ${apply ? "added" : "would add"} ${totalAdded} manager link(s) ` +
      `across ${clientsTouched} client(s), ${skipped} excluded${apply ? "" : "  (DRY RUN — nothing written)"}\n`
  );
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error("[backfill-region-managers] failed:", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

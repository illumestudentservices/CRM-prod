/**
 * One-off: put each existing client's region Regional Manager(s) onto its team.
 * Uses the same add-only rule as the live create/edit path.
 *
 *   node --import tsx scripts/backfill-region-managers.ts [--apply]
 *
 * Dry run by default — prints what WOULD be added and changes nothing.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { syncRegionalManagersForInstitution } from "@/lib/institution-team";

async function main() {
  const apply = process.argv.includes("--apply");

  const institutions = await db.institution.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, regionId: true, regions: { select: { regionId: true } } },
    orderBy: { name: "asc" },
  });

  let totalAdded = 0, clientsTouched = 0;
  for (const inst of institutions) {
    const regionIds = [
      ...(inst.regionId ? [inst.regionId] : []),
      ...inst.regions.map((r) => r.regionId),
    ].filter((v, i, a) => a.indexOf(v) === i);
    if (regionIds.length === 0) continue;

    if (apply) {
      const added = await db.$transaction((tx) => syncRegionalManagersForInstitution(tx, inst.id, regionIds));
      if (added > 0) { totalAdded += added; clientsTouched++; console.log(`  ✓ ${inst.name} — added ${added} manager(s)`); }
    } else {
      // Report-only: replicate the add-only computation without writing.
      const managers = await db.user.findMany({
        where: { role: "REGIONAL_MANAGER", isActive: true, deletedAt: null, regionId: { in: regionIds } },
        select: { id: true, name: true },
      });
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
      `across ${clientsTouched} client(s)${apply ? "" : "  (DRY RUN — nothing written)"}\n`
  );
}

main().then(() => db.$disconnect()).catch(async (e) => {
  console.error("[backfill-region-managers] failed:", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

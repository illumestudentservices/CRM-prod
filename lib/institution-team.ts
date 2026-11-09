import type { PrismaTransaction } from "@/lib/db";
import { OWNER_REGION_RECIPIENTS } from "@/lib/region-owners";

export interface RegionManager {
  id: string;
  name: string | null;
  /** The region name to stamp on the team row (role manager's region, or null). */
  regionName: string | null;
}

/**
 * The managers who answer for a set of regions — used both to preview (backfill
 * dry run) and to apply (create/edit). Two sources, unioned by user id:
 *
 *  1. Role-based Regional Managers: an active User with role REGIONAL_MANAGER
 *     whose `regionId` is one of the regions (Region has no manager column).
 *  2. HQ region OWNERS (lib/region-owners.ts) whose owned region NAMES include
 *     one of the regions — e.g. Annie Li owns Latin America + China, where
 *     there is no single-region RM.
 *
 * Accepts `db` or a transaction `tx` (both satisfy PrismaTransaction).
 */
export async function resolveRegionManagers(
  client: PrismaTransaction,
  regionIds: string[]
): Promise<RegionManager[]> {
  const regions = regionIds.filter((r) => typeof r === "string" && r.length > 0);
  if (regions.length === 0) return [];

  const roleManagers = await client.user.findMany({
    where: { role: "REGIONAL_MANAGER", isActive: true, deletedAt: null, regionId: { in: regions } },
    select: { id: true, name: true, region: { select: { name: true } } },
  });

  const selectedNames = new Set(
    (await client.region.findMany({ where: { id: { in: regions } }, select: { name: true } })).map((r) => r.name)
  );
  const ownerEmails = OWNER_REGION_RECIPIENTS
    .filter((o) => o.regionNames.some((n) => selectedNames.has(n)))
    .map((o) => o.email);
  const ownerManagers = ownerEmails.length
    ? await client.user.findMany({
        where: { email: { in: ownerEmails }, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];

  const byId = new Map<string, RegionManager>();
  for (const m of roleManagers) byId.set(m.id, { id: m.id, name: m.name, regionName: m.region?.name ?? null });
  // Owners don't overwrite a role-manager entry already present.
  for (const m of ownerManagers) if (!byId.has(m.id)) byId.set(m.id, { id: m.id, name: m.name, regionName: null });
  return [...byId.values()];
}

/**
 * Keep a client's team in step with its regions: every region the client works
 * in should have that region's manager (see {@link resolveRegionManagers}) on
 * the team.
 *
 * ADD-ONLY. A manager already on the team is left exactly as they are — we never
 * flip a PAUSED/ENDED assignment back to ACTIVE, change their accountRole, or
 * remove a manager when a region is deselected. So manual team edits and
 * deliberate pauses are never undone by a region change; the function only ever
 * fills in a missing manager.
 *
 * Runs inside the caller's transaction so the team update commits together with
 * the region change.
 *
 * @returns the number of managers newly added to the team.
 */
export async function syncRegionalManagersForInstitution(
  tx: PrismaTransaction,
  institutionId: string,
  regionIds: string[]
): Promise<number> {
  const managers = await resolveRegionManagers(tx, regionIds);
  if (managers.length === 0) return 0;

  const existing = await tx.institutionUser.findMany({
    where: { institutionId, userId: { in: managers.map((m) => m.id) } },
    select: { userId: true },
  });
  const existingIds = new Set(existing.map((e) => e.userId));
  const toAdd = managers.filter((m) => !existingIds.has(m.id));
  if (toAdd.length === 0) return 0;

  await tx.institutionUser.createMany({
    data: toAdd.map((m) => ({
      institutionId,
      userId: m.id,
      accountRole: "REGIONAL_MANAGER" as const,
      assignmentStatus: "ACTIVE" as const,
      region: m.regionName,
    })),
    skipDuplicates: true,
  });
  return toAdd.length;
}

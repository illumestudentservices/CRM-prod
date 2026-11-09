import type { PrismaTransaction } from "@/lib/db";
import { OWNER_REGION_RECIPIENTS } from "@/lib/region-owners";

/**
 * Keep a client's team in step with its regions: every region the client works
 * in should have that region's Regional Manager on the team.
 *
 * "Regional Manager of a region" is the same definition the notifications and
 * reports use — an active User with role REGIONAL_MANAGER whose `regionId` is
 * that region (Region has no manager column). In addition, an HQ region OWNER
 * (lib/region-owners.ts — e.g. Annie Li owns Latin America + China, where there
 * is no single-region RM) is added for the regions they own. A region with
 * neither simply contributes nobody.
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
  const regions = regionIds.filter((r) => typeof r === "string" && r.length > 0);
  if (regions.length === 0) return 0;

  // Role-based Regional Managers for the selected regions.
  const roleManagers = await tx.user.findMany({
    where: {
      role: "REGIONAL_MANAGER",
      isActive: true,
      deletedAt: null,
      regionId: { in: regions },
    },
    select: { id: true, region: { select: { name: true } } },
  });

  // HQ region owners (e.g. Annie Li for Latin America + China). Resolve which of
  // the selected regions they own by NAME, then resolve the owner's account.
  const selectedNames = new Set(
    (await tx.region.findMany({ where: { id: { in: regions } }, select: { name: true } })).map((r) => r.name)
  );
  const ownerEmails = OWNER_REGION_RECIPIENTS
    .filter((o) => o.regionNames.some((n) => selectedNames.has(n)))
    .map((o) => o.email);
  const ownerManagers = ownerEmails.length
    ? await tx.user.findMany({
        where: { email: { in: ownerEmails }, isActive: true, deletedAt: null },
        select: { id: true, region: { select: { name: true } } },
      })
    : [];

  // Union (an owner who also happens to be a role-RM is not added twice).
  const byId = new Map<string, { id: string; region: { name: string } | null }>();
  for (const m of [...roleManagers, ...ownerManagers]) byId.set(m.id, m);
  const managers = [...byId.values()];
  if (managers.length === 0) return 0;

  // Which of them are already linked (in any status) — don't touch those.
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
      region: m.region?.name ?? null,
    })),
    skipDuplicates: true,
  });
  return toAdd.length;
}

import type { PrismaTransaction } from "@/lib/db";

/**
 * Keep a client's team in step with its regions: every region the client works
 * in should have that region's Regional Manager on the team.
 *
 * "Regional Manager of a region" is the same definition the notifications and
 * reports use — an active User with role REGIONAL_MANAGER whose `regionId` is
 * that region (Region has no manager column). A region with no such user simply
 * contributes nobody.
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

  const managers = await tx.user.findMany({
    where: {
      role: "REGIONAL_MANAGER",
      isActive: true,
      deletedAt: null,
      regionId: { in: regions },
    },
    select: { id: true, region: { select: { name: true } } },
  });
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

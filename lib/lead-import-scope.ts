import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { isImportAdmin, type ImportableInstitution } from "@/lib/lead-import";

/**
 * The universities a user may import leads for. Server-only (touches the DB);
 * kept out of lib/lead-import.ts so that module's pure validation can be used in
 * the browser.
 *
 * Admins (SUPER_ADMIN, HQ_EXECUTIVE) → every active institution.
 * Everyone else → only the institutions they are actively assigned to via
 * InstitutionUser. Returns [] for a non-admin with no assignment, which the
 * import route treats as "you have no university to import for" — fail closed.
 */
export async function importableInstitutions(
  userId: string,
  role: Role
): Promise<ImportableInstitution[]> {
  if (isImportAdmin(role)) {
    return db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }
  const rows = await db.institutionUser.findMany({
    where: { userId, assignmentStatus: "ACTIVE", institution: { deletedAt: null } },
    select: { institution: { select: { id: true, name: true } } },
  });
  return rows
    .map((r) => r.institution)
    .sort((a, b) => a.name.localeCompare(b.name));
}

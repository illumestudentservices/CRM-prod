import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Who may write a GENERAL knowledge article — one attached to neither a client
 * nor a market. Kept as a list because there is no `knowledge_base` resource in
 * PERMISSION_MATRIX to check against.
 */
export const KB_WRITE_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];

/**
 * May this role add or remove attachments on a knowledge article?
 *
 * The answer depends on WHICH knowledge base the article belongs to, because
 * the three of them are gated differently and all write to the same table:
 *
 *   institution article → institutions:write
 *   market article      → markets:write
 *   general article     → KB_WRITE_ROLES
 *
 * The attachment routes previously used KB_WRITE_ROLES for all three. That is
 * right for the general base and wrong for the other two: a Regional Manager
 * holds `institutions:write` and `markets:write`, so they could create an
 * article on a client or a market and then be refused when they tried to attach
 * anything to it. The rule here is simply "you may attach to an article you
 * could have written", which is what anyone would assume.
 */
export async function canWriteKbArticle(
  role: Role,
  article: { institutionId?: string | null; marketId?: string | null }
): Promise<boolean> {
  if (article.institutionId) {
    return effectiveHasPermission(role, "institutions", "write");
  }
  if (article.marketId) {
    return effectiveHasPermission(role, "markets", "write");
  }
  return KB_WRITE_ROLES.includes(role);
}

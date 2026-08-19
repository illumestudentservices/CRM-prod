import { AlertTriangle } from "lucide-react";
import type { Role } from "@/lib/permissions";

/**
 * Tells a Regional Manager who has no region why their screens are empty.
 *
 * Scope for this role is `{ regionId: <their region> }`, and a manager with no
 * region matches nothing — deliberately, because the alternative was matching
 * everything (see lib/region-scope.ts). But "correctly scoped to nothing" and
 * "the app is broken" look identical from the outside: empty tables, zero
 * counts, no error.
 *
 * So say it. The person who can fix it is a Super Admin, and the fix is one
 * field, but nobody goes looking for a setting when the screen simply shows no
 * data.
 */
export function NoRegionBanner({
  role,
  regionId,
}: {
  role: Role;
  regionId: string | null | undefined;
}) {
  if (role !== "REGIONAL_MANAGER" || regionId) return null;

  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="text-sm">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          No region assigned to your account
        </p>
        <p className="mt-1 text-amber-800 dark:text-amber-300">
          Regional Manager screens are scoped to your region, so until one is set
          you will see no students, reports or analytics. Ask a Super Admin to
          set your region under Settings → Users.
        </p>
      </div>
    </div>
  );
}

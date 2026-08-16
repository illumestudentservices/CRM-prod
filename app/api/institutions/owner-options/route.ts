import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayNameOr } from "@/lib/person-name";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * People who can own a client issue or a health intervention.
 *
 * A dedicated endpoint because the existing user lists are all wrong for this:
 * `/api/settings/users` is SUPER_ADMIN-only and returns role, MFA state and
 * lockout counters; `/api/hr/unlinked-users` is HR-only and answers a different
 * question. An Account Manager needs neither, and widening either one to reach
 * a dropdown would hand out far more than a name.
 *
 * Same reasoning as /api/hr/offboarding-requests/candidates: when a picker needs
 * a list the caller cannot already see, give it its own narrow endpoint rather
 * than loosening an administrative one.
 *
 * Returns the minimum needed to identify a colleague: id, name, email, role.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Read on institutions is the right gate — anyone who can open a client
  // record needs to be able to see who an issue is assigned to.
  if (!(await effectiveHasPermission(session.user.role as Role, "institutions", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      // An external client contact must never be offered as the owner of an
      // internal issue about their own account.
      role: { not: "INSTITUTION_CLIENT" },
    },
    select: { id: true, firstName: true, lastName: true, name: true, email: true, role: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });

  return NextResponse.json({
    data: users.map((u) => ({
      id: u.id,
      name: displayNameOr(u, u.email),
      email: u.email,
      role: u.role,
    })),
  });
}

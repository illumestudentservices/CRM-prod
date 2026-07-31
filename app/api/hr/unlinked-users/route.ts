import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

/**
 * Live accounts with no Employee record.
 *
 * Only HR → Add Employee creates one; an account made through Settings → Users
 * does not. Those people can sign in and use the CRM, but every HR feature
 * keyed to Employee — leave, attendance, gender-based parental eligibility,
 * performance reviews — cannot see them, and the failure is silent: applying
 * for leave just returns "employee not found".
 *
 * All three real staff accounts were in this state and nobody could tell,
 * because HR was busy displaying seven employees belonging to disabled demo
 * accounts. Surfacing it is the difference between a fixable gap and an
 * invisible one.
 */
const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!HR_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      employee: null,
      // Institution clients are external contacts, not staff — they are
      // supposed to have no employee record.
      role: { not: "INSTITUTION_CLIENT" },
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}

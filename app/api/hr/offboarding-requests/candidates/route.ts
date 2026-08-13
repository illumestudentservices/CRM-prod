import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayNameOr } from "@/lib/person-name";
import {
  canRequestOffboarding,
  canTargetRole,
  employeeScopeFor,
} from "@/lib/offboarding-requests";

/**
 * Who the caller may raise a departure for.
 *
 * This exists because GET /api/hr/employees is restricted to HR_MANAGER and
 * SUPER_ADMIN, while a REGIONAL_MANAGER is a permitted requester — so the picker
 * cannot reuse the staff list. Rather than widening that endpoint (it returns
 * phone numbers, addresses and emergency contacts), this returns the minimum
 * needed to identify a colleague in a dropdown.
 *
 * Anyone already queued for departure is excluded, so the form cannot be used to
 * create a duplicate that the POST would only reject afterwards.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: userId } = session.user;
  if (!canRequestOffboarding(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read the region from the DB, not the JWT — see the note in the POST route.
  const requester = await db.user.findUnique({
    where: { id: userId },
    select: { regionId: true },
  });

  const scope = employeeScopeFor(role, requester?.regionId);
  // No region set means no scope at all. Returning an empty list with a reason
  // beats an unscoped query that would hand back the whole company.
  if (scope === null) {
    return NextResponse.json({
      candidates: [],
      reason: "You have no region assigned, so there is nobody you can offboard.",
    });
  }

  const employees = await db.employee.findMany({
    where: {
      isActive: true,
      // Never offer someone whose account is already gone, whatever isActive says
      // on the employee row — the two flags have never been kept in step.
      user: { deletedAt: null },
      offboardingRequests: { none: { status: "PENDING" } },
      // Merged through AND rather than spread at the top level: that way this
      // query does not need to know the scope's internal shape, so a scope that
      // grows a second key cannot be silently dropped here.
      AND: [scope],
    },
    select: {
      id: true,
      employeeId: true,
      jobTitle: true,
      department: { select: { name: true } },
      user: { select: { firstName: true, lastName: true, email: true, role: true } },
    },
    orderBy: [{ user: { firstName: "asc" } }, { user: { lastName: "asc" } }],
    take: 500,
  });

  const candidates = employees
    // A regional manager cannot target a Super Admin, so do not show them one.
    .filter((e) => canTargetRole(role, e.user.role))
    .map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      name: displayNameOr(e.user, e.user.email),
      email: e.user.email,
      jobTitle: e.jobTitle,
      department: e.department?.name ?? null,
    }));

  return NextResponse.json({ candidates });
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayNameOr } from "@/lib/person-name";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";
import {
  ACTIVE_LEAD_STAGES,
  RECEIVING_ROLES,
  userScopeForReassignment,
} from "@/lib/workload-reassignment";

/**
 * Colleagues who may receive a reassigned workload.
 *
 * A dedicated endpoint rather than reusing the user list in Settings, which is
 * SUPER_ADMIN-only and returns role, MFA state and lockout counters. A regional
 * manager is a permitted reassigner, so the picker needs its own narrow view —
 * the same reasoning that produced the offboarding candidates route.
 *
 * The POST re-applies every filter here. This exists to keep the operator from
 * picking someone the POST would only reject afterwards, not as the gate.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { role, id: sessionUserId } = session.user;
  if (!(await hasCapability(role as Role, "leads.bulk_reassign"))) {
    return NextResponse.json(
      { error: "Your role is not permitted to reassign workloads." },
      { status: 403 }
    );
  }

  // From the DB, not the JWT — see the note in the sibling route.
  const caller = await db.user.findUnique({
    where: { id: sessionUserId },
    select: { regionId: true },
  });
  const scope = userScopeForReassignment(role, caller?.regionId);
  if (scope === null) {
    return NextResponse.json({
      targets: [],
      reason: "You have no region assigned, so there is nobody who can receive a workload.",
    });
  }

  const excludeUserId = req.nextUrl.searchParams.get("excludeUserId")?.trim() || undefined;

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      // Handing a caseload to a disabled account is the exact failure this
      // feature exists to prevent, so those are never offered.
      isActive: true,
      role: { in: [...RECEIVING_ROLES] },
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      AND: [scope],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      region: { select: { name: true } },
      // Surfaced so the operator can see who is already carrying a load before
      // adding to it. Uses ACTIVE_LEAD_STAGES rather than a literal list: two
      // stage lists that must agree is the drift bug this codebase has already
      // shipped three times (NAV_RESOURCE_MAP, the permissions UI, the country
      // flag map), and TypeScript cannot catch it.
      _count: {
        select: {
          assignedLeads: {
            where: { deletedAt: null, stage: { in: [...ACTIVE_LEAD_STAGES] } },
          },
        },
      },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 500,
  });

  return NextResponse.json({
    targets: users.map((u) => ({
      id: u.id,
      name: displayNameOr(u, u.email),
      email: u.email,
      role: u.role,
      region: u.region?.name ?? null,
      currentLiveLeads: u._count.assignedLeads,
    })),
  });
}

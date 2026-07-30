import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Role } from "@/lib/permissions";

/**
 * Department lookup for pickers. Mirrors the gate on /api/hr/regions — a
 * regional manager needs it to raise an account request, and the list is
 * organisational structure rather than anything sensitive.
 */
const ALLOWED: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "REGIONAL_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS"];

export async function GET() {
  const session = await auth();
  if (!session?.user || !ALLOWED.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const departments = await db.department.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ departments });
}

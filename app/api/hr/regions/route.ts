import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Role } from "@/lib/permissions";

const ALLOWED: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "REGIONAL_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS"];

export async function GET() {
  const session = await auth();
  if (!session?.user || !ALLOWED.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const regions = await db.region.findMany({
    select: { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ regions });
}

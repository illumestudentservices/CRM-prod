import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import type { Role } from "@/lib/permissions";

// VP_GLOBAL_SALES is here because PERMISSION_MATRIX grants it
// announcements:write, and posting one to a single region needs the list
// to choose from. Without it the region dropdown came back empty and the
// only option was a company-wide announcement.
const ALLOWED: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "REGIONAL_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS", "VP_GLOBAL_SALES"];

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

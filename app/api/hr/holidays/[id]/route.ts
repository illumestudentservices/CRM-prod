import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { trashRecord } from "@/lib/recycle-bin";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!HR_ROLES.includes(session.user.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.holiday.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
  }

  await trashRecord({ entityType: "Holiday", entityId: id, userId: session.user.id });

  return NextResponse.json({ success: true });
}

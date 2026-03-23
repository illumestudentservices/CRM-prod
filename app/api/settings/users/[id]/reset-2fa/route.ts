import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  try {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, twoFactorEnabled: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.twoFactorEnabled) return NextResponse.json({ error: "MFA is not enabled for this user" }, { status: 400 });

    await db.user.update({
      where: { id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        twoFactorBackupCodes: [],
      },
    });

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null;

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "MFA_RESET",
        entity: "USER",
        entityId: id,
        changes: { targetEmail: user.email, resetBy: session.user.email },
        ipAddress: ip,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reset-2fa]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

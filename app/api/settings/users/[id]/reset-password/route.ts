import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { createMagicLink } from "@/lib/magic-link";
import { sendMagicLinkEmail } from "@/lib/email";

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
      select: { id: true, name: true, email: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const magicLinkUrl = await createMagicLink(user.id, 24);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null;

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PASSWORD_RESET",
        entity: "USER",
        entityId: id,
        changes: { targetEmail: user.email, method: "magic_link" },
        ipAddress: ip,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    // Fire-and-forget
    sendMagicLinkEmail({
      to: user.email,
      name: user.name ?? user.email,
      magicLinkUrl,
      expiryHours: 24,
      resetBy: session.user.name ?? session.user.email ?? "Administrator",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[reset-password]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

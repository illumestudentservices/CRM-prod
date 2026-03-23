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
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const employee = await db.employee.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const magicLinkUrl = await createMagicLink(employee.user.id, 24);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      null;

    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "PASSWORD_RESET",
        entity: "USER",
        entityId: employee.user.id,
        changes: { targetEmail: employee.user.email, method: "magic_link" },
        ipAddress: ip,
        userAgent: req.headers.get("user-agent") ?? null,
      },
    });

    // Fire-and-forget
    sendMagicLinkEmail({
      to: employee.user.email,
      name: employee.user.name ?? employee.user.email,
      magicLinkUrl,
      expiryHours: 24,
      resetBy: session.user.name ?? session.user.email ?? "Administrator",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[hr/reset-password]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Capability-gated (Phase 10). Defaults to SUPER_ADMIN and still requires
  // users:write underneath, so it cannot be widened past the coarse matrix.
  if (!(await hasCapability(session.user.role as Role, "users.reset_mfa"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const user = await db.user.findUnique({
      where: { id },
      select: { id: true, email: true, twoFactorEnabled: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!user.twoFactorEnabled) return NextResponse.json({ error: "MFA is not enabled for this user" }, { status: 400 });

    // `sessionsRevokedAt` is not housekeeping here — without it the reset does
    // not take effect, and it actively locks the person out.
    //
    // The proxy decides where to send someone by reading `twoFactorPending` and
    // `twoFactorEnabled` out of their JWT, and the token-refresh callback in
    // lib/auth.ts re-reads isActive / deletedAt / sessionsRevokedAt / role /
    // regionId — but NOT twoFactorEnabled. So somebody sitting on /verify-2fa
    // when their MFA is reset keeps a token saying "2FA pending", and the proxy
    // goes on asking them for a TOTP code or a backup code that no longer exists
    // anywhere. There is nothing they can enter. They stay stuck until the token
    // expires, which is up to 48 hours.
    //
    // Seen on production: a reset that reported success, after which the user was
    // asked for backup codes instead of being sent to /setup-2fa to rescan.
    //
    // It is right for the security reason too. Resetting someone's MFA is a
    // security event, and leaving their sessions alive means that if the reason
    // for the reset was a compromised account, whoever is in there keeps full
    // access for another two days.
    const now = new Date();
    await db.$transaction([
      db.user.update({
        where: { id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
          twoFactorBackupCodes: [],
          sessionsRevokedAt: now,
        },
      }),
      // Sessions are stateless JWTs, but the adapter keeps rows for any
      // adapter-managed session and those should go with them.
      db.session.deleteMany({ where: { userId: id } }),
    ]);

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
        changes: {
          targetEmail: user.email,
          resetBy: session.user.email,
          // Recorded because it is a second, separately consequential effect:
          // whoever reads this trail needs to know the person was signed out,
          // not just that their MFA was cleared.
          sessionsRevokedAt: now.toISOString(),
        },
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

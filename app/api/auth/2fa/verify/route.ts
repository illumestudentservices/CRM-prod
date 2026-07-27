import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { totpVerify } from "@/lib/totp";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { logActivity } from "@/lib/activity-logger";

const verifySchema = z.object({
  code: z.string().min(1).max(20),
});

/**
 * POST /api/auth/2fa/verify
 * Called from /verify-2fa page after the user enters their TOTP or backup code.
 * Requires a session with twoFactorPending === true.
 * On success the client calls useSession().update({ twoFactorVerified: true })
 * which triggers the JWT callback to clear the pending flag.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Already past the challenge — a double submit, a stale tab, or the session
  // update landing before this request. Treating that as an error strands the
  // user on the verify page behind a message that reads like a rejected code,
  // so report success and let the client move on.
  if (!session.user.twoFactorPending) {
    return NextResponse.json({ success: true, alreadyVerified: true });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const { code } = parsed.data;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorSecret: true, twoFactorBackupCodes: true },
  });
  if (!user?.twoFactorSecret) {
    return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
  }

  // Try TOTP code first
  const cleanCode = code.replace(/\s/g, "");
  const isTotpValid = await totpVerify(user.twoFactorSecret, cleanCode);

  if (isTotpValid) {
    void logActivity(session.user.id, "2FA_VERIFIED", "USER", session.user.id, { method: "totp" });
    return NextResponse.json({ success: true });
  }

  // Try backup codes (format: XXXXX-XXXXX — 11 chars)
  const upperCode = cleanCode.toUpperCase();
  const matchIndex = (
    await Promise.all(
      user.twoFactorBackupCodes.map((hash) => bcrypt.compare(upperCode, hash))
    )
  ).findIndex(Boolean);

  if (matchIndex !== -1) {
    // Remove the used backup code
    const remaining = user.twoFactorBackupCodes.filter((_, i) => i !== matchIndex);
    await db.user.update({
      where: { id: session.user.id },
      data: { twoFactorBackupCodes: remaining },
    });
    void logActivity(session.user.id, "2FA_VERIFIED", "USER", session.user.id, {
      method: "backup_code",
      codesRemaining: remaining.length,
    });
    return NextResponse.json({ success: true, usedBackupCode: true, codesRemaining: remaining.length });
  }

  return NextResponse.json({ error: "Invalid code" }, { status: 400 });
}

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { totpVerify } from "@/lib/totp";
import { z } from "zod";
import { logActivity } from "@/lib/activity-logger";

const disableSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA for the current user. Requires a valid TOTP code to confirm.
 * User must be fully authenticated (not twoFactorPending).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || session.user.twoFactorPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 });
  }

  const isValid = await totpVerify(user.twoFactorSecret, parsed.data.code);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  await db.user.update({
    where: { id: session.user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: [],
    },
  });

  void logActivity(session.user.id, "2FA_DISABLED", "USER", session.user.id, {});
  return NextResponse.json({ success: true });
}

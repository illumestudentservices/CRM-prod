import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { totpGenerateSecret, totpKeyUri } from "@/lib/totp";
import QRCode from "qrcode";

/**
 * POST /api/auth/2fa/generate
 * Generates a new TOTP secret + QR code for the current user.
 * The secret is NOT saved yet — the client must call /enable after verifying.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // 2FA-pending users cannot set up 2FA until they complete their current pending verification
  if (session.user.twoFactorPending) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, twoFactorEnabled: true },
  });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "2FA is already enabled" }, { status: 400 });
  }

  const secret = totpGenerateSecret();
  const otpauth = totpKeyUri(user.email, "Illume CRM", secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 256, margin: 2 });

  return NextResponse.json({ secret, qrDataUrl });
}

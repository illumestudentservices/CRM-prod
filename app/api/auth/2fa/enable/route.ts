import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { totpVerify } from "@/lib/totp";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const enableSchema = z.object({
  secret: z.string().min(16),
  code: z.string().length(6).regex(/^\d{6}$/),
});

function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")
  );
}

/**
 * POST /api/auth/2fa/enable
 * Verifies the first TOTP code against the provided secret, then saves the secret
 * and generates backup codes. Returns plaintext backup codes (shown once only).
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

  const parsed = enableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const { secret, code } = parsed.data;

  // Verify the TOTP code against the secret
  const isValid = await totpVerify(secret, code);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid code — make sure your authenticator app is synced" }, { status: 400 });
  }

  const backupCodes = generateBackupCodes(8);
  const hashedBackupCodes = await Promise.all(
    backupCodes.map((c) => bcrypt.hash(c, 10))
  );

  await db.user.update({
    where: { id: session.user.id },
    data: {
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorBackupCodes: hashedBackupCodes,
    },
  });

  return NextResponse.json({ success: true, backupCodes });
}

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { totpVerify } from "@/lib/totp";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { sendSecurityAlertEmail } from "@/lib/email";
import { logActivity } from "@/lib/activity-logger";

const enableSchema = z.object({
  secret: z.string().min(16),
  code: z.string().length(6).regex(/^\d{6}$/),
  // Spec pentest H-2 (2026-08-10) — the enroll flow now requires the
  // account password. Without this, a stolen session cookie can enrol
  // attacker-controlled MFA on any account that hasn't already enabled it
  // (or any account whose MFA was reset by an admin). Mirrors the pattern
  // used by /api/auth/change-password.
  currentPassword: z.string().min(1, "Current password is required"),
});

function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")
  );
}

/**
 * POST /api/auth/2fa/enable
 *
 * Enrolls MFA for the current user. Requires:
 *   1. a signed-in session that has NOT already passed 2FA (twoFactorPending
 *      is set true by the JWT callback right after credential sign-in),
 *   2. the account's current password (defence against stolen-session
 *      enrollment),
 *   3. a valid first TOTP code proving the caller controls the shared
 *      secret they're submitting.
 *
 * On success:
 *   - saves the shared secret and 8 bcrypt-hashed backup codes,
 *   - flips twoFactorEnabled = true on the user row,
 *   - sends a security-alert email to the account owner so a silent
 *     enrolment by a hijacked session is visible after the fact,
 *   - writes an audit log row,
 *   - returns the plaintext backup codes ONCE.
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

  const { secret, code, currentPassword } = parsed.data;

  // Load the user with their password hash to verify.
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      password: true,
      name: true,
      firstName: true,
      lastName: true,
      twoFactorEnabled: true,
    },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Already enrolled — refuse rather than silently overwrite. A rotation
  // flow (disable → enable) belongs on a different endpoint controlled by
  // SUPER_ADMIN so an attacker with a session can't quietly rotate the
  // shared secret and lock the real owner out.
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "MFA is already enabled on this account" }, { status: 409 });
  }

  // Password re-verification. Timing-safe via bcrypt.compare.
  if (!user.password) {
    return NextResponse.json({ error: "No password set on this account" }, { status: 400 });
  }
  const passwordOk = await bcrypt.compare(currentPassword, user.password);
  if (!passwordOk) {
    // Deliberately generic — do not disclose whether it was the code, the
    // password, or the session that failed.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  // Now verify the TOTP code against the submitted secret.
  const isValid = await totpVerify(secret, code);
  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid code — make sure your authenticator app is synced" },
      { status: 400 }
    );
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

  // Audit + user-facing notification. Best-effort: a mail send failure
  // should NOT roll back the enrollment (that would leave the user unable
  // to re-enrol if Brevo is briefly down).
  void logActivity(user.id, "MFA_ENABLED", "USER", user.id, {});

  const targetName =
    user.name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email;

  const ip =
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const ua = req.headers.get("user-agent")?.slice(0, 120) ?? "unknown";

  try {
    await sendSecurityAlertEmail({
      to: user.email,
      alertType: "MFA_ENABLED",
      targetName,
      targetEmail: user.email,
      changedBy: "you",
      details: {
        "IP address": ip,
        "Browser": ua,
        "Time (UTC)": new Date().toISOString(),
      },
    });
  } catch {
    /* non-fatal */
  }

  return NextResponse.json({ success: true, backupCodes });
}

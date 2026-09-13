import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { sendMfaCodeEmail, sendSecurityAlertEmail } from "@/lib/email";
import { logActivity, auditOrigin } from "@/lib/activity-logger";
import { issueEmailOtp, verifyEmailOtp, maskEmail, EMAIL_OTP_TTL_MS } from "@/lib/mfa";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({
    action: z.literal("confirm"),
    code: z.string().min(4).max(10),
    // Same guard as the authenticator flow (pentest H-2, 2026-08-10): without
    // the password, a stolen session cookie could enrol attacker-chosen MFA on
    // any account that has none yet. That the second factor here is the user's
    // own mailbox does not remove the need — the attacker holds the session,
    // and enrolling would hand them a durable foothold.
    currentPassword: z.string().min(1),
  }),
]);

function generateBackupCodes(count = 8): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-")
  );
}

/**
 * POST /api/auth/2fa/enroll-email
 *
 * Turns on two-factor using EMAILED CODES, with no authenticator app at any
 * point.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * `/api/settings/users/[id]/mfa-method` deliberately refuses to move an account
 * that has not finished enrolment, so it can never leave someone half
 * configured. Correct — but it produced a circular dead end for the exact
 * person the email method was built for: an executive who will not run an
 * authenticator app could not be given emailed codes, because the only way to
 * enrol was to first set up an authenticator app.
 *
 * This closes that loop. It is the same shape as the authenticator flow —
 * prove the factor works, then turn it on — with the emailed code standing in
 * for the first TOTP code.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * It will not touch an account that already has MFA. Changing an existing
 * account's method is the admin route's job, where it is audited and needs a
 * written reason. This only ever goes from "no second factor" to "one".
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  // `twoFactorPending` true means a second factor already exists and is
  // outstanding — the wrong state for enrolling a first one.
  if (!session?.user || session.user.twoFactorPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, email: true, password: true, name: true,
      firstName: true, lastName: true, twoFactorEnabled: true,
    },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refuse rather than silently overwrite, exactly as the authenticator flow
  // does. Rotating a live second factor from a session is how an attacker
  // quietly locks the real owner out.
  if (user.twoFactorEnabled) {
    return NextResponse.json({ error: "MFA is already enabled on this account" }, { status: 409 });
  }

  const displayName =
    user.name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email;

  // ── Step 1: send a code to the account's own mailbox ─────────────────────
  if (parsed.data.action === "send") {
    const issued = await issueEmailOtp(user.id);
    if (!issued.ok) {
      return NextResponse.json(
        {
          error: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
          retryAfterSeconds: issued.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(issued.retryAfterSeconds) } }
      );
    }

    const sent = await sendMfaCodeEmail({
      to: user.email,
      name: displayName,
      code: issued.code,
      expiryMinutes: Math.round(EMAIL_OTP_TTL_MS / 60000),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    // Say so rather than claiming success. Someone told "check your email" who
    // then waits for a message that was never accepted has no way to tell the
    // difference between slow mail and a broken setup.
    if (!sent) {
      await db.user.update({
        where: { id: user.id },
        data: { emailOtpHash: null, emailOtpExpiresAt: null, emailOtpAttempts: 0 },
      });
      return NextResponse.json(
        { error: "We could not send your code. Please try again, or contact IT support." },
        { status: 502 }
      );
    }

    return NextResponse.json({ sentTo: maskEmail(user.email) });
  }

  // ── Step 2: confirm the code, then turn it on ────────────────────────────
  const { code, currentPassword } = parsed.data;

  if (!user.password) {
    return NextResponse.json({ error: "No password set on this account" }, { status: 400 });
  }
  if (!(await bcrypt.compare(currentPassword, user.password))) {
    // Generic on purpose — never disclose whether the password or the code was
    // the part that failed.
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const check = await verifyEmailOtp(user.id, code);
  if (!check.ok) {
    if (check.reason === "expired" || check.reason === "no_code") {
      return NextResponse.json({ error: "That code has expired. Send a new one.", expired: true }, { status: 400 });
    }
    if (check.reason === "too_many_attempts") {
      return NextResponse.json(
        { error: "Too many incorrect attempts. Send a new code.", expired: true },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  const backupCodes = generateBackupCodes(8);
  const hashed = await Promise.all(backupCodes.map((c) => bcrypt.hash(c, 10)));

  await db.user.update({
    where: { id: user.id },
    data: {
      twoFactorEnabled: true,
      mfaMethod: "EMAIL",
      // No TOTP secret is set. The account can be moved to an authenticator
      // later, but that needs an MFA reset so a secret is actually enrolled —
      // the admin method route checks for one and refuses without it, rather
      // than switching someone onto a factor they do not possess.
      twoFactorSecret: null,
      twoFactorBackupCodes: hashed,
      mfaAttempts: 0,
      mfaLockedUntil: null,
    },
  });

  void logActivity(user.id, "MFA_ENABLED", "USER", user.id, {
    method: "email",
    ...(await auditOrigin()),
  });

  // Best effort: a mail failure here must not roll back the enrolment, which
  // would leave the user with no second factor and no way to add one.
  try {
    await sendSecurityAlertEmail({
      to: user.email,
      alertType: "MFA_ENABLED",
      targetName: displayName,
      targetEmail: user.email,
      changedBy: "you",
      details: {
        "Method": "Emailed sign-in codes",
        "IP address":
          req.headers.get("x-real-ip") ||
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          "unknown",
        "Time (UTC)": new Date().toISOString(),
      },
    });
  } catch { /* non-fatal */ }

  return NextResponse.json({ success: true, backupCodes });
}

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { totpVerify } from "@/lib/totp";
import {
  verifyEmailOtp, checkMfaLock, recordMfaFailure, clearMfaFailures,
} from "@/lib/mfa";
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
    select: { twoFactorSecret: true, twoFactorBackupCodes: true, mfaMethod: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Attempt ceiling, before any code is checked ──────────────────────────
  //
  // This route used to count nothing. Every factor below — authenticator code,
  // emailed code, backup code — could be guessed as often as a script liked by
  // anyone holding the password. Checked FIRST so a locked account costs an
  // attacker a bcrypt comparison of nothing at all.
  const lock = await checkMfaLock(session.user.id);
  if (lock.locked) {
    return NextResponse.json(
      {
        error: `Too many incorrect codes. Try again in ${Math.ceil(lock.retryAfterSeconds / 60)} minute(s).`,
        lockedOut: true,
        retryAfterSeconds: lock.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(lock.retryAfterSeconds) } }
    );
  }

  const cleanCode = code.replace(/\s/g, "");

  // Why the emailed code was refused, kept so the final message can be useful.
  // "Invalid code" on an EXPIRED code sends people round the same loop retyping
  // digits that were always right.
  let emailOtpFailure: "no_code" | "expired" | "too_many_attempts" | "mismatch" | null = null;

  // ── The primary factor, whichever one this account is on ─────────────────
  //
  // `mfaMethod` decides what is ACCEPTED, not just what is offered. An account
  // on EMAIL keeps its TOTP secret so it can move back without re-enrolling,
  // but that secret is NOT honoured here — otherwise both factors would stay
  // live forever and "which one is actually protecting this account" would have
  // no answer.
  if (user.mfaMethod === "EMAIL") {
    const result = await verifyEmailOtp(session.user.id, cleanCode);
    if (result.ok) {
      await clearMfaFailures(session.user.id);
      void logActivity(session.user.id, "2FA_VERIFIED", "USER", session.user.id, { method: "email_otp" });
      return NextResponse.json({ success: true });
    }
    // A wrong emailed code still falls through to the backup-code check below:
    // backup codes work under both methods, and they are the escape hatch for
    // precisely the failure this method is most exposed to — the mailbox being
    // unreachable. `result` is carried down so the message can be specific if
    // the backup check also misses.
    emailOtpFailure = result.reason;
  } else {
    if (!user.twoFactorSecret) {
      return NextResponse.json({ error: "2FA not configured" }, { status: 400 });
    }
    if (await totpVerify(user.twoFactorSecret, cleanCode)) {
      await clearMfaFailures(session.user.id);
      void logActivity(session.user.id, "2FA_VERIFIED", "USER", session.user.id, { method: "totp" });
      return NextResponse.json({ success: true });
    }
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
    await clearMfaFailures(session.user.id);
    void logActivity(session.user.id, "2FA_VERIFIED", "USER", session.user.id, {
      method: "backup_code",
      codesRemaining: remaining.length,
    });
    return NextResponse.json({ success: true, usedBackupCode: true, codesRemaining: remaining.length });
  }

  // Nothing matched. Counted ONCE here rather than at each factor above, so a
  // single wrong entry is one strike and not two or three just because the
  // route tried several things with it.
  const afterFailure = await recordMfaFailure(session.user.id);
  if (afterFailure.locked) {
    return NextResponse.json(
      {
        error: `Too many incorrect codes. Try again in ${Math.ceil(afterFailure.retryAfterSeconds / 60)} minute(s).`,
        lockedOut: true,
        retryAfterSeconds: afterFailure.retryAfterSeconds,
      },
      { status: 429, headers: { "Retry-After": String(afterFailure.retryAfterSeconds) } }
    );
  }

  // The caller is already past the password, so naming the reason tells them
  // nothing they could not work out by waiting — and saying "invalid" to
  // someone holding a correct-but-expired code is how people end up locked out
  // of their own account convinced the system is broken.
  if (emailOtpFailure === "expired" || emailOtpFailure === "no_code") {
    return NextResponse.json(
      { error: "That code has expired. Request a new one.", expired: true },
      { status: 400 }
    );
  }
  if (emailOtpFailure === "too_many_attempts") {
    return NextResponse.json(
      {
        error: "Too many incorrect attempts. That code is no longer valid — request a new one.",
        expired: true,
      },
      { status: 429 }
    );
  }

  return NextResponse.json({ error: "Invalid code" }, { status: 400 });
}

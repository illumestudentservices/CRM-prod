/**
 * Email OTP as a second factor, and the single place that decides which factor
 * an account is challenged with.
 *
 * ── WHY THIS EXISTS AND WHAT IT COSTS ───────────────────────────────────────
 *
 * TOTP is the default and remains the right answer for almost everyone. EMAIL
 * exists because some people will not run an authenticator app.
 *
 * It is WEAKER, and the weakness is specific rather than general: the
 * forgot-password flow emails a reset link to the same mailbox that receives
 * the code, so whoever holds that inbox can reset the password AND collect the
 * second factor. Two factors become one.
 *
 * That was put to the business on 2026-09-13 and ACCEPTED KNOWINGLY, on the
 * basis that the Microsoft 365 mailbox carries its own MFA. **That premise is
 * what makes this safe.** If company mail ever stops enforcing its own second
 * factor, this method stops being a second factor at all. Do not treat the
 * decision as settled for all time — it was made against a stated condition.
 *
 * Rejected at the same time, for the record, so they are not re-proposed as
 * novel: SMS (SIM swap), and exempting the account from MFA altogether (it
 * holds SUPER_ADMIN, so it is the worst account in the system to weaken).
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * `mfaMethod` decides what is ACCEPTED, not merely what is offered. While an
 * account is on EMAIL its TOTP secret is retained — so it can move back without
 * re-enrolling — but a TOTP code will not be accepted. Which factor is live is
 * therefore never ambiguous, and an attacker who obtained the old secret gains
 * nothing from the account having once used it.
 *
 * Backup codes work under BOTH methods. They are the escape hatch for exactly
 * the case this method is most exposed to: the mailbox being unreachable.
 */
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { db } from "@/lib/db";

/**
 * Ten minutes, not the five a TOTP step might suggest. The code has to survive
 * a mail hop, a spam filter and someone switching to their phone to read it; a
 * window that expires while the mail is still in flight produces "invalid code"
 * on a code that was never wrong, which is the failure people retry forever.
 */
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Wrong guesses allowed against one code before it is destroyed. Six digits is
 * a million possibilities — trivial to walk through over HTTP if nothing counts
 * the attempts, and nothing did: `/api/auth/2fa/verify` had no attempt limiting
 * of any kind before this. Five is enough for fat fingers and far short of
 * useful for a script.
 */
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

/**
 * Minimum gap between sends. Without it the resend button is a mail-flood
 * primitive aimed at someone else's inbox, and a way to burn the Resend quota.
 */
export const EMAIL_OTP_RESEND_COOLDOWN_MS = 60 * 1000;

/** Six digits: what people expect from an emailed code, and what autofill reads. */
const OTP_DIGITS = 6;

/**
 * `crypto.randomInt`, not `Math.random()`. This is a credential for ten
 * minutes, and `Math.random()` is a predictable PRNG — an attacker who learns
 * its state can produce the next code without ever seeing the email. Padded so
 * a leading zero survives, which also keeps every code the same length and
 * therefore indistinguishable in timing and in the UI.
 */
export function generateEmailOtp(): string {
  return String(crypto.randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, "0");
}

/** Codes are compared after stripping spaces — people paste "123 456". */
export function normaliseOtp(input: string): string {
  return input.replace(/\s/g, "");
}

export type OtpSendResult =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: "cooldown"; retryAfterSeconds: number };

/**
 * Issues a fresh code and stores only its hash.
 *
 * Issuing REPLACES any code still outstanding and resets the attempt counter.
 * That is deliberate: leaving the previous code valid would mean several live
 * codes at once, multiplying the guessing surface every time someone pressed
 * resend — the opposite of what a resend button should do.
 */
export async function issueEmailOtp(userId: string, now = new Date()): Promise<OtpSendResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailOtpSentAt: true },
  });

  if (user?.emailOtpSentAt) {
    const elapsed = now.getTime() - user.emailOtpSentAt.getTime();
    if (elapsed < EMAIL_OTP_RESEND_COOLDOWN_MS) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil((EMAIL_OTP_RESEND_COOLDOWN_MS - elapsed) / 1000),
      };
    }
  }

  const code = generateEmailOtp();
  const expiresAt = new Date(now.getTime() + EMAIL_OTP_TTL_MS);

  await db.user.update({
    where: { id: userId },
    data: {
      emailOtpHash: await bcrypt.hash(code, 10),
      emailOtpExpiresAt: expiresAt,
      emailOtpAttempts: 0,
      emailOtpSentAt: now,
    },
  });

  return { ok: true, code, expiresAt };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "no_code" | "expired" | "too_many_attempts" | "mismatch"; attemptsLeft: number };

/**
 * Checks a code and consumes it.
 *
 * A correct code is cleared immediately, so it cannot be replayed from a
 * forwarded email or a shoulder-surfed screen. A wrong one increments the
 * counter, and the code is destroyed once the ceiling is reached rather than
 * merely refused — refusing alone would leave the same code guessable again
 * after the next attempt.
 *
 * Expired and exhausted codes are also cleared, so a stale row cannot sit
 * around being tested. Every failure path returns the same shape; the caller is
 * responsible for not telling an unauthenticated user which one occurred.
 */
export async function verifyEmailOtp(
  userId: string,
  input: string,
  now = new Date()
): Promise<OtpVerifyResult> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { emailOtpHash: true, emailOtpExpiresAt: true, emailOtpAttempts: true },
  });

  if (!user?.emailOtpHash || !user.emailOtpExpiresAt) {
    return { ok: false, reason: "no_code", attemptsLeft: 0 };
  }

  if (user.emailOtpExpiresAt.getTime() <= now.getTime()) {
    await clearEmailOtp(userId);
    return { ok: false, reason: "expired", attemptsLeft: 0 };
  }

  if (user.emailOtpAttempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    await clearEmailOtp(userId);
    return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };
  }

  if (await bcrypt.compare(normaliseOtp(input), user.emailOtpHash)) {
    await clearEmailOtp(userId);
    return { ok: true };
  }

  const attempts = user.emailOtpAttempts + 1;
  if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    await clearEmailOtp(userId);
    return { ok: false, reason: "too_many_attempts", attemptsLeft: 0 };
  }

  await db.user.update({ where: { id: userId }, data: { emailOtpAttempts: attempts } });
  return { ok: false, reason: "mismatch", attemptsLeft: EMAIL_OTP_MAX_ATTEMPTS - attempts };
}

/**
 * Wipes the live code. Called on success, on expiry, on exhaustion, and
 * whenever the method changes — a code outstanding for a method the account no
 * longer uses is a credential nobody is watching.
 *
 * `emailOtpSentAt` is deliberately NOT cleared: it drives the resend cooldown,
 * and resetting it would make "fail, then immediately resend" an unlimited
 * send loop.
 */
export async function clearEmailOtp(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { emailOtpHash: null, emailOtpExpiresAt: null, emailOtpAttempts: 0 },
  });
}

/**
 * Masks an address for display on the pre-authentication verify screen.
 *
 * The person there has given a correct password but has NOT completed sign-in,
 * so they are not yet proven to be the account holder. Printing the address in
 * full would hand a partial attacker a verified mailbox to go after. Enough is
 * shown for the real owner to recognise which inbox to open.
 *
 *   jamshid@illumestudentservices.ca  →  j••••••d@illumestudentservices.ca
 *   al@x.com                          →  a••@x.com
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}••${domain}`;
  return `${local[0]}${"•".repeat(Math.min(local.length - 2, 8))}${local[local.length - 1]}${domain}`;
}

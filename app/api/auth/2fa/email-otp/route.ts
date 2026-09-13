import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { logActivity, auditOrigin } from "@/lib/activity-logger";
import { sendMfaCodeEmail } from "@/lib/email";
import { issueEmailOtp, maskEmail, EMAIL_OTP_TTL_MS } from "@/lib/mfa";
import { headers } from "next/headers";

/**
 * POST /api/auth/2fa/email-otp
 *
 * Called by /verify-2fa on mount, and again when the user presses Resend.
 *
 * Doubles as the page's "which factor am I on?" query, so the client needs one
 * round trip rather than two and there is no window where the screen says
 * "open your authenticator" to somebody who does not have one. An account on
 * TOTP gets `{ method: "TOTP" }` and NO email is sent.
 *
 * Requires a session with `twoFactorPending` — i.e. the password has already
 * been accepted. That matters: without it this endpoint would email a code to
 * any address an anonymous caller named, which is both a disclosure (the
 * account exists) and a way to spam a mailbox.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Nothing outstanding — a stale tab or a double submit. Not an error, and
  // certainly not a reason to send a code to someone already signed in.
  if (!session.user.twoFactorPending) {
    return NextResponse.json({ method: "NONE", alreadyVerified: true });
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, name: true, mfaMethod: true, twoFactorEnabled: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.mfaMethod !== "EMAIL") {
    return NextResponse.json({ method: "TOTP" });
  }

  const issued = await issueEmailOtp(session.user.id);

  if (!issued.ok) {
    // 429 with the exact wait, so the button can show a countdown instead of
    // failing silently and inviting another press.
    return NextResponse.json(
      {
        method: "EMAIL",
        error: `Please wait ${issued.retryAfterSeconds}s before requesting another code.`,
        retryAfterSeconds: issued.retryAfterSeconds,
        sentTo: maskEmail(user.email),
      },
      { status: 429, headers: { "Retry-After": String(issued.retryAfterSeconds) } }
    );
  }

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const sent = await sendMfaCodeEmail({
    to: user.email,
    name: user.name ?? user.email,
    code: issued.code,
    expiryMinutes: Math.round(EMAIL_OTP_TTL_MS / 60000),
    ip,
  });

  // If the provider did not take it, say so. The alternative — "check your
  // email" over a message that never left the building — strands the user on a
  // screen waiting for a code that does not exist, with a valid hash sitting in
  // the database making it look like everything worked.
  if (!sent) {
    return NextResponse.json(
      {
        method: "EMAIL",
        error: "We could not send your code right now. Please try again, or contact IT support.",
        sentTo: maskEmail(user.email),
      },
      { status: 502 }
    );
  }

  void logActivity(session.user.id, "MFA_EMAIL_CODE_SENT", "USER", session.user.id, {
    // The code itself is never logged — it is a live credential for ten
    // minutes, and an audit row is a copy of it that outlives its use.
    method: "email",
    ...(await auditOrigin()),
  });

  return NextResponse.json({
    method: "EMAIL",
    sentTo: maskEmail(user.email),
    expiresAt: issued.expiresAt.toISOString(),
  });
}

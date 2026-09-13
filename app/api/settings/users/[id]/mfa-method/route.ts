import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { logActivity, auditOrigin } from "@/lib/activity-logger";
import { clearEmailOtp } from "@/lib/mfa";

const schema = z.object({
  method: z.enum(["TOTP", "EMAIL"]),
  /** Free text, recorded on the audit row. Required for EMAIL — see below. */
  reason: z.string().trim().max(500).optional(),
});

/**
 * PATCH /api/settings/users/[id]/mfa-method
 *
 * Moves one account between second factors.
 *
 * ── WHY THIS IS A ROLE LITERAL AND NOT A CAPABILITY ─────────────────────────
 *
 * Almost everything else admin-ish in this codebase is capability-gated so it
 * can be tuned in Settings → Security without a deploy, and that is normally
 * the better pattern. Not here. A capability can be granted to a role, and the
 * thing being granted is "weaken another person's second factor" — including a
 * SUPER_ADMIN's. Making that reachable by configuration means a single
 * permissions edit is enough to set up the next attack. It stays hardcoded so
 * changing who can do it requires a code change and a review.
 *
 * ── WHAT THIS DELIBERATELY WILL NOT DO ──────────────────────────────────────
 *
 * It will not enrol anybody. The account must already have MFA working, so the
 * switch is always from one live factor to another and there is no path here
 * that turns MFA on, off, or into a half-configured state. A never-enrolled
 * user goes through /setup-2fa like everyone else and can be moved afterwards.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 422 });
  }
  const { method, reason } = parsed.data;

  // A reason is mandatory when weakening, optional when strengthening. Email
  // OTP is a documented exception to the standard, and an exception nobody
  // wrote a reason for is indistinguishable from a mistake six months later.
  if (method === "EMAIL" && !reason) {
    return NextResponse.json(
      { error: "A reason is required when moving an account to email codes." },
      { status: 422 }
    );
  }

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, name: true, mfaMethod: true,
      twoFactorEnabled: true, twoFactorSecret: true, deletedAt: true,
    },
  });
  if (!user || user.deletedAt) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!user.twoFactorEnabled) {
    return NextResponse.json(
      {
        error:
          "This account has not finished setting up two-factor authentication yet. It must complete enrolment before the method can be changed.",
      },
      { status: 400 }
    );
  }
  if (user.mfaMethod === method) {
    return NextResponse.json({ success: true, unchanged: true, method });
  }

  // Someone who enrolled straight onto emailed codes has NO authenticator
  // secret, so moving them to TOTP would point the account at a factor it does
  // not possess — and since the method decides what is accepted, that is a
  // lockout. Refuse and name the way forward instead of doing it and letting
  // them discover it at the login screen.
  if (method === "TOTP" && !user.twoFactorSecret) {
    return NextResponse.json(
      {
        error:
          "This account has no authenticator app set up, so it cannot be switched to one. Reset its MFA instead — the user will then be asked to enrol again and can pick either method.",
      },
      { status: 400 }
    );
  }

  await db.user.update({ where: { id }, data: { mfaMethod: method } });

  // Any code outstanding under the old method is a live credential that nothing
  // is watching any more. Clearing it also means the resend cooldown is the
  // only thing standing between the user and a fresh code on the new method.
  await clearEmailOtp(id);

  // Recorded against the TARGET account, not the acting admin, because the
  // question later is "why is this account weaker than the others" and the
  // answer needs to be on that account's own trail. `actorId` carries who did
  // it; the audit row's own userId is the subject.
  void logActivity(session.user.id, "MFA_METHOD_CHANGED", "USER", id, {
    from: user.mfaMethod,
    to: method,
    subjectEmail: user.email,
    reason: reason ?? null,
    ...(await auditOrigin()),
  });

  return NextResponse.json({ success: true, method });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const MAX_ATTEMPTS = 5;

// POST /api/auth/login-status
// Called client-side after a failed sign-in to show richer error messaging
// (lockout countdown, remaining attempts).
//
// Security note: we intentionally do NOT distinguish "unknown email" from
// "wrong password" — always return a generic status for unrecognised addresses
// to prevent user enumeration.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const email = typeof body?.email === "string" ? body.email.trim() : null;
    if (!email) return NextResponse.json({ status: "unknown" });

    const user = await db.user.findUnique({
      where: { email },
      select: { loginAttempts: true, lockedUntil: true, isActive: true, deletedAt: true },
    });

    // Unknown email — return generic response (same shape as other non-actionable states)
    if (!user || user.deletedAt) return NextResponse.json({ status: "unknown" });

    // Inactive account — safe to disclose so the user doesn't keep trying
    if (!user.isActive) return NextResponse.json({ status: "inactive" });

    // Locked account — disclose lockout details so the user knows to wait
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return NextResponse.json({
        status: "locked",
        lockedUntil: user.lockedUntil.toISOString(),
      });
    }

    // Active, not locked — return remaining attempts so the user can self-correct.
    // Only surface this when attempts are meaningful (> 0 failed).
    const attemptsUsed = user.loginAttempts ?? 0;
    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - attemptsUsed);

    return NextResponse.json({ status: "ok", attemptsUsed, attemptsRemaining });
  } catch {
    return NextResponse.json({ status: "unknown" });
  }
}

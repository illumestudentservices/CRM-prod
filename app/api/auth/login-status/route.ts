import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/auth/login-status
 *
 * Historical purpose: fetch richer post-failure UX (attempts remaining,
 * lockout countdown) so the login page could tell a user why they were
 * blocked.
 *
 * Security change (pentest H-1, 2026-08-10): the endpoint was authored
 * unauthenticated and returned FOUR distinct response shapes depending on
 * account state:
 *
 *   { status: "ok",       attemptsUsed, attemptsRemaining }  -- real account
 *   { status: "unknown" }                                    -- email not in DB
 *   { status: "locked",   lockedUntil }                      -- real, locked
 *   { status: "inactive" }                                   -- real, deactivated
 *
 * That's user enumeration: an attacker can (a) confirm which emails
 * correspond to real accounts, (b) spot deactivated employees, and
 * (c) watch attemptsUsed to pace credential-stuffing under the 5-attempt
 * lockout ceiling.
 *
 * The fix: the endpoint now always returns the SAME payload — a fixed
 * "ok" shape with no per-account values. The client-side login page
 * cannot show a lockout timer or attempts remaining from an unauthenticated
 * call any more, but that information is still available AFTER a successful
 * credential match (delivered through the session), which is the only
 * point at which we know the caller is legitimate.
 *
 * We intentionally keep the endpoint responding to POST so old clients
 * don't crash; they just receive a value that carries no signal.
 */
export async function POST(_req: NextRequest) {
  // Constant-time-ish, constant-shape response. No DB query, no branching
  // on user state — even the request body is ignored.
  return NextResponse.json({ status: "ok" });
}

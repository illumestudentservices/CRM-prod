import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * POST /api/auth/2fa/disable
 *
 * Self-service disable is intentionally closed off. 2FA is mandatory for every
 * role (enforced in proxy.ts), so turning it off would only bounce the user to
 * /setup-2fa on their next request.
 *
 * A SUPER_ADMIN resets it instead — PATCH /api/settings/users with resetMfa —
 * which clears the secret and forces re-enrolment at next login.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user || session.user.twoFactorPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error:
        "Two-factor authentication is required on all accounts and cannot be disabled. Contact an administrator if you need it reset.",
    },
    { status: 403 }
  );
}

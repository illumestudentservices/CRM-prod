import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLink } from "@/lib/magic-link";
import { sendMagicLinkEmail } from "@/lib/email";
import { findUserByEmail } from "@/lib/email-identity";
import { logActivity } from "@/lib/activity-logger";

const schema = z.object({
  email: z.string().email(),
});

// POST /api/auth/forgot-password
// Always returns { success: true } regardless of whether the email exists,
// to prevent user enumeration attacks.
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: true });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: true });
  }

  const { email } = parsed.data;

  try {
    // Case-insensitive, and deliberately the SAME lookup sign-in uses. If reset
    // matched capitalisation while sign-in did not, somebody could be sent a
    // working link for an account they were then unable to sign into — which is
    // exactly the shape of the bug this fixes.
    const user = await findUserByEmail(email, {
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
    });

    if (user) {
      // A password-reset request is a security event and had no audit row at
      // all. Logged only when the account exists — the endpoint deliberately
      // answers identically either way to avoid confirming an address, and an
      // audit row for a non-existent user would record nothing but noise.
      //
      // Attributed to the account itself: there is no session here, and the
      // subject of the event is the account whose password is being reset.
      void logActivity(user.id, "PASSWORD_RESET_REQUESTED", "USER", user.id, {
        route: "auth/forgot-password",
      });

      // Fire-and-forget: create the link and send email without blocking the response
      createMagicLink(user.id, 24)
        .then((magicLinkUrl) =>
          sendMagicLinkEmail({
            to: user.email,
            name: user.name ?? user.email,
            magicLinkUrl,
            expiryHours: 24,
          })
        )
        .catch((err) => console.error("[forgot-password] Failed:", err));
    }
  } catch (err) {
    console.error("[forgot-password]", err);
  }

  // Always success — caller can't tell if user exists
  return NextResponse.json({ success: true });
}

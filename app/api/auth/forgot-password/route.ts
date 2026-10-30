import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLink } from "@/lib/magic-link";
import { sendMagicLinkEmail } from "@/lib/email";
import { findUserByEmail } from "@/lib/email-identity";
import { logActivity } from "@/lib/activity-logger";
import { rateLimit, clientIp } from "@/lib/rate-limit";

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

  // Rate limit BEFORE the user lookup, so it protects against bombing a victim's
  // inbox and draining the email quota, and behaves identically whether or not
  // the address exists (the 429 reveals request frequency, never account
  // existence). Per-email caps messages to any one inbox; per-IP caps a single
  // source hammering many addresses. There was no limit here at all before.
  const ip = clientIp(req);
  const emailOk = rateLimit(`fp:email:${email.toLowerCase()}`, 3, 15 * 60 * 1000);
  const ipOk = rateLimit(`fp:ip:${ip}`, 20, 60 * 60 * 1000);
  if (!emailOk || !ipOk) {
    return NextResponse.json(
      { error: "Too many password-reset requests. Please wait a while and try again." },
      { status: 429 }
    );
  }

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

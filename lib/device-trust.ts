import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";
import { sendNewDeviceAlertEmail } from "@/lib/email";

/**
 * New-device sign-in detection.
 *
 * Every browser that signs in is tagged with a random token in a long-lived
 * cookie. On each login we look that token up among the user's known devices:
 *   - known      → quietly bump "last seen", nothing else.
 *   - not known  → record it as a new device; if it is NOT the user's first
 *                  ever device, email them a "new sign-in" alert and log it.
 *
 * The user's FIRST device is trusted silently — onboarding (the very first sign
 * in) is expected, so alerting on it would just be noise.
 *
 * Only the token's HMAC is stored, keyed by the server's auth secret, so neither
 * a database leak nor a second server can forge a "known" device. Everything
 * here is best-effort: a failure must never block a legitimate login.
 */

export const DEVICE_COOKIE = "illume_device";
// ~400 days — the longest a browser will persist a cookie (Chrome caps here).
export const DEVICE_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const SECRET =
  process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "illume-device-fallback-secret";

function hashToken(token: string): string {
  return crypto.createHmac("sha256", SECRET).update(token).digest("hex");
}

function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Record a device the user has not used before, and alert unless it's their first. */
async function recordNewDevice(userId: string, token: string, userAgent: string, ip: string | null) {
  const prior = await db.knownDevice.count({ where: { userId } });

  await db.knownDevice.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      userAgent: userAgent ? userAgent.slice(0, 300) : null,
      ipAddress: ip,
    },
  });

  // First device ever → trust silently (onboarding). Any later new device alerts.
  if (prior > 0) {
    void logActivity(userId, "NEW_DEVICE_LOGIN", "USER", userId, {
      ip,
      userAgent: userAgent ? userAgent.slice(0, 200) : null,
    });
    try {
      const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
      if (user?.email) {
        await sendNewDeviceAlertEmail({
          to: user.email,
          name: user.name ?? "there",
          ip,
          userAgent,
          when: new Date(),
        });
      }
    } catch (err) {
      console.error("[device-trust] new-device email failed:", err);
    }
  }
}

/**
 * Call on a successful login. Returns the cookie token to set on the response
 * when a fresh one was minted (a browser with no device cookie yet), or null
 * when the existing cookie is fine as-is. Never throws.
 */
export async function recogniseDeviceOnLogin(
  req: NextRequest,
  userId: string
): Promise<{ cookieToSet: string | null }> {
  try {
    const ua = req.headers.get("user-agent") ?? "";
    const ip = clientIpFromHeaders(req);
    const existing = req.cookies.get(DEVICE_COOKIE)?.value;

    if (existing) {
      const known = await db.knownDevice.findFirst({
        where: { userId, tokenHash: hashToken(existing) },
        select: { id: true },
      });
      if (known) {
        // Recognised — just refresh last-seen. Keep the existing cookie.
        await db.knownDevice.update({
          where: { id: known.id },
          data: { lastSeenAt: new Date(), ipAddress: ip, userAgent: ua ? ua.slice(0, 300) : null },
        });
        return { cookieToSet: null };
      }
      // Cookie exists but this user has never used it (e.g. a shared computer,
      // or a token minted for another account). Bind it to this user as a new
      // device — no need to reset the cookie the browser already holds.
      await recordNewDevice(userId, existing, ua, ip);
      return { cookieToSet: null };
    }

    // No device cookie at all → brand-new browser. Mint one.
    const token = newToken();
    await recordNewDevice(userId, token, ua, ip);
    return { cookieToSet: token };
  } catch (err) {
    console.error("[device-trust] recognise failed (login not blocked):", err);
    return { cookieToSet: null };
  }
}

/** Mirror of lib/rate-limit clientIp, kept local so this module has no cycle. */
function clientIpFromHeaders(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip");
}

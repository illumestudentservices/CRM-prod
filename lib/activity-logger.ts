import { db } from "@/lib/db";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

/**
 * Pulls the caller's IP and user-agent.
 *
 * Most call sites have no NextRequest to hand — the login path runs inside
 * NextAuth's authorize(), for example — so when one isn't passed we fall back to
 * next/headers, which reaches the same request through async context. Without
 * that fallback every entry logged outside a route handler stored a null IP.
 *
 * Nginx sets X-Real-IP and X-Forwarded-For. X-Forwarded-For is a client-to-proxy
 * chain, so the first entry is the originating client.
 */
async function requestMeta(req?: NextRequest) {
  const read = (get: (k: string) => string | null) => ({
    ipAddress:
      get("x-forwarded-for")?.split(",")[0].trim() ?? get("x-real-ip") ?? null,
    userAgent: get("user-agent") ?? null,
  });

  if (req) return read((k) => req.headers.get(k));

  try {
    const h = await headers();
    return read((k) => h.get(k));
  } catch {
    // Outside a request context (e.g. a background job) — nothing to capture.
    return { ipAddress: null, userAgent: null };
  }
}

/**
 * Origin metadata for a `db.auditLog.create()` written directly rather than via
 * logActivity().
 *
 * 33 route files write audit rows straight to Prisma and only 3 of them set
 * ipAddress, so most audited actions were stored with no origin: on production 28
 * of 84 rows had a null IP, and they were the business actions (CREATE Lead,
 * LEAD_CLOSED) while LOGIN and 2FA_VERIFIED — which do go through this module —
 * had one. Spread this into the `data` block:
 *
 *     data: { action: "CREATE", ..., ...(await auditOrigin()) }
 *
 * Preferred over extending the Prisma client: `$extends` changes the client's type
 * and breaks every `$transaction` callback that expects a plain client.
 */
export async function auditOrigin(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  return requestMeta();
}

/**
 * Fire-and-forget audit logger. Never throws — failures are logged to stderr only.
 */
export async function logActivity(
  userId: string,
  action: string,
  entity: string,
  entityId: string,
  changes?: Record<string, unknown> | null,
  req?: NextRequest
): Promise<void> {
  try {
    const { ipAddress, userAgent } = await requestMeta(req);
    await db.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        changes: (changes ?? undefined) as any,
        ipAddress,
        userAgent,
      },
    });
  } catch (err) {
    console.error("[logActivity]", err);
  }
}

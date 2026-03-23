import { db } from "@/lib/db";
import type { NextRequest } from "next/server";

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
    await db.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        changes: (changes ?? undefined) as any,
        ipAddress:
          req?.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
          req?.headers.get("x-real-ip") ??
          null,
        userAgent: req?.headers.get("user-agent") ?? null,
      },
    });
  } catch (err) {
    console.error("[logActivity]", err);
  }
}

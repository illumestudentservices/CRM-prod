import { db } from "@/lib/db";
import { generateResetToken } from "@/lib/password";

/**
 * Creates a one-time password-reset magic link token for a user.
 * Invalidates any existing unused tokens for that user first.
 * Returns the full URL the user should visit.
 */
export async function createMagicLink(userId: string, expiryHours = 24): Promise<string> {
  // Invalidate existing tokens
  await db.passwordResetToken.deleteMany({ where: { userId } });

  const token = generateResetToken();
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  await db.passwordResetToken.create({
    data: { userId, token, expiresAt },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${baseUrl}/reset-password/${token}`;
}

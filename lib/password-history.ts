import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { PASSWORD_HISTORY_DEPTH } from "@/lib/password";
import type { Prisma } from "@prisma/client";

/**
 * Password reuse prevention.
 *
 * Every path that sets a password goes through here, so a user cannot dodge
 * the rule by using the forgot-password flow instead of the change form.
 *
 * The history holds the last N hashes *including the current one* — a new hash
 * is recorded at the moment it is set. That makes "you cannot reuse your last 5
 * passwords" literally true, rather than off by one.
 */

/** True when the candidate matches any remembered password. */
export async function isPasswordReused(userId: string, plaintext: string): Promise<boolean> {
  const history = await db.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
    select: { hash: true },
  });
  if (history.length === 0) return false;

  // Sequential rather than Promise.all: bcrypt is CPU-bound, so firing all five
  // at once buys nothing and pins the event loop for the whole batch. Stopping
  // at the first match usually costs one comparison, not five.
  for (const { hash } of history) {
    if (await bcrypt.compare(plaintext, hash)) return true;
  }
  return false;
}

/**
 * Records a newly set password and trims the history back to the policy depth.
 *
 * Accepts a transaction client so the write lands atomically with the password
 * update — a crash between the two would otherwise leave a password that is not
 * in its own history and is therefore immediately reusable.
 */
export async function recordPasswordInHistory(
  userId: string,
  hash: string,
  client: Prisma.TransactionClient | typeof db = db
): Promise<void> {
  await client.passwordHistory.create({ data: { userId, hash } });

  // Keep only the most recent N. Old hashes are not harmless to retain: they
  // are offline-crackable material for passwords the user may still use
  // elsewhere, so there is no reason to keep more than the policy needs.
  const keep = await client.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
    select: { id: true },
  });
  await client.passwordHistory.deleteMany({
    where: { userId, id: { notIn: keep.map((r) => r.id) } },
  });
}

/** Human-readable refusal, shared so every entry point words it the same way. */
export const PASSWORD_REUSED_MESSAGE = `You have used this password recently. Choose one you have not used in your last ${PASSWORD_HISTORY_DEPTH} passwords.`;

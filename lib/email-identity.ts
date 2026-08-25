import { db } from "@/lib/db";

/**
 * Finding and storing people by email address, without caring about capitals.
 *
 * `lib/auth.ts` used to look a user up with the address exactly as typed.
 * Postgres compares `text` case-sensitively, so an account stored as
 * "Ashley-Jane@illumestudentservices.ca" could only be signed into by typing
 * that capitalisation — and anyone typing their own address in lowercase was
 * told "Invalid email or password".
 *
 * It looked like two separate faults and that is why it lasted: the password
 * seemed wrong, and two-factor setup seemed to be missing. Both were the same
 * cause. The lookup failed before the password was ever compared, so
 * `loginAttempts` stayed at 0 — no lockout, no audit trail, nothing to find —
 * and MFA enrolment sits behind a successful password check, so it never
 * appeared.
 *
 * Four call sites matched on email and every one of them was case-sensitive:
 * sign-in, forgotten password, and the duplicate checks on employee creation and
 * on account requests. They live here now so a future fifth cannot quietly
 * reintroduce the bug, and so sign-in and password reset can never disagree
 * about who a person is.
 */

/**
 * The stored form of an address: trimmed and lowercased.
 *
 * The local part is technically case-sensitive per RFC 5321, but no mail
 * provider in practice treats it that way, and a login form that does is
 * indistinguishable to the user from a broken password. Migration 036
 * lowercases the existing rows and adds a unique index on `lower(email)` so the
 * two can never drift.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The user with this address, whatever capitalisation was typed.
 *
 * FAILS CLOSED on more than one match. Migration 036's unique index on
 * `lower(email)` should make that impossible, but a case-insensitive lookup that
 * silently picks the first of several rows would authenticate against an
 * arbitrary account — so if the invariant is ever broken, this refuses rather
 * than guesses. `select` is passed straight through so callers keep control of
 * what they read.
 */
export async function findUserByEmail<T extends Record<string, unknown>>(
  email: string,
  args: { select?: T; include?: Record<string, unknown>; where?: Record<string, unknown> } = {}
) {
  const { select, include, where } = args;
  const matches = await db.user.findMany({
    where: {
      ...where,
      email: { equals: normaliseEmail(email), mode: "insensitive" },
    },
    ...(select ? { select } : {}),
    ...(include ? { include } : {}),
    take: 2,
  });

  if (matches.length > 1) {
    console.error(
      `[email-identity] ${matches.length} accounts share the address ${normaliseEmail(email)} ` +
      `ignoring case. Refusing to choose one. The unique index from migration 036 should ` +
      `prevent this — check it exists.`
    );
    return null;
  }
  return matches[0] ?? null;
}

/**
 * Is this address already taken, ignoring capitalisation?
 *
 * Used by the duplicate checks on employee creation and account requests. Those
 * were case-sensitive, which meant "mike@" could be created alongside an
 * existing "Mike@" — two accounts for one person, and the ambiguity that
 * findUserByEmail now refuses to resolve.
 */
export async function emailIsTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const n = await db.user.count({
    where: {
      email: { equals: normaliseEmail(email), mode: "insensitive" },
      ...(exceptUserId ? { NOT: { id: exceptUserId } } : {}),
    },
  });
  return n > 0;
}

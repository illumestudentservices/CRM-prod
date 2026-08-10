import { randomBytes } from "crypto";

export interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Industry-standard password complexity rules:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];
  if (password.length < 12) errors.push("At least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("At least one uppercase letter (A-Z)");
  if (!/[a-z]/.test(password)) errors.push("At least one lowercase letter (a-z)");
  if (!/[0-9]/.test(password)) errors.push("At least one number (0-9)");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("At least one special character (!@#$%...)");
  return { valid: errors.length === 0, errors };
}

/** Generates a cryptographically secure random token for magic links */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** Generates a secure random temporary password that meets complexity rules */
export function generateTempPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;

  const buf = randomBytes(20);
  // Ensure at least one from each category
  const required = [
    upper[buf[0] % upper.length],
    lower[buf[1] % lower.length],
    digits[buf[2] % digits.length],
    special[buf[3] % special.length],
  ];
  const rest = Array.from({ length: 12 }, (_, i) => all[buf[4 + i] % all.length]);

  // Fisher-Yates shuffle
  const arr = [...required, ...rest];
  const shuffleBuf = randomBytes(arr.length);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = shuffleBuf[i] % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const out = arr.join("");
  // Defense in depth: any future edit to this function that accidentally
  // produces a value that doesn't meet the policy should fail loudly at the
  // callsite (HR create) rather than silently seed a weak temp password. The
  // check runs once per invocation and is cheap.
  const check = validatePassword(out);
  if (!check.valid) {
    throw new Error(
      `generateTempPassword produced a value that fails policy: ${check.errors.join(", ")}`
    );
  }
  return out;
}

// ─── Rotation policy ──────────────────────────────────────────────────────────

/** Passwords must be rotated on this cadence. */
export const PASSWORD_MAX_AGE_DAYS = 90;

/**
 * How many recent passwords are remembered and refused on reuse. Counts the
 * current password, so a user cannot immediately set it back to what it was.
 */
export const PASSWORD_HISTORY_DEPTH = 5;

/** Start warning the user this many days before expiry. */
export const PASSWORD_EXPIRY_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * Whole days until the password must be changed. Negative once overdue.
 *
 * A null `changedAt` means the account predates rotation tracking. It is
 * treated as *not* expired: the migration stamps every existing user, so the
 * only way to see null here is a row created outside that path, and locking
 * someone out on a bookkeeping gap is the wrong default.
 */
export function daysUntilPasswordExpiry(
  // Accepts epoch milliseconds too: the session carries the stamp as a number,
  // since a Date does not survive JWT serialisation intact.
  changedAt: Date | string | number | null | undefined,
  now: Date = new Date()
): number | null {
  if (changedAt === null || changedAt === undefined || changedAt === "") return null;
  const t =
    typeof changedAt === "number"
      ? changedAt
      : typeof changedAt === "string"
        ? Date.parse(changedAt)
        : changedAt.getTime();
  if (!Number.isFinite(t)) return null;
  const elapsedDays = Math.floor((now.getTime() - t) / DAY_MS);
  return PASSWORD_MAX_AGE_DAYS - elapsedDays;
}

export function isPasswordExpired(
  changedAt: Date | string | number | null | undefined,
  now: Date = new Date()
): boolean {
  const left = daysUntilPasswordExpiry(changedAt, now);
  return left !== null && left <= 0;
}

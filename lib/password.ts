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
  return arr.join("");
}

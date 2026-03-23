/**
 * Thin wrapper around otplib v13 for TOTP operations.
 * otplib v13 exposes async standalone functions — this file adapts them to
 * the synchronous-like interface the rest of the codebase expects.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const otplib = require("otplib") as {
  generateSecret: () => string;
  generate: (opts: { secret: string }) => Promise<string>;
  verify: (opts: { secret: string; token: string }) => Promise<{ valid: boolean }>;
};

export function totpGenerateSecret(): string {
  return otplib.generateSecret();
}

/** Returns the otpauth:// URI for QR code generation. */
export function totpKeyUri(email: string, issuer: string, secret: string): string {
  return (
    `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}

export async function totpGenerate(secret: string): Promise<string> {
  return otplib.generate({ secret });
}

export async function totpVerify(secret: string, token: string): Promise<boolean> {
  const result = await otplib.verify({ secret, token });
  return result?.valid === true;
}

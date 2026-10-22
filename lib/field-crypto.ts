import crypto from "node:crypto";

/**
 * Application-level field encryption for data at rest.
 *
 * ★ WHY THIS EXISTS.
 *
 * The database disk is not full-disk encrypted. Anyone who could read the raw
 * table files — a stolen backup, a mis-scoped snapshot, a compromised host —
 * would see passport numbers and visa history in clear text. Encrypting the
 * most sensitive fields in the application means those bytes are ciphertext on
 * disk and in every backup, readable only with the key, which lives in the
 * environment and never in the database.
 *
 * ★ THE ENVELOPE, AND WHY IT IS PREFIXED.
 *
 * A ciphertext is stored as:  enc:1:<base64url( iv(12) || tag(16) || ct )>
 *
 * The `enc:1:` prefix is load-bearing. It lets every read tell an encrypted
 * value from a legacy plaintext one, so the system works correctly through the
 * migration: a value that is already plaintext decrypts to itself, a value that
 * is encrypted is unwrapped, and nothing has to be migrated in a single stop-
 * the-world step. The `1` is a scheme version, so the format can change later
 * without guessing what old rows used.
 *
 * ★ AES-256-GCM.
 *
 * Authenticated encryption: the tag is verified on decrypt, so a corrupted or
 * tampered ciphertext throws rather than returning garbage. A fresh random IV
 * per encryption means the same plaintext encrypts differently each time —
 * which is why equality lookups use the separate blind index below, not the
 * ciphertext.
 *
 * ★ KEY MANAGEMENT — READ THIS.
 *
 * One secret, FIELD_ENCRYPTION_KEY (base64, >= 32 bytes), is the root. The
 * encryption key and the blind-index key are each derived from it with HKDF and
 * distinct info labels, so the two uses never share key material. If this
 * secret is lost, every encrypted field becomes unrecoverable — it must be
 * backed up securely and kept STABLE for the life of the data. If it is ever
 * rotated, existing ciphertext must be re-encrypted under the new key first.
 */

const PREFIX = "enc:1:";

let masterCache: Buffer | null = null;
function master(): Buffer {
  if (masterCache) return masterCache;
  const b64 = process.env.FIELD_ENCRYPTION_KEY ?? "";
  if (!b64) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is not set — sensitive-field encryption cannot run without it.",
    );
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 32) {
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to at least 32 bytes (got ${buf.length}).`,
    );
  }
  masterCache = buf;
  return buf;
}

// Derived, cached. Distinct info labels keep the two derived keys independent.
let encCache: Buffer | null = null;
let macCache: Buffer | null = null;
function encKey(): Buffer {
  if (!encCache) {
    encCache = Buffer.from(
      crypto.hkdfSync("sha256", master(), Buffer.alloc(0), Buffer.from("illume:field-enc:v1"), 32),
    );
  }
  return encCache;
}
function macKey(): Buffer {
  if (!macCache) {
    macCache = Buffer.from(
      crypto.hkdfSync("sha256", master(), Buffer.alloc(0), Buffer.from("illume:blind-index:v1"), 32),
    );
  }
  return macCache;
}

/** True if the value is one of our ciphertext envelopes (not legacy plaintext). */
export function isEncrypted(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a string. Already-encrypted input is returned unchanged (idempotent). */
export function encryptField(plain: string): string {
  if (isEncrypted(plain)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64url");
}

/**
 * Decrypt an envelope. A value WITHOUT the prefix is passed through unchanged —
 * that is deliberate, so legacy plaintext read before migration is correct.
 */
export function decryptField(value: string): string {
  if (!isEncrypted(value)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * A deterministic, one-way blind index of a value, for equality lookups without
 * decrypting. Normalised (trimmed, upper-cased) first so matching is case- and
 * whitespace-insensitive, which is what the old `mode: "insensitive"` query did.
 * It is an HMAC: it reveals nothing about the value and cannot be reversed.
 */
export function blindIndex(plain: string): string {
  const norm = plain.trim().toUpperCase();
  return crypto.createHmac("sha256", macKey()).update(norm, "utf8").digest("base64url");
}

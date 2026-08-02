/**
 * Encryption for leads held on a device between capture and upload.
 *
 * Browser-only — WebCrypto, no dependency.
 *
 * The threat this addresses is narrow and worth stating plainly: a phone left
 * on a stand or taken from a bag, holding up to a hundred students' names,
 * emails and phone numbers. It does not defend against malware running as the
 * user, and it cannot — the key is derived in the same browser that would be
 * compromised.
 *
 * A six-digit PIN is not a strong key, which is why the derivation is
 * deliberately expensive. At 310,000 PBKDF2 iterations a brute force of the
 * whole six-digit space costs hours of continuous work on the device itself
 * rather than seconds, and the queue is meant to be emptied daily.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256, and roughly 100ms on a mid-range phone. */
const PBKDF2_ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBlob {
  /** Fresh per record. Reusing an IV under one key breaks AES-GCM outright. */
  iv: number[];
  ciphertext: number[];
}

export function isCryptoAvailable(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  );
}

export function newSalt(): number[] {
  return Array.from(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/**
 * Turns a PIN into an AES key.
 *
 * The salt is stored in the clear next to the data, which is fine and normal:
 * its job is to stop one precomputed table working against every device, not
 * to be a secret.
 */
export async function deriveKey(pin: string, salt: number[]): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) };
}

/**
 * Returns null when the key is wrong.
 *
 * AES-GCM authenticates, so a wrong PIN fails to decrypt rather than producing
 * plausible rubbish — which is what makes a PIN check possible at all without
 * storing anything derived from the PIN itself.
 */
export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(blob.iv) },
      key,
      new Uint8Array(blob.ciphertext)
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

/**
 * A known value encrypted under the key, used to check a PIN before anything
 * is decrypted with it.
 *
 * Without this the only way to test a PIN is to try decrypting a real record,
 * which means an empty queue cannot be unlocked at all — and an ICR arriving at
 * a venue with nothing captured yet is exactly when they first need in.
 */
export const PIN_CHECK_VALUE = "illume-offline-pin-check";

export async function makePinCheck(key: CryptoKey): Promise<EncryptedBlob> {
  return encryptJson(key, PIN_CHECK_VALUE);
}

export async function verifyPinCheck(key: CryptoKey, check: EncryptedBlob): Promise<boolean> {
  return (await decryptJson<string>(key, check)) === PIN_CHECK_VALUE;
}

/**
 * The on-device queue of leads captured with no connection.
 *
 * Browser-only — import this from client components alone.
 *
 * IndexedDB rather than localStorage: localStorage is synchronous, caps out
 * around 5MB, and stores strings only. More importantly it is cleared by
 * "clear site data" in ways users trigger by accident, and a hundred students'
 * details are not something to keep in a store that casual.
 *
 * Written against the raw API rather than pulling in a wrapper library. The
 * surface used here is one object store with get, put, delete and getAll; a
 * dependency would be more supply-chain risk than saved code.
 */

import { OFFLINE_CAPTURE_LIMIT } from "@/lib/offline-capture";
import {
  decryptJson,
  deriveKey,
  encryptJson,
  makePinCheck,
  newSalt,
  verifyPinCheck,
  type EncryptedBlob,
} from "@/lib/offline-crypto";

const DB_NAME = "illume-offline";
// Bumped from 1: records now hold an encrypted `payload` rather than a plain
// `data` object. There is no migration path for anything captured under v1 —
// see clearLegacyPlaintext below.
const DB_VERSION = 2;
const CAPTURES = "captures";
const REFERENCE = "reference";
const VAULT = "vault";

/** One lead as it sits on the device, before it has been accepted by the server. */
export interface QueuedCapture {
  /** Idempotency key. Generated once, at capture, and never regenerated. */
  captureId: string;
  capturedAt: string;
  /**
   * Who was signed in when this was written down.
   *
   * Sessions expire after 48 hours and an event can outlast that, so the person
   * uploading is not guaranteed to be the person who captured. Recording it
   * lets the UI warn rather than silently filing another ICR's work under
   * whoever happened to log in.
   */
  capturedByUserId: string | null;
  /** "pending" has never been sent; "failed" was rejected and needs correcting. */
  status: "pending" | "failed";
  lastError?: string;
  /** The lead itself, shaped for /api/leads/offline-sync. Decrypted in memory. */
  data: Record<string, unknown>;
}

/** What actually sits in IndexedDB: everything identifying is inside `payload`. */
interface StoredCapture {
  captureId: string;
  capturedAt: string;
  capturedByUserId: string | null;
  status: "pending" | "failed";
  lastError?: string;
  /**
   * The lead, encrypted.
   *
   * captureId, timestamps and status stay in the clear deliberately — they are
   * needed to count, sort and reconcile the queue without a key, and none of
   * them says anything about a student.
   */
  payload: EncryptedBlob;
}

export interface OfflineReference {
  generatedAt: string;
  sources: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  icrUsers: { id: string; name: string | null }[];
  events: { id: string; name: string; date: string; city: string; country: string }[];
  regions: { id: string; name: string }[];
}

/** Thrown when the device is already holding a full session's worth. */
export class QueueFullError extends Error {
  constructor() {
    super(
      `This device is holding ${OFFLINE_CAPTURE_LIMIT} leads, which is the maximum. ` +
        `Upload them before capturing more.`
    );
    this.name = "QueueFullError";
  }
}

export function isOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isOfflineStorageAvailable()) {
      reject(new Error("This browser cannot store leads offline."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CAPTURES)) {
        db.createObjectStore(CAPTURES, { keyPath: "captureId" });
      }
      if (!db.objectStoreNames.contains(REFERENCE)) {
        db.createObjectStore(REFERENCE);
      }
      if (!db.objectStoreNames.contains(VAULT)) {
        db.createObjectStore(VAULT);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open offline storage"));
  });
}

/**
 * Resolves only once the transaction itself completes, not when the request
 * does. A request can succeed inside a transaction that then fails to commit,
 * and treating that as saved is how a lead gets reported captured and is not.
 */
function commit<T>(tx: IDBTransaction, result: T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("Offline storage write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("Offline storage write aborted"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Offline storage read failed"));
  });
}

// ─── PIN and vault ───────────────────────────────────────────────────────────

interface VaultMeta {
  salt: number[];
  check: EncryptedBlob;
  createdAt: string;
}

/** True once a PIN has been chosen on this device. */
export async function hasPin(): Promise<boolean> {
  const db = await openDb();
  try {
    const tx = db.transaction(VAULT, "readonly");
    return (await request<VaultMeta | undefined>(tx.objectStore(VAULT).get("meta"))) != null;
  } finally {
    db.close();
  }
}

/** Chooses the PIN for this device. Refuses to overwrite an existing one. */
export async function setPin(pin: string): Promise<CryptoKey> {
  if (await hasPin()) {
    throw new Error("A PIN is already set on this device.");
  }
  const salt = newSalt();
  const key = await deriveKey(pin, salt);
  const meta: VaultMeta = { salt, check: await makePinCheck(key), createdAt: new Date().toISOString() };
  const db = await openDb();
  try {
    const tx = db.transaction(VAULT, "readwrite");
    tx.objectStore(VAULT).put(meta, "meta");
    await commit(tx, undefined);
    return key;
  } finally {
    db.close();
  }
}

/**
 * Returns the key for a correct PIN, or null for a wrong one.
 *
 * Checked against a stored known value rather than a real record, so an empty
 * queue can still be unlocked — which is the state an ICR is in when they first
 * arrive at a venue.
 */
export async function unlock(pin: string): Promise<CryptoKey | null> {
  const db = await openDb();
  let meta: VaultMeta | undefined;
  try {
    const tx = db.transaction(VAULT, "readonly");
    meta = await request<VaultMeta | undefined>(tx.objectStore(VAULT).get("meta"));
  } finally {
    db.close();
  }
  if (!meta) return null;
  const key = await deriveKey(pin, meta.salt);
  return (await verifyPinCheck(key, meta.check)) ? key : null;
}

/**
 * Forgets the PIN and everything encrypted under it.
 *
 * Unavoidably destructive: the key exists only in the PIN, so held leads cannot
 * be recovered without it. Offered anyway, because the alternative is a device
 * that is permanently unusable for capture.
 */
export async function resetVault(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([VAULT, CAPTURES], "readwrite");
    tx.objectStore(VAULT).clear();
    tx.objectStore(CAPTURES).clear();
    await commit(tx, undefined);
  } finally {
    db.close();
  }
}

/**
 * Discards anything written before encryption existed.
 *
 * v1 records held the lead in a plain `data` field. They cannot be encrypted
 * retroactively without a key that did not exist when they were written, and
 * leaving readable copies alongside encrypted ones would make the encryption
 * decorative. Callers should warn before this runs.
 */
export async function clearLegacyPlaintext(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const all = await request<Array<StoredCapture & { data?: unknown }>>(store.getAll());
    const legacy = all.filter((r) => r.payload === undefined);
    for (const r of legacy) store.delete(r.captureId);
    await commit(tx, undefined);
    return legacy.length;
  } finally {
    db.close();
  }
}

export async function countLegacyPlaintext(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readonly");
    const all = await request<Array<StoredCapture & { data?: unknown }>>(tx.objectStore(CAPTURES).getAll());
    return all.filter((r) => r.payload === undefined).length;
  } finally {
    db.close();
  }
}

// ─── Captures ────────────────────────────────────────────────────────────────

export async function listCaptures(key: CryptoKey): Promise<QueuedCapture[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readonly");
    const all = await request<StoredCapture[]>(tx.objectStore(CAPTURES).getAll());
    const out: QueuedCapture[] = [];
    for (const r of all) {
      if (!r.payload) continue; // pre-encryption leftover; clearLegacyPlaintext handles it
      const data = await decryptJson<Record<string, unknown>>(key, r.payload);
      // A record that will not decrypt is listed rather than hidden, so the
      // count still matches what is really on the device and nothing looks
      // silently lost.
      out.push({
        captureId: r.captureId,
        capturedAt: r.capturedAt,
        capturedByUserId: r.capturedByUserId,
        status: data ? r.status : "failed",
        lastError: data ? r.lastError : "Could not be decrypted on this device.",
        data: data ?? {},
      });
    }
    return out.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  } finally {
    db.close();
  }
}

export async function countCaptures(): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readonly");
    return await request<number>(tx.objectStore(CAPTURES).count());
  } finally {
    db.close();
  }
}

/**
 * Writes one captured lead to the device.
 *
 * The count is checked inside the same transaction as the write. Checking first
 * and writing after leaves a gap in which two quick submissions both pass a
 * check at 99 and land at 101.
 */
export async function addCapture(
  key: CryptoKey,
  data: Record<string, unknown>,
  capturedByUserId: string | null
): Promise<QueuedCapture> {
  // Encrypted before the transaction opens: IndexedDB transactions auto-close
  // once the event loop yields, and awaiting WebCrypto inside one kills it.
  const payload = await encryptJson(key, data);
  const record: StoredCapture = {
    captureId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    capturedByUserId,
    status: "pending",
    payload,
  };

  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const existing = await request<number>(store.count());
    if (existing >= OFFLINE_CAPTURE_LIMIT) {
      tx.abort();
      throw new QueueFullError();
    }
    store.put(record);
    await commit(tx, undefined);
    return { ...record, data } as QueuedCapture;
  } finally {
    db.close();
  }
}

/**
 * Removes only what the server confirmed it holds.
 *
 * Never call this optimistically. Everything the device deletes without a
 * confirmation is gone for good — there is no second copy anywhere.
 */
export async function removeCaptures(captureIds: string[]): Promise<void> {
  if (captureIds.length === 0) return;
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    for (const id of captureIds) store.delete(id);
    await commit(tx, undefined);
  } finally {
    db.close();
  }
}

/** Keeps a rejected lead on the device with the reason, so it can be corrected. */
export async function markFailed(captureId: string, error: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const existing = await request<StoredCapture | undefined>(store.get(captureId));
    if (existing) {
      store.put({ ...existing, status: "failed", lastError: error });
    }
    await commit(tx, undefined);
  } finally {
    db.close();
  }
}

/** Replaces a queued lead's data after the ICR has corrected it. */
export async function updateCapture(
  key: CryptoKey,
  captureId: string,
  data: Record<string, unknown>
): Promise<void> {
  const payload = await encryptJson(key, data);
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const existing = await request<StoredCapture | undefined>(store.get(captureId));
    if (existing) {
      // captureId is deliberately preserved: a corrected lead is the same lead,
      // and a fresh key would let the original upload and the retry both land.
      store.put({ ...existing, payload, status: "pending", lastError: undefined });
    }
    await commit(tx, undefined);
  } finally {
    db.close();
  }
}

export async function saveReference(reference: OfflineReference): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(REFERENCE, "readwrite");
    tx.objectStore(REFERENCE).put(reference, "current");
    await commit(tx, undefined);
  } finally {
    db.close();
  }
}

export async function loadReference(): Promise<OfflineReference | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(REFERENCE, "readonly");
    const ref = await request<OfflineReference | undefined>(
      tx.objectStore(REFERENCE).get("current")
    );
    return ref ?? null;
  } finally {
    db.close();
  }
}

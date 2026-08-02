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

const DB_NAME = "illume-offline";
/**
 * 3, not 1, even though the format matches v1 again.
 *
 * A PIN-encrypted variant shipped briefly as v2. IndexedDB cannot open a
 * database at a lower version than the one already on the device — it throws
 * VersionError — so going back to 1 would leave anyone who opened v2 unable to
 * use offline capture at all. Moving forward past it is the only way back.
 */
const DB_VERSION = 3;
const CAPTURES = "captures";
const REFERENCE = "reference";
const LEGACY_VAULT = "vault";

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
  /** The lead itself, shaped for /api/leads/offline-sync. */
  data: Record<string, unknown>;
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
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CAPTURES)) {
        db.createObjectStore(CAPTURES, { keyPath: "captureId" });
      }
      if (!db.objectStoreNames.contains(REFERENCE)) {
        db.createObjectStore(REFERENCE);
      }

      // Coming from the short-lived encrypted version: the key was derived from
      // a PIN that no longer exists anywhere, so those records can never be read
      // again. Clearing them is the only honest option — leaving them would show
      // an ICR a queue count for leads nothing can decrypt.
      if (event.oldVersion === 2) {
        if (db.objectStoreNames.contains(LEGACY_VAULT)) db.deleteObjectStore(LEGACY_VAULT);
        req.transaction?.objectStore(CAPTURES).clear();
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

export async function listCaptures(): Promise<QueuedCapture[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readonly");
    const all = await request<QueuedCapture[]>(tx.objectStore(CAPTURES).getAll());
    return all.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
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
  data: Record<string, unknown>,
  capturedByUserId: string | null
): Promise<QueuedCapture> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const existing = await request<number>(store.count());
    if (existing >= OFFLINE_CAPTURE_LIMIT) {
      tx.abort();
      throw new QueueFullError();
    }
    const record: QueuedCapture = {
      captureId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      capturedByUserId,
      status: "pending",
      data,
    };
    store.put(record);
    return await commit(tx, record);
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
    const existing = await request<QueuedCapture | undefined>(store.get(captureId));
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
  captureId: string,
  data: Record<string, unknown>
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(CAPTURES, "readwrite");
    const store = tx.objectStore(CAPTURES);
    const existing = await request<QueuedCapture | undefined>(store.get(captureId));
    if (existing) {
      // captureId is deliberately preserved: a corrected lead is the same lead,
      // and a fresh key would let the original upload and the retry both land.
      store.put({ ...existing, data, status: "pending", lastError: undefined });
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

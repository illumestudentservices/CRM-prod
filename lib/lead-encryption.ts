import { Prisma } from "@prisma/client";
import { encryptField, decryptField, blindIndex, isEncrypted } from "@/lib/field-crypto";

/**
 * Transparent at-rest encryption for the sensitive Lead fields.
 *
 * A Prisma client extension on the `lead` model: it encrypts the managed fields
 * on the way into the database and decrypts them on the way out, so the rest of
 * the application keeps reading and writing plain strings and never has to know.
 *
 * ★ WHAT IS MANAGED.
 *
 *   passportNumber     — encrypted, PLUS a one-way blind index
 *                        (passportNumberHash) kept in step with it so the
 *                        duplicate-matching lookup still works without
 *                        decrypting. The value itself stays exactly as entered.
 *   visaRefusalReason  — encrypted. Never used in a filter, so no index.
 *
 * ★ WHY THIS IS SAFE TO DO MODEL-WIDE.
 *
 * Every write to these fields goes through db.lead.{create,update,upsert,...}
 * (there is no nested `lead: { create }` anywhere), and every read of them is a
 * direct db.lead query (no other model includes them in a nested select), so a
 * lead-scoped extension sees the entire surface. The find-matches route is the
 * one place that queries by passport, and it queries the blind index directly.
 *
 * ★ TOLERANT BY DESIGN.
 *
 * decryptField passes plaintext through untouched, and encryptField refuses to
 * double-encrypt, so the app behaves correctly before, during, and after the
 * backfill — a row that has not been migrated yet still reads correctly.
 */

const ENCRYPTED_FIELDS = ["passportNumber", "visaRefusalReason"] as const;

/** Read a write value whether it is a bare scalar or Prisma's `{ set: x }`. */
function unwrap(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v) && "set" in (v as Record<string, unknown>)) {
    return (v as Record<string, unknown>).set;
  }
  return v;
}

/** Write a value back in the same shape (bare scalar or `{ set: x }`) it arrived in. */
function rewrap(original: unknown, next: unknown): unknown {
  if (original && typeof original === "object" && !Array.isArray(original) && "set" in (original as Record<string, unknown>)) {
    return { ...(original as Record<string, unknown>), set: next };
  }
  return next;
}

/** Encrypt the managed fields on a create/update data object, in place. */
function applyWrite(data: Record<string, unknown> | undefined | null): void {
  if (!data || typeof data !== "object") return;

  // passportNumber + its blind index, kept in lock-step.
  if ("passportNumber" in data) {
    const raw = unwrap(data.passportNumber);
    if (raw === null || raw === undefined || raw === "") {
      // Cleared (or explicitly set null): clear the index too. Leave `undefined`
      // alone (that means "not being written"), but an explicit null clears both.
      if (raw === null || raw === "") {
        data.passportNumberHash = null;
      }
    } else if (typeof raw === "string") {
      // Index comes from the PLAINTEXT, so compute it before encrypting. If the
      // value is already an envelope (e.g. a round-tripped re-save), leave the
      // index untouched rather than hashing ciphertext.
      if (!isEncrypted(raw)) {
        data.passportNumberHash = blindIndex(raw);
        data.passportNumber = rewrap(data.passportNumber, encryptField(raw));
      }
    }
  }

  if ("visaRefusalReason" in data) {
    const raw = unwrap(data.visaRefusalReason);
    if (typeof raw === "string" && raw !== "" && !isEncrypted(raw)) {
      data.visaRefusalReason = rewrap(data.visaRefusalReason, encryptField(raw));
    }
  }
}

/** Decrypt the managed fields on one returned lead object, in place. */
function decryptLead<T>(obj: T): T {
  if (!obj || typeof obj !== "object") return obj;
  const row = obj as Record<string, unknown>;
  for (const f of ENCRYPTED_FIELDS) {
    const v = row[f];
    if (typeof v === "string" && isEncrypted(v)) {
      row[f] = decryptField(v);
    }
  }
  // The blind index is an internal lookup key, never part of the data a caller
  // asked for — strip it from any result that selected the whole row.
  if ("passportNumberHash" in row) delete row.passportNumberHash;
  return obj;
}

function decryptResult<T>(res: T): T {
  if (Array.isArray(res)) {
    for (const item of res) decryptLead(item);
    return res;
  }
  return decryptLead(res);
}

const WRITE_WITH_DATA = new Set([
  "create",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "createManyAndReturn",
]);
const RETURNS_LEAD = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "create",
  "update",
  "upsert",
  "createManyAndReturn",
  "updateManyAndReturn",
]);

export const leadEncryptionExtension = Prisma.defineExtension({
  name: "lead-field-encryption",
  query: {
    lead: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async $allOperations({ operation, args, query }: any) {
        // ── Encrypt inputs ────────────────────────────────────────────────
        if (operation === "upsert") {
          applyWrite(args.create);
          applyWrite(args.update);
        } else if (operation === "createMany") {
          const d = args.data;
          if (Array.isArray(d)) d.forEach(applyWrite);
          else applyWrite(d);
        } else if (WRITE_WITH_DATA.has(operation)) {
          const d = args.data;
          if (Array.isArray(d)) d.forEach(applyWrite);
          else applyWrite(d);
        }

        const result = await query(args);

        // ── Decrypt outputs ───────────────────────────────────────────────
        if (RETURNS_LEAD.has(operation)) return decryptResult(result);
        return result;
      },
    },
  },
});

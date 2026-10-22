import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { leadEncryptionExtension } from "@/lib/lead-encryption";

function createPrismaClient() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaPg(pool as any);
  const base = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  // Transparent at-rest encryption for sensitive Lead fields. Applied here so
  // every caller — routes, scripts, transactions — goes through it uniformly.
  return base.$extends(leadEncryptionExtension);
}

type ExtendedPrismaClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedPrismaClient | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * The client shape available inside `db.$transaction(async (tx) => …)` — the
 * extended client without the connection-level methods. Helpers that run either
 * standalone or inside a transaction type their client parameter as this, so
 * both `db` and a transaction's `tx` are accepted now that the client carries
 * the field-encryption extension.
 */
export type PrismaTransaction = Omit<
  typeof db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

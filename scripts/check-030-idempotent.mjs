/**
 * Is migration 030 safe to run twice?
 *
 * Deploy paths re-run migrations more often than anyone intends. A migration
 * that only works on a virgin database is a migration that fails the second
 * time someone runs the deploy script — on production, mid-deploy. Checked on
 * the mirror, never on prod.
 */
import fs from "node:fs/promises";
import { db } from "./qa-lib.mjs";

const [{ current_database: dbName }] = await db.$queryRawUnsafe("SELECT current_database()");
if (dbName === "illume_crm") {
  console.error("REFUSING: this points at production. Mirror only.");
  process.exit(1);
}
console.log("database:", dbName);

const sql = await fs.readFile("prisma/manual/030-forecasting.sql", "utf8");

try {
  await db.$executeRawUnsafe(sql);
  console.log("RERUN: ok — migration 030 is idempotent");
} catch (e) {
  const msg = String(e.message).split("\n")
    .filter((l) => /error|exception|already exists/i.test(l))
    .slice(0, 3).join(" | ");
  console.log("RERUN FAILED:", msg.slice(0, 400));
}

const cols = await db.$queryRawUnsafe(
  `SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_name = 'forecast_segments' AND column_name LIKE 'rm%' ORDER BY column_name`
);
console.log("nullable guard:", cols.map((c) => `${c.column_name}=${c.is_nullable}`).join(" "));

const t = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.tables
   WHERE table_name IN ('forecasts','forecast_segments','forecast_events')`
);
console.log("tables present:", t[0].n, "of 3");

await db.$disconnect();

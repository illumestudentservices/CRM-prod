/**
 * Proves migration 030 still works on a database that has never seen it —
 * which is the path production will take. Adding the re-run guards changed
 * every CREATE and every ADD CONSTRAINT, so the from-scratch path needs
 * re-proving, not assuming.
 *
 * Destructive: drops the forecasting tables. Mirror only, and it refuses to
 * run if any forecast rows exist.
 */
import fs from "node:fs/promises";
import { db } from "./qa-lib.mjs";

const [{ current_database: dbName }] = await db.$queryRawUnsafe("SELECT current_database()");
if (dbName === "illume_crm") {
  console.error("REFUSING: this points at production.");
  process.exit(1);
}

const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM forecasts`);
if (n > 0) {
  console.error(`REFUSING: ${n} forecast rows present — not dropping data.`);
  process.exit(1);
}

console.log("database:", dbName, "| forecast rows:", n);

await db.$executeRawUnsafe(`
  DROP TABLE IF EXISTS forecast_events, forecast_segments, forecasts CASCADE;
  DROP TYPE IF EXISTS "ForecastSegmentKey", "ForecastStatus", "PipelineMaturity" CASCADE;
`);
console.log("dropped — simulating a database that has never run 030");

const sql = await fs.readFile("prisma/manual/030-forecasting.sql", "utf8");
try {
  await db.$executeRawUnsafe(sql);
  console.log("FRESH RUN: ok");
} catch (e) {
  console.log("FRESH RUN FAILED:", String(e.message).slice(0, 400));
  process.exit(1);
}

const tables = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.tables
   WHERE table_name IN ('forecasts','forecast_segments','forecast_events')`
);
const cols = await db.$queryRawUnsafe(
  `SELECT column_name, is_nullable FROM information_schema.columns
   WHERE table_name = 'forecast_segments' AND column_name LIKE 'rm%' ORDER BY column_name`
);
const fks = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.table_constraints
   WHERE constraint_type = 'FOREIGN KEY'
     AND table_name IN ('forecasts','forecast_segments','forecast_events')`
);
const idx = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM pg_indexes
   WHERE tablename IN ('forecasts','forecast_segments','forecast_events')`
);

console.log("tables:", tables[0].n, "of 3");
console.log("foreign keys:", fks[0].n, "of 9");
console.log("indexes:", idx[0].n, "(6 declared + 3 primary keys)");
console.log("nullable guard:", cols.map((c) => `${c.column_name}=${c.is_nullable}`).join(" "));

await db.$disconnect();

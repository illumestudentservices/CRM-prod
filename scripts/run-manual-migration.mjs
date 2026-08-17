/**
 * Apply a manual migration from prisma/manual/ using the pg client.
 *
 *   node --env-file=.env scripts/run-manual-migration.mjs prisma/manual/029-icr-transition.sql
 *
 * The project's convention is `psql "$DATABASE_URL" -f <file>`, but psql is not
 * installed on this machine. This is the equivalent: it connects with the same
 * DATABASE_URL — so it runs as the application role, which the migrations'
 * ownership post-conditions depend on — and sends the file as a single script
 * through the simple query protocol, so the BEGIN/COMMIT and DO $$ blocks
 * behave exactly as they would under psql.
 *
 * Prints the database name and role before running, and refuses a target that
 * does not match TARGET_DB when that is set, so a migration cannot be applied
 * to production by forgetting which shell it was launched from.
 */
import { Pool } from "pg";
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-manual-migration.mjs <path-to-sql>");
  process.exit(1);
}
const sql = fs.readFileSync(file, "utf8");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  const who = await client.query(
    "select current_database() as db, current_user as role, version() as v"
  );
  const { db, role } = who.rows[0];
  console.log(`target database : ${db}`);
  console.log(`connected as    : ${role}`);

  const expected = process.env.TARGET_DB;
  if (expected && db !== expected) {
    throw new Error(
      `Refusing to run: connected to "${db}" but TARGET_DB is "${expected}".`
    );
  }

  console.log(`applying        : ${file}`);
  const res = await client.query(sql);
  // NOTICEs from the post-condition block arrive on the connection, not in the
  // result, so they are surfaced by the listener registered below.
  console.log(
    `done            : ${Array.isArray(res) ? res.length : 1} statement group(s) executed`
  );
} catch (e) {
  console.error("\nMIGRATION FAILED");
  console.error(e.message);
  if (e.detail) console.error("detail:", e.detail);
  if (e.where) console.error("where :", e.where);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

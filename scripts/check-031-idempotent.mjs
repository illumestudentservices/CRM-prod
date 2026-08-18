/**
 * Is migration 031 safe to run twice, and does it work on a database that has
 * never seen it?
 *
 * Both matter and they are different questions. The guards that make a
 * migration re-runnable rewrite every CREATE in it, so proving the re-run works
 * says nothing about the path production actually takes. This checks the fresh
 * install first — dropping the tables so the run is genuinely from scratch —
 * then runs it a second time on top of itself.
 *
 * Mirror only. Refuses production twice: by database name, and by refusing to
 * drop anything that holds rows.
 */
import fs from "node:fs/promises";
import { db } from "./qa-lib.mjs";

const [{ current_database: dbName }] = await db.$queryRawUnsafe("SELECT current_database()");
if (dbName === "illume_crm") {
  console.error("REFUSING: this points at production. Mirror only.");
  process.exit(1);
}
console.log("database:", dbName);

const sql = await fs.readFile("prisma/manual/031-icr-monthly-report.sql", "utf8");

// ── Fresh install ──────────────────────────────────────────────────────────
// The enum value is deliberately NOT dropped: PostgreSQL cannot remove one, and
// ADD VALUE IF NOT EXISTS is idempotent, so leaving it is both necessary and
// harmless.
const [{ n: existingRows }] = await db.$queryRawUnsafe(
  `SELECT COALESCE((SELECT count(*) FROM icr_monthly_reports), 0)::int AS n
     WHERE EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_name = 'icr_monthly_reports')
   UNION ALL SELECT 0 LIMIT 1`
).catch(() => [{ n: 0 }]);
if (existingRows > 0) {
  console.error(`REFUSING: icr_monthly_reports holds ${existingRows} rows. Not dropping data.`);
  process.exit(1);
}

await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "icr_report_approvals" CASCADE`);
await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "icr_monthly_reports" CASCADE`);
console.log("dropped — running 031 against a database that has never seen it");

try {
  await db.$executeRawUnsafe(sql);
  console.log("FRESH: ok");
} catch (e) {
  console.log("FRESH FAILED:", String(e.message).slice(0, 400));
  process.exit(1);
}

// ── Re-run ─────────────────────────────────────────────────────────────────
try {
  await db.$executeRawUnsafe(sql);
  console.log("RERUN: ok — migration 031 is idempotent");
} catch (e) {
  const msg = String(e.message).split("\n")
    .filter((l) => /error|exception|already exists/i.test(l))
    .slice(0, 3).join(" | ");
  console.log("RERUN FAILED:", msg.slice(0, 400));
  process.exit(1);
}

// ── Post-state ─────────────────────────────────────────────────────────────
const tables = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('icr_monthly_reports','icr_report_approvals')`
);
const fks = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.table_constraints
    WHERE constraint_type='FOREIGN KEY' AND table_name IN ('icr_monthly_reports','icr_report_approvals')`
);
// The primary key is itself a unique index, so it is excluded — what is being
// checked is the one-report-per-rep-per-month key specifically.
const uniq = await db.$queryRawUnsafe(
  `SELECT indexname FROM pg_indexes
    WHERE tablename='icr_monthly_reports'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexname <> 'icr_monthly_reports_pkey'`
);
const enumVal = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='AttachmentParentType' AND e.enumlabel='ICR_MONTHLY_REPORT'`
);
const untouched = await db.$queryRawUnsafe(
  `SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema='public' AND table_name='monthly_reports'`
);

console.log("tables:", tables[0].n, "of 2");
console.log("foreign keys:", fks[0].n, "of 4");
console.log("unique index:", uniq.map((r) => r.indexname).join(", ") || "MISSING");
console.log("attachment enum value present:", enumVal[0].n === 1);
console.log("monthly_reports still present:", untouched[0].n === 1);

const ok =
  tables[0].n === 2 && fks[0].n === 4 && uniq.length === 1 &&
  enumVal[0].n === 1 && untouched[0].n === 1;
console.log(ok ? "\n031 CHECK: PASS" : "\n031 CHECK: FAIL");

await db.$disconnect();
process.exit(ok ? 0 : 1);

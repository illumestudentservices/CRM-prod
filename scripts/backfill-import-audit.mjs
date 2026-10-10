/**
 * Write the audit entries the bulk import should have written as it went.
 *
 *   node --import tsx scripts/backfill-import-audit.mjs <actor-email> [--commit]
 *
 * Creating a login is the security-relevant half of hiring, and
 * /api/hr/employees records every one of them in the audit log. The bulk
 * importer did not, so eighty-three accounts appeared on production with no
 * trace of who added them or when — exactly the question an audit log exists
 * to answer, and the one it would have failed.
 *
 * The timestamps are real: these rows are written minutes after the accounts,
 * and `createdAt` is left to default to now rather than being back-dated to
 * look as though the entry had been there all along. `changes.backfilled`
 * records that the entry came from here and not from the route, so nobody
 * later reads it as a live trail.
 *
 * Idempotent: a second run writes nothing.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");

const [, , actorEmail, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!actorEmail) {
  console.error("usage: backfill-import-audit.mjs <actor-email> [--commit]");
  process.exit(2);
}

const actor = await db.user.findFirst({
  where: { email: actorEmail.toLowerCase(), deletedAt: null },
  select: { id: true, email: true, role: true },
});
if (!actor) {
  console.error(`no active user for ${actorEmail}`);
  process.exit(1);
}
console.log(`actor: ${actor.email} (${actor.role})`);

// The import created ILL-0025 upward; everything below that predates it.
const imported = await db.employee.findMany({
  select: { id: true, employeeId: true, userId: true, jobTitle: true, createdAt: true },
  orderBy: { employeeId: "asc" },
});
const fresh = imported.filter((e) => {
  const n = parseInt(String(e.employeeId).replace(/^[A-Z]+-/, ""), 10);
  return Number.isFinite(n) && n >= 25;
});
console.log(`${fresh.length} imported employee record(s)`);

const already = await db.auditLog.findMany({
  where: { entity: "Employee", entityId: { in: fresh.map((e) => e.id) } },
  select: { entityId: true },
});
const have = new Set(already.map((a) => a.entityId));
const missing = fresh.filter((e) => !have.has(e.id));
console.log(`${missing.length} without an audit entry`);

if (!COMMIT) {
  console.log("\ndry run — nothing written. Re-run with --commit.");
  await db.$disconnect();
  process.exit(0);
}

const res = await db.auditLog.createMany({
  data: missing.map((e) => ({
    userId: actor.id,
    action: "CREATE",
    entity: "Employee",
    entityId: e.id,
    changes: {
      route: "scripts/import-employees.mjs",
      employeeId: e.employeeId,
      createdUserId: e.userId,
      jobTitle: e.jobTitle,
      source: "Zoho People export — Employee View.xlsx",
      welcomeEmailSent: false,
      backfilled: true,
    },
  })),
});
console.log(`\nwrote ${res.count} audit entr${res.count === 1 ? "y" : "ies"}`);
await db.$disconnect();

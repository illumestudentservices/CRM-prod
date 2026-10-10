/**
 * Turn the asset register's custodian NAMES into real assignments.
 *
 *   node --import tsx scripts/assign-assets-to-employees.mjs <matches.json> [--commit]
 *
 * Dry run by default. Idempotent: an asset already out with that employee and
 * not yet returned is left alone.
 *
 * When the register was imported the CRM had sixteen employees and the
 * register named fifty-two, so who holds a device was stored as free text on
 * ITAsset.custodianName. The schema says what should happen next, and this is
 * it: "As accounts are created AssetAssignment takes over — it is the stronger
 * record, being a foreign key with a date range."
 *
 * ★ custodianName IS NOT CLEARED.
 *
 * It stays as written. Four names still match nobody, so the column is still
 * carrying the only answer for those devices — and even where an assignment
 * now exists, the original string is what the register actually said. An
 * assignment is the live fact; the name is the provenance. Overwriting it
 * would destroy the evidence for a match somebody may later want to question.
 *
 * ★ assignedAt IS NOT TODAY.
 *
 * Nobody picked these devices up this morning. A date of today would say that,
 * and "assigned 10 Oct 2026" on a laptop someone has had for two years is a
 * fabricated fact in the record an organisation reaches for when a device goes
 * missing. The asset's own createdAt — when the register entry was made — is
 * the earliest moment the custody is actually evidenced, so that is used, and
 * the note says where the assignment came from.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const { db } = await import("@/lib/db");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!file) {
  console.error("usage: assign-assets-to-employees.mjs <matches.json> [--commit]");
  process.exit(2);
}

const matches = JSON.parse(readFileSync(file, "utf8"));
console.log(`${matches.length} matched custodian name(s)`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null }, select: { id: true },
});

const byEmployeeId = new Map();
for (const e of await db.employee.findMany({ select: { id: true, employeeId: true } })) {
  byEmployeeId.set(e.employeeId, e.id);
}

let created = 0, already = 0, missing = 0;
const perTier = {};

for (const m of matches) {
  const empRowId = byEmployeeId.get(m.employeeId);
  if (!empRowId) { console.log(`  ${m.employeeId}: no employee row`); missing++; continue; }

  const assets = await db.iTAsset.findMany({
    where: { custodianName: m.custodianName },
    select: { id: true, name: true, assetTag: true, createdAt: true },
  });

  for (const a of assets) {
    const open = await db.assetAssignment.findFirst({
      where: { assetId: a.id, employeeId: empRowId, returnedAt: null },
      select: { id: true },
    });
    if (open) { already++; continue; }

    if (!COMMIT) {
      perTier[m.tier] = (perTier[m.tier] ?? 0) + 1;
      created++;
      continue;
    }

    await db.assetAssignment.create({
      data: {
        assetId: a.id,
        employeeId: empRowId,
        // See the note at the top: the register entry's own date, not today.
        assignedAt: a.createdAt,
        notes: `From the IT asset register, where the holder was recorded as "${m.custodianName}" (matched: ${m.tier}).`,
      },
    });
    perTier[m.tier] = (perTier[m.tier] ?? 0) + 1;
    created++;
  }
}

if (COMMIT && actor) {
  await db.auditLog.create({
    data: {
      userId: actor.id, action: "CREATE", entity: "AssetAssignment", entityId: "bulk-match-2026-10-10",
      changes: {
        source: "ITAsset.custodianName matched to employee records",
        assignmentsCreated: created, byMatchTier: perTier,
        note: "custodianName left in place as provenance; assignedAt is the register entry's date, not the run date.",
      },
    },
  }).catch(() => {});
}

console.log("\n" + "=".repeat(58));
console.log(`  assignments ${COMMIT ? "created" : "that would be created"}: ${created}`);
for (const [t, n] of Object.entries(perTier)) console.log(`      ${t}: ${n}`);
console.log(`  already assigned: ${already}`);
console.log(`  employee missing: ${missing}`);

const total = await db.iTAsset.count();
const assigned = await db.iTAsset.count({
  where: { assignments: { some: { returnedAt: null } } },
});
console.log(`\n  ${assigned} of ${total} assets now have a named holder on record`);

const orphans = await db.iTAsset.findMany({
  where: { assignments: { none: { returnedAt: null } }, custodianName: { not: null } },
  select: { assetTag: true, name: true, custodianName: true },
  orderBy: { custodianName: "asc" },
});
if (orphans.length) {
  console.log(`\n  still unassigned, custodian named but not matched:`);
  for (const o of orphans) {
    console.log(`      ${(o.assetTag ?? "(no tag)").padEnd(10)} ${String(o.name).slice(0, 28).padEnd(30)} "${o.custodianName}"`);
  }
}
console.log("=".repeat(58));

await db.$disconnect();

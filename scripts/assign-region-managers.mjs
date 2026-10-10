/**
 * Give everyone in a region the region's manager, where they have none.
 *
 *   node --import tsx scripts/assign-region-managers.mjs [--commit]
 *
 * Dry run by default.
 *
 * An employee with no manager has no leave approver, and under the task rules
 * nobody can assign them work either — so a blank manager is a broken account
 * rather than a tidy one. This fills those blanks from the standing mapping
 * below.
 *
 * Two rules it will not break.
 *
 * It only fills BLANKS. Somebody already pointed at a different manager was
 * put there by a person who knew something this script does not, and quietly
 * re-pointing them would overwrite that decision — those are listed at the end
 * for a human to look at instead.
 *
 * And nobody is ever made their own manager. Jamshid is himself Middle East,
 * so his own rule would otherwise close a one-person loop around him: a
 * self-referencing manager breaks the leave-approval chain, because the
 * approver the system looks for is the person asking.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");

// Latin America and the Middle East were set on 2026-10-10. The rest were
// already in use. Keep in step with REGION_MANAGER in build-additions.py and
// convert-employee-export.py.
const REGION_MANAGER = {
  "South Asia": "ILL-0014",
  "Africa": "ILL-0019",
  "China": "ILL-0021",
  "Southeast Asia": "ILL-0018",
  "Latin America": "ILL-0021",
  "Middle East": "ILL-0001",
};

const COMMIT = process.argv.includes("--commit");
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null },
  select: { id: true },
});

let assigned = 0;
const alreadyElsewhere = [];
const noRegionManager = [];

for (const [regionName, managerCode] of Object.entries(REGION_MANAGER)) {
  const manager = await db.employee.findFirst({
    where: { employeeId: managerCode },
    select: { id: true, employeeId: true, user: { select: { name: true } } },
  });
  if (!manager) {
    console.log(`  ${regionName}: manager ${managerCode} not found — skipped`);
    continue;
  }

  const staff = await db.employee.findMany({
    where: { user: { deletedAt: null, region: { name: regionName } } },
    select: {
      id: true, employeeId: true, managerId: true,
      user: { select: { email: true } },
    },
    orderBy: { employeeId: "asc" },
  });

  for (const e of staff) {
    const mailbox = e.user.email.split("@")[0];
    if (e.id === manager.id) continue;             // never your own manager
    if (e.managerId === manager.id) continue;      // already correct
    if (e.managerId) {
      alreadyElsewhere.push({ regionName, employeeId: e.employeeId, mailbox });
      continue;
    }

    if (!COMMIT) {
      console.log(`  WOULD SET  ${e.employeeId} ${mailbox.padEnd(12)} ${regionName} -> ${managerCode}`);
      assigned++;
      continue;
    }

    await db.employee.update({ where: { id: e.id }, data: { managerId: manager.id } });
    if (actor) {
      await db.auditLog.create({
        data: {
          userId: actor.id,
          action: "UPDATE",
          entity: "Employee",
          entityId: e.id,
          changes: {
            field: "managerId",
            employeeId: e.employeeId,
            from: null,
            to: manager.id,
            reason: `Standing rule: ${regionName} reports to ${managerCode}.`,
          },
        },
      }).catch((err) => console.error("  audit failed:", err.message));
    }
    console.log(`  set  ${e.employeeId} ${mailbox.padEnd(12)} ${regionName} -> ${managerCode}`);
    assigned++;
  }
}

// Anyone left over, so the gap stays visible rather than looking closed.
const stillNone = await db.employee.findMany({
  where: { managerId: null, user: { deletedAt: null } },
  select: {
    employeeId: true,
    user: { select: { email: true, region: { select: { name: true } } } },
  },
  orderBy: { employeeId: "asc" },
});

console.log("\n" + "=".repeat(60));
console.log(`  managers ${COMMIT ? "assigned" : "that would be assigned"}: ${assigned}`);
if (alreadyElsewhere.length) {
  console.log(`\n  already pointed at a DIFFERENT manager — left alone:`);
  for (const a of alreadyElsewhere) {
    console.log(`    ${a.employeeId} ${a.mailbox} (${a.regionName})`);
  }
}
if (stillNone.length) {
  console.log(`\n  still without a manager: ${stillNone.length}`);
  for (const s of stillNone) {
    console.log(`    ${s.employeeId} ${s.user.email.split("@")[0].padEnd(22)} region=${s.user.region?.name ?? "(none)"}`);
  }
}
console.log("=".repeat(60));

await db.$disconnect();

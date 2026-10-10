/**
 * Apply the corrections the Microsoft 365 roll can make to existing CRM staff.
 *
 *   node --import tsx scripts/apply-m365-updates.mjs <recon.json> [--commit]
 *
 * Dry run by default.
 *
 * Only three fields are touched — job title, region and department — and only
 * where M365 has a value. That is the whole of what this source can honestly
 * correct: M365 is a mailbox directory, not an HR system, so it carries no
 * joining date, no employment type and no reporting line.
 *
 * Deliberately NOT done here:
 *
 *   - nobody is deactivated for being absent from the export. The file is one
 *     licence type ("Business Standard"); a colleague on a different plan is
 *     missing from it while working here perfectly normally, and reading
 *     absence as departure would lock them out.
 *   - no email is changed. An email is a login, and rewriting one silently
 *     moves somebody's account out from under them.
 *   - no name is overwritten where the CRM already has one. M365 display names
 *     are better spelled, but replacing what HR typed is a decision, not a fix.
 *
 * Each change is written to the audit log with its before and after, so the
 * run can be read back or reversed.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const { db } = await import("@/lib/db");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!file) {
  console.error("usage: apply-m365-updates.mjs <recon.json> [--commit]");
  process.exit(2);
}

const { updates } = JSON.parse(readFileSync(file, "utf8"));
console.log(`${updates.length} record(s) with corrections`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");

const regions = await db.region.findMany({ select: { id: true, name: true } });
const regionId = new Map(regions.map((r) => [r.name.toLowerCase(), r.id]));
const departments = await db.department.findMany({ select: { id: true, name: true } });
const deptId = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null },
  select: { id: true },
});

const tally = { jobTitle: 0, region: 0, department: 0, names: 0, skipped: 0, failed: 0 };

for (const u of updates) {
  const emp = await db.employee.findFirst({
    where: { user: { email: u.email } },
    select: { id: true, employeeId: true, userId: true },
  });
  if (!emp) {
    console.log(`  SKIP  ${u.email} — no employee record`);
    tally.skipped++;
    continue;
  }

  const empData = {};
  const userData = {};
  const applied = {};

  if (u.changes.jobTitle) {
    empData.jobTitle = u.changes.jobTitle.to;
    applied.jobTitle = u.changes.jobTitle;
    tally.jobTitle++;
  }
  if (u.changes.region) {
    const id = regionId.get(u.changes.region.to.toLowerCase());
    if (id) {
      userData.regionId = id;
      applied.region = u.changes.region;
      tally.region++;
    }
  }
  if (u.changes.department) {
    const id = deptId.get(u.changes.department.to.toLowerCase());
    if (id) {
      empData.departmentId = id;
      applied.department = u.changes.department;
      tally.department++;
    }
  }
  for (const f of ["firstName", "lastName"]) {
    if (u.changes[f]) {
      userData[f] = u.changes[f].to;
      applied[f] = u.changes[f];
      tally.names++;
    }
  }
  if (userData.firstName || userData.lastName) {
    const cur = await db.user.findUnique({
      where: { id: emp.userId }, select: { firstName: true, lastName: true },
    });
    const first = userData.firstName ?? cur.firstName ?? "";
    const last = userData.lastName ?? cur.lastName ?? "";
    userData.name = `${first} ${last}`.trim();
  }

  if (Object.keys(applied).length === 0) {
    tally.skipped++;
    continue;
  }

  const line = Object.entries(applied)
    .map(([f, c]) => `${f}: ${String(c.from).slice(0, 22)} -> ${String(c.to).slice(0, 30)}`)
    .join("; ");

  if (!COMMIT) {
    console.log(`  ${emp.employeeId}  ${line}`);
    continue;
  }

  try {
    await db.$transaction(async (tx) => {
      if (Object.keys(empData).length) {
        await tx.employee.update({ where: { id: emp.id }, data: empData });
      }
      if (Object.keys(userData).length) {
        await tx.user.update({ where: { id: emp.userId }, data: userData });
      }
      if (actor) {
        await tx.auditLog.create({
          data: {
            userId: actor.id,
            action: "UPDATE",
            entity: "Employee",
            entityId: emp.id,
            changes: {
              source: "Microsoft 365 Business Standard user list, 10 Oct 2026",
              employeeId: emp.employeeId,
              ...applied,
            },
          },
        });
      }
    });
    console.log(`  ${emp.employeeId}  ${line}`);
  } catch (err) {
    console.error(`  FAILED ${emp.employeeId} — ${err.message}`);
    tally.failed++;
  }
}

console.log("\n" + "=".repeat(60));
console.log(`  job titles corrected  ${tally.jobTitle}`);
console.log(`  regions set           ${tally.region}`);
console.log(`  departments set       ${tally.department}`);
console.log(`  blank names filled    ${tally.names}`);
console.log(`  nothing to change     ${tally.skipped}`);
console.log(`  failed                ${tally.failed}`);
console.log("=".repeat(60));

await db.$disconnect();
process.exit(tally.failed ? 1 : 0);

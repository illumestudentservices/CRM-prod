/**
 * Bulk-import staff from an HR export, WITHOUT sending anybody a welcome email.
 *
 *   node --import tsx scripts/import-employees.mjs <people.json> [--commit]
 *
 * Dry run by default. Nothing is written until --commit is passed, and the
 * dry run prints exactly what the real run will do.
 *
 * ★ WHY THIS EXISTS INSTEAD OF POSTING TO /api/hr/employees.
 *
 * That route is the right way to hire one person, and it is the wrong way to
 * load eighty-three: it fires createMagicLink + sendWelcomeEmail on every
 * create, which cannot be switched off from the request. Running it in bulk
 * would send eighty-three people a 72-hour link to set a password, weeks
 * before anyone is ready to onboard them — and those links would all expire
 * unused, so the real invitation later would be the second email they ignore.
 *
 * Everything else the route does is reproduced here deliberately, using the
 * same helpers rather than copies of them, so an imported account is
 * indistinguishable from one created through the screen:
 *
 *   - email normalised to lowercase, with the case-insensitive taken check
 *   - a random temp password, hashed at the same cost, recorded in history so
 *     it cannot later be chosen as the real one
 *   - mustChangePassword, and passwordChangedAt left NULL so the 90-day clock
 *     starts when the person picks their own password rather than today
 *   - employeeId allocated as ILL-#### from the current maximum
 *   - no leave balances: entitlement is derived from startDate by
 *     lib/leave-policy.ts, and a seeded row would both ignore the joining date
 *     and expire at year end
 *
 * The one deliberate difference is the email, and the magic link that goes
 * with it. Neither is created. When onboarding starts, the existing
 * "resend welcome email" path issues a fresh link per person.
 */
// Next.js loads .env itself; a standalone script does not, and without this
// DATABASE_URL is undefined and the pg adapter fails on an empty password
// with "SASL: client password must be a string".
import "dotenv/config";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";

const { db } = await import("@/lib/db");
const { normaliseEmail, emailIsTaken } = await import("@/lib/email-identity");
const { userNameFields } = await import("@/lib/person-name");
const { generateTempPassword } = await import("@/lib/password");
const { recordPasswordInHistory } = await import("@/lib/password-history");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!file) {
  console.error("usage: import-employees.mjs <people.json> [--commit]");
  process.exit(2);
}

const people = JSON.parse(readFileSync(file, "utf8"));
console.log(`${people.length} record(s) from ${file}`);
console.log(COMMIT ? "MODE: COMMIT — rows will be written\n" : "MODE: dry run — nothing will be written\n");

// ── Look-ups ────────────────────────────────────────────────────────────────
const regions = await db.region.findMany({ select: { id: true, name: true } });
const regionByName = new Map(regions.map((r) => [r.name.toLowerCase(), r.id]));

const departments = await db.department.findMany({ select: { id: true, name: true } });
const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));

/** Existing staff, for the manager links and the already-present check. */
const existing = await db.employee.findMany({
  where: { user: { deletedAt: null } },
  select: {
    id: true,
    employeeId: true,
    user: { select: { email: true, name: true, firstName: true, lastName: true } },
  },
});
const normName = (s) => (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const empByEmail = new Map(existing.map((e) => [e.user.email.toLowerCase(), e]));
const empByName = new Map();
for (const e of existing) {
  const full = e.user.name || `${e.user.firstName ?? ""} ${e.user.lastName ?? ""}`;
  if (normName(full)) empByName.set(normName(full), e);
}

const summary = {
  created: 0, skippedExisting: 0, failed: 0,
  withNamedManager: 0, withRegionManager: 0, withoutManager: 0,
};
const unresolvedManagers = new Map();
const noManager = [];

// Second pass fixes up managers who are themselves part of this import, so the
// order of the file cannot decide whether a link is made.
const deferredManagerLinks = [];

for (const p of people) {
  const email = normaliseEmail(p.email);

  if (empByEmail.has(email)) {
    summary.skippedExisting++;
    continue;
  }
  if (await emailIsTaken(email)) {
    console.log(`  SKIP  ${email} — already in use (soft-deleted or non-staff account)`);
    summary.skippedExisting++;
    continue;
  }

  // ── Manager ──────────────────────────────────────────────────────────────
  let managerId = null;
  let managerVia = "none";
  if (p.managerName) {
    const hit = empByName.get(normName(p.managerName));
    if (hit) {
      managerId = hit.id;
      managerVia = "named";
      summary.withNamedManager++;
    } else {
      unresolvedManagers.set(p.managerName, (unresolvedManagers.get(p.managerName) ?? 0) + 1);
    }
  }
  if (!managerId && p.regionManagerEmployeeId) {
    const hit = existing.find((e) => e.employeeId === p.regionManagerEmployeeId);
    if (hit) {
      managerId = hit.id;
      managerVia = "region";
      summary.withRegionManager++;
    }
  }
  if (!managerId) {
    summary.withoutManager++;
    noManager.push(`${p.firstName} ${p.lastName}`);
  }

  const regionId = p.regionName ? regionByName.get(p.regionName.toLowerCase()) ?? null : null;
  const departmentId = p.departmentName ? deptByName.get(p.departmentName.toLowerCase()) ?? null : null;

  if (!COMMIT) {
    console.log(
      `  WOULD CREATE  ${email.padEnd(42)} ${p.jobTitle.padEnd(24)} ` +
      `region=${(p.regionName ?? "-").padEnd(14)} manager=${managerVia}`
    );
    summary.created++;
    continue;
  }

  try {
    const hashed = await bcrypt.hash(generateTempPassword(), 12);
    const emp = await db.$transaction(async (tx) => {
      // The maximum, not the newest. The route reads the most recently created
      // row, which is correct only while ids rise with creation time; one
      // back-dated or re-created record and the next id collides with a
      // number already in use.
      const rows = await tx.employee.findMany({ select: { employeeId: true } });
      const maxNum = rows.reduce((m, r) => {
        const n = parseInt(String(r.employeeId).replace(/^[A-Z]+-/, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0);
      const employeeId = `ILL-${String(maxNum + 1).padStart(4, "0")}`;

      const user = await tx.user.create({
        data: {
          email,
          ...userNameFields({ firstName: p.firstName, lastName: p.lastName }),
          password: hashed,
          role: "EMPLOYEE",
          regionId,
          isActive: true,
          mustChangePassword: true,
          passwordChangedAt: null,
        },
      });
      await recordPasswordInHistory(user.id, hashed, tx);

      return tx.employee.create({
        data: {
          employeeId,
          userId: user.id,
          jobTitle: p.jobTitle,
          departmentId,
          employmentType: p.employmentType,
          managerId,
          startDate: new Date(p.startDate),
          phone: p.phone ?? null,
          address: p.address ?? null,
          gender: p.gender ?? null,
          isActive: true,
        },
        select: { id: true, employeeId: true },
      });
    });

    empByEmail.set(email, { id: emp.id, employeeId: emp.employeeId, user: { email } });
    empByName.set(normName(`${p.firstName} ${p.lastName}`), { id: emp.id, employeeId: emp.employeeId });
    existing.push({ id: emp.id, employeeId: emp.employeeId, user: { email } });
    if (!managerId && p.managerName) deferredManagerLinks.push({ empId: emp.id, managerName: p.managerName });

    summary.created++;
    console.log(`  created  ${emp.employeeId}  ${email}`);
  } catch (err) {
    summary.failed++;
    console.error(`  FAILED   ${email} — ${err.message}`);
  }
}

// ── Managers who were themselves created in this run ───────────────────────
if (COMMIT && deferredManagerLinks.length) {
  console.log(`\nresolving ${deferredManagerLinks.length} manager link(s) deferred to the second pass`);
  for (const d of deferredManagerLinks) {
    const hit = empByName.get(normName(d.managerName));
    if (!hit) continue;
    await db.employee.update({ where: { id: d.empId }, data: { managerId: hit.id } })
      .then(() => {
        summary.withNamedManager++;
        summary.withoutManager--;
        unresolvedManagers.delete(d.managerName);
      })
      .catch((e) => console.error(`  link failed: ${e.message}`));
  }
}

console.log("\n" + "=".repeat(62));
console.log(`  created            ${summary.created}`);
console.log(`  already present    ${summary.skippedExisting}`);
console.log(`  failed             ${summary.failed}`);
console.log(`  manager by name    ${summary.withNamedManager}`);
console.log(`  manager by region  ${summary.withRegionManager}`);
console.log(`  no manager         ${summary.withoutManager}`);
if (unresolvedManagers.size) {
  console.log("\n  managers named in the export that match nobody:");
  for (const [n, c] of unresolvedManagers) console.log(`    ${n} (${c} report${c === 1 ? "" : "s"})`);
}
console.log("\n  NO welcome emails were sent and no magic links were created.");
console.log("=".repeat(62));

await db.$disconnect();
process.exit(summary.failed ? 1 : 0);

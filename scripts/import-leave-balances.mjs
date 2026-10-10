/**
 * Load opening leave balances from the HR system's Leave Balance Report.
 *
 *   node --import tsx scripts/import-leave-balances.mjs <balances.json> [--commit]
 *
 * Dry run by default.
 *
 * ★ HOW A BALANCE IS STORED WHEN ENTITLEMENT IS NOT.
 *
 * This CRM derives entitlement from the joining date and never stores it —
 * leave_balances holds only what has been consumed, plus `adjustmentDays` for
 * exactly this case. So a stated balance is loaded by solving for the
 * adjustment:
 *
 *     available = entitlement + adjustment - used - pending
 *     adjustment = target - entitlement + used + pending
 *
 * which makes the screen show the figure HR reported, to the day, while
 * leaving the accrual maths alone. Any consumption already recorded is kept
 * rather than overwritten; the formula absorbs it.
 *
 * Rows are written against the CURRENT YEAR, which is what every reader
 * filters on, so these are 2026 opening balances and 1 January starts clean.
 *
 * ★ MATERNITY AND PATERNITY ARE NOT LOADED AT ALL.
 *
 * The first plan was to load whichever of the two the employee is eligible
 * for. Checking the figures against the gender on record killed that idea:
 * they do not track gender in the source at all. Sixteen men are shown 22 days
 * of maternity, five women are shown none, and one man has maternity but no
 * paternity. The column is the policy printed against everybody, with some
 * per-person noise on top.
 *
 * Where the report agrees with this system it says 22 and 10, which is exactly
 * what the accrual already computes — loading it would write an adjustment of
 * zero. So the only figures it would actually change are the ones that
 * disagree with the gender on the record, and those are the ones least worth
 * trusting. Loading them would zero maternity for five women.
 *
 * Vacation and sick are different: they vary genuinely per person, they are
 * what people have actually spent, and nothing else can supply them.
 *
 * ★ WHAT IS IGNORED.
 *
 * The "Extra Work" column has no counterpart here and is not loaded. Several
 * values are large and negative, which is a different concept from leave
 * entitlement; guessing at it would be worse than leaving it out.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const { db } = await import("@/lib/db");
const { deriveLeaveBalances, leaveTypesForGender } = await import("@/lib/leave-policy");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!file) {
  console.error("usage: import-leave-balances.mjs <balances.json> [--commit]");
  process.exit(2);
}

const sheet = JSON.parse(readFileSync(file, "utf8"));
const YEAR = new Date().getUTCFullYear();
console.log(`${sheet.length} row(s) from the report, writing against ${YEAR}`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null }, select: { id: true },
});

const staff = await db.employee.findMany({
  where: { user: { deletedAt: null } },
  select: {
    id: true, employeeId: true, startDate: true, gender: true,
    user: { select: { email: true } },
    leaveBalances: {
      where: { year: YEAR },
      select: { leaveType: true, usedDays: true, pendingDays: true, adjustmentDays: true },
    },
  },
});
const byEmail = new Map(staff.map((e) => [e.user.email.toLowerCase(), e]));

const tally = { written: 0, unchanged: 0, skippedType: 0, notInCrm: [], notInSheet: [] };
const examples = [];
const bigMoves = [];

for (const row of sheet) {
  const emp = byEmail.get(String(row.email).toLowerCase());
  if (!emp) { tally.notInCrm.push(row.name); continue; }

  // Vacation and sick only — see the note at the top about the parental
  // columns. Intersected with what the person is eligible for anyway, using
  // the same function the screens use, so the import cannot write a type the
  // UI would then hide.
  const LOADABLE = ["VACATION_PAID", "SICK"];
  const eligible = leaveTypesForGender(emp.gender).filter((t) => LOADABLE.includes(t));
  const derived = deriveLeaveBalances(emp.startDate, emp.leaveBalances, emp.gender);

  for (const [type, target] of Object.entries(row.balances)) {
    if (target === null || target === undefined) continue;
    if (!eligible.includes(type)) { tally.skippedType++; continue; }

    const d = derived.find((x) => x.leaveType === type);
    if (!d) { tally.skippedType++; continue; }

    const existing = emp.leaveBalances.find((b) => b.leaveType === type);
    const used = existing?.usedDays ?? 0;
    const pending = existing?.pendingDays ?? 0;
    // d.totalDays already includes any adjustment currently stored, so strip
    // it back to the pure accrual before solving, or a re-run would stack
    // adjustments on top of each other.
    const accrued = Number((d.totalDays - (existing?.adjustmentDays ?? 0)).toFixed(2));
    const adjustment = Number((target - accrued + used + pending).toFixed(2));

    if (existing && Math.abs((existing.adjustmentDays ?? 0) - adjustment) < 0.005) {
      tally.unchanged++;
      continue;
    }

    if (Math.abs(adjustment) >= 10) {
      bigMoves.push(`${emp.employeeId} ${type}: accrued ${accrued}d -> report says ${target}d (adjust ${adjustment > 0 ? "+" : ""}${adjustment})`);
    }
    if (examples.length < 8) {
      examples.push(`  ${emp.employeeId} ${type.padEnd(14)} accrued ${String(accrued).padStart(6)}d  report ${String(target).padStart(6)}d  adjust ${(adjustment > 0 ? "+" : "") + adjustment}`);
    }

    if (COMMIT) {
      await db.leaveBalance.upsert({
        where: { employeeId_leaveType_year: { employeeId: emp.id, leaveType: type, year: YEAR } },
        create: {
          employeeId: emp.id, leaveType: type, year: YEAR,
          totalDays: 0, adjustmentDays: adjustment, usedDays: used, pendingDays: pending,
        },
        update: { adjustmentDays: adjustment },
      });
      if (actor) {
        await db.auditLog.create({
          data: {
            userId: actor.id, action: "UPDATE", entity: "Employee", entityId: emp.id,
            changes: {
              field: "leaveBalance.adjustmentDays", employeeId: emp.employeeId,
              leaveType: type, year: YEAR, accruedByPolicy: accrued,
              reportedBalance: target, adjustment,
              source: "Leave_Balance_Report.xlsx, opening balances from the previous HR system",
            },
          },
        }).catch(() => {});
      }
    }
    tally.written++;
  }
}

const seen = new Set(sheet.map((r) => String(r.email).toLowerCase()));
for (const e of staff) if (!seen.has(e.user.email.toLowerCase())) tally.notInSheet.push(e.employeeId);

console.log("examples:");
for (const x of examples) console.log(x);

console.log("\n" + "=".repeat(62));
console.log(`  balances ${COMMIT ? "written" : "that would be written"}: ${tally.written}`);
console.log(`  already correct:                  ${tally.unchanged}`);
console.log(`  types skipped (not eligible):     ${tally.skippedType}`);
console.log(`  report rows with no CRM record:   ${tally.notInCrm.length}`);
for (const n of tally.notInCrm) console.log(`      ${n}`);
console.log(`  staff not in the report (left as computed): ${tally.notInSheet.length}`);
console.log(`      ${tally.notInSheet.join(", ")}`);
if (bigMoves.length) {
  console.log(`\n  adjustments of 10 days or more — worth a look:`);
  for (const b of bigMoves.slice(0, 15)) console.log(`      ${b}`);
  if (bigMoves.length > 15) console.log(`      ...and ${bigMoves.length - 15} more`);
}
console.log("=".repeat(62));

await db.$disconnect();

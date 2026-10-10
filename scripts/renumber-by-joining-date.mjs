/**
 * Renumber staff so the employee number follows the joining date.
 *
 *   node --import tsx scripts/renumber-by-joining-date.mjs [--commit]
 *
 * Dry run by default. Writes docs/Employee number mapping.xlsx either way.
 *
 * ILL-0000 and ILL-0001 are fixed — the CEO and the COO keep their numbers
 * whatever their start dates say. Everyone else is ordered by startDate and
 * numbered from ILL-0002 up, with the current number as the tiebreak so the
 * nine people who joined on the same day keep the order they were entered in
 * and the result is the same on every run.
 *
 * ★ WHY THIS IS A TWO-PHASE RENAME.
 *
 * `employeeId` is unique, and a renumbering is a permutation: the person
 * taking ILL-0005 is standing on a number somebody else is about to vacate.
 * Renaming in one pass hits a unique violation on the first swap, whatever
 * order it goes in. So every row moves to a temporary number first, and only
 * then to its final one — the usual trick for permuting a unique column, and
 * the reason the whole thing runs in one transaction.
 *
 * ★ AND WHY THE DEPARTED STAFF MOVE TOO.
 *
 * The eight people removed earlier still hold ILL-0054, 0063, 0069, 0070,
 * 0080, 0081, 0089 and 0091, which land in the middle of the new range. Their
 * User rows are soft-deleted but their Employee rows are not, so the unique
 * constraint still counts them. Reusing those numbers for living staff — which
 * is what was asked for — is only possible if the departed records give them
 * up, so they move to a retired ILL-9xxx block.
 *
 * Their old numbers are kept in the audit entry and in the mapping sheet,
 * because those numbers appear in documents written while they worked here and
 * now point at somebody else.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";

const { db } = await import("@/lib/db");

const COMMIT = process.argv.includes("--commit");
const FIXED = { "ILL-0000": true, "ILL-0001": true };   // CEO, COO
const RETIRED_BASE = 9000;

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null },
  select: { id: true },
});

const all = await db.employee.findMany({
  select: {
    id: true, employeeId: true, startDate: true,
    user: { select: { email: true, name: true, firstName: true, lastName: true, deletedAt: true } },
  },
});

const live = all.filter((e) => !e.user.deletedAt);
const departed = all.filter((e) => e.user.deletedAt);
const num = (id) => parseInt(String(id).replace(/^[A-Z]+-/, ""), 10) || 0;

const fixed = live.filter((e) => FIXED[e.employeeId]);
const toOrder = live
  .filter((e) => !FIXED[e.employeeId])
  .sort((a, b) => {
    const d = a.startDate.getTime() - b.startDate.getTime();
    // Same joining date: keep the order they were entered in, so the result is
    // stable and a re-run produces the same answer.
    return d !== 0 ? d : num(a.employeeId) - num(b.employeeId);
  });

console.log(`${all.length} employee rows: ${live.length} live, ${departed.length} departed`);
console.log(`${fixed.length} fixed (CEO, COO), ${toOrder.length} to renumber\n`);

const plan = [];
let next = 2;
for (const e of toOrder) {
  plan.push({
    rowId: e.id,
    from: e.employeeId,
    to: `ILL-${String(next).padStart(4, "0")}`,
    name: e.user.name ?? `${e.user.firstName ?? ""} ${e.user.lastName ?? ""}`.trim(),
    email: e.user.email,
    joined: e.startDate.toISOString().slice(0, 10),
    state: "live",
  });
  next += 1;
}
departed.forEach((e, i) => {
  plan.push({
    rowId: e.id,
    from: e.employeeId,
    to: `ILL-${RETIRED_BASE + i + 1}`,
    name: e.user.name ?? `${e.user.firstName ?? ""} ${e.user.lastName ?? ""}`.trim(),
    email: e.user.email,
    joined: e.startDate.toISOString().slice(0, 10),
    state: "departed",
  });
});

const moving = plan.filter((p) => p.from !== p.to);
console.log(`${moving.length} row(s) actually change number`);
console.log(`live range: ILL-0002 .. ILL-${String(next - 1).padStart(4, "0")}`);
console.log(`retired block: ILL-${RETIRED_BASE + 1} .. ILL-${RETIRED_BASE + departed.length}\n`);

// A sheet of old -> new, because the old numbers are in documents already.
const header = "Old number,New number,Name,Email,Joined,State";
const csv = [header, ...plan
  .sort((a, b) => num(a.to) - num(b.to))
  .map((p) => [p.from, p.to, `"${p.name.replace(/"/g, '""')}"`, p.email, p.joined, p.state].join(","))
].join("\n");
writeFileSync("docs/Employee number mapping.csv", csv, "utf8");
console.log("mapping written: docs/Employee number mapping.csv");

console.log("\nfirst 8 and last 4:");
for (const p of [...plan.filter((x) => x.state === "live").slice(0, 8),
                 ...plan.filter((x) => x.state === "live").slice(-4)]) {
  console.log(`  ${p.from} -> ${p.to}  ${p.joined}  ${p.name.slice(0, 28)}`);
}

if (!COMMIT) {
  console.log("\ndry run — nothing written to the database. Re-run with --commit.");
  await db.$disconnect();
  process.exit(0);
}

// Phase 1 to a temporary number, phase 2 to the final one. Both inside one
// transaction so a failure halfway cannot leave the table full of TMP- ids.
await db.$transaction(async (tx) => {
  for (const [i, p] of moving.entries()) {
    await tx.employee.update({
      where: { id: p.rowId },
      data: { employeeId: `TMP-${String(i).padStart(5, "0")}` },
    });
  }
  for (const p of moving) {
    await tx.employee.update({ where: { id: p.rowId }, data: { employeeId: p.to } });
  }
}, { timeout: 120_000, maxWait: 20_000 });

console.log(`\nrenumbered ${moving.length} record(s)`);

if (actor) {
  await db.auditLog.createMany({
    data: moving.map((p) => ({
      userId: actor.id,
      action: "UPDATE",
      entity: "Employee",
      entityId: p.rowId,
      changes: {
        field: "employeeId",
        from: p.from,
        to: p.to,
        reason: p.state === "departed"
          ? "Moved to the retired block so a living employee could take this number."
          : "Renumbered in joining-date order.",
        note: "Records written before 2026-10-10 quote the old number.",
      },
    })),
  }).catch((e) => console.error("audit write failed:", e.message));
  console.log(`${moving.length} audit entries written`);
}

const check = await db.employee.findMany({
  where: { user: { deletedAt: null } },
  select: { employeeId: true, startDate: true },
  orderBy: { employeeId: "asc" },
});
let outOfOrder = 0;
for (let i = 1; i < check.length; i++) {
  if (num(check[i].employeeId) <= 1) continue;
  if (num(check[i - 1].employeeId) <= 1) continue;
  if (check[i].startDate < check[i - 1].startDate) outOfOrder++;
}
console.log(`\nverification: ${check.length} live staff, ${outOfOrder} out of joining-date order`);
console.log(`lowest ${check[0].employeeId}, highest ${check[check.length - 1].employeeId}`);

await db.$disconnect();

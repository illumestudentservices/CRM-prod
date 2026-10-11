/**
 * Put everyone whose job title says "recruitment" into the recruitment team.
 *
 *   node --import tsx scripts/assign-recruitment-department.mjs [--commit]
 *
 * Dry run by default. Run it on the VPS, where the production database is.
 *
 * ★ IT FILLS BLANKS. IT DOES NOT MOVE ANYBODY.
 *
 * An employee whose title mentions recruitment but who has already been put
 * in another department was put there by a person, who knew something this
 * script does not. Overwriting that is how a tidy-up quietly undoes a
 * decision — the same trap the M365 import hit, where mapping "Management" to
 * Leadership would have moved Finance and Student Recruitment staff out of
 * the departments they belong to.
 *
 * So a title match on somebody who already has a department is REPORTED, not
 * changed, and the choice stays with a person.
 */
import "dotenv/config";

const { db } = await import("@/lib/db");

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");

/**
 * --rest  takes everyone with NO department instead of matching on job
 *         title, minus whatever --except names.
 *
 * The people left over are "In Country Representative" spelled five
 * different ways - In-Country, In Country, Inc Country, Country, Regional -
 * so matching on the title again would catch some and miss others. Naming
 * the exceptions is shorter, and honest about what is being decided rather
 * than hiding the decision inside a pattern.
 */
const REST = argv.includes("--rest");
const list = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? (argv[i + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : [];
};
const EXCEPT = list("--except");
const TEAM = "Student Recruitment";
/** Matches Recruitment Specialist, In-Country Recruitment Officer, and so on. */
const PATTERN = "recruit";

const team = await db.department.findFirst({
  where: { name: TEAM },
  select: { id: true, name: true },
});
if (!team) {
  console.error(`No department named "${TEAM}". Nothing to assign to.`);
  await db.$disconnect();
  process.exit(2);
}

const matches = await db.employee.findMany({
  where: {
    isActive: true,
    user: { deletedAt: null },
    ...(REST
      ? { departmentId: null, employeeId: { notIn: EXCEPT } }
      : { jobTitle: { contains: PATTERN, mode: "insensitive" } }),
  },
  select: {
    id: true, employeeId: true, jobTitle: true, departmentId: true,
    department: { select: { name: true } },
    user: { select: { name: true } },
  },
  orderBy: { employeeId: "asc" },
});

const toFill = matches.filter((e) => !e.departmentId);
const alreadyRight = matches.filter((e) => e.department?.name === TEAM);
const elsewhere = matches.filter(
  (e) => e.departmentId && e.department?.name !== TEAM,
);

console.log(REST
  ? `${matches.length} active employee(s) with no department`
    + (EXCEPT.length ? `, excluding ${EXCEPT.join(", ")}` : "")
  : `${matches.length} active employee(s) with "${PATTERN}" in the job title`);
console.log("");
console.log(`  already in ${TEAM}:        ${alreadyRight.length}`);
console.log(`  no department yet:         ${toFill.length}`);
console.log(`  in a DIFFERENT department: ${elsewhere.length}`);
console.log(COMMIT ? "\nMODE: COMMIT\n" : "\nMODE: dry run — nothing will be written\n");

for (const e of toFill) {
  console.log(`  ${e.employeeId}  ${(e.user.name ?? "?").slice(0, 26).padEnd(28)} ${e.jobTitle.slice(0, 44)}`);
}

if (elsewhere.length) {
  console.log(`\n  LEFT ALONE — their title says recruitment but somebody has already`);
  console.log(`  put them in another department. Move them by hand if that is wrong:`);
  for (const e of elsewhere) {
    console.log(`      ${e.employeeId}  ${(e.user.name ?? "?").slice(0, 24).padEnd(26)} ${e.jobTitle.slice(0, 32).padEnd(34)} currently: ${e.department?.name}`);
  }
}

if (!COMMIT) {
  console.log(`\nDry run. Add --commit to write. Nothing was changed.`);
  await db.$disconnect();
  process.exit(0);
}

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null },
  select: { id: true },
});

const { count } = await db.employee.updateMany({
  where: { id: { in: toFill.map((e) => e.id) } },
  data: { departmentId: team.id },
});

await db.auditLog
  .create({
    data: {
      userId: actor?.id ?? null,
      action: "UPDATE",
      entity: "Employee",
      entityId: `bulk-recruitment-department-${new Date().toISOString().slice(0, 10)}`,
      changes: {
        rule: REST
          ? `every active employee with no department, except ${EXCEPT.join(", ") || "none"}`
          : `jobTitle contains "${PATTERN}" (case-insensitive) and department was blank`,
        department: TEAM,
        updated: count,
        employeeIds: toFill.map((e) => e.employeeId),
        leftAlone: elsewhere.map((e) => `${e.employeeId} (${e.department?.name})`),
      },
    },
  })
  .catch(() => {});

console.log(`\n  updated: ${count}`);

const after = await db.department.findMany({
  select: { name: true, _count: { select: { employees: true } } },
  orderBy: { name: "asc" },
});
console.log("\n  departments now:");
for (const d of after) console.log(`      ${String(d._count.employees).padStart(3)}  ${d.name}`);
const noDept = await db.employee.count({
  where: { isActive: true, user: { deletedAt: null }, departmentId: null },
});
console.log(`\n  ${noDept} active employee(s) still have no department`);

await db.$disconnect();

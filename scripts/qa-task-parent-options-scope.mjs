/**
 * The task "Related record" picker (/api/tasks/parent-options) must not leak
 * records the signed-in user can't otherwise see:
 *   - STUDENT is row-scoped — an ICR sees only their assigned students;
 *   - FIELD_OPERATION is row-scoped — an ICR sees only field ops they registered;
 *   - every type is gated on READ of its own resource, honouring permission
 *     overrides (e.g. Market Intelligence removed from ICR → empty).
 *
 *   npx tsx --env-file=.env.local scripts/qa-task-parent-options-scope.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const PO = (type) => `/api/tasks/parent-options?type=${type}`;
const ids = (payload) => new Set((payload?.data ?? []).map((d) => d.id));

let icr, admin, myLeads = [], myActivity, overrideMade = false;
try {
  icr = await createAndLogin({ role: "ICR", withEmployee: true });
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  const leadBase = {
    nationality: "Testland", countryOfResidence: "Testland", interestedProgram: "CS",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE", createdById: icr.user.id,
  };
  myLeads = await Promise.all([
    db.lead.create({ data: { ...leadBase, firstName: TAG, lastName: "Mine1", assignedICRId: icr.user.id } }),
    db.lead.create({ data: { ...leadBase, firstName: TAG, lastName: "Mine2", assignedICRId: icr.user.id } }),
  ]);
  // A pre-existing student NOT assigned to this ICR — the one that must not leak.
  const foreign = await db.lead.findFirst({
    where: { deletedAt: null, id: { notIn: myLeads.map((l) => l.id) }, OR: [{ assignedICRId: null }, { assignedICRId: { not: icr.user.id } }] },
    select: { id: true },
  });

  // ── STUDENT — ICR sees only their own ───────────────────────────────────
  startSection("STUDENT picker is row-scoped to the ICR");
  let r = await api(icr.jar, "GET", PO("STUDENT"));
  const icrStudents = ids(r.payload);
  expect(r.status === 200, "ICR can load the student picker", `got ${r.status}`);
  expect(icrStudents.size === 2, "ICR sees exactly their 2 students", `saw ${icrStudents.size}`);
  expect(myLeads.every((l) => icrStudents.has(l.id)), "both of the ICR's students are present");
  expect(!foreign || !icrStudents.has(foreign.id), "a student NOT assigned to the ICR is hidden");

  r = await api(admin.jar, "GET", PO("STUDENT"));
  const adminStudents = ids(r.payload);
  expect(adminStudents.size > icrStudents.size, "a super admin sees many more students");
  expect(!foreign || adminStudents.has(foreign.id), "the super admin DOES see the foreign student");

  // ── FIELD_OPERATION — ICR sees only their own ───────────────────────────
  startSection("FIELD_OPERATION picker is row-scoped to the ICR");
  myActivity = await db.activity.create({
    data: { type: "SCHOOL_VISIT", title: `${TAG} my field op`, date: new Date(), userId: icr.user.id },
  });
  r = await api(icr.jar, "GET", PO("FIELD_OPERATION"));
  const icrOps = ids(r.payload);
  expect(icrOps.size === 1 && icrOps.has(myActivity.id), "ICR sees only the field op they registered", `saw ${icrOps.size}`);
  r = await api(admin.jar, "GET", PO("FIELD_OPERATION"));
  expect(ids(r.payload).size > 1, "a super admin sees all field ops");

  // ── MARKET — permission gate honours overrides ──────────────────────────
  startSection("MARKET picker respects a removed-permission override");
  r = await api(icr.jar, "GET", PO("MARKET"));
  expect(ids(r.payload).size > 0, "ICR sees markets while they hold markets:read");

  await db.permissionOverride.create({
    data: { role: "ICR", resource: "markets", action: "read", granted: false, updatedById: admin.user.id },
  });
  overrideMade = true;
  r = await api(icr.jar, "GET", PO("MARKET"));
  expect(ids(r.payload).size === 0, "with markets:read removed, the MARKET picker is empty", `saw ${ids(r.payload).size}`);

  await db.permissionOverride.deleteMany({ where: { role: "ICR", resource: "markets", action: "read" } });
  overrideMade = false;
  r = await api(icr.jar, "GET", PO("MARKET"));
  expect(ids(r.payload).size > 0, "restoring the permission brings markets back");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (overrideMade) await db.permissionOverride.deleteMany({ where: { role: "ICR", resource: "markets", action: "read" } }).catch(() => {});
  for (const l of myLeads) await db.lead.delete({ where: { id: l.id } }).catch(() => {});
  if (myActivity) await db.activity.delete({ where: { id: myActivity.id } }).catch(() => {});
  if (icr) await destroyUser(icr);
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

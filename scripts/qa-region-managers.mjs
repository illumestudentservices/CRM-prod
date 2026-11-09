/**
 * QA — a client's region Regional Manager(s) are auto-added to its team. 3×.
 *
 *   - POST with region r1 → r1's RM joins the team (ACTIVE, accountRole RM)
 *   - PATCH adding r2 → r2's RM joins; r1's RM stays
 *   - add-only: a PAUSED manager is NOT flipped back to ACTIVE, nor duplicated
 *   - deselecting r2 does NOT remove r2's RM (add-only)
 *   - a region with no RM adds nobody and doesn't error
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-region-managers.mjs
 */
import bcrypt from "bcryptjs";
import { db, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function mkRM(tag, label, regionId) {
  return db.user.create({ data: {
    email: `${tag}-${label}@rm.local`.toLowerCase(),
    firstName: label, lastName: tag, name: `${label} ${tag}`,
    password: await bcrypt.hash("x", 4), role: "REGIONAL_MANAGER", isActive: true,
    passwordChangedAt: new Date(), regionId,
  } });
}
const link = (instId, userId) => db.institutionUser.findUnique({ where: { institutionId_userId: { institutionId: instId, userId } }, select: { assignmentStatus: true, accountRole: true } });

async function run() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = admin.user.name.replace(/\s+/g, "");
  const mkReg = (n) => db.region.create({ data: { name: `QA RMReg ${n} ${tag}`, code: `QRM${n}${Date.now().toString().slice(-5)}` } });
  const [r1, r2, r3] = await Promise.all([mkReg("A"), mkReg("B"), mkReg("C")]);
  const rm1 = await mkRM(tag, "RM1", r1.id);
  const rm2 = await mkRM(tag, "RM2", r2.id);
  // r3 deliberately has NO regional manager.

  const created = [];
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // Create with region r1 → rm1 auto-joins.
      const cr = await api(admin.jar, "POST", "/api/institutions", {
        name: `QA RMClient ${tag} ${round}`, country: "T", type: "University", regionIds: [r1.id],
      });
      const instId = cr.payload?.id; created.push(instId);
      expect("create 201", cr.status === 201, `(${cr.status})`);
      const l1 = await link(instId, rm1.id);
      expect("rm1 auto-added, ACTIVE, accountRole REGIONAL_MANAGER", l1 && l1.assignmentStatus === "ACTIVE" && l1.accountRole === "REGIONAL_MANAGER", `(${JSON.stringify(l1)})`);
      expect("rm2 NOT on team yet", !(await link(instId, rm2.id)));

      // Add r2 → rm2 joins, rm1 stays.
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r1.id, r2.id] });
      expect("rm2 added after adding r2", !!(await link(instId, rm2.id)));
      expect("rm1 still on team", !!(await link(instId, rm1.id)));

      // Add-only: pause rm1, re-PATCH same regions → stays PAUSED (not resurrected).
      await db.institutionUser.update({ where: { institutionId_userId: { institutionId: instId, userId: rm1.id } }, data: { assignmentStatus: "PAUSED" } });
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r1.id, r2.id] });
      const l1b = await link(instId, rm1.id);
      expect("paused rm1 NOT flipped back to ACTIVE", l1b?.assignmentStatus === "PAUSED", `(${l1b?.assignmentStatus})`);
      const dupCount = await db.institutionUser.count({ where: { institutionId: instId, userId: rm1.id } });
      expect("no duplicate rm1 row", dupCount === 1, `(${dupCount})`);

      // Deselect r2 → rm2 stays (add-only, no removal).
      await api(admin.jar, "PATCH", `/api/institutions/${instId}`, { regionIds: [r1.id] });
      expect("deselecting r2 does NOT remove rm2 (add-only)", !!(await link(instId, rm2.id)));

      // A region with no RM adds nobody, no error.
      const cr3 = await api(admin.jar, "POST", "/api/institutions", {
        name: `QA RMClient-NoRM ${tag} ${round}`, country: "T", type: "University", regionIds: [r3.id],
      });
      created.push(cr3.payload?.id);
      expect("create with RM-less region 201", cr3.status === 201, `(${cr3.status})`);
      const teamCount = await db.institutionUser.count({ where: { institutionId: cr3.payload?.id } });
      expect("RM-less region adds nobody", teamCount === 0, `(${teamCount})`);
    }
  } finally {
    await db.institutionUser.deleteMany({ where: { institutionId: { in: created } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: created } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: [rm1.id, rm2.id] } } }).catch(() => {});
    await db.region.deleteMany({ where: { id: { in: [r1.id, r2.id, r3.id] } } }).catch(() => {});
    await destroyUser(admin).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

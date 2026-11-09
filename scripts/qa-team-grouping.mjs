/**
 * QA — Team tab groups by per-client account role, elevate-don't-demote. 3×.
 *
 * Seeds one client with five teammates and checks the SSR Team tab headings:
 *   hqRM     — global HQ_EXECUTIVE, accountRole REGIONAL_MANAGER → Regional Managers
 *   realRM   — global REGIONAL_MANAGER, no accountRole           → Regional Managers
 *   demoRM   — global REGIONAL_MANAGER, accountRole CLIENT_RELATIONS → STILL Regional Managers
 *   hqOther  — global HQ_EXECUTIVE, accountRole CLIENT_RELATIONS  → Other
 *   recruit  — global EMPLOYEE, no accountRole                   → ICRs
 *
 * So "Regional Managers (3)" proves BOTH elevate (hqRM in) and don't-demote
 * (demoRM kept) and that hqOther is NOT counted as an RM.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-team-grouping.mjs
 */
import bcrypt from "bcryptjs";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function mkUser(tag, label, role) {
  return db.user.create({ data: {
    email: `${tag}-${label}@team.local`.toLowerCase(),
    firstName: label, lastName: tag, name: `${label} ${tag}`,
    password: await bcrypt.hash("x", 4), role, isActive: true, passwordChangedAt: new Date(),
  } });
}

async function run() {
  const viewer = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = viewer.user.name.split(" ")[1] || "QA";
  const inst = await db.institution.create({ data: { name: `QA Team ${tag}`, country: "T", type: "UNIVERSITY", createdById: viewer.user.id } });

  const hqRM = await mkUser(tag, "HqRM", "HQ_EXECUTIVE");
  const realRM = await mkUser(tag, "RealRM", "REGIONAL_MANAGER");
  const demoRM = await mkUser(tag, "DemoRM", "REGIONAL_MANAGER");
  const hqOther = await mkUser(tag, "HqOther", "HQ_EXECUTIVE");
  const recruit = await mkUser(tag, "Recruit", "EMPLOYEE");
  await db.institutionUser.createMany({ data: [
    { institutionId: inst.id, userId: hqRM.id, accountRole: "REGIONAL_MANAGER", assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: realRM.id, assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: demoRM.id, accountRole: "CLIENT_RELATIONS", assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: hqOther.id, accountRole: "CLIENT_RELATIONS", assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: recruit.id, assignmentStatus: "ACTIVE" },
  ] });

  const get = async (path) => (await fetch(`${BASE}${path}`, { headers: { Cookie: viewer.jar.header() } })).text();

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      // Strip SSR comment markers so the "(N)" counts match.
      const team = (await get(`/institutions/${inst.id}?tab=team`)).replace(/<!--.*?-->/g, "");

      expect("Regional Managers (3) — hqRM elevated, demoRM kept, hqOther excluded",
        /Regional Managers \(3\)/.test(team), `(${(team.match(/Regional Managers \(\d+\)/) || [])[0]})`);
      expect("ICRs (1) — the EMPLOYEE recruiter", /ICRs \(1\)/.test(team), `(${(team.match(/ICRs \(\d+\)/) || [])[0]})`);
      expect("Other Assigned Users (1) — hqOther only", /Other Assigned Users \(1\)/.test(team), `(${(team.match(/Other Assigned Users \(\d+\)/) || [])[0]})`);

      // Every seeded person is on the page (grouping aside).
      for (const u of [hqRM, realRM, demoRM, hqOther, recruit]) {
        expect(`${u.firstName} is listed`, team.includes(`${u.firstName} ${tag}`));
      }
    }
  } finally {
    await db.institutionUser.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    for (const u of [hqRM, realRM, demoRM, hqOther, recruit]) await db.user.delete({ where: { id: u.id } }).catch(() => {});
    await destroyUser(viewer).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

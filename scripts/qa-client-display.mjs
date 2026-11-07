/**
 * QA — client display fixes behind Ashley's report:
 *   A. Governance "Pipeline" count excludes soft-deleted leads.
 *   B. Card "ICRs" count = recruiters only (ICR+EMPLOYEE), not the AM/RMs.
 *   C. Team tab puts EMPLOYEE-role recruiters under "ICRs" (not "Other").
 * 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-client-display.mjs
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
    email: `${tag}-${label}@illume.local`.toLowerCase(),
    firstName: label, lastName: tag, name: `${label} ${tag}`,
    password: await bcrypt.hash("x", 4), role, isActive: true, passwordChangedAt: new Date(),
  } });
}

async function run() {
  const viewer = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = viewer.user.name.split(" ")[1] || "QA";
  const region = await db.region.findFirst({ select: { id: true } });
  const am = await mkUser(tag, "AMgr", "HQ_EXECUTIVE");
  const rec1 = await mkUser(tag, "RecICR", "ICR");
  const rec2 = await mkUser(tag, "RecEmp", "EMPLOYEE");
  const rm = await mkUser(tag, "RegMgr", "REGIONAL_MANAGER");
  const inst = await db.institution.create({ data: {
    name: `QA Client ${tag}`, country: "Testland", type: "UNIVERSITY",
    createdById: viewer.user.id, accountManagerId: am.id, regionId: region?.id ?? null,
  } });
  await db.institutionUser.createMany({ data: [
    { institutionId: inst.id, userId: am.id, accountRole: "CLIENT_RELATIONS", assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: rec1.id, assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: rec2.id, assignmentStatus: "ACTIVE" },
    { institutionId: inst.id, userId: rm.id, assignmentStatus: "ACTIVE" },
  ] });
  const leadBase = { nationality: "T", countryOfResidence: "T", interestedProgram: "CS", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9, createdById: viewer.user.id, institutionId: inst.id };
  const activeLead = await db.lead.create({ data: { ...leadBase, firstName: "Active", lastName: tag, stage: "NEW_LEAD" } });
  const deletedLead = await db.lead.create({ data: { ...leadBase, firstName: "Deleted", lastName: tag, stage: "NEW_LEAD", deletedAt: new Date() } });

  const get = async (path) => (await fetch(`${BASE}${path}`, { headers: { Cookie: viewer.jar.header() } })).text();

  try {
    // DB-level check of the card predicate (fix B)
    const cardCount = await db.institutionUser.count({
      where: { institutionId: inst.id, assignmentStatus: "ACTIVE", user: { role: { in: ["ICR", "EMPLOYEE"] } } },
    });
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      expect("card ICRs predicate = 2 recruiters (not AM/RM)", cardCount === 2, `(got ${cardCount})`);

      // A. Governance Pipeline count excludes the deleted lead → 1
      const gov = await get(`/institutions/${inst.id}`);
      const m = gov.match(/Pipeline<\/span>[\s\S]{0,240}?text-2xl[^>]*>\s*(\d+)/);
      expect("Governance Pipeline count = 1 (deleted lead excluded)", m && m[1] === "1", `(got ${m ? m[1] : "no match"})`);

      // C. Team tab. Strip React's SSR comment markers (<!-- -->) that sit
      // between "ICRs (" and the number, so the count regex can match.
      const team = (await get(`/institutions/${inst.id}?tab=team`)).replace(/<!--.*?-->/g, "");
      expect("Team: ICRs (2) — both recruiters, incl. the EMPLOYEE one", /ICRs \(2\)/.test(team), `(${(team.match(/ICRs \(\d+\)/) || [])[0]})`);
      expect("Team: the EMPLOYEE recruiter is listed (under ICRs)", team.includes(`RecEmp ${tag}`));
      expect("Team: the ICR recruiter is listed", team.includes(`RecICR ${tag}`));
      expect("Team: Regional Managers (1)", /Regional Managers \(1\)/.test(team));
      expect("Team: account manager shown", team.includes(`AMgr ${tag}`));
    }
  } finally {
    await db.lead.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institutionUser.deleteMany({ where: { institutionId: inst.id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    for (const u of [am, rec1, rec2, rm]) await db.user.delete({ where: { id: u.id } }).catch(() => {});
    await destroyUser(viewer).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

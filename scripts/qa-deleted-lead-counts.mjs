/**
 * QA — soft-deleted leads are excluded from relation counts (the "N leads"
 * shown on client/source cards and APIs). Seeds an institution and a source,
 * each with 1 active + 1 deleted lead, and asserts the count is 1 (not 2). 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-deleted-lead-counts.mjs
 */
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const viewer = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = viewer.user.name;
  const inst = await db.institution.create({ data: { name: `QA DelInst ${tag}`, country: "T", type: "UNIVERSITY", createdById: viewer.user.id } });
  const source = await db.recruitmentPartner.create({ data: { name: `QA DelSrc ${tag}`, type: "AGENT", country: "T", createdById: viewer.user.id } });
  const base = { nationality: "T", countryOfResidence: "T", interestedProgram: "CS", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9, createdById: viewer.user.id, institutionId: inst.id, sourceId: source.id };
  const ids = [];
  const a = await db.lead.create({ data: { ...base, firstName: "Active", lastName: tag, stage: "NEW_LEAD" } });
  const d = await db.lead.create({ data: { ...base, firstName: "Deleted", lastName: tag, stage: "NEW_LEAD", deletedAt: new Date() } });
  ids.push(a.id, d.id);

  const getJson = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: viewer.jar.header() } });
    return res.ok ? res.json() : { __status: res.status };
  };

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      // Institution API _count.leads
      const instRes = await getJson(`/api/institutions/${inst.id}`);
      const instCount = instRes?.institution?._count?.leads ?? instRes?._count?.leads;
      expect("institution _count.leads excludes deleted (=1)", instCount === 1, `(got ${JSON.stringify(instCount)})`);

      // Sources API _count.leads for our source
      const srcRes = await getJson(`/api/sources`);
      const list = Array.isArray(srcRes) ? srcRes : (srcRes?.sources ?? srcRes?.data ?? []);
      const mine = list.find?.((s) => s.id === source.id);
      expect("source found in /api/sources", !!mine, `(status ${srcRes?.__status ?? "ok"})`);
      expect("source _count.leads excludes deleted (=1)", mine?._count?.leads === 1, `(got ${JSON.stringify(mine?._count?.leads)})`);
    }
  } finally {
    for (const id of ids) await db.lead.delete({ where: { id } }).catch(() => {});
    await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
    await db.recruitmentPartner.delete({ where: { id: source.id } }).catch(() => {});
    await destroyUser(viewer).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

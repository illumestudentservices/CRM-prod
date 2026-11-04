/**
 * QA — /students honours ?stage= and ?institution= URL filters.
 *
 * This is the enabler behind many figure-tile links (dashboard "Enrolled",
 * report-detail KPIs, client pipeline tiles). Seeds leads across 2 clients and
 * asserts the pre-applied filters narrow the pipeline. 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-students-urlfilter.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const uid = ctx.user.id;
  const tag = ctx.user.name.split(" ")[0];

  const instA = await db.institution.create({ data: { name: `${tag} ClientA`, country: "Testland", type: "UNIVERSITY", createdById: uid } });
  const instB = await db.institution.create({ data: { name: `${tag} ClientB`, country: "Testland", type: "UNIVERSITY", createdById: uid } });

  const L = { enrolledA: `${tag}EnrolA`, newA: `${tag}NewA`, newB: `${tag}NewB` };
  const leadIds = [];
  async function lead(firstName, stage, institutionId) {
    const l = await db.lead.create({
      data: {
        firstName, lastName: "QaLead", nationality: "Testland", countryOfResidence: "Testland",
        interestedProgram: "CS", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
        stage, institutionId, createdById: uid,
      },
    });
    leadIds.push(l.id);
  }
  await lead(L.enrolledA, "ENROLLED", instA.id);
  await lead(L.newA, "NEW_LEAD", instA.id);
  await lead(L.newB, "NEW_LEAD", instB.id);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    await context.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
    const page = await context.newPage();
    const seen = async (t) => (await page.getByText(t, { exact: false }).count()) > 0;
    const load = async (qs) => {
      await page.goto(`${BASE}/students${qs}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(600);
    };
    const only = async (keys) => {
      const s = {};
      for (const k of Object.keys(L)) s[k] = await seen(L[k]);
      return keys.every((k) => s[k]) && Object.keys(L).filter((k) => !keys.includes(k)).every((k) => !s[k]);
    };

    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);
      await load("?stage=ENROLLED");
      expect("?stage=ENROLLED → only enrolled lead", await only(["enrolledA"]));

      await load(`?institution=${instA.id}`);
      expect("?institution=A → only client A leads", await only(["enrolledA", "newA"]));

      await load(`?institution=${instA.id}&stage=ENROLLED`);
      expect("?institution=A&stage=ENROLLED → only enrolled A", await only(["enrolledA"]));

      await load("");
      expect("no filter → all 3 seeded shown", await only(["enrolledA", "newA", "newB"]));
    }
  } finally {
    await browser.close();
    for (const id of leadIds) await db.lead.delete({ where: { id } }).catch(() => {});
    await db.institution.delete({ where: { id: instA.id } }).catch(() => {});
    await db.institution.delete({ where: { id: instB.id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

/**
 * QA — a client's "Activities" tile shows ONLY that client's activities.
 * Seeds two clients each with activities, then checks the field-operations page
 * filtered by one client shows its rows and not the other's, plus the chip. 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-client-activities-filter.mjs
 */
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

async function run() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = admin.user.name.replace(/\s+/g, "");
  const get = (path) => fetch(`${BASE}${path}`, { headers: { Cookie: admin.jar.header() }, redirect: "manual" }).then((r) => r.text());

  const A = await db.institution.create({ data: { name: `QA ClientA ${tag}`, country: "T", type: "UNIVERSITY", createdById: admin.user.id } });
  const B = await db.institution.create({ data: { name: `QA ClientB ${tag}`, country: "T", type: "UNIVERSITY", createdById: admin.user.id } });
  const titleA = `ACTA-${tag}`, titleB = `ACTB-${tag}`;
  const mkAct = (instId, title) => db.activity.create({ data: { title, type: "CLIENT_MEETING", date: new Date(), userId: admin.user.id, institutionId: instId } });
  await Promise.all([mkAct(A.id, titleA), mkAct(A.id, `${titleA}-2`), mkAct(B.id, titleB), mkAct(B.id, `${titleB}-2`)]);

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // Filtered to client A — the activity TITLES are the clean signal (they
      // render only in the activity rows, unlike institution names which appear
      // in the form's dropdowns on every page).
      const fa = await get(`/field-operations?institution=${A.id}`);
      expect("A-filter: shows A's activities", fa.includes(titleA), "(A title missing)");
      expect("A-filter: hides B's activities", !fa.includes(titleB), "(B title leaked)");
      expect("A-filter: shows the Client filter chip", fa.includes("Clear client filter"));

      // Filtered to client B.
      const fb = await get(`/field-operations?institution=${B.id}`);
      expect("B-filter: shows B's activities", fb.includes(titleB));
      expect("B-filter: hides A's activities", !fb.includes(titleA), "(A title leaked)");

      // No filter — both appear (the global list is unchanged), no client chip.
      const all = await get(`/field-operations`);
      expect("no filter: shows both clients' activities", all.includes(titleA) && all.includes(titleB));
      expect("no filter: no client filter chip", !all.includes("Clear client filter"));
    }
  } finally {
    await db.activity.deleteMany({ where: { institutionId: { in: [A.id, B.id] } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: [A.id, B.id] } } }).catch(() => {});
    await destroyUser(admin).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

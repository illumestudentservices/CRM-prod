/**
 * QA — client DETAIL page figure tiles are clickable + ?tab deep-linking.
 *
 * Verified via authenticated server-rendered HTML (the detail page soft-navigates
 * under Playwright, so we assert the SSR markup instead — which is also what a
 * deep link delivers before JS runs):
 *   - Governance: Pipeline tile links to the client's students; Open Issues is a
 *     wired control (role=button → Issues tab).
 *   - ?tab=overview: Total Leads / Enrolled link to the client's pipeline
 *     (Enrolled pins stage); the pipeline stage tiles link per stage.
 *   - ?tab=issues: the Issues tab renders active (SSR), proving the deep link.
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-client-detail-tiles.mjs
 */
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
// Hrefs are HTML-encoded in SSR markup (& -> &amp;); match either form.
const hasHref = (html, href) => html.includes(href) || html.includes(href.replace(/&/g, "&amp;"));

async function run() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const uid = ctx.user.id;
  const tag = ctx.user.name.split(" ")[0];
  const inst = await db.institution.create({ data: { name: `${tag} DetailU`, country: "Testland", type: "UNIVERSITY", createdById: uid } });
  const leadIds = [];
  async function lead(firstName, stage) {
    const l = await db.lead.create({ data: {
      firstName, lastName: "QaLead", nationality: "Testland", countryOfResidence: "Testland",
      interestedProgram: "CS", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
      stage, institutionId: inst.id, createdById: uid,
    } });
    leadIds.push(l.id);
  }
  await lead(`${tag}Enr`, "ENROLLED");
  await lead(`${tag}New`, "NEW_LEAD");
  const issue = await db.clientIssue.create({ data: {
    institutionId: inst.id, title: `${tag} Issue`, category: "OTHER", status: "OPEN", ownerId: uid, createdById: uid,
  } });

  const id = inst.id;
  const get = async (path) => {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: ctx.jar.header() } });
    return { ok: res.ok, status: res.status, html: await res.text() };
  };

  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // Governance (default tab)
      const gov = await get(`/institutions/${id}`);
      expect("governance page loads", gov.ok, `(status ${gov.status})`);
      expect("Pipeline tile → client students", hasHref(gov.html, `/students?institution=${id}`));
      expect("Open Issues is a wired control (→ Issues tab)", gov.html.includes('title="Open the Issues tab"'));
      expect("Activities tile → field operations", gov.html.includes('href="/field-operations"'));

      // Overview (deep link, SSR renders this tab)
      const ov = await get(`/institutions/${id}?tab=overview`);
      expect("overview deep link loads", ov.ok, `(status ${ov.status})`);
      expect("Enrolled card → students?...&stage=ENROLLED", hasHref(ov.html, `/students?institution=${id}&stage=ENROLLED`));
      expect("pipeline stage tile → students?...&stage=NEW_LEAD", hasHref(ov.html, `/students?institution=${id}&stage=NEW_LEAD`));

      // Issues (deep link → Issues tab active in SSR)
      const iss = await get(`/institutions/${id}?tab=issues`);
      expect("issues deep link loads", iss.ok, `(status ${iss.status})`);
      // The Issues panel's static description renders in SSR only when the
      // Issues tab is the active one (Radix unmounts inactive tabs), so its
      // presence proves ?tab=issues selected the Issues tab.
      expect("?tab=issues → Issues tab active (panel rendered)",
        iss.html.includes("Problems raised against this client"));
    }
  } finally {
    await db.clientIssue.delete({ where: { id: issue.id } }).catch(() => {});
    for (const lid of leadIds) await db.lead.delete({ where: { id: lid } }).catch(() => {});
    await db.institution.delete({ where: { id } }).catch(() => {});
    await destroyUser(ctx).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

/**
 * QA — corrected dashboard tile destinations.
 *   A. /students?stage=A,B,C filters to multiple stages (the "In Progress" tile).
 *   B. ICR dashboard: "Needs Attention" scrolls to the on-page card
 *      (href="#needs-attention"), not /students; "In Progress" links to the
 *      in-progress stages.
 * 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-tile-targets.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const IN_PROGRESS = "CONTACTED,QUALIFIED,APPLICATION_SUBMITTED,AWAITING_DECISION,OFFER_RECEIVED,DEPOSIT_PAID";

async function run() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const tag = admin.user.name.split(" ")[0];
  const L = { contacted: `${tag}Contacted`, enrolled: `${tag}Enrolled`, fresh: `${tag}Fresh` };
  const ids = [];
  async function lead(firstName, stage) {
    const l = await db.lead.create({ data: {
      firstName, lastName: "QaLead", nationality: "Testland", countryOfResidence: "Testland",
      interestedProgram: "CS", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
      stage, createdById: admin.user.id,
    } });
    ids.push(l.id);
  }
  await lead(L.contacted, "CONTACTED");
  await lead(L.enrolled, "ENROLLED");
  await lead(L.fresh, "NEW_LEAD");

  const browser = await chromium.launch();
  try {
    // ── A. multi-stage filter ──
    {
      const context = await browser.newContext();
      await context.addCookies([...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
      const page = await context.newPage();
      const url = `${BASE}/students?stage=${IN_PROGRESS}`;
      const seen = async (t) => { try { return (await page.getByText(t, { exact: false }).count()) > 0; } catch { return null; } };
      const go = async () => { for (let a = 0; a < 4; a++) { try { await page.goto(url, { waitUntil: "domcontentloaded" }); return; } catch { await page.waitForTimeout(800); } } };
      // Warm up the route (first dev compile can abort/stall a navigation).
      await go(); await page.waitForTimeout(1500);
      for (let round = 1; round <= 3; round++) {
        console.log(`\n── round ${round} (multi-stage filter) ──`);
        await go();
        // Poll until the seeded in-progress lead is visible.
        let shownContacted = false;
        for (let i = 0; i < 40; i++) { if (await seen(L.contacted)) { shownContacted = true; break; } await page.waitForTimeout(300); }
        expect("in-progress stage shown (Contacted)", shownContacted);
        expect("NEW_LEAD hidden", (await seen(L.fresh)) === false);
        expect("ENROLLED hidden", (await seen(L.enrolled)) === false);
      }
      await context.close();
    }

    // ── B. dashboard ICR tile hrefs (SSR) ──
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} (dashboard hrefs) ──`);
      let html = "";
      for (const url of ["/dashboard", "/dashboard?view=personal"]) {
        const res = await fetch(`${BASE}${url}`, { headers: { Cookie: icr.jar.header() } });
        html = await res.text();
        if (html.includes("Needs Attention")) break;
      }
      expect("Needs Attention → scrolls to on-page card (#needs-attention)", html.includes('href="#needs-attention"'));
      expect("the #needs-attention target exists on the page", html.includes('id="needs-attention"'));
      expect("In Progress → in-progress stages", html.includes(`/students?stage=${IN_PROGRESS}`));
    }
  } finally {
    await browser.close();
    for (const id of ids) await db.lead.delete({ where: { id } }).catch(() => {});
    await destroyUser(icr).catch(() => {});
    await destroyUser(admin).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

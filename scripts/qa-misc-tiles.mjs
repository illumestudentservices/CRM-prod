/**
 * QA — remaining simple clickable tiles:
 *   A. Home dashboard (ICR view): New This Month / In Progress / Needs Attention
 *      / Deadlines This Week are now links with the right href.
 *   B. Analytics exec dashboard: "Avg KPI Achievement" navigates to HR reviews.
 *   C. Events: "Avg ROI" card filters the list to COMPLETED events.
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-misc-tiles.mjs
 */
import { chromium } from "playwright";
import { db, BASE, createAndLogin, destroyUser } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
async function ctxPage(browser, ctx) {
  const c = await browser.newContext();
  await c.addCookies([...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, url: BASE })));
  return c.newPage();
}

async function run() {
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const tag = admin.user.name.split(" ")[0];

  // Seed 2 events for the ROI filter test
  const evCompleted = `${tag} Completed Event`;
  const evPlanned = `${tag} Planned Event`;
  const evIds = [];
  for (const [name, status] of [[evCompleted, "COMPLETED"], [evPlanned, "PLANNED"]]) {
    const e = await db.event.create({
      data: { name, type: "EDUCATION_FAIR", date: new Date(), city: "Testville", country: "Testland", status, createdById: admin.user.id },
    });
    evIds.push(e.id);
  }

  const browser = await chromium.launch();
  try {
    for (let round = 1; round <= 3; round++) {
      console.log(`\n── round ${round} ──`);

      // ── A. ICR dashboard tile hrefs ──
      {
        const page = await ctxPage(browser, icr);
        await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
        await page.getByText("My Leads", { exact: true }).first().waitFor({ timeout: 20000 });
        const href = async (name) => page.getByRole("link", { name }).first().getAttribute("href");
        expect("New This Month → /students?stage=NEW_LEAD", (await href(/New This Month/)) === "/students?stage=NEW_LEAD");
        expect("In Progress → /students", (await href(/In Progress/)) === "/students");
        expect("Needs Attention → /students", (await href(/Needs Attention/)) === "/students");
        expect("Deadlines This Week → /tasks?view=dueThisWeek", (await href(/Deadlines This Week/)) === "/tasks?view=dueThisWeek");
        await page.context().close();
      }

      // ── B. Analytics Avg KPI Achievement → HR performance reviews ──
      {
        const page = await ctxPage(browser, admin);
        await page.goto(`${BASE}/analytics`, { waitUntil: "domcontentloaded" });
        await page.getByText("Avg KPI Achievement", { exact: true }).first().waitFor({ timeout: 25000 });
        await page.getByText("Avg KPI Achievement", { exact: true }).first().click();
        await page.waitForURL(/\/hr\?tab=performance-reviews/, { timeout: 10000 });
        expect("Avg KPI Achievement → /hr?tab=performance-reviews", /\/hr\?tab=performance-reviews/.test(page.url()));
        await page.context().close();
      }

      // ── C. Events Avg ROI → COMPLETED filter ──
      {
        const page = await ctxPage(browser, admin);
        await page.goto(`${BASE}/events`, { waitUntil: "domcontentloaded" });
        await page.getByText(evCompleted, { exact: true }).first().waitFor({ timeout: 20000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800); // let the client component hydrate before clicking
        await page.getByText("Avg ROI", { exact: true }).first().click();
        // Poll for the filter to take effect (planned event drops out).
        let completedShown = true, plannedShown = true;
        for (let i = 0; i < 20; i++) {
          completedShown = (await page.getByText(evCompleted, { exact: true }).count()) > 0;
          plannedShown = (await page.getByText(evPlanned, { exact: true }).count()) > 0;
          if (completedShown && !plannedShown) break;
          await page.waitForTimeout(250);
        }
        expect("Avg ROI → shows COMPLETED, hides PLANNED", completedShown && !plannedShown, `(completed=${completedShown} planned=${plannedShown})`);
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    for (const id of evIds) await db.event.delete({ where: { id } }).catch(() => {});
    await destroyUser(icr).catch(() => {});
    await destroyUser(admin).catch(() => {});
    await db.$disconnect().catch(() => {});
  }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });

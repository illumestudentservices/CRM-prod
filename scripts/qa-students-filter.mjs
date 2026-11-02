/**
 * QA — multi-select filters on the Students / Pipeline page.
 *
 * Real browser (Playwright), real login (super admin via qa-lib), real DB.
 * Seeds leads across two regions and two stages, then drives the filter bar:
 *   - Region filter lets several regions be ticked at once and narrows correctly.
 *   - Stage filter lets several stages be ticked at once.
 *   - An empty selection means "show all".
 * Asserts against the live result count ("N leads").
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-students-filter.mjs
 */
import { chromium } from "playwright";
import { db, createAndLogin, destroyUser, TAG, BASE } from "./qa-lib.mjs";

const AFRICA = "d46440e9-6cc3-4ab8-be49-8eac11f59e81";
const CHINA = "4b339de8-84fb-4a12-9ee0-09dc4a0b3a0e";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

const leadBase = (over) => ({
  firstName: "Zed",
  lastName: `${TAG}`,
  nationality: "Testlandia",
  countryOfResidence: "Testlandia",
  interestedProgram: "MSc Testing",
  studyLevel: "POSTGRADUATE",
  intakeYear: 2027,
  intakeMonth: 9,
  ...over,
});

async function countText(page) {
  // Anchored so it matches ONLY the result-count span ("3 leads"), not the
  // offline-capture warning sentence, which also contains "... 100 leads ...".
  const el = page.getByText(/^\d+ leads?$/).first();
  await el.waitFor({ timeout: 10000 });
  const t = await el.innerText();
  return parseInt(t.match(/(\d+)/)[1], 10);
}

async function pickOption(page, filterAriaLabel, optionLabel) {
  await page.getByRole("button", { name: filterAriaLabel }).click();
  // Option rows are buttons carrying the label text; scope to the open popover.
  await page.getByRole("button", { name: optionLabel, exact: true }).click();
  // Close the popover so it doesn't cover the result count / next trigger.
  await page.keyboard.press("Escape");
}

async function run() {
  console.log(`[qa] target=${BASE}`);
  if (!BASE.includes("localhost") && !BASE.includes("127.0.0.1")) {
    throw new Error(`refusing to run against non-local BASE: ${BASE}`);
  }

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  const created = [];
  let browser;
  try {
    const mk = (over) =>
      db.lead.create({ data: leadBase({ createdById: admin.user.id, ...over }) });
    // A,C in Africa / NEW_LEAD; B in China / CONTACTED.
    const a = await mk({ firstName: "Aisha", regionId: AFRICA, stage: "NEW_LEAD" });
    const b = await mk({ firstName: "Bo", regionId: CHINA, stage: "CONTACTED" });
    const c = await mk({ firstName: "Cara", regionId: AFRICA, stage: "NEW_LEAD" });
    created.push(a.id, b.id, c.id);

    browser = await chromium.launch();
    const context = await browser.newContext();
    // Reuse the authenticated session from qa-lib's login.
    const host = new URL(BASE).hostname;
    await context.addCookies(
      [...admin.jar.cookies.entries()].map(([name, value]) => ({
        name, value, domain: host, path: "/",
      }))
    );
    const page = await context.newPage();
    await page.goto(`${BASE}/students`, { waitUntil: "networkidle" });

    // Narrow to just our three seeded leads via the TAG in their surname.
    await page.getByPlaceholder("Search leads...").fill(TAG);
    expect("search by TAG shows the 3 seeded leads", (await countText(page)) === 3);

    // ── Region filter: multi-select ──────────────────────────────────────
    await pickOption(page, "Filter by region", "Africa");
    expect("Region=Africa narrows to 2 (A,C)", (await countText(page)) === 2);

    await pickOption(page, "Filter by region", "China");
    expect("Region=Africa+China shows all 3 (multi-select works)", (await countText(page)) === 3);

    // Clear just the region filter via its "Clear regions" affordance.
    await page.getByRole("button", { name: "Filter by region" }).click();
    await page.getByRole("button", { name: "Clear regions" }).click();
    await page.keyboard.press("Escape");
    expect("clearing region returns to 3", (await countText(page)) === 3);

    // ── Stage filter: multi-select ───────────────────────────────────────
    await pickOption(page, "Filter by stage", "Contacted");
    expect("Stage=Contacted narrows to 1 (B)", (await countText(page)) === 1);

    await pickOption(page, "Filter by stage", "New Lead");
    expect("Stage=Contacted+New Lead shows all 3 (multi-select works)", (await countText(page)) === 3);

    // ── Combined Region + Stage ──────────────────────────────────────────
    await pickOption(page, "Filter by region", "Africa");
    expect("Region=Africa + Stage{Contacted,New Lead} = 2 (A,C)", (await countText(page)) === 2);
  } finally {
    if (browser) await browser.close();
    if (created.length) await db.lead.deleteMany({ where: { id: { in: created } } });
    await destroyUser(admin);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error("qa-students-filter crashed", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

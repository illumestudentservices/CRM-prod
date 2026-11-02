/**
 * QA — multi-select filters on the Clients (Institutions) page.
 *
 * Real browser (Playwright), real super-admin login, real DB. Seeds clients
 * across two statuses, two types and two regions, then drives the filter bar
 * and asserts the live "Showing N of M clients" count. Confirms each filter
 * accepts several values at once and that an empty selection shows all.
 *
 *   BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-institutions-filter.mjs
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

async function shownCount(page) {
  const el = page.getByText(/Showing \d+ of \d+ clients/).first();
  await el.waitFor({ timeout: 10000 });
  const t = await el.innerText();
  return parseInt(t.match(/Showing (\d+)/)[1], 10);
}

async function pickOption(page, filterAriaLabel, optionLabel) {
  await page.getByRole("button", { name: filterAriaLabel }).click();
  await page.getByRole("button", { name: optionLabel, exact: true }).click();
  await page.keyboard.press("Escape");
}

async function clearOption(page, filterAriaLabel, clearLabel) {
  await page.getByRole("button", { name: filterAriaLabel }).click();
  await page.getByRole("button", { name: clearLabel }).click();
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
      db.institution.create({
        data: {
          name: `${TAG} ${over.tag}`,
          country: over.country,
          type: over.type,
          accountStatus: over.accountStatus,
          regionId: over.regionId,
          createdById: admin.user.id,
        },
      });
    // A: Active / University / Africa / Testonia
    // B: Prospect / College / China / Testonia
    // C: Active / University / Africa / Otherland
    const a = await mk({ tag: "Alpha", country: "Testonia", type: "University", accountStatus: "ACTIVE", regionId: AFRICA });
    const b = await mk({ tag: "Bravo", country: "Testonia", type: "College", accountStatus: "PROSPECT", regionId: CHINA });
    const c = await mk({ tag: "Charlie", country: "Otherland", type: "University", accountStatus: "ACTIVE", regionId: AFRICA });
    created.push(a.id, b.id, c.id);

    browser = await chromium.launch();
    const context = await browser.newContext();
    const host = new URL(BASE).hostname;
    await context.addCookies(
      [...admin.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: host, path: "/" }))
    );
    const page = await context.newPage();
    await page.goto(`${BASE}/institutions`, { waitUntil: "networkidle" });

    // Narrow to our three seeded clients via the TAG in their name.
    await page.getByPlaceholder("Search by name or country…").fill(TAG);
    expect("search by TAG shows the 3 seeded clients", (await shownCount(page)) === 3);

    // ── Status: multi-select ─────────────────────────────────────────────
    await pickOption(page, "Filter by status", "Active");
    expect("Status=Active narrows to 2 (A,C)", (await shownCount(page)) === 2);
    await pickOption(page, "Filter by status", "Prospect");
    expect("Status=Active+Prospect shows all 3 (multi-select)", (await shownCount(page)) === 3);
    await clearOption(page, "Filter by status", "Clear statuses");
    expect("clearing status returns to 3", (await shownCount(page)) === 3);

    // ── Type: multi-select ───────────────────────────────────────────────
    await pickOption(page, "Filter by type", "College");
    expect("Type=College narrows to 1 (B)", (await shownCount(page)) === 1);
    await pickOption(page, "Filter by type", "University");
    expect("Type=College+University shows all 3 (multi-select)", (await shownCount(page)) === 3);
    await clearOption(page, "Filter by type", "Clear types");

    // ── Region: multi-select ─────────────────────────────────────────────
    await pickOption(page, "Filter by region", "Africa");
    expect("Region=Africa narrows to 2 (A,C)", (await shownCount(page)) === 2);
    await pickOption(page, "Filter by region", "China");
    expect("Region=Africa+China shows all 3 (multi-select)", (await shownCount(page)) === 3);

    // ── Combined Region + Status ─────────────────────────────────────────
    await pickOption(page, "Filter by status", "Active");
    expect("Region{Africa,China} + Status=Active = 2 (A,C)", (await shownCount(page)) === 2);
  } finally {
    if (browser) await browser.close();
    if (created.length) await db.institution.deleteMany({ where: { id: { in: created } } });
    await destroyUser(admin);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await db.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

run().catch(async (e) => {
  console.error("qa-institutions-filter crashed", e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});

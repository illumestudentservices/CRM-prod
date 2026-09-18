/**
 * Filters on the recruitment partners list.
 *
 *   npx tsx --env-file=.env scripts/qa-partner-filters-ui.mjs
 *
 * The page had a tab bar and an honoured `q` parameter, but nothing rendered a
 * search box, so search could only be reached by editing the URL. It now has a
 * search box plus country, agreement, region, agent tier and active-status
 * filters, all applied on the SERVER.
 *
 * WHY THE SERVER MATTERS HERE, AND WHY THIS SCRIPT CHECKS IT
 *
 * The list is capped at 300 rows and the mirror already holds 259 partners.
 * Filtering the loaded page in the browser — which is what the Institutions and
 * Students pages do — would search only the first 300 and report a partner at
 * position 301 as not existing. So each assertion below compares the rendered
 * rows against a COUNT taken straight from the database, not against the
 * previous screen.
 *
 * Read-only: this script creates no partners and changes nothing.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const PATH = "/recruitment-network/partners";
const PARTNER_TYPES = ["AGENT", "SCHOOL", "REFERRAL_PARTNER", "PARTNER", "EDUCATION_PARTNER"];
let ctx, browser;

/**
 * Data rows in the results table.
 *
 * Excludes the "No partners match the current filter" row, which is a single
 * <tr> with a colspan cell. Counting it made a correct empty result look like
 * one match.
 */
const rowCount = (page) =>
  page.locator("table tbody tr:not(:has(td[colspan]))").count();

/**
 * Waits for the URL to satisfy `pred`, then for the new server render.
 *
 * These navigations take three to four seconds against the dev server — the
 * page is force-dynamic and runs several queries per render. A fixed sleep
 * reported the tab and the clear button as broken when both worked; that is the
 * third time in this codebase a fixed wait has been mistaken for a bug.
 */
async function settle(page, pred, timeout = 20000) {
  await page.waitForURL(pred, { timeout });
  await page.waitForLoadState("networkidle", { timeout });
  await page.waitForTimeout(400);
}

async function go(page, qs) {
  await page.goto(`${BROWSER_BASE}${PATH}${qs}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  const activeBase = { deletedAt: null, isActive: true, type: { in: PARTNER_TYPES } };
  const totalActive = await db.recruitmentPartner.count({ where: activeBase });

  // ── 1. The controls exist ────────────────────────────────────────────────
  startSection("the filter bar is on the page");
  await go(page, "");

  expect(
    await page.getByLabel("Search partners").count() === 1,
    "the search box exists at last",
    "the q parameter was honoured for a long time with no input to reach it"
  );
  for (const label of ["Country", "Agreement status", "Region", "Agent tier", "Active status"]) {
    expect(await page.getByLabel(label).count() === 1, `the ${label} filter exists`);
  }

  const shown = await rowCount(page);
  expect(
    shown === Math.min(totalActive, 300),
    "the unfiltered list matches the database",
    `page shows ${shown}, database has ${totalActive} active partners`
  );

  // ── 2. Search really filters, and on the server ──────────────────────────
  startSection("search narrows the list to what the database says");

  const sample = await db.recruitmentPartner.findFirst({
    where: activeBase, select: { name: true, country: true }, orderBy: { name: "asc" },
  });
  expect(!!sample, "there is a partner to search for");

  if (sample) {
    const term = sample.name.slice(0, 6);
    const expected = await db.recruitmentPartner.count({
      where: {
        ...activeBase,
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { country: { contains: term, mode: "insensitive" } },
          { city: { contains: term, mode: "insensitive" } },
          { contactPerson: { contains: term, mode: "insensitive" } },
        ],
      },
    });

    await page.getByLabel("Search partners").fill(term);
    await settle(page, (u) => u.searchParams.has("q"));
    const got = await rowCount(page);
    expect(
      got === Math.min(expected, 300),
      "typing in the box filters the list",
      `showed ${got}, database says ${expected} for "${term}"`
    );
    expect(
      page.url().includes("q="),
      "the search is in the URL, so it survives a refresh and can be shared"
    );
  }

  // ── 3. Country, checked against the database ─────────────────────────────
  startSection("the country filter matches the database");

  const topCountry = await db.recruitmentPartner.groupBy({
    by: ["country"], where: activeBase, _count: { _all: true },
    orderBy: { _count: { country: "desc" } }, take: 1,
  });
  const country = topCountry[0]?.country;
  expect(!!country, "there is a country to filter by");

  if (country) {
    const expected = await db.recruitmentPartner.count({
      where: { ...activeBase, country },
    });
    await go(page, `?country=${encodeURIComponent(country)}`);
    const got = await rowCount(page);
    expect(
      got === Math.min(expected, 300),
      `filtering by ${country} shows exactly those partners`,
      `showed ${got}, database says ${expected}`
    );
    expect(
      expected < totalActive,
      "and that is genuinely fewer than the whole list",
      "otherwise this check would pass without the filter doing anything"
    );
  }

  // ── 4. Inactive partners are reachable at all ────────────────────────────
  // They were not: the query hard-coded isActive true with no way past it.
  startSection("deactivated partners can now be found");

  const inactiveCount = await db.recruitmentPartner.count({
    where: { deletedAt: null, isActive: false, type: { in: PARTNER_TYPES } },
  });
  await go(page, "?status=inactive");
  const inactiveShown = await rowCount(page);
  expect(
    inactiveShown === Math.min(inactiveCount, 300),
    "the inactive list matches the database",
    `showed ${inactiveShown}, database has ${inactiveCount} inactive partners`
  );

  await go(page, "?status=all");
  const allShown = await rowCount(page);
  expect(
    allShown === Math.min(totalActive + inactiveCount, 300),
    "and active-and-inactive shows both",
    `showed ${allShown}, database has ${totalActive + inactiveCount}`
  );

  // ── 5. Agent tier ────────────────────────────────────────────────────────
  startSection("the agent tier filter matches the database");

  const tierRow = await db.agentProfile.groupBy({
    by: ["tier"], _count: { _all: true },
    orderBy: { _count: { tier: "desc" } }, take: 1,
  });
  const tier = tierRow[0]?.tier;
  if (tier) {
    const expected = await db.recruitmentPartner.count({
      where: { ...activeBase, agentProfile: { tier } },
    });
    await go(page, `?tier=${tier}`);
    const got = await rowCount(page);
    expect(
      got === Math.min(expected, 300),
      `filtering by ${tier} matches the database`,
      `showed ${got}, database says ${expected}`
    );
  } else {
    expect(true, "(no agent profiles in this database, tier filter not exercised)");
  }

  // ── 6. The tab must not throw the filters away ───────────────────────────
  startSection("choosing a tab keeps the filters");

  if (country) {
    await go(page, `?country=${encodeURIComponent(country)}`);
    await page.getByRole("link", { name: /^Agents/ }).first().click();
    await settle(page, (u) => u.searchParams.get("type") === "agents");

    const url = page.url();
    expect(url.includes("type=agents"), "the tab was applied");
    expect(
      url.includes("country="),
      "and the country filter survived the click",
      `URL is ${url} — the tab links used to hard-code ?type= and drop everything else`
    );

    const expected = await db.recruitmentPartner.count({
      where: { ...activeBase, country, type: "AGENT" },
    });
    const got = await rowCount(page);
    expect(
      got === Math.min(expected, 300),
      "and the list is both filters applied together",
      `showed ${got}, database says ${expected}`
    );
  }

  // ── 7. Clearing ──────────────────────────────────────────────────────────
  startSection("clear filters puts the list back");

  await go(page, `?country=${encodeURIComponent(country ?? "")}&status=all`);
  await page.getByRole("button", { name: /clear filters/i }).first().click();
  await settle(page, (u) => !u.searchParams.has("country"));
  const cleared = await rowCount(page);
  expect(
    cleared === Math.min(totalActive, 300),
    "the full active list is back",
    `showed ${cleared}, expected ${Math.min(totalActive, 300)}`
  );

  startSection("no page errors");
  expect(pageErrors.length === 0, "no client-side errors", pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

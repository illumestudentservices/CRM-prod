/**
 * Filters on the Recruitment Planning tabs.
 *
 *   npx tsx --env-file=.env scripts/qa-planning-filters-ui.mjs
 *
 * Adds status / year / quarter / ICR / client / market filters to the plans
 * list, and the missing search box to Events and Campaigns — both of which
 * honoured a `q` parameter already but rendered no input.
 *
 * ── THE CHECK THAT MATTERS MOST ─────────────────────────────────────────────
 *
 * The plans list is ROW-SCOPED: an ICR sees only their own plans. Every filter
 * is a URL parameter, so `?icr=<someone else's id>` is a thing a curious person
 * can type. If the filter replaced the scope instead of narrowing it, that
 * single parameter would be a way around the scoping.
 *
 * So this script creates two ICRs with plans each, then asks one of them for
 * the other's plans by id and asserts it gets nothing. A filter that merely
 * "works" is not enough; it has to fail closed.
 *
 * Fixtures are created directly in the database and removed in `finally`.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
const made = [];
const planIds = [];
const campaignIds = [];
let browser;

const rowCount = (page) =>
  page.locator("table tbody tr:not(:has(td[colspan]))").count();

async function pageFor(ctx) {
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  return bctx.newPage();
}

async function go(page, path) {
  await page.goto(`${BROWSER_BASE}${path}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
}

try {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  made.push(admin);
  const icrA = await createAndLogin({ role: "ICR" });
  made.push(icrA);
  const icrB = await createAndLogin({ role: "ICR" });
  made.push(icrB);

  // ── Fixtures ─────────────────────────────────────────────────────────────
  // A: two plans, different years and statuses. B: one, so "someone else's".
  const mk = async (icrId, year, quarter, status) => {
    const row = await db.quarterlyRecruitmentPlan.create({
      data: { icrId, year, quarter, status, reportingCurrency: "USD" },
      select: { id: true },
    });
    planIds.push(row.id);
    return row.id;
  };
  await mk(icrA.user.id, 2026, 1, "DRAFT");
  await mk(icrA.user.id, 2027, 2, "APPROVED");
  await mk(icrB.user.id, 2026, 3, "DRAFT");

  const aId = icrA.user.id;
  const bId = icrB.user.id;

  const camp = await db.campaign.create({
    data: {
      name: `ZZCampaign Alpha ${stamp}`, channel: "EMAIL",
      startDate: new Date("2026-03-01"), country: "India",
      createdById: admin.user.id,
    },
    select: { id: true },
  });
  campaignIds.push(camp.id);
  const camp2 = await db.campaign.create({
    data: {
      name: `ZZCampaign Beta ${stamp}`, channel: "SOCIAL",
      startDate: new Date("2026-04-01"), country: "Kenya",
      createdById: admin.user.id,
    },
    select: { id: true },
  });
  campaignIds.push(camp2.id);

  browser = await chromium.launch();
  const adminPage = await pageFor(admin);
  const errs = [];
  adminPage.on("pageerror", (e) => errs.push(String(e)));

  // ── 1. The controls are there ────────────────────────────────────────────
  startSection("the plan filter bar renders");
  await go(adminPage, "/recruitment-planning");

  for (const label of ["Plan status", "Plan year", "Plan quarter", "Plan ICR"]) {
    expect(await adminPage.getByLabel(label).count() === 1, `the ${label} filter exists`);
  }

  const allRows = await rowCount(adminPage);
  const allPlans = await db.quarterlyRecruitmentPlan.count();
  expect(
    allRows === Math.min(allPlans, 100),
    "an admin sees every plan",
    `page ${allRows}, database ${allPlans}`
  );

  // ── 2. Each filter narrows to what the database says ─────────────────────
  startSection("the filters match the database");

  const draft = await db.quarterlyRecruitmentPlan.count({ where: { status: "DRAFT" } });
  await go(adminPage, "/recruitment-planning?status=DRAFT");
  expect(
    (await rowCount(adminPage)) === Math.min(draft, 100),
    "status narrows the list",
    `page ${await rowCount(adminPage)}, database ${draft}`
  );

  const y2027 = await db.quarterlyRecruitmentPlan.count({ where: { year: 2027 } });
  await go(adminPage, "/recruitment-planning?year=2027");
  expect(
    (await rowCount(adminPage)) === Math.min(y2027, 100),
    "year narrows the list",
    `page ${await rowCount(adminPage)}, database ${y2027}`
  );

  const q3 = await db.quarterlyRecruitmentPlan.count({ where: { quarter: 3 } });
  await go(adminPage, "/recruitment-planning?quarter=3");
  expect(
    (await rowCount(adminPage)) === Math.min(q3, 100),
    "quarter narrows the list",
    `page ${await rowCount(adminPage)}, database ${q3}`
  );

  const byA = await db.quarterlyRecruitmentPlan.count({ where: { icrId: aId } });
  await go(adminPage, `/recruitment-planning?icr=${aId}`);
  expect(
    (await rowCount(adminPage)) === Math.min(byA, 100),
    "ICR narrows the list",
    `page ${await rowCount(adminPage)}, database ${byA}`
  );

  // Two filters together, to prove they compose rather than replace.
  const both = await db.quarterlyRecruitmentPlan.count({
    where: { icrId: aId, year: 2026 },
  });
  await go(adminPage, `/recruitment-planning?icr=${aId}&year=2026`);
  expect(
    (await rowCount(adminPage)) === Math.min(both, 100),
    "two filters combine",
    `page ${await rowCount(adminPage)}, database ${both}`
  );
  expect(both < byA, "and the pair is narrower than one alone", "otherwise this proves nothing");

  // ── 3. THE IMPORTANT ONE: a filter cannot widen the scope ────────────────
  startSection("an ICR cannot use a filter to see someone else's plans");

  const icrPage = await pageFor(icrA);
  await go(icrPage, "/recruitment-planning");
  const own = await db.quarterlyRecruitmentPlan.count({ where: { icrId: aId } });
  expect(
    (await rowCount(icrPage)) === own,
    "the ICR sees their own plans",
    `page ${await rowCount(icrPage)}, database ${own}`
  );

  await go(icrPage, `/recruitment-planning?icr=${bId}`);
  expect(
    (await rowCount(icrPage)) === 0,
    "asking for another ICR's plans by id returns nothing",
    "a filter that replaced the scope instead of narrowing it would leak here"
  );

  await go(icrPage, "/recruitment-planning");
  expect(
    !(await icrPage.innerText("body")).includes(icrB.email),
    "and the other ICR is not named anywhere on the page"
  );
  expect(
    await icrPage.getByLabel("Plan ICR").count() === 0,
    "the ICR dropdown is not shown to an ICR",
    "every row is theirs, so it would offer one choice and filter nothing"
  );

  // ── 4. The search boxes that were missing ────────────────────────────────
  startSection("events and campaigns finally have a search box");

  await go(adminPage, "/recruitment-planning/events");
  expect(await adminPage.getByLabel("Search events").count() === 1, "events has a search box");

  const anyEvent = await db.event.findFirst({ select: { name: true } });
  if (anyEvent) {
    const term = anyEvent.name.slice(0, 5);
    const expected = await db.event.count({
      where: {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { city: { contains: term, mode: "insensitive" } },
          { country: { contains: term, mode: "insensitive" } },
        ],
      },
    });
    await go(adminPage, `/recruitment-planning/events?q=${encodeURIComponent(term)}`);
    expect(
      (await rowCount(adminPage)) === Math.min(expected, 300),
      "searching events matches the database",
      `page ${await rowCount(adminPage)}, database ${expected} for "${term}"`
    );
  }

  await go(adminPage, "/recruitment-planning/campaigns");
  expect(
    await adminPage.getByLabel("Search campaigns").count() === 1,
    "campaigns has a search box"
  );
  await go(adminPage, `/recruitment-planning/campaigns?q=ZZCampaign+Alpha+${stamp}`);
  expect(
    (await rowCount(adminPage)) === 1,
    "searching campaigns finds the one match",
    `page showed ${await rowCount(adminPage)} rows`
  );

  // ── 5. The status tabs must keep the search term ─────────────────────────
  startSection("a status tab does not throw the search away");

  await go(adminPage, `/recruitment-planning/campaigns?q=ZZCampaign+${stamp}`);
  const tab = adminPage.locator('a[href*="/recruitment-planning/campaigns"]').nth(1);
  const href = await tab.getAttribute("href");
  expect(
    (href ?? "").includes("q="),
    "the status tab links carry the search term",
    `first status tab href is ${href}`
  );

  startSection("no page errors");
  expect(errs.length === 0, "no client-side errors", errs.slice(0, 3).join(" | "));
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of planIds) {
    try { await db.quarterlyRecruitmentPlan.delete({ where: { id } }); } catch { /* best effort */ }
  }
  for (const id of campaignIds) {
    try { await db.campaign.delete({ where: { id } }); } catch { /* best effort */ }
  }
  for (const ctx of made) {
    try { await destroyUser(ctx); } catch { /* best effort */ }
  }
  await db.$disconnect();
  summary();
}

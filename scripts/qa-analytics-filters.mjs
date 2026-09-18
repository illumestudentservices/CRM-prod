/**
 * The analytics dashboard: every chart draws, and the filters reach all of it.
 *
 *   npx tsx --env-file=.env scripts/qa-analytics-filters.mjs
 *
 * WHAT WAS WRONG
 *
 * The date picker reached some blocks and not others. Narrowing the range to
 * two days took Total Leads from 53 to 0 and emptied Top Markets and Top
 * Sources, while the Enrollment Funnel still read 53 — two figures on one
 * screen disagreeing, with nothing to explain it. Enrolment targets were also
 * pinned to the CURRENT year regardless of the range, and "Last Year" ran from
 * 1 January last year to today, about twenty-one months.
 *
 * WHAT TO WATCH WHEN CHANGING THIS
 *
 * `icrId` is a new parameter and the route must refuse it for an ICR, whose
 * scope already pins the query to their own leads. A filter that overwrites a
 * scope instead of narrowing it is how one ICR ends up reading a colleague's
 * numbers — the same shape of bug found on the plans list. That is checked here
 * with two real ICR accounts and real leads.
 */
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
const made = [];
const leadIds = [];
let browser;

const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

try {
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  made.push(admin);
  const icrA = await createAndLogin({ role: "ICR" });
  made.push(icrA);
  const icrB = await createAndLogin({ role: "ICR" });
  made.push(icrB);

  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });
  const mkLead = async (icrId, n) => {
    const r = await api(admin.jar, "POST", "/api/leads", {
      firstName: "ZZAnalytics", lastName: `T${stamp}${n}`,
      email: `zz.an.${stamp}.${n}@example.invalid`, phone: `+1555${stamp}${n}`,
      nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "Business Administration", studyLevel: "UNDERGRADUATE",
      intakeYear: 2026, intakeMonth: 9, sourceId: source?.id,
      intendedDestination: "Canada", assignedICRId: icrId,
    });
    const id = idOf(r.payload);
    if (id) leadIds.push(id);
    return id;
  };
  await mkLead(icrA.user.id, 1);
  await mkLead(icrA.user.id, 2);
  await mkLead(icrB.user.id, 3);

  const get = async (ctx, path) => {
    const r = await api(ctx.jar, "GET", path);
    return { status: r.status, p: r.payload ?? {} };
  };

  // ── 1. The date range now reaches the funnel ─────────────────────────────
  startSection("the date picker reaches every block, including the funnel");

  const wide = await get(admin, "/api/analytics/overview");
  const narrow = await get(admin, "/api/analytics/overview?startDate=1990-01-01&endDate=1990-01-02");

  expect(wide.status === 200 && narrow.status === 200, "the overview endpoint answers");
  expect(wide.p.totalLeadsYTD > 0, "there are leads in the wide range", "otherwise nothing below proves anything");

  expect(
    narrow.p.totalLeadsYTD === 0,
    "an empty range gives no leads"
  );
  expect(
    sum(narrow.p.stageBreakdown) === 0,
    "and the funnel is empty too",
    `funnel totalled ${sum(narrow.p.stageBreakdown)} in a range with no leads — it used to ignore the date entirely`
  );
  expect(
    sum(wide.p.stageBreakdown) > 0,
    "while the wide range still fills the funnel",
    "the fix must not have simply emptied it"
  );
  expect(
    (narrow.p.topMarkets ?? []).length === 0 && (narrow.p.topSources ?? []).length === 0,
    "markets and sources follow the range as before"
  );

  // ── 2. Enrolment targets follow the year being viewed ────────────────────
  startSection("enrolment targets follow the selected year");

  const yearsWithTargets = await db.enrollmentTarget.groupBy({ by: ["year"] });
  const someYear = yearsWithTargets.map((r) => r.year).sort((a, b) => b - a)[0];
  expect(someYear !== undefined, "the database has targets for some year");

  if (someYear !== undefined) {
    const inYear = await get(
      admin,
      `/api/analytics/overview?startDate=${someYear}-01-01&endDate=${someYear}-12-31`
    );
    const expected = await db.enrollmentTarget.count({ where: { year: someYear } });
    expect(
      (inYear.p.institutionTargets ?? []).length === Math.min(expected, 15),
      `selecting ${someYear} shows that year's targets`,
      `got ${(inYear.p.institutionTargets ?? []).length}, database has ${expected} for ${someYear} — this was pinned to the current year`
    );

    const otherYear = someYear + 50;
    const none = await get(
      admin,
      `/api/analytics/overview?startDate=${otherYear}-01-01&endDate=${otherYear}-12-31`
    );
    expect(
      (none.p.institutionTargets ?? []).length === 0,
      "and a year with no targets shows none"
    );
  }

  // ── 3. The new filters narrow the numbers ────────────────────────────────
  startSection("region, client and ICR filters narrow the data");

  const byA = await get(admin, `/api/analytics/overview?icrId=${icrA.user.id}`);
  const dbA = await db.lead.count({
    where: { assignedICRId: icrA.user.id, deletedAt: null, createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) } },
  });
  expect(
    byA.p.totalLeadsYTD === dbA,
    "the ICR filter matches the database",
    `API ${byA.p.totalLeadsYTD}, database ${dbA}`
  );
  expect(byA.p.totalLeadsYTD < wide.p.totalLeadsYTD, "and it is genuinely narrower than everything");

  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (inst) {
    const byInst = await get(admin, `/api/analytics/overview?institutionId=${inst.id}`);
    const dbInst = await db.lead.count({
      where: { institutionId: inst.id, deletedAt: null, createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) } },
    });
    expect(
      byInst.p.totalLeadsYTD === dbInst,
      "the client filter matches the database",
      `API ${byInst.p.totalLeadsYTD}, database ${dbInst}`
    );
  }

  // ── 4. THE IMPORTANT ONE: an ICR cannot filter to someone else ───────────
  startSection("an ICR cannot use the new filter to read a colleague's numbers");

  const ownA = await get(icrA, "/api/analytics/overview");
  const dbOwnA = await db.lead.count({
    where: { assignedICRId: icrA.user.id, deletedAt: null, createdAt: { gte: new Date(new Date().getFullYear(), 0, 1) } },
  });
  expect(
    ownA.p.totalLeadsYTD === dbOwnA,
    "an ICR sees their own numbers",
    `API ${ownA.p.totalLeadsYTD}, database ${dbOwnA}`
  );

  const asB = await get(icrA, `/api/analytics/overview?icrId=${icrB.user.id}`);
  expect(
    asB.p.totalLeadsYTD === dbOwnA,
    "asking for a colleague's id changes nothing",
    `API returned ${asB.p.totalLeadsYTD}, their own total is ${dbOwnA} — if this matched the colleague's count the parameter would be overwriting the scope`
  );

  // ── 5. The charts actually draw ──────────────────────────────────────────
  startSection("every chart on the page draws");

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1700, height: 1400 } });
  await bctx.addCookies(
    [...admin.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(`${BROWSER_BASE}/analytics`, { waitUntil: "networkidle", timeout: 60000 });
  // Skeletons, not a fixed sleep: this page showed 32 of them at two seconds.
  for (let i = 0; i < 40; i++) {
    if ((await page.locator(".animate-pulse").count()) === 0) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1200);

  expect((await page.locator(".animate-pulse").count()) === 0, "nothing is still loading");
  expect(
    (await page.locator(".recharts-surface").count()) >= 3,
    "the recharts canvases rendered",
    `found ${await page.locator(".recharts-surface").count()}`
  );
  expect(
    (await page.locator(".recharts-bar-rectangle").count()) > 0,
    "bars are drawn",
    "an axis with no bars is the shape of a chart that silently got no data"
  );
  expect(
    (await page.locator(".recharts-line-curve").count()) > 0,
    "the trend line is drawn"
  );

  const headings = (await page.locator("h2, h3").allInnerTexts()).map((t) => t.trim());
  for (const want of [
    "Lead Volume Trend", "Enrollment Funnel", "Top 10 Markets",
    "Top 5 Sources", "Revenue", "Delivery & SLA", "Market Coverage",
    "Team Performance", "Risk & Compliance",
  ]) {
    expect(headings.some((h) => h.includes(want)), `"${want}" is on the page`);
  }

  // ── 6. The filter controls are present ───────────────────────────────────
  startSection("the new filter controls are on the page");

  for (const label of ["Date range", "Region", "Client", "ICR"]) {
    expect(await page.getByLabel(label).count() === 1, `the ${label} filter exists`);
  }

  await page.getByLabel("Date range").click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: /custom range/i }).first().click();
  await page.waitForTimeout(800);
  expect(
    await page.getByLabel("From date").count() === 1 &&
      await page.getByLabel("To date").count() === 1,
    "choosing a custom range reveals From and To"
  );

  expect(errs.length === 0, "no client-side errors", errs.slice(0, 3).join(" | "));
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of leadIds) {
    for (const run of [
      () => db.leadActivity.deleteMany({ where: { leadId: id } }),
      () => db.leadChecklistItem.deleteMany({ where: { leadId: id } }),
      () => db.lead.delete({ where: { id } }),
    ]) { try { await run(); } catch { /* best effort */ } }
  }
  for (const ctx of made) {
    try { await destroyUser(ctx); } catch { /* best effort */ }
  }
  await db.$disconnect();
  summary();
}

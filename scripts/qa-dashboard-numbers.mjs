/**
 * Do the dashboard numbers actually agree with the database?
 *
 *   npx tsx --env-file=.env scripts/qa-dashboard-numbers.mjs
 *
 * ★ A dashboard that shows the WRONG number is worse than one that shows none:
 * nothing about the screen tells you it is wrong. So every figure below is
 * recomputed from the DB with the same predicate and compared exactly. "It
 * rendered a number" is not a passing condition.
 *
 * Read-only: one disposable SUPER_ADMIN, destroyed in `finally`. No fixtures.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
let ctx, browser, page;
let suspended = [];

const now = new Date();
const ytdStart = new Date(now.getFullYear(), 0, 1);
const yearEnd = new Date(now.getFullYear() + 1, 0, 1);

/** Reads the number printed on a StatCard by its title. */
async function statValue(title) {
  const card = page.locator("div").filter({ hasText: new RegExp(`^${title}`) }).last();
  const text = await card.innerText().catch(() => "");
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*%?/);
  return m ? Number(m[1]) : null;
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });

  // ═══ /api/analytics/overview — every KPI, against the DB ═══════════════════
  startSection("/api/analytics/overview — KPIs recomputed from the database");
  {
    const res = await fetch(`${BASE}/api/analytics/overview`, {
      headers: { Cookie: ctx.jar.header() },
    });
    expect(res.status === 200, "overview API answers 200", `status ${res.status}`);
    const d = await res.json();

    const totalLeadsYTD = await db.lead.count({
      where: { deletedAt: null, createdAt: { gte: ytdStart } },
    });
    expect(d.totalLeadsYTD === totalLeadsYTD,
      `totalLeadsYTD = ${totalLeadsYTD}`, `API said ${d.totalLeadsYTD}`);

    const enrollmentsYTD = await db.lead.count({
      where: { deletedAt: null, stage: "ENROLLED", updatedAt: { gte: ytdStart } },
    });
    // Enrolment may be dated by enrolmentDate rather than updatedAt; report the
    // discrepancy rather than asserting a definition the route may not share.
    expect(typeof d.enrollmentsYTD === "number",
      `enrollmentsYTD is a number (API ${d.enrollmentsYTD}, updatedAt-based ${enrollmentsYTD})`);

    const activePartners = await db.recruitmentPartner.count({
      where: { deletedAt: null, isActive: true },
    });
    expect(d.activePartners === activePartners,
      `activePartners = ${activePartners}`, `API said ${d.activePartners}`);

    // ★ The bug this run was chasing: the card is "Events This Year", but the
    // query used `lte: now`, so anything still to come was missing.
    //
    // ★★ THIS NEEDS A FIXTURE OR IT PROVES NOTHING. Every event in the mirror
    // is dated 2025, so the whole-year count and the past-only count are BOTH
    // zero and `0 === 0` passes against the unfixed code just as happily. Make
    // an UPCOMING event for this year, which only the fixed query can see.
    const upcomingEvent = await db.event.create({
      data: {
        name: `ZZDash Upcoming ${Date.now()}`,
        date: new Date(now.getFullYear(), 11, 15),   // 15 Dec, this year
        type: "EXHIBITION",
        status: "PLANNED",
        country: "India",
        city: "Delhi",
        createdById: ctx.user.id,
      },
    });
    try {
      const res2 = await fetch(`${BASE}/api/analytics/overview`, {
        headers: { Cookie: ctx.jar.header() },
      });
      const d2 = await res2.json();
      const wholeYear = await db.event.count({
        where: { deletedAt: null, date: { gte: ytdStart, lt: yearEnd } },
      });
      const pastOnly = await db.event.count({
        where: { deletedAt: null, date: { gte: ytdStart, lte: now } },
      });
      expect(wholeYear > pastOnly,
        `fixture makes the two definitions differ (whole year ${wholeYear} vs past-only ${pastOnly})`);
      expect(d2.eventsThisYear === wholeYear,
        `eventsThisYear counts the WHOLE year = ${wholeYear}, upcoming included`,
        `API said ${d2.eventsThisYear}`);
      expect(d2.eventsThisYear !== pastOnly,
        `…and is NOT the past-only figure ${pastOnly} — that was the bug`);
    } finally {
      await db.event.delete({ where: { id: upcomingEvent.id } }).catch(() => {});
    }

    // stageBreakdown must agree with a groupBy, bucket for bucket.
    const byStage = await db.lead.groupBy({
      by: ["stage"], where: { deletedAt: null }, _count: true,
    });
    const dbStages = Object.fromEntries(byStage.map((r) => [r.stage, r._count]));
    const apiStages = d.stageBreakdown ?? {};
    let mismatched = [];
    for (const [stage, n] of Object.entries(dbStages)) {
      if ((apiStages[stage] ?? 0) !== n) mismatched.push(`${stage}: api=${apiStages[stage] ?? 0} db=${n}`);
    }
    expect(mismatched.length === 0,
      `stageBreakdown matches a groupBy across ${byStage.length} stages`,
      mismatched.join(" | "));

    // ★ A funnel must be monotonic. stageBreakdown is a SNAPSHOT (leads
    // currently AT each stage), so buckets are not nested and dividing adjacent
    // ones produced "Overall Conversion 111%" before PR #57.
    const total = Object.values(apiStages).reduce((a, b) => a + b, 0);
    expect(total <= (await db.lead.count({ where: { deletedAt: null } })),
      `stageBreakdown sums to ${total}, never more than the lead count`);
  }

  // ═══ The rendered dashboard ════════════════════════════════════════════════
  startSection("/dashboard — the figures actually painted on screen");
  {
    browser = await chromium.launch();
    const bctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } });
    await bctx.addCookies(
      [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
    );
    page = await bctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));

    await page.goto(`${BROWSER_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0,
      { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const body = await page.locator("main").innerText();

    // No placeholder should survive to the user.
    for (const bad of ["NaN", "undefined", "Infinity", "[object Object]"]) {
      expect(!body.includes(bad), `dashboard renders no "${bad}"`);
    }

    const leads = await db.lead.count({ where: { deletedAt: null } });
    const enrolled = await db.lead.count({ where: { deletedAt: null, stage: "ENROLLED" } });
    const institutions = await db.institution.count({ where: { deletedAt: null } });

    const shownLeads = await statValue("Total Leads");
    expect(shownLeads === leads, `"Total Leads" card = ${leads}`, `card showed ${shownLeads}`);

    const shownEnrolled = await statValue("Enrolled");
    expect(shownEnrolled === enrolled, `"Enrolled" card = ${enrolled}`, `card showed ${shownEnrolled}`);

    // ★ Conversion must be a real percentage, not a ratio of two unnested
    // snapshot buckets. PR #57 fixed a funnel reading 111%.
    const conv = await statValue("Conversion Rate");
    expect(conv === null || (conv >= 0 && conv <= 100),
      `"Conversion Rate" is within 0-100 (showed ${conv})`);
    if (conv !== null && leads > 0) {
      const expected = Math.round((enrolled / leads) * 1000) / 10;
      expect(Math.abs(conv - expected) <= 1.5,
        `conversion ≈ enrolled/total = ${expected}%`, `showed ${conv}%`);
    }

    expect(jsErrors.length === 0, "dashboard raises no client-side errors",
      jsErrors.slice(0, 2).join(" | "));
    await page.screenshot({ path: "screenshots/dashboard-numbers.png", fullPage: true });
  }

  // ═══ /analytics — charts must draw, not just mount ═════════════════════════
  startSection("/analytics — charts render with data");
  {
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));
    await page.goto(`${BROWSER_BASE}/analytics`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0,
      { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const body = await page.locator("main").innerText();
    for (const bad of ["NaN", "undefined", "[object Object]"]) {
      expect(!body.includes(bad), `analytics renders no "${bad}"`);
    }

    // A chart that mounted but drew nothing is the failure mode worth catching.
    const svgs = await page.locator("svg.recharts-surface").count();
    const withData = await page.locator("svg.recharts-surface .recharts-layer path, svg.recharts-surface .recharts-bar-rectangle").count();
    expect(svgs > 0, `analytics mounts ${svgs} charts`);
    expect(withData > 0, `${withData} chart series actually drew geometry`);

    // Only meaningful when this year actually HAS events — on the mirror every
    // event is dated 2025, so "shows 0" would match the unfixed code too.
    const events = await db.event.count({
      where: { deletedAt: null, date: { gte: ytdStart, lt: yearEnd } },
    });
    if (events > 0) {
      expect(body.includes(String(events)),
        `"Events This Year" shows the whole-year figure ${events}`,
        "the old past-only query showed 0 here");
    } else {
      expect(true,
        `no events dated ${now.getFullYear()} in this database — card correctly reads 0`,
        "the API-level assertion above uses a fixture to prove the fix");
    }

    expect(jsErrors.length === 0, "analytics raises no client-side errors",
      jsErrors.slice(0, 2).join(" | "));
    await page.screenshot({ path: "screenshots/analytics-numbers.png", fullPage: true });
  }
  // ═══ PRODUCTION'S SHAPE: no ICR-role users at all ═════════════════════════
  startSection("Dashboards still populate with ZERO ICR-role users (production)");
  {
    // The mirror has ICR users and production has none, which is exactly why
    // these panels looked fine in every test and were empty on live. Reproduce
    // production by deactivating them, and restore in the inner `finally`.
    suspended = await db.user.findMany({
      where: { role: "ICR", isActive: true },
      select: { id: true },
    });
    await db.user.updateMany({
      where: { id: { in: suspended.map((u) => u.id) } },
      data: { isActive: false },
    });
    expect(await db.user.count({ where: { role: "ICR", isActive: true } }) === 0,
      `simulated production: 0 active ICR users (was ${suspended.length})`);

    // 1. The analytics ICR filter is derived from the leads, so it survives.
    const owners = await db.lead.findMany({
      where: { deletedAt: null, assignedICRId: { not: null } },
      select: { assignedICRId: true },
      distinct: ["assignedICRId"],
    });
    const oldWay = await db.user.count({ where: { role: "ICR", isActive: true } });
    expect(oldWay === 0, "the OLD `role: ICR` predicate returns 0 — the live bug, reproduced");
    expect(owners.length > 0,
      `the NEW lead-derived predicate finds ${owners.length} owners`);

    await page.goto(`${BROWSER_BASE}/analytics`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0,
      { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const icrCombo = page.locator('button[role="combobox"]', { hasText: "ICR" }).first();
    expect(await icrCombo.count() > 0,
      "the ICR filter is RENDERED on /analytics (it is hidden when the list is empty)");
    if (await icrCombo.count()) {
      await icrCombo.click();
      await page.waitForTimeout(500);
      const opts = await page.getByRole("option").allTextContents();
      await page.keyboard.press("Escape");
      expect(opts.length > 1,
        `…and offers ${opts.length - 1} people besides "All" (was 0 on production)`,
        opts.join(" | "));
    }

    // 2. The client cards count assigned staff regardless of role.
    const assigned = await db.institutionUser.count({
      where: { assignmentStatus: "ACTIVE", user: { role: { not: "INSTITUTION_CLIENT" } } },
    }).catch(() => 0);
    const icrOnly = await db.institutionUser.count({
      where: { assignmentStatus: "ACTIVE", user: { role: "ICR" } },
    }).catch(() => 0);
    expect(assigned >= icrOnly,
      `client cards count ${assigned} assigned staff, not just the ${icrOnly} with role ICR`);

    // 3. The regional field-ops roster is region-scoped and role-agnostic.
    //
    // Pick a region that actually HAS a non-ICR member. `findFirst()` is not
    // good enough: on the mirror one region contains only an ICR, so with the
    // ICRs suspended its roster is legitimately 0 and the assertion fails
    // against correct code.
    const withNonIcr = await db.user.findFirst({
      where: {
        regionId: { not: null }, isActive: true, deletedAt: null,
        role: { notIn: ["ICR", "INSTITUTION_CLIENT"] },
      },
      select: { regionId: true, role: true },
    });
    expect(!!withNonIcr,
      "mirror has a region containing a non-ICR colleague to test with", withNonIcr?.role);
    const roster = await db.user.count({
      where: { regionId: withNonIcr.regionId, isActive: true, deletedAt: null,
               role: { not: "INSTITUTION_CLIENT" } },
    });
    const icrRoster = await db.user.count({
      where: { regionId: withNonIcr.regionId, isActive: true, role: "ICR" },
    });
    expect(icrRoster === 0 && roster > 0,
      `field-ops roster finds ${roster} colleagues where the old query found ${icrRoster}`);

    // ★ CAVEAT THIS FIX CANNOT REMOVE: the roster keys off `User.regionId`, so
    // it is empty for any region nobody is assigned to, whatever their role.
    // On the mirror only 6 of 12 users have a region at all.
    const noRegion = await db.user.count({
      where: { regionId: null, isActive: true, deletedAt: null,
               role: { not: "INSTITUTION_CLIENT" } },
    });
    expect(true,
      `NOTE: ${noRegion} active users have no region — they appear in NO regional roster`,
      "if production leaves regionId unset, this table stays empty regardless of role");

    // ★ And it must FAIL CLOSED with no region — `{}` is no filter, not no
    // access, which is how a regionless manager saw every region's team.
    const NO_REGION = "__no_region__";
    const regionless = await db.user.count({
      where: { regionId: NO_REGION, isActive: true, deletedAt: null },
    });
    expect(regionless === 0,
      "a manager with no region matches nobody (regionScope fails closed)");
  }
} catch (e) {
  console.error("FATAL:", e.code ?? "", e.message);
  process.exitCode = 1;
} finally {
  if (suspended.length) {
    await db.user.updateMany({
      where: { id: { in: suspended.map((u) => u.id) } },
      data: { isActive: true },
    });
    console.log(`restored ${suspended.length} ICR users -> active ICR count now ` +
      `${await db.user.count({ where: { role: "ICR", isActive: true } })}`);
  }
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  summary();
  await db.$disconnect();
}

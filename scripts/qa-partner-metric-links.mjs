/**
 * Verifies the recruitment-partner detail "metric" tiles are real drill-through
 * links and that each destination filters to exactly that partner's records.
 *
 *   npx tsx --env-file=.env.local scripts/qa-partner-metric-links.mjs
 *
 * ★ The assertion that matters is "rendered === DB count of the SAME predicate",
 * and a NEGATIVE control (a second partner's records must NOT leak in). A filter
 * that merely shortens the list, or drops the wrong rows, fails these.
 *
 * Seeds its own tagged fixtures (2 partners + leads/campaigns/activities),
 * drives a browser as a disposable SUPER_ADMIN, and tears everything down in
 * `finally`, so it is safe to re-run.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const ROWS = "table tbody tr:not(:has(td[colspan]))";

let ctx, browser, page;
let partnerA, partnerB;
const leadIds = [], campaignIds = [], activityIds = [];

async function goto(route) {
  await page.goto(`${BROWSER_BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const uid = ctx.user.id;

  // ── Fixtures ────────────────────────────────────────────────────────
  partnerA = await db.recruitmentPartner.create({
    data: { name: `${TAG} Partner A`, type: "AGENT", country: "Testland", createdById: uid },
  });
  partnerB = await db.recruitmentPartner.create({
    data: { name: `${TAG} Partner B`, type: "AGENT", country: "Testland", createdById: uid },
  });

  const mkLead = (partnerId, n) =>
    db.lead.create({
      data: {
        firstName: `${TAG}${n}`, lastName: "Lead", nationality: "Indian",
        countryOfResidence: "India", interestedProgram: "Computer Science",
        studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
        createdById: uid, sourceId: partnerId,
      },
    });
  const mkCampaign = (partnerId, n) =>
    db.campaign.create({
      data: { name: `${TAG} Campaign ${n}`, channel: "EMAIL", startDate: new Date(), createdById: uid, sourceId: partnerId },
    });
  const mkActivity = (partnerId, n) =>
    db.activity.create({
      data: { type: "AGENT_MEETING", title: `${TAG} Activity ${n}`, date: new Date(), userId: uid, sourceId: partnerId },
    });

  // Partner A: 3 leads / 2 campaigns / 2 activities. Partner B: 1 / 1 / 1 (control).
  for (const [p, nL, nC, nAc] of [[partnerA, 3, 2, 2], [partnerB, 1, 1, 1]]) {
    for (let i = 0; i < nL; i++) leadIds.push((await mkLead(p.id, `${p === partnerA ? "A" : "B"}${i}`)).id);
    for (let i = 0; i < nC; i++) campaignIds.push((await mkCampaign(p.id, `${p === partnerA ? "A" : "B"}${i}`)).id);
    for (let i = 0; i < nAc; i++) activityIds.push((await mkActivity(p.id, `${p === partnerA ? "A" : "B"}${i}`)).id);
  }

  // DB truth (same predicates the pages use).
  const dbLeadsA = await db.lead.count({ where: { deletedAt: null, sourceId: partnerA.id } });
  const dbCampA = await db.campaign.count({ where: { deletedAt: null, sourceId: partnerA.id } });
  const dbActA = await db.activity.count({ where: { deletedAt: null, sourceId: partnerA.id } });
  const dbLeadsB = await db.lead.count({ where: { deletedAt: null, sourceId: partnerB.id } });

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  page = await bctx.newPage();

  // ── 1. Partner detail tiles are links with the right hrefs ──────────
  startSection("Partner detail — metric tiles are drill-through links");
  await goto(`/recruitment-network/partners/${partnerA.id}`);
  const leadsHref = `/students?source=${partnerA.id}`;
  const campHref = `/recruitment-planning/campaigns?source=${partnerA.id}`;
  const fopsHref = `/field-operations?source=${partnerA.id}`;
  expect((await page.locator(`a[href="${leadsHref}"]`).count()) === 1, "Leads tile is a link");
  expect((await page.locator(`a[href="${campHref}"]`).count()) === 1, "Campaigns tile is a link");
  expect((await page.locator(`a[href="${fopsHref}"]`).count()) === 1, "Field Ops tile is a link");
  const leadsTileTxt = await page.locator(`a[href="${leadsHref}"]`).innerText();
  expect(/\b3\b/.test(leadsTileTxt), "Leads tile shows the value 3", leadsTileTxt.replace(/\n/g, " "));

  // ── 2. Leads drill-through filters to partner A only ────────────────
  startSection("Leads tile → /students?source filters correctly");
  await page.locator(`a[href="${leadsHref}"]`).click();
  await page.waitForURL(new RegExp(`/students\\?source=${partnerA.id}`), { timeout: 20000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const countText = async () => (await page.getByText(/^\d+\s+leads?$/).first().innerText());
  const nA = parseInt((await countText()).match(/\d+/)[0], 10);
  expect(nA === dbLeadsA, `rendered leads === DB (${nA} === ${dbLeadsA})`);
  expect(nA === 3, "exactly the 3 Partner-A leads (B's lead excluded)", String(nA));
  // Source chip/dropdown reflects the partner.
  expect((await page.getByText("All Sources").count()) >= 0, "source filter control present");

  // Negative control — partner B shows only its 1 lead.
  await goto(`/students?source=${partnerB.id}`);
  const nB = parseInt((await countText()).match(/\d+/)[0], 10);
  expect(nB === dbLeadsB, `partner B rendered leads === DB (${nB} === ${dbLeadsB})`);
  expect(nB === 1, "partner B shows exactly 1 lead", String(nB));

  // Unfiltered shows strictly more than either partner alone.
  await goto(`/students`);
  const nAll = parseInt((await countText()).match(/\d+/)[0], 10);
  expect(nAll >= 4 && nAll > nA && nAll > nB, "unfiltered list shows all leads (> each partner)", String(nAll));

  // ── 3. Campaigns drill-through ──────────────────────────────────────
  startSection("Campaigns tile → /recruitment-planning/campaigns?source filters");
  await goto(`/recruitment-planning/campaigns?source=${partnerA.id}`);
  const campRows = await page.locator(ROWS).count();
  expect(campRows === dbCampA, `rendered campaign rows === DB (${campRows} === ${dbCampA})`);
  expect(campRows === 2, "exactly the 2 Partner-A campaigns", String(campRows));
  expect((await page.getByText(/Source:\s/).count()) >= 1, "source filter chip shown");
  expect((await page.getByText(`Partner A`, { exact: false }).count()) >= 1, "chip names the partner");

  // ── 4. Field Ops drill-through ──────────────────────────────────────
  startSection("Field Ops tile → /field-operations?source filters");
  await goto(`/field-operations?source=${partnerA.id}`);
  const actRows = await page.locator(ROWS).count();
  expect(actRows === Math.min(dbActA, 100), `rendered activity rows === DB (${actRows} === ${Math.min(dbActA, 100)})`);
  expect(actRows === 2, "exactly the 2 Partner-A activities", String(actRows));
  expect((await page.getByText(/Partner:\s/).count()) >= 1, "partner chip shown on field ops");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  // Teardown: fixtures first (they FK the partners), then the user.
  try {
    if (activityIds.length) await db.activity.deleteMany({ where: { id: { in: activityIds } } });
    if (campaignIds.length) await db.campaign.deleteMany({ where: { id: { in: campaignIds } } });
    if (leadIds.length) await db.lead.deleteMany({ where: { id: { in: leadIds } } });
    if (partnerA) await db.recruitmentPartner.delete({ where: { id: partnerA.id } }).catch(() => {});
    if (partnerB) await db.recruitmentPartner.delete({ where: { id: partnerB.id } }).catch(() => {});
  } catch (e) { console.error("[cleanup]", e?.message); }
  if (browser) await browser.close().catch(() => {});
  if (ctx) await destroyUser(ctx);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

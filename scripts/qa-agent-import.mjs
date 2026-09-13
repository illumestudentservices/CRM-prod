/**
 * Checks that the imported agent database is actually on screen.
 *
 *   npx tsx --env-file=.env scripts/qa-agent-import.mjs
 *
 * Drives the real pages rather than the API, because the count that matters is
 * the one a person sees. The Partners page caps its list at `take: 300` while
 * the tab-bar count comes from an uncapped groupBy, so the two can disagree
 * without anything on screen saying so — that disagreement is asserted here.
 *
 * NOTE: localhost, never 127.0.0.1. On the IP, Next 16 treats the request as
 * cross-origin dev, the HMR socket fails, React never hydrates, and every
 * client panel sits on "Loading…" while the page still returns 200.
 */
import { chromium } from "playwright";
import { BASE, db, createAndLogin, destroyUser, startSection, ok, fail, expect, summary } from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");

let ctx;
let browser;

try {
  startSection("data");

  const agents = await db.recruitmentPartner.count({ where: { type: "AGENT", deletedAt: null, isActive: true } });
  const contacts = await db.partnerContact.count();
  ok(`AGENT rows in the database: ${agents}`);
  ok(`partner_contacts rows: ${contacts}`);

  // The silent-truncation guard. Harmless while agents < 300; the point is that
  // it stops being harmless without warning, so it fails loudly here first.
  expect(
    agents <= 300,
    "agent count is within the page's take: 300 cap",
    `${agents} agents but the Partners page only ever fetches 300 — the tab bar would say ${agents} while the list showed 300`
  );

  const noEmail = await db.recruitmentPartner.count({
    where: { type: "AGENT", deletedAt: null, email: null },
  });
  ok(`agents with no email address: ${noEmail} (expected: the 2 the sheet leaves blank)`);

  const noRegion = await db.recruitmentPartner.count({
    where: { type: "AGENT", deletedAt: null, regionId: null },
  });
  expect(noRegion === 0, "every imported agent has a region", `${noRegion} have none`);

  startSection("browser");

  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const browserCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await browserCtx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await browserCtx.newPage();

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BROWSER_BASE}/recruitment-network/partners?tab=agents`, { waitUntil: "networkidle" });

  const body = await page.locator("body").innerText();

  // A handful of agencies chosen because each one exercised a different repair.
  const mustAppear = [
    ["Abhinav Outsourcings Pvt Ltd.", "plain India row"],
    ["Canrelocate Immigration Consulting Ltd", "dual-country row, filed under Canada"],
    ["Alpha Study Group", "country typo Cameron → Cameroon"],
    ["Global Edmissions FZC", "country Dubai → UAE"],
    ["Uniserve Education", "five addresses, four became contacts"],
    ["Explore Career", "one address unusable, the other kept"],
  ];
  for (const [name, why] of mustAppear) {
    expect(body.includes(name), `on screen: ${name}`, `not rendered — ${why}`);
  }

  expect(errors.length === 0, "no page errors", errors.join(" | "));

  // Detail page: do the extra addresses actually show as contacts?
  const uniserve = await db.recruitmentPartner.findFirst({
    where: { name: "Uniserve Education", type: "AGENT" },
    select: { id: true, _count: { select: { partnerContacts: true } } },
  });
  await page.goto(`${BROWSER_BASE}/recruitment-network/partners/${uniserve.id}`, { waitUntil: "networkidle" });
  const detail = await page.locator("body").innerText();
  expect(
    detail.includes("catherine@uniserveducation.com"),
    "the extra addresses render on the partner detail page",
    "contact rows exist in the database but are not on screen"
  );
  ok(`Uniserve Education has ${uniserve._count.partnerContacts} contact rows`);
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

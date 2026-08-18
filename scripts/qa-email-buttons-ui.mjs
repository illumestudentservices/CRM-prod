/**
 * The email controls on the monthly report, seen in a browser.
 *
 *   node --import tsx --env-file=.env scripts/qa-email-buttons-ui.mjs
 *
 * The API refusing an ICR is only half of it. Before this change the buttons
 * were rendered for everyone, so a rep could open the dialog, type a recipient
 * and a covering note, press send, and only then be told no. An action a role
 * cannot perform should not be on their screen at all.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

let icr, rm;
const made = { region: null, institution: null, reportId: null };

async function signIn(page, acct) {
  const row = await db.user.findUnique({
    where: { id: acct.user.id }, select: { twoFactorSecret: true },
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator('input[type="email"]').fill(acct.email);
  await page.locator('input[type="password"]').fill(acct.password);
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"]')?.hasAttribute("disabled"),
    { timeout: 20000 }
  );
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/verify-2fa/, { timeout: 30000 });
  await page.locator('input[inputmode="numeric"]').fill(await totpGenerate(row.twoFactorSecret));
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !/verify-2fa|login/.test(u.pathname), { timeout: 30000 });
}

/** Every email control on the page: the header button plus the per-section ones. */
async function emailControlCount(page) {
  return page.getByRole("button", { name: /email/i }).count();
}

async function cleanup() {
  if (made.reportId) await db.monthlyReport.deleteMany({ where: { id: made.reportId } }).catch(() => {});
  if (made.institution) await db.institution.deleteMany({ where: { id: made.institution.id } }).catch(() => {});
  for (const ctx of [icr, rm]) await destroyUser(ctx).catch(() => {});
  if (made.region) await db.region.deleteMany({ where: { id: made.region.id } }).catch(() => {});
}

const browser = await chromium.launch();

try {
  startSection("Setup");
  made.region = await db.region.create({ data: { name: `${TAG} Region`, code: TAG.slice(0, 6) } });
  icr = await createAndLogin({ role: "ICR", extra: { regionId: made.region.id } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: made.region.id } });
  made.institution = await db.institution.create({
    data: { name: `${TAG} College`, country: "Canada", type: "COLLEGE", createdById: icr.user.id, regionId: made.region.id },
  });
  const report = await db.monthlyReport.create({
    data: {
      icrId: icr.user.id, institutionId: made.institution.id, regionId: made.region.id,
      reportingMonth: 6, reportingYear: 2026, status: "FINAL_APPROVED",
      kpiSummary: { totalLeads: 3, enrolled: 1, conversionRate: 33.3, contactRate: 100, eventsCount: 0, totalEventCost: 0 },
      leadsData: [{ firstName: "Ada", lastName: "Obi", nationality: "Nigerian", interestedProgram: "Business", studyLevel: "UNDERGRADUATE", stage: "ENROLLED" }],
      engagementNotes: "Steady month.",
    },
    select: { id: true },
  });
  made.reportId = report.id;
  ok("report seeded, owned by the ICR, in the manager's region");

  // ── The rep ─────────────────────────────────────────────────────────────
  startSection("What the ICR sees");
  const icrCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const icrPage = await icrCtx.newPage();
  await signIn(icrPage, icr);
  await icrPage.goto(`${BASE}/reports/${made.reportId}`, { waitUntil: "networkidle", timeout: 45000 });

  const icrBody = await icrPage.locator("body").innerText();
  expect(icrBody.includes(`${TAG} College`), "the ICR can open their own report", icrBody.slice(0, 80));

  const icrEmailButtons = await emailControlCount(icrPage);
  expect(icrEmailButtons === 0,
    "*** no email control is offered to the ICR anywhere on the page ***",
    `${icrEmailButtons} still rendered`);
  expect(!/Email Report/i.test(icrBody),
    "*** the header 'Email Report' button is gone ***");

  // The rest of the page must be untouched — this hides one action, it does not
  // take the report away.
  expect(/Key Performance Indicators/i.test(icrBody), "the KPI section still renders");
  expect(/Leads Collected/i.test(icrBody), "the leads table still renders");
  expect(/Steady month/i.test(icrBody), "the narrative sections still render");

  // ── The manager ─────────────────────────────────────────────────────────
  startSection("What the Regional Manager sees");
  const rmCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const rmPage = await rmCtx.newPage();
  await signIn(rmPage, rm);
  await rmPage.goto(`${BASE}/reports/${made.reportId}`, { waitUntil: "networkidle", timeout: 45000 });

  const rmBody = await rmPage.locator("body").innerText();
  const rmEmailButtons = await emailControlCount(rmPage);
  expect(rmEmailButtons > 0,
    "*** the manager still has the email controls ***", `${rmEmailButtons} found`);
  expect(/Email Report/i.test(rmBody), "including the whole-report button");

  // And the dialog still opens and asks for a recipient.
  await rmPage.getByRole("button", { name: /Email Report/i }).first().click();
  await rmPage.waitForTimeout(600);
  const dialog = await rmPage.locator("[role=dialog]").innerText().catch(() => "");
  expect(/recipient|to\b|email/i.test(dialog),
    "and the compose dialog opens for them", dialog.slice(0, 100).replace(/\n/g, " "));
} catch (e) {
  fail("run completed", String(e?.message ?? e).slice(0, 300));
} finally {
  await browser.close();
  await cleanup();
  startSection("Cleanup");
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } }).catch(() => -1);
  expect(left === 0, "no test users left behind", `${left} remaining`);
  summary();
  await db.$disconnect();
}

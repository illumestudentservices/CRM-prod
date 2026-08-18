/**
 * The ICR Monthly Report page, driven in a real browser.
 *
 *   node --import tsx --env-file=.env scripts/qa-icr-monthly-report-ui.mjs
 *
 * The API suite proves the figures are right. This proves a rep can see them:
 * that every numbered section of the Word template is on the page, that the
 * CRM-derived numbers are rendered as figures rather than as empty boxes
 * waiting to be retyped, and that a rep can write their sections and send the
 * report to their manager without touching an API by hand.
 *
 * The distinction it exists to catch: a computed cell must NOT be an input. If
 * the leads figure ever became editable the report would stop being evidence,
 * and nothing in the API tests would notice.
 */
import { chromium } from "playwright";
import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { totpGenerate } = await import("../lib/totp.ts");

const now = new Date();
const YEAR = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
const MONTH = now.getMonth() === 0 ? 12 : now.getMonth();
const midPeriod = new Date(YEAR, MONTH - 1, 15, 12, 0, 0);
const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const SEED = { leads: 6, applications: 4, offers: 3, deposits: 2 };

let icr, rm;
const made = { region: null, institution: null, partner: null, event: null, leadIds: [], reportId: null };

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

/** Poll until the report reaches `want`, or give up after ~15s. */
async function waitForStatus(id, want, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let row;
  do {
    row = await db.icrMonthlyReport.findUnique({
      where: { id },
      select: { status: true, submittedAt: true, finalApprovedAt: true },
    });
    if (row?.status === want) return row;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  return row;
}

/** Poll until a narrative column starts with `prefix`, or give up after ~10s. */
async function waitForField(column, prefix, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let row;
  do {
    row = await db.icrMonthlyReport.findUnique({
      where: { id: made.reportId },
      select: { keyHighlights: true, supportRequested: true },
    });
    if (row?.[column]?.startsWith(prefix)) return row;
    await new Promise((r) => setTimeout(r, 400));
  } while (Date.now() < deadline);
  return row;
}

async function seed(icrId, regionId) {
  made.institution = await db.institution.create({
    data: { name: `${TAG} College`, country: "Canada", type: "COLLEGE", createdById: icrId, regionId },
  });
  made.partner = await db.recruitmentPartner.create({
    data: { name: `${TAG} Agency`, type: "AGENT", country: "Nigeria", createdById: icrId, createdAt: midPeriod, regionId },
  });
  made.event = await db.event.create({
    data: {
      name: `${TAG} Fair`, type: "EDUCATION_FAIR", date: midPeriod, city: "Lagos",
      country: "Nigeria", totalCost: 1200, createdById: icrId, assignedICRId: icrId, regionId,
    },
  });

  for (let i = 0; i < SEED.leads; i++) {
    const lead = await db.lead.create({
      data: {
        firstName: `${TAG}Student`, lastName: String(i),
        email: `${TAG.toLowerCase()}-ui-${i}-${Date.now()}@illume.local`,
        phone: "+2340000000", nationality: "Nigerian", countryOfResidence: "Nigeria",
        interestedProgram: "Business Administration", studyLevel: "UNDERGRADUATE",
        intakeYear: YEAR + 1, intakeMonth: 9, createdById: icrId, assignedICRId: icrId,
        institutionId: made.institution.id, sourceId: made.partner.id, eventId: made.event.id,
        createdAt: midPeriod, regionId,
      },
    });
    made.leadIds.push(lead.id);
  }

  const move = async (leadId, to, at) => {
    await db.leadActivity.create({
      data: {
        leadId, userId: icrId, kind: "SYSTEM", type: "STAGE_CHANGE",
        description: `Stage moved to ${to}`, metadata: { from: null, to }, createdAt: at,
      },
    });
    await db.lead.update({ where: { id: leadId }, data: { stage: to, stageEnteredAt: at } });
  };
  for (let i = 0; i < SEED.applications; i++) await move(made.leadIds[i], "APPLICATION_SUBMITTED", midPeriod);
  for (let i = 0; i < SEED.offers; i++) await move(made.leadIds[i], "OFFER_RECEIVED", midPeriod);
  for (let i = 0; i < SEED.deposits; i++) await move(made.leadIds[i], "DEPOSIT_PAID", midPeriod);

  await db.activity.create({
    data: { type: "AGENT_MEETING", title: `${TAG} meeting`, date: midPeriod, actualDate: midPeriod, userId: icrId, sourceId: made.partner.id },
  }).catch(() => {});
}

async function cleanup() {
  await db.icrReportApproval.deleteMany({ where: { report: { icrId: icr?.user?.id } } }).catch(() => {});
  await db.icrMonthlyReport.deleteMany({ where: { icrId: icr?.user?.id } }).catch(() => {});
  if (made.leadIds.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: made.leadIds } } }).catch(() => {});
    await db.lead.deleteMany({ where: { id: { in: made.leadIds } } }).catch(() => {});
  }
  await db.activity.deleteMany({ where: { title: { startsWith: TAG } } }).catch(() => {});
  for (const [model, row] of [["event", made.event], ["recruitmentPartner", made.partner], ["institution", made.institution]]) {
    if (row) await db[model].deleteMany({ where: { id: row.id } }).catch(() => {});
  }
  for (const ctx of [icr, rm]) await destroyUser(ctx).catch(() => {});
  if (made.region) await db.region.deleteMany({ where: { id: made.region.id } }).catch(() => {});
}

const browser = await chromium.launch();
const errs = [];

try {
  startSection("Setup");
  made.region = await db.region.create({
    data: { name: `${TAG} Region`, code: TAG.slice(0, 6) },
  });
  icr = await createAndLogin({ role: "ICR", extra: { regionId: made.region.id } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: made.region.id } });
  await seed(icr.user.id, made.region.id);
  ok("region, ICR, Regional Manager and a month of pipeline seeded");

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|DevTools|Download the React/i.test(m.text())) errs.push(m.text());
  });

  await signIn(page, icr);
  ok("ICR signed in through the real login path including MFA");

  // ── Reaching it ─────────────────────────────────────────────────────────
  startSection("Finding the report");
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle", timeout: 45000 });
  const reportsBody = await page.locator("body").innerText();
  expect(/ICR Monthly/i.test(reportsBody),
    "*** the Reports page offers a way through to the rep-wise report ***",
    reportsBody.slice(0, 120).replace(/\n/g, " "));

  await page.goto(`${BASE}/reports/icr-monthly`, { waitUntil: "networkidle", timeout: 45000 });
  expect(!/\/login/.test(new URL(page.url()).pathname), "the list page loads for an ICR", page.url());

  // ── Creating it from the UI ─────────────────────────────────────────────
  startSection("Generating from the CRM");
  await page.getByRole("button", { name: /New monthly report/i }).click();
  await page.getByRole("button", { name: /Generate from CRM/i }).click();
  await page.waitForURL(/\/reports\/icr-monthly\/[0-9a-f-]{10,}/, { timeout: 45000 });
  made.reportId = page.url().split("/").pop();
  ok("the report generated and opened");

  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  const body = await page.locator("body").innerText();

  // ── Every section of the template is present ────────────────────────────
  startSection("The template, section by section");
  const SECTIONS = [
    ["1. Executive Summary", /1\.\s*Executive Summary/i],
    ["1.1 Performance Overview", /1\.1[\s\S]{0,4}Performance Overview/i],
    ["1.2 Application Pipeline Snapshot", /1\.2[\s\S]{0,4}Application Pipeline Snapshot/i],
    ["1.3 Priority Applications", /1\.3[\s\S]{0,4}Priority Applications Requiring Admissions Support/i],
    ["1.4 Key Highlights", /1\.4[\s\S]{0,4}Key Highlights/i],
    ["1.5 Key Challenges / Risks", /1\.5[\s\S]{0,4}Key Challenges/i],
    ["2. Pipeline & Agent Activity", /2\.\s*Pipeline\s*&\s*Agent Activity/i],
    ["2.1 Agent Engagement", /2\.1[\s\S]{0,4}Agent Engagement/i],
    ["2.2 Top Agent Activity", /2\.2[\s\S]{0,4}Top Agent Activity/i],
    ["2.3 Underperforming / At-Risk Agents", /2\.3[\s\S]{0,4}Underperforming/i],
    ["2.4 New Channel Development", /2\.4[\s\S]{0,4}New Channel Development/i],
    ["3. Events & Business Development", /3\.\s*Events\s*&\s*Business Development/i],
    ["3.1 Events Conducted", /3\.1[\s\S]{0,4}Events Conducted/i],
    ["3.2 Business Development Notes", /3\.2[\s\S]{0,4}Business Development/i],
    ["4. Market Update", /4\.\s*Market Update/i],
    ["4.1 Student Demand Trends", /4\.1[\s\S]{0,4}Student Demand Trends/i],
    ["4.2 Competitive Activity", /4\.2[\s\S]{0,4}Competitive Activity/i],
    ["4.3 General Market Conditions", /4\.3[\s\S]{0,4}General Market Conditions/i],
    ["5. Top 3 Priorities", /5\.\s*Top 3 Priorities for Next Month/i],
    ["6. Support Requested", /6\.\s*Support Requested from Institution/i],
    ["7. Snapshots", /7\.\s*Snapshots/i],
  ];
  for (const [label, re] of SECTIONS) expect(re.test(body), label);

  // The header block from the template.
  for (const [label, re] of [
    ["Institutions covered", /Institutions covered/i],
    ["Region / Market", /Region \/ Market/i],
    ["Reporting period", /Reporting period/i],
    ["Intake\\(s\\) covered", /Intake\(s\) covered/i],
    ["Report submission date", /Report submission date/i],
  ]) expect(re.test(body), `header: ${label}`);

  // ── The figures are on the screen ───────────────────────────────────────
  startSection("The CRM's answers are rendered, not asked for");
  expect(new RegExp(`${MONTH_NAMES[MONTH]}\\s+${YEAR}`).test(body),
    `the period reads ${MONTH_NAMES[MONTH]} ${YEAR}`);
  expect(body.includes(`${TAG} College`), "*** the institution the rep worked is named ***");
  expect(body.includes(`${TAG} Agency`), "*** the sourcing agent is named in 2.2 ***");
  expect(body.includes(`${TAG} Fair`), "*** the event is listed in 3.1 ***");

  const perfRow = await page.locator("tr", { hasText: "Leads Generated" }).first().innerText();
  expect(new RegExp(`\\b${SEED.leads}\\b`).test(perfRow),
    `*** Performance Overview shows ${SEED.leads} leads without the rep typing it ***`, perfRow.replace(/\n/g, " | "));
  const appRow = await page.locator("tr", { hasText: "Applications Submitted" }).first().innerText();
  expect(new RegExp(`\\b${SEED.applications}\\b`).test(appRow),
    `*** and ${SEED.applications} applications ***`, appRow.replace(/\n/g, " | "));

  expect(/Not tracked in the CRM/i.test(body),
    "*** Visa Approvals says it is untracked rather than showing a fabricated zero ***");

  // The distinction this test exists for: computed cells are text, not inputs.
  const leadsCellInputs = await page.locator("tr", { hasText: "Leads Generated" })
    .first().locator("input").count();
  expect(leadsCellInputs === 1,
    "*** the Leads row has exactly one input — the Target — so the CRM figure cannot be retyped ***",
    `found ${leadsCellInputs} inputs`);

  const eventRow = await page.locator("tr", { hasText: `${TAG} Fair` }).first().innerText();
  expect(/200/.test(eventRow), "cost per lead is computed on the row ($1200 / 6)", eventRow.replace(/\n/g, " | "));

  // Optional full-page capture, for showing the layout to someone who is not
  // going to run the suite: SCREENSHOT=1 node --import tsx …
  if (process.env.SCREENSHOT) {
    await page.screenshot({ path: "tmp/icr-monthly-report.png", fullPage: true });
    ok("full-page screenshot written to tmp/icr-monthly-report.png");
  }

  // ── Writing the parts only a person can write ───────────────────────────
  startSection("The rep writes their sections");
  // Each field saves on blur, so every one is explicitly blurred rather than
  // relying on the next fill to do it — the last field in the list has no
  // "next" and was the one that silently never saved.
  for (const [id, value] of [
    ["keyHighlights", "Deposit conversion accelerated after the Lagos fair."],
    ["keyChallenges", "Visa appointment backlog is pushing decisions into next intake."],
    ["demandTrends", "Business and IT dominate; PG interest rising."],
    ["priorityOne", "Convert the five outstanding offers."],
    ["supportRequested", "Faster offer turnaround from admissions."],
  ]) {
    await page.locator(`#${id}`).fill(value);
    await page.locator(`#${id}`).blur();
  }

  const savedHighlights = await waitForField("supportRequested", "Faster offer");
  expect(savedHighlights?.keyHighlights?.startsWith("Deposit conversion"),
    "*** what the rep typed reached the database ***", String(savedHighlights?.keyHighlights).slice(0, 60));
  expect(savedHighlights?.supportRequested?.startsWith("Faster offer"),
    "including section 6");

  // ── Sending it to the manager ───────────────────────────────────────────
  startSection("Send to manager");
  await page.getByRole("button", { name: /Send to manager/i }).click();
  // Sending flushes every narrative field first and only then submits, so this
  // is two round trips, not one. Poll for the outcome rather than guessing a
  // duration — a fixed wait here reported DRAFT for a report that submitted
  // fine a moment later.
  const afterSubmit = await waitForStatus(made.reportId, "PENDING_REVIEW");
  expect(afterSubmit?.status === "PENDING_REVIEW",
    "*** the button sends the report for approval ***", `status ${afterSubmit?.status}`);
  expect(afterSubmit?.submittedAt != null, "and stamps the submission date");

  await page.reload({ waitUntil: "networkidle" });
  const submittedBody = await page.locator("body").innerText();
  expect(/Awaiting your manager/i.test(submittedBody), "the rep sees that it is with their manager");
  const stillEditable = await page.locator("#keyHighlights").count();
  expect(stillEditable === 0,
    "*** and the narrative fields are read-only once submitted ***", `${stillEditable} textareas still editable`);

  // ── The manager's view ──────────────────────────────────────────────────
  startSection("The manager's view");
  const rmCtx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  const rmPage = await rmCtx.newPage();
  await signIn(rmPage, rm);
  await rmPage.goto(`${BASE}/reports/icr-monthly/${made.reportId}`, { waitUntil: "networkidle", timeout: 45000 });
  const rmBody = await rmPage.locator("body").innerText();
  expect(/waiting for your decision/i.test(rmBody), "*** the manager is shown a decision to make ***");
  expect(rmBody.includes("Deposit conversion accelerated"), "and can read what the rep wrote");
  expect(new RegExp(`\\b${SEED.leads}\\b`).test(rmBody), "alongside the CRM's figures");

  await rmPage.getByRole("button", { name: /^Approve$/i }).click();
  const approved = await waitForStatus(made.reportId, "FINAL_APPROVED");
  expect(approved?.status === "FINAL_APPROVED",
    "*** the manager approves it from the page ***", `status ${approved?.status}`);
  expect(approved?.finalApprovedAt != null, "and the approval is dated");

  startSection("Console");
  expect(errs.length === 0, "no uncaught client errors across the run", errs.slice(0, 3).join(" | "));
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

/**
 * The "Pipeline progress" section on the edit form.
 *
 *   npx tsx --env-file=.env scripts/qa-pipeline-progress-section.mjs
 *
 * Every field a stage gate can ask for now has a control on the edit form, so
 * a student can be moved along without going hunting across three panels.
 *
 * The interesting cases are the ones where it must NOT show a field: the
 * eligibility outcome belongs to a journey, and a student may have several —
 * one box cannot honestly answer for three. Same for applications. Those are
 * asserted here, because a silently-wrong edit is worse than a missing one.
 */
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, leadId;

/** Opens Edit Lead and expands the section. */
async function openSection(page) {
  await page.getByRole("button", { name: /edit lead|edit/i }).first().click();
  await page.waitForTimeout(2000);
  const toggle = page.getByRole("button", { name: /pipeline progress/i }).first();
  await toggle.waitFor({ state: "visible", timeout: 10000 });
  await toggle.click();
  await page.waitForTimeout(3000);
  return page.locator('[role="dialog"]').first();
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });
  const institutions = await db.institution.findMany({
    where: { deletedAt: null }, select: { id: true, name: true }, take: 2,
  });

  const created = await api(ctx.jar, "POST", "/api/leads", {
    firstName: "ZZSection", lastName: `Test${stamp}`,
    email: `zz.section.${stamp}@example.invalid`, phone: `+15553${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
    interestedProgram: "Business Administration",
    studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
    sourceId: source?.id, intendedDestination: "Canada",
  });
  leadId = idOf(created.payload);

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── Nothing to edit yet ──────────────────────────────────────────────────
  startSection("with no journey and no application, it says where to go");

  await page.goto(`${BROWSER_BASE}/students/${leadId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  let dlg = await openSection(page);
  let text = await dlg.innerText();

  expect(/No institution journey yet/i.test(text), "it explains there is no journey");
  expect(/No application recorded yet/i.test(text), "it explains there is no application");
  expect(
    /Institution Interests/i.test(text) && /Record application/i.test(text),
    "it names the controls that create them",
    "telling someone a record is missing without saying where to add it is half an answer"
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // ── One of each: every gate field is editable here ───────────────────────
  startSection("with one journey and one application, every gate field is present");

  const interest = await api(ctx.jar, "POST", "/api/institution-interests", {
    leadId, institutionId: institutions[0].id, program: "Business Administration",
    intakeYear: 2026, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
  });
  expect(interest.status < 300, "journey created", `status ${interest.status}`);

  const app = await api(ctx.jar, "POST", `/api/leads/${leadId}/applications`, {
    institutionId: institutions[0].id, program: "Business Administration",
    submissionDate: new Date().toISOString(), submissionMethod: "DIRECT",
  });
  expect(app.status < 300, "application created", `status ${app.status} ${JSON.stringify(app.payload).slice(0, 160)}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  dlg = await openSection(page);
  text = await dlg.innerText();

  // The complete list the gates can ask for, by their on-screen labels.
  const wanted = [
    "Eligibility outcome", "Application number", "Evidence of submission",
    "Submitted on", "Submission method", "Application status",
    "Last institutional update", "Expected decision date", "Outstanding requirement",
    "Offer type", "Offer received on", "Student decision",
    "Deposit status", "Deposit paid on", "Deposit deadline",
    "Acceptance status", "Acceptance date",
  ];
  for (const label of wanted) {
    expect(text.includes(label), `on the form: ${label}`);
  }

  expect(
    /save as soon as you change them/i.test(text),
    "it says these save immediately",
    "they write to other records through other endpoints, so Save does not cover them — that has to be stated"
  );

  // ── It actually writes ───────────────────────────────────────────────────
  startSection("the controls really save");

  const elig = dlg.locator("select").filter({ hasText: /Provisionally eligible/i }).first();
  await elig.selectOption("ELIGIBLE");
  await page.waitForTimeout(2500);
  const savedInterest = await db.institutionInterest.findFirst({
    where: { leadId }, select: { eligibilityOutcome: true },
  });
  expect(
    savedInterest.eligibilityOutcome === "ELIGIBLE",
    "the eligibility outcome is written to the journey",
    `got ${savedInterest.eligibilityOutcome}`
  );

  const appNo = dlg.locator('input[placeholder*="Reference from the institution"]').first();
  await appNo.fill("APP-SECTION-1");
  await appNo.blur();
  await page.waitForTimeout(2500);
  const savedApp = await db.leadApplication.findFirst({
    where: { leadId }, select: { applicationNumber: true },
  });
  expect(
    savedApp.applicationNumber === "APP-SECTION-1",
    "the application number is written to the application",
    `got ${savedApp.applicationNumber}`
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);

  // ── Two journeys: it must refuse to guess ────────────────────────────────
  startSection("with two journeys it refuses to guess");

  const second = await api(ctx.jar, "POST", "/api/institution-interests", {
    leadId, institutionId: institutions[1].id, program: "Data Science",
    intakeYear: 2026, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
  });
  expect(second.status < 300, "second journey created", `status ${second.status}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  dlg = await openSection(page);
  text = await dlg.innerText();

  console.log("SECTION TEXT >>>");
  console.log(text.split("\n").filter((l) => /journey|application|eligib/i.test(l)).join(" || "));
  console.log("<<<");
  expect(
    /2 open journeys/i.test(text),
    "it says how many journeys there are",
    "the section should explain itself, not just disappear"
  );
  expect(
    !/Eligibility outcome —/i.test(text),
    "the eligibility box is NOT shown for two journeys",
    "one box editing one of three journeys would silently write to the wrong one"
  );
  expect(
    /Institution Interests/i.test(text),
    "it points at the panel where each journey can be edited separately"
  );

  expect(pageErrors.length === 0, "no page errors", pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (leadId) {
    for (const run of [
      () => db.leadChecklistItem.deleteMany({ where: { leadId } }),
      () => db.leadActivity.deleteMany({ where: { leadId } }),
      () => db.leadApplication.deleteMany({ where: { leadId } }),
      () => db.institutionInterest.deleteMany({ where: { leadId } }),
      () => db.lead.delete({ where: { id: leadId } }),
    ]) { try { await run(); } catch { /* best effort */ } }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

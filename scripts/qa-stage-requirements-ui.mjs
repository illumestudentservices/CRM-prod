/**
 * The stage requirement checklist, driven in a real browser.
 *
 *   npx tsx --env-file=.env scripts/qa-stage-requirements-ui.mjs
 *
 * `qa-stage-requirements.mjs` proves the RULES. This proves the part that was
 * actually complained about: that each outstanding rule is one click from the
 * control that satisfies it. Every assertion here is about arriving somewhere —
 * the dialog that opened, the field that flashed, the mode that was preset —
 * because "the list told me what was missing but not where it lived" is the
 * thing being fixed, and no amount of rule testing can show it.
 *
 * ONLY rows this script creates are removed at the end. The mirror's seeded
 * students are left alone; a previous run of something else wiped them.
 */
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  ok, fail, expect, summary, idOf, startSection,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, leadId;

/** The amber (or green) requirement card inside the Pipeline Stage panel. */
const panel = (page) =>
  page.locator("div").filter({ hasText: /^To move to |^Everything .* needs is done\./ }).last();

async function reload(page) {
  await page.goto(`${BROWSER_BASE}/students/${leadId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });

  // Deliberately WITHOUT intendedDestination and sourceId: both are New Lead
  // gate requirements, so the checklist has something real to point at.
  const created = await api(ctx.jar, "POST", "/api/leads", {
    firstName: "ZZReq", lastName: `Test${stamp}`,
    email: `zz.req.${stamp}@example.invalid`, phone: `+15554${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
    interestedProgram: "Business Administration",
    studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
  });
  leadId = idOf(created.payload);
  if (!leadId) throw new Error(`could not create the student: ${JSON.stringify(created.payload)}`);

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1300 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ─── The checklist itself ────────────────────────────────────────────────
  startSection("The checklist replaces the bullet list");
  await reload(page);

  const body = await page.locator("body").innerText();
  expect(/To move to Contacted:/i.test(body), "it names the stage being moved to");
  expect(/\d+ of \d+ done/.test(body), "it shows progress, not only failures");
  expect(/Intended destination/i.test(body), "the outstanding field is named");

  const openButtons = await page.locator("button", { hasText: /Intended destination/i }).count();
  expect(openButtons > 0, "an outstanding requirement is a button, not a bullet");

  startSection("Already-met rules are visible but out of the way");
  const showDone = page.getByRole("button", { name: /already done/i }).first();
  expect(await showDone.count() > 0, "there is a 'show the N already done' toggle");
  await showDone.click();
  await page.waitForTimeout(400);
  const withDone = await page.locator("body").innerText();
  expect(/Email|Phone|First name/i.test(withDone), "met rules are listed once expanded");

  // ─── A field on the student ──────────────────────────────────────────────
  startSection("Clicking a student field lands on that field");
  await reload(page);
  await page.locator("button", { hasText: /Intended destination/i }).first().click();

  // WAIT FOR the flash rather than sleeping and then looking. The marker is
  // deliberately removed after two seconds, and the dialog takes close to a
  // second to mount, so a fixed 2.5s sleep checked just after it had been
  // cleaned up — a passing feature reported as broken.
  const flashed = page.locator('[data-field="intendedDestination"][data-field-flash="true"]');
  let didFlash = true;
  await flashed.waitFor({ state: "attached", timeout: 6000 }).catch(() => { didFlash = false; });

  const dialog = page.locator('[role="dialog"]').first();
  expect(await dialog.count() > 0, "the edit form opened");
  expect(didFlash, "the field it named is the field that flashed");

  const focusedField = await page.evaluate(
    () => document.activeElement?.closest("[data-field]")?.getAttribute("data-field") ?? null
  );
  expect(focusedField === "intendedDestination",
    `the cursor is in it (focus was on ${focusedField})`);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ─── The "book a next step" rule ─────────────────────────────────────────
  startSection("Clicking the booking rule opens the activity dialog, ready to schedule");
  await reload(page);
  await page.locator("button", { hasText: /next step booked/i }).first().click();
  await page.waitForTimeout(1200);

  const addDialog = page.locator('[role="dialog"]').first();
  expect(await addDialog.count() > 0, "the Add activity dialog opened");
  const dialogText = await addDialog.innerText();
  expect(/Add activity/i.test(dialogText), "it is the activity dialog");
  // The chosen mode is the one carrying the active styling.
  const scheduleActive = await page
    .locator('button:has-text("Schedule for later")')
    .first()
    .evaluate((el) => el.className.includes("sky") || el.className.includes("0EA5E9"));
  expect(scheduleActive, "it opened on 'Schedule for later', not 'Log something done'");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ─── The counselling contradiction ───────────────────────────────────────
  startSection("Counselling done at an earlier stage counts, and says so");
  const enteredContacted = new Date(Date.now() - 2 * 86_400_000);
  await db.lead.update({
    where: { id: leadId },
    data: {
      stage: "CONTACTED",
      stageEnteredAt: enteredContacted,
      preferredCountry: "Canada",
      budgetRange: "FROM_20K_TO_35K", // an enum, not free text
      currentQualification: "High school",
      counsellingOutcomeEnum: "PROCEED_TO_ELIGIBILITY",
    },
  });

  // Completed BEFORE the student reached Contacted, and stamped against New
  // Lead — exactly the shape that used to read "must be completed in this
  // stage" while the activity panel showed it ticked.
  await db.leadActivity.create({
    data: {
      leadId, userId: ctx.user.id, kind: "ENGAGEMENT",
      engagementType: "COUNSELLING", type: "COUNSELLING",
      description: "Initial counselling call",
      completedAt: new Date(Date.now() - 5 * 86_400_000),
      stageAtCreation: "NEW_LEAD", stageAtCompletion: "NEW_LEAD",
    },
  });

  await reload(page);
  const contactedBody = await page.locator("body").innerText();
  expect(!/Initial counselling must be completed/i.test(contactedBody),
    "it no longer demands counselling that has already been done");

  await page.getByRole("button", { name: /already done/i }).first().click();
  await page.waitForTimeout(400);
  const doneList = await page.locator("body").innerText();
  expect(/Initial counselling/i.test(doneList), "counselling is listed as done");
  expect(/at New Lead/i.test(doneList), "and it says which stage the credit came from");

  // ─── A typed task, when it genuinely is missing ──────────────────────────
  startSection("Clicking a missing typed task presets the dialog");
  await db.leadActivity.deleteMany({ where: { leadId, engagementType: "COUNSELLING" } });
  await reload(page);

  await page.locator("button", { hasText: /Initial counselling/i }).first().click();
  await page.waitForTimeout(1200);
  const logDialog = page.locator('[role="dialog"]').first();
  expect(await logDialog.count() > 0, "the Add activity dialog opened");
  const logActive = await page
    .locator('button:has-text("Log something done")')
    .first()
    .evaluate((el) => el.className.includes("sky") || el.className.includes("0EA5E9"));
  expect(logActive, "it opened on 'Log something done' rather than Schedule");
  const typeText = await logDialog.innerText();
  expect(/Initial counselling/i.test(typeText), "the activity type is already chosen");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ─── Creating a journey ──────────────────────────────────────────────────
  startSection("The institution interest rule opens the add-interest form");
  await reload(page);
  const interestRow = page.locator("button", { hasText: /institution interest/i }).first();
  if (await interestRow.count() > 0) {
    await interestRow.click();
    await page.waitForTimeout(1200);
    const cancelShown = await page.getByRole("button", { name: /^Cancel$/ }).count();
    expect(cancelShown > 0, "the add-interest form is open (its button now reads Cancel)");
  } else {
    fail("the institution interest requirement was not listed");
  }

  // ─── The met state ───────────────────────────────────────────────────────
  startSection("When nothing is outstanding it offers the move");
  await db.lead.update({
    where: { id: leadId },
    data: { stage: "NEW_LEAD", stageEnteredAt: new Date(), intendedDestination: "Canada" },
  });
  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });
  if (source) await db.lead.update({ where: { id: leadId }, data: { sourceId: source.id } });
  await db.leadActivity.create({
    data: {
      leadId, userId: ctx.user.id, kind: "ENGAGEMENT",
      engagementType: "FOLLOW_UP", type: "FOLLOW_UP",
      description: "Next call", scheduledFor: new Date(Date.now() + 7 * 86_400_000),
      stageAtCreation: "NEW_LEAD",
    },
  });
  await reload(page);
  const readyBody = await page.locator("body").innerText();
  expect(/Everything Contacted needs is done/i.test(readyBody),
    "it says so plainly instead of disappearing");
  expect(await page.getByRole("button", { name: /Move to Contacted/i }).count() > 0,
    "and the move is offered right there");

  startSection("No client-side errors");
  const real = pageErrors.filter((e) => !/ResizeObserver|hydration/i.test(e));
  expect(real.length === 0, `no uncaught errors (${real.slice(0, 2).join(" | ")})`);
} catch (e) {
  fail(`suite threw: ${e.message}`);
  console.error(e);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (leadId) {
    await db.leadActivity.deleteMany({ where: { leadId } }).catch(() => {});
    await db.institutionInterest.deleteMany({ where: { leadId } }).catch(() => {});
    await db.lead.delete({ where: { id: leadId } }).catch(() => {});
  }
  if (ctx) await destroyUser(ctx).catch(() => {});
  await db.$disconnect().catch(() => {});
  summary();
}

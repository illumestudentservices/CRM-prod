/**
 * Spec pages 2-11 — the controls that had no input at all.
 *
 * The audit's largest category was fields present in the database and reachable
 * by the API but with nothing on screen to set them. tsc cannot catch that and
 * an API test cannot either: both pass while the user has no way in. Only a
 * browser can answer it, so this drives the real screens.
 *
 * Run: BASE_URL=http://127.0.0.1:3000 npx tsx --env-file=.env scripts/qa-pipeline-ui.mjs
 */
import { chromium } from "playwright";
import {
  db,
  createAndLogin,
  destroyUser,
  BASE,
  startSection,
  expect,
  ok,
  summary,
  TAG,
} from "./qa-lib.mjs";

let admin = null;
const created = { leads: [], interests: [], applications: [] };

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN" });

  const institution = await db.institution.findFirstOrThrow({ where: { deletedAt: null } });

  const lead = await db.lead.create({
    data: {
      firstName: TAG,
      lastName: "UI",
      email: `${TAG.toLowerCase()}-ui@illume.local`,
      phone: "+971500555666",
      nationality: "British",
      countryOfResidence: "United Arab Emirates",
      interestedProgram: "Computer Science",
      studyLevel: "UNDERGRADUATE",
      intakeYear: 2027,
      intakeMonth: 9,
      createdById: admin.user.id,
      assignedICRId: admin.user.id,
    },
  });
  created.leads.push(lead.id);

  const interest = await db.institutionInterest.create({
    data: {
      leadId: lead.id,
      institutionId: institution.id,
      program: "Computer Science",
      intakeYear: 2027,
      intakeMonth: 9,
      studyLevel: "UNDERGRADUATE",
    },
  });
  created.interests.push(interest.id);

  const application = await db.leadApplication.create({
    data: {
      leadId: lead.id,
      institutionId: institution.id,
      institutionInterestId: interest.id,
      program: "Computer Science",
    },
  });
  created.applications.push(application.id);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  // Must be `localhost`, matching BASE_URL. Driving the dev server on
  // 127.0.0.1 instead makes Next treat it as a cross-origin dev request: the
  // HMR WebSocket handshake fails and React never hydrates, so every panel sits
  // on "Loading…" and no effect ever runs. The page still returns 200, so this
  // reads as a product bug and is not one.
  await ctx.addCookies(
    [...admin.jar.cookies.entries()].map(([name, value]) => ({
      name,
      value,
      domain: "localhost",
      path: "/",
    }))
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e.message)));

  await page.goto(`${BASE}/students/${lead.id}`, { waitUntil: "networkidle" });

  startSection("Student detail page loads");
  expect(!page.url().includes("/login"), "reached the student page", page.url());

  // ── §9/§10 application controls that did not exist ───────────────────────
  startSection("Application fields that previously had no control");

  // The panel fetches its applications in an effect after mount, so
  // `networkidle` on the document is not enough. Wait on a field that existed
  // before this work — if THAT is absent the panel itself never rendered, which
  // is a different failure from the one under test.
  await page.waitForSelector("text=Application number", { timeout: 20000 });
  ok("application panel rendered");

  for (const label of [
    "Application status", // §8 current application status
    "Offer received on", // §9 offer date
    "Deposit status", // §10 — all six statuses were unreachable
    "Deposit amount", // §10
    "Currency", // §10
    "Offer conditions", // §9 conditions
  ]) {
    const n = await page.getByText(label, { exact: true }).count();
    expect(n >= 1, `"${label}" is on screen`, `found ${n}`);
  }

  // ── §9 dropdowns must offer every specified value ────────────────────────
  startSection("§9 offer type and student decision option lists");

  // Radix triggers, not native selects — the options only exist in the DOM once
  // the dropdown is open, so it has to be driven rather than read.
  const offerLabel = page.getByText("Offer type", { exact: true }).first();
  const offerTrigger = offerLabel.locator("xpath=following::*[@role='combobox'][1]");
  await offerTrigger.click();
  await page.waitForTimeout(600);
  for (const label of ["Conditional", "Unconditional", "Alternative programme", "Waitlist", "Other"]) {
    const n = await page.getByRole("option", { name: label, exact: true }).count();
    expect(n === 1, `offer type "${label}" is offered`, `found ${n}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const decisionLabel = page.getByText("Student decision", { exact: true }).first();
  const decisionTrigger = decisionLabel.locator("xpath=following::*[@role='combobox'][1]");
  await decisionTrigger.click();
  await page.waitForTimeout(600);
  for (const label of [
    "Accepted",
    "Intends to accept",
    "Considering",
    "Awaiting other offers",
    "Declined",
    "Requesting deferral",
  ]) {
    const n = await page.getByRole("option", { name: label, exact: true }).count();
    expect(n === 1, `student decision "${label}" is offered`, `found ${n}`);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  startSection("§6/§11 interest controls");

  const eligibilityLabel = await page.getByText("Eligibility outcome", { exact: true }).count();
  expect(eligibilityLabel >= 1, '"Eligibility outcome" control is on screen', `found ${eligibilityLabel}`);

  // Drive it, and confirm it actually persists — display without a write path
  // was the original defect.
  const selects = page.locator("select");
  const count = await selects.count();
  let wrote = false;
  for (let i = 0; i < count; i++) {
    const opts = await selects.nth(i).locator("option").allTextContents();
    if (opts.includes("Provisionally eligible")) {
      await selects.nth(i).selectOption({ label: "Provisionally eligible" });
      await page.waitForTimeout(1500);
      wrote = true;
      break;
    }
  }
  expect(wrote, "found the eligibility outcome select and set it");

  if (wrote) {
    const row = await db.institutionInterest.findUnique({ where: { id: interest.id } });
    expect(
      row?.eligibilityOutcome === "PROVISIONALLY_ELIGIBLE",
      "setting eligibility outcome in the UI persisted to the database",
      `stored ${row?.eligibilityOutcome}`
    );
  }

  // ── The journey now has a stage control at all ───────────────────────────
  startSection("Spec page 3 — a screen that advances the journey");

  await page.waitForSelector("text=Advance to Contacted", { timeout: 20000 });
  ok("the journey has an Advance control (there was no such screen before)");

  // At New Lead there is nothing behind it, so "Move back" must not be offered.
  expect(
    (await page.getByRole("button", { name: "Move back" }).count()) === 0,
    "no Move back button at the first stage",
    "a backwards move from New Lead is meaningless"
  );

  // A brand-new journey cannot advance. The refusal must land on screen and
  // STAY there — it is a list of work to do, not a notification.
  await page.getByRole("button", { name: /Advance to Contacted/ }).click();
  await page.waitForSelector("text=/Cannot advance yet/", { timeout: 20000 });
  ok("clicking Advance renders the gate's refusal inline");

  const blockerCount = await page.locator("text=/Cannot advance yet — \\d+ outstanding/").count();
  expect(blockerCount >= 1, "the refusal states how many items are outstanding");

  await page.waitForTimeout(2500);
  expect(
    (await page.locator("text=/Cannot advance yet/").count()) >= 1,
    "the refusal persists rather than disappearing like a toast"
  );

  // The journey must NOT have moved.
  const stillNew = await db.institutionInterest.findUnique({ where: { id: interest.id } });
  expect(stillNew?.stage === "NEW_LEAD", "the refused journey did not move", `stage=${stillNew?.stage}`);

  // SUPER_ADMIN holds the override capability, so the escape hatch is offered.
  expect(
    (await page.getByRole("button", { name: /Override with a reason/ }).count()) === 1,
    "an override is offered to a holder of the capability"
  );

  await page.getByRole("button", { name: /Override with a reason/ }).click();
  await page.waitForSelector("text=/Force this journey to/", { timeout: 10000 });
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: "Override and move" });
  expect(await confirm.isDisabled(), "Override is disabled before a reason is written");
  await dialog.getByRole("textbox").first().fill("Offer already confirmed by the institution by phone");
  await page.waitForTimeout(300);
  expect(!(await confirm.isDisabled()), "Override enables once a reason is written");

  await confirm.click();
  await page.waitForTimeout(3000);
  const moved = await db.institutionInterest.findUnique({ where: { id: interest.id } });
  expect(moved?.stage === "CONTACTED", "the override moved the journey", `stage=${moved?.stage}`);

  // The override must be on the record, not just in the response.
  const overrideRow = await db.leadActivity.findFirst({
    where: { institutionInterestId: interest.id, type: "STAGE_CHANGE_OVERRIDE" },
  });
  expect(!!overrideRow, "the override wrote an audit activity against the journey");
  expect(
    overrideRow?.description?.includes("gate overridden"),
    "the recorded reason is on the activity",
    String(overrideRow?.description).slice(0, 120)
  );

  startSection("Console");
  // The 422 is provoked on purpose: the stage-control section above clicks
  // Advance on a journey that cannot advance, and the browser logs every
  // non-2xx fetch as a console error. Excluded by exact status rather than by
  // ignoring all 4xx, so a genuine 400 or 403 would still fail this.
  const EXPECTED_422 = /status of 422 \(Unprocessable Entity\)/i;
  const real = errors.filter(
    (e) =>
      !/favicon|Download the React DevTools|webpack-hmr|WebSocket/i.test(e) &&
      !EXPECTED_422.test(e)
  );
  expect(real.length === 0, "no unexpected console errors", real.slice(0, 3).join(" | "));
  expect(
    errors.some((e) => EXPECTED_422.test(e)),
    "the deliberately refused advance did reach the server (422 observed)"
  );

  await browser.close();
} finally {
  for (const id of created.applications) await db.leadApplication.deleteMany({ where: { id } });
  for (const id of created.interests) await db.institutionInterest.deleteMany({ where: { id } });
  for (const id of created.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } });
    await db.leadChecklistItem.deleteMany({ where: { leadId: id } });
    await db.institutionInterest.deleteMany({ where: { leadId: id } });
    await db.leadApplication.deleteMany({ where: { leadId: id } });
    await db.lead.deleteMany({ where: { id } });
  }
  if (admin) await destroyUser(admin);
  await db.$disconnect();
  summary();
}

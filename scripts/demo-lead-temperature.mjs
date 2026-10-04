/**
 * Lead temperature, walked through in a real browser the way an ICR would.
 *
 *   npx tsx --env-file=.env scripts/demo-lead-temperature.mjs
 *
 * Not a replacement for qa-lead-temperature.mjs — that one drives the API and
 * reads the database back. This one only ever touches what a person can see and
 * click: it never sets the temperature through the API or the database, only
 * through the dropdown, and it never reads the stage except off the screen.
 *
 * That restriction is the point. Every earlier bug in this area looked fine
 * from the API and wrong on the page: a blocker panel that listed a rule the
 * move did not enforce, a requirement whose button went nowhere, a field the
 * form sent and the route silently dropped. The only way to see those is to
 * use the thing.
 *
 * Writes PNGs to scratch/lead-temperature/ so the run can be looked at.
 *
 * Footprint: one disposable user and one disposable lead, removed in `finally`.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const SHOTS = "scratch/lead-temperature";
const stamp = Date.now().toString().slice(-6);
let ctx, browser, leadId;
let baseline = {};
let shot = 0;

fs.mkdirSync(SHOTS, { recursive: true });

const capture = async (page, name) => {
  const file = path.join(SHOTS, `${String(++shot).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`      saved ${file}`);
};

const open = async (page) => {
  await page.goto(`${BROWSER_BASE}/students/${leadId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
};

/** What the stage panel says right now. */
const screen = (page) => page.locator("body").innerText();

try {
  baseline = { leads: await db.lead.count(), users: await db.user.count() };
  ctx = await createAndLogin({ role: "ICR" });

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

  // ── 1. Capture a lead the way an ICR at an event would ───────────────────
  startSection("1. An ICR captures a lead and never answers the temperature");
  {
    const source = await db.recruitmentPartner.findFirst({
      where: { deletedAt: null, isActive: true }, select: { id: true },
    });
    // Everything the New Lead gate wants EXCEPT the temperature, so the only
    // thing left outstanding is the field under test.
    const created = await api(ctx.jar, "POST", "/api/leads", {
      firstName: "Priya", lastName: `Demo${stamp}`,
      email: `priya.demo.${stamp}@example.invalid`, phone: `+15557${stamp}`,
      nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "Business Administration",
      studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
      sourceId: source?.id,
      intendedDestination: "Canada", preferredCountry: "Canada",
    });
    expect(created.status === 201,
      "★ the lead saves with the temperature left blank", `status ${created.status}`);
    leadId = idOf(created.payload);

    // The gate also wants a booked next step. Schedule one so the temperature
    // is the only thing standing between this student and Contacted — otherwise
    // "still blocked" at the end proves nothing.
    await db.leadActivity.create({
      data: {
        leadId, userId: ctx.user.id, kind: "ENGAGEMENT",
        engagementType: "FOLLOW_UP", type: "FOLLOW_UP",
        description: "Call back Tuesday",
        scheduledFor: new Date(Date.now() + 7 * 86_400_000),
        stageAtCreation: "NEW_LEAD",
      },
    });
  }

  // ── 2. The student page says what is missing ─────────────────────────────
  startSection("2. The student page says the temperature is outstanding");
  {
    await open(page);
    await capture(page, "blocked");
    const body = await screen(page);

    expect(/To move to Contacted/i.test(body),
      "the page explains what is needed to move on");
    expect(/lead temperature/i.test(body),
      "★ and Lead temperature is named as outstanding",
      body.slice(0, 300));
    // The student must still be visibly at New Lead, not quietly advanced.
    expect(/New Lead/i.test(body), "the student is shown at New Lead");
  }

  // ── 3. The move is actually refused, not just discouraged ────────────────
  startSection("3. Trying to move to Contacted is refused");
  {
    const moveBtn = page.getByRole("button", { name: /Move to Contacted/i });
    expect(await moveBtn.count() === 0,
      "★ the 'Move to Contacted' button is not offered at all",
      "an unjudged student should not have a one-click path forward");

    // And the server agrees, in case the UI is only hiding the button.
    const forced = await api(ctx.jar, "PATCH", `/api/leads/${leadId}/stage`, {
      stage: "CONTACTED",
    });
    expect(forced.status >= 400,
      "★ and the server refuses the move even when asked directly",
      `status ${forced.status} — a hidden button alone is not a rule`);
  }

  // ── 4. Clicking the blocker lands on the dropdown ────────────────────────
  startSection("4. Clicking the blocker opens the form at the dropdown");
  {
    const row = page.locator("button", { hasText: /lead temperature/i }).first();
    expect(await row.count() > 0, "the outstanding item is clickable");
    await row.click();
    await page.waitForTimeout(1800);

    const field = page.locator('[data-field="leadTemperature"]');
    expect(await field.count() > 0,
      "★ it lands on the Lead Temperature control", "a blocker that goes nowhere is worse than none");
    await capture(page, "form-focused");

    const text = await field.first().innerText();
    expect(/not assessed/i.test(text),
      "which starts on 'Not assessed yet'", text);
    expect(/needed before this student can move past new lead/i.test(text),
      "and says plainly why it matters", text);
  }

  // ── 5. Pick Hot, through the dropdown, like a person ──────────────────────
  startSection("5. Choosing Hot from the dropdown and saving");
  {
    const field = page.locator('[data-field="leadTemperature"]');
    await field.locator('[role="combobox"]').first().click();
    await page.waitForTimeout(700);
    await capture(page, "dropdown-open");

    const options = await page.locator('[role="option"]').allInnerTexts();
    for (const want of [/hot/i, /warm/i, /cold/i]) {
      expect(options.some((o) => want.test(o)),
        `the list offers ${String(want).replace(/[\/i]/g, "")}`, options.join(" | "));
    }

    await page.locator('[role="option"]', { hasText: /^Hot/i }).first().click();
    await page.waitForTimeout(600);

    // Save through the form's own button — not an API call.
    const save = page.getByRole("button", { name: /^(Save|Update|Save changes)/i }).first();
    expect(await save.count() > 0, "the form has a save button");
    await save.click();

    // ★ POLL, do not sleep-then-read. A fixed wait makes the assertion a race
    // against a dev-mode save and its revalidation, and the first version of
    // this script lost that race — it reported "stored null" on a save that
    // had plainly worked, because the very next step found the gate open and
    // moved the student. A test that fails for being early is worse than no
    // test: it sends you looking for a bug that is not there.
    let row = null;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      row = await db.lead.findUnique({
        where: { id: leadId }, select: { leadTemperature: true },
      });
      if (row?.leadTemperature) break;
      await page.waitForTimeout(500);
    }
    await capture(page, "saved");

    expect(row?.leadTemperature === "HOT",
      "★ Hot reached the database, picked entirely through the UI",
      `stored ${JSON.stringify(row?.leadTemperature)}`);
  }

  // ── 6. The blocker clears and the move is offered ────────────────────────
  startSection("6. The student can now be moved to Contacted");
  {
    await open(page);
    const body = await screen(page);
    expect(!/lead temperature/i.test(body),
      "the temperature is no longer listed as outstanding",
      body.slice(0, 300));
    expect(/Everything Contacted needs is done/i.test(body),
      "★ the page says the student is ready", body.slice(0, 300));
    await capture(page, "ready");

    const moveBtn = page.getByRole("button", { name: /Move to Contacted/i });
    expect(await moveBtn.count() > 0, "the move is offered");
    await moveBtn.first().click();
    await page.waitForTimeout(3000);
    await capture(page, "contacted");

    const after = await db.lead.findUnique({
      where: { id: leadId }, select: { stage: true },
    });
    expect(after?.stage === "CONTACTED",
      "★ and clicking it actually moves the student", `stage is ${after?.stage}`);
  }

  // ── 7. The capture form hides the rep's own notes until asked ────────────
  startSection("7. Pipeline Details is folded away on the capture form");
  {
    await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const addBtn = page.getByRole("button", { name: /Add (Student|Lead)|New (Student|Lead)/i }).first();
    expect(await addBtn.count() > 0, "the Add Student button is there");
    await addBtn.click();
    await page.waitForTimeout(2000);
    await capture(page, "capture-form-collapsed");

    const toggle = page.getByRole("button", { name: /Pipeline Details/i }).first();
    expect(await toggle.count() > 0, "the section has a heading");
    expect(/to be filled by university rep/i.test(await toggle.innerText()),
      "★ it says who it is for",
      await toggle.innerText());

    // ★ The fields must be ABSENT, not merely hidden. A student reading over a
    // rep's shoulder is the case this is for; CSS-hidden still renders, still
    // flashes during layout, and still lands in a screenshot or a screen share.
    expect(await page.locator('[data-field="leadTemperature"]').count() === 0,
      "★ the rep's notes are not on screen until asked for");
    expect(await page.locator('[data-field="budgetRange"]').count() === 0,
      "  …including the budget question");
    expect(await page.getByText(/Nationality/i).count() > 0,
      "while the student's own details are still shown",
      "only the rep's section folds away — the form must stay usable");

    // Aria, because this is a disclosure and keyboard users get no chevron.
    expect(await toggle.getAttribute("aria-expanded") === "false",
      "it reports itself as collapsed to a screen reader");

    await toggle.click();
    await page.waitForTimeout(800);
    await capture(page, "capture-form-expanded");

    expect(await toggle.getAttribute("aria-expanded") === "true",
      "and as expanded once opened");
    const field = page.locator('[data-field="leadTemperature"]');
    expect(await field.count() > 0, "★ one click reveals the dropdown");
    const text = await field.first().innerText();
    expect(!text.includes("*"),
      "★ with no red asterisk — it is not required to capture a lead", text);
    expect(/not assessed/i.test(text),
      "and defaults to 'Not assessed yet'", text);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // ── 7b. Reopening the form starts folded again ───────────────────────────
  startSection("7b. It is folded again next time the form is opened");
  {
    // ★ `LeadForm` stays mounted while the dialog is shut, so an expanded
    // section would otherwise still be open the next time the form is used —
    // in front of the next student.
    const addBtn = page.getByRole("button", { name: /Add (Student|Lead)|New (Student|Lead)/i }).first();
    await addBtn.click();
    await page.waitForTimeout(2000);
    expect(await page.locator('[data-field="leadTemperature"]').count() === 0,
      "★ expanding it once does not leave it open for the next student");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  startSection("8. No errors in the browser");
  {
    const real = pageErrors.filter((e) => !/ResizeObserver|hydration/i.test(e));
    expect(real.length === 0, "no uncaught errors", real.slice(0, 2).join(" | "));
  }
} catch (e) {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (leadId) {
    await db.leadActivity.deleteMany({ where: { leadId } }).catch(() => {});
    await db.leadNote.deleteMany({ where: { leadId } }).catch(() => {});
    await db.activity.deleteMany({ where: { leadId } }).catch(() => {});
    await db.lead.delete({ where: { id: leadId } }).catch(() => {});
  }
  await destroyUser(ctx).catch(() => {});

  startSection("Footprint");
  const after = { leads: await db.lead.count(), users: await db.user.count() };
  for (const k of Object.keys(baseline)) {
    expect(after[k] === baseline[k], `${k} back to ${baseline[k]}`, `now ${after[k]}`);
  }
  summary();
  await db.$disconnect();
}

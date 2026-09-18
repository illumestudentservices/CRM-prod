/**
 * The Nationality and Country of Residence dropdowns on the lead form.
 *
 *   npx tsx --env-file=.env scripts/qa-country-combobox-ui.mjs
 *
 * Both boxes were free text until 2026-09-18, so the same country arrived as
 * "UAE", "U.A.E." and "UAE National". They are now type-to-search dropdowns fed
 * by the ISO 3166-1 list in lib/countries.ts.
 *
 * The cases that actually matter here:
 *
 * 1. IT WORKS AT ALL INSIDE THE DIALOG. The list is a Radix Popover, which
 *    portals outside the Dialog's DOM, and the Dialog runs a focus trap. If the
 *    trap pulls focus back, the search box cannot be typed into and the whole
 *    control is dead. Nothing in tsc or the build would catch that.
 *
 * 2. A VALUE THAT IS NOT IN THE LIST SURVIVES. Existing leads hold free text
 *    typed before the change. Opening one to edit a phone number must not
 *    silently blank their nationality — that is data loss disguised as a UI
 *    improvement, and it would hit records nobody is looking at.
 *
 * 3. THE SAVED STRING IS THE ONE THE LIST SHOWS, read back from the database
 *    rather than from the screen, because a control that displays "India" and
 *    posts something else is the failure this is meant to prevent.
 */
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, leadId, unlistedLeadId;

/** Opens the Edit Lead dialog and returns it. */
async function openEdit(page) {
  await page.getByRole("button", { name: /edit lead|edit/i }).first().click();
  await page.waitForTimeout(2000);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.waitFor({ state: "visible", timeout: 10000 });
  return dlg;
}

/** The combobox trigger sitting inside the FormField wrapper for `field`. */
function trigger(dlg, field) {
  return dlg.locator(`[data-field="${field}"] [role="combobox"]`).first();
}

/** The open dropdown panel. It is portaled, so it is NOT inside the dialog. */
function panel(page) {
  return page.locator('[role="listbox"]').first();
}

/**
 * Waits for the row to satisfy `predicate`, then returns it.
 *
 * A fixed sleep after clicking Save is what made the first version of this
 * script report a product bug that did not exist: the save takes four to five
 * seconds against the dev server, the script waited three and a half, and read
 * the old row. Polling removes the guess.
 */
async function waitForLead(id, predicate, timeoutMs = 20000) {
  const started = Date.now();
  let row;
  for (;;) {
    row = await db.lead.findUnique({
      where: { id },
      select: { nationality: true, countryOfResidence: true, phone: true },
    });
    if (predicate(row) || Date.now() - started > timeoutMs) return row;
    await new Promise((r) => setTimeout(r, 400));
  }
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });

  const base = {
    interestedProgram: "Business Administration",
    studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
    sourceId: source?.id, intendedDestination: "Canada",
  };

  const created = await api(ctx.jar, "POST", "/api/leads", {
    ...base,
    firstName: "ZZCountry", lastName: `Test${stamp}`,
    email: `zz.country.${stamp}@example.invalid`, phone: `+15554${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
  });
  leadId = idOf(created.payload);

  // A lead holding a value that is NOT in either dropdown — exactly what the
  // pre-existing rows look like.
  const legacy = await api(ctx.jar, "POST", "/api/leads", {
    ...base,
    firstName: "ZZLegacy", lastName: `Test${stamp}`,
    email: `zz.legacy.${stamp}@example.invalid`, phone: `+15555${stamp}`,
    nationality: "UAE National", countryOfResidence: "U.A.E.",
  });
  unlistedLeadId = idOf(legacy.payload);

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

  // ── 1. It opens, and the search box takes focus inside the Dialog ─────────
  startSection("the dropdown opens and can be typed into inside the dialog");

  await page.goto(`${BROWSER_BASE}/students/${leadId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  let dlg = await openEdit(page);

  const natTrigger = trigger(dlg, "nationality");
  expect(await natTrigger.count() === 1, "the Nationality field renders a combobox");
  expect(
    (await natTrigger.innerText()).trim() === "Indian",
    "it shows the stored nationality",
    `trigger read ${JSON.stringify((await natTrigger.innerText()).trim())}`
  );

  await natTrigger.click();
  await page.waitForTimeout(600);
  expect(await panel(page).isVisible(), "the list opens");

  const optionCount = await page.locator('[role="option"]').count();
  expect(
    optionCount > 200,
    "the whole country list is offered",
    `only ${optionCount} options rendered`
  );

  // THE focus test. If the Dialog's focus trap wins, this types nowhere.
  await page.keyboard.type("nigeri");
  await page.waitForTimeout(600);
  const search = page.locator('input[aria-label="Search nationality..."]');
  expect(
    (await search.inputValue()) === "nigeri",
    "the search box keeps focus despite the dialog focus trap",
    `search box holds ${JSON.stringify(await search.inputValue())} — the popover portals outside the dialog, so this is the thing most likely to break`
  );

  const filtered = await page.locator('[role="option"]').allInnerTexts();
  expect(
    filtered.some((t) => /Nigerian/.test(t)),
    "searching narrows the list to the match"
  );
  expect(
    filtered.length < 10,
    "the list actually filters rather than just scrolling",
    `${filtered.length} options still shown`
  );

  // ── 2. Picking a value saves that exact string ───────────────────────────
  startSection("picking a nationality saves the string the list showed");

  await page.locator('[role="option"]', { hasText: /^Nigerian$/ }).first().click();
  await page.waitForTimeout(500);
  expect(
    (await natTrigger.innerText()).trim() === "Nigerian",
    "the trigger shows the newly picked nationality"
  );

  // Country of Residence, via keyboard only, to prove arrow keys work.
  const resTrigger = trigger(dlg, "countryOfResidence");
  await resTrigger.click();
  await page.waitForTimeout(500);
  await page.keyboard.type("nigeria");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  expect(
    (await resTrigger.innerText()).trim() === "Nigeria",
    "Enter picks the highlighted country",
    `trigger read ${JSON.stringify((await resTrigger.innerText()).trim())}`
  );

  await dlg.getByRole("button", { name: /save|update/i }).first().click();
  const saved = await waitForLead(leadId, (r) => r?.nationality === "Nigerian");
  expect(
    saved.nationality === "Nigerian",
    "the database holds the nationality exactly as listed",
    `stored ${JSON.stringify(saved.nationality)}`
  );
  expect(
    saved.countryOfResidence === "Nigeria",
    "the database holds the country exactly as listed",
    `stored ${JSON.stringify(saved.countryOfResidence)}`
  );

  // ── 3. A value not in the list is preserved, not silently dropped ────────
  startSection("a pre-existing free-text value is kept, not wiped");

  await page.goto(`${BROWSER_BASE}/students/${unlistedLeadId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  dlg = await openEdit(page);

  const legacyNat = trigger(dlg, "nationality");
  expect(
    (await legacyNat.innerText()).trim() === "UAE National",
    "the unlisted value is shown on the trigger",
    `trigger read ${JSON.stringify((await legacyNat.innerText()).trim())}`
  );

  await legacyNat.click();
  await page.waitForTimeout(600);
  const firstOption = page.locator('[role="option"]').first();
  expect(
    (await firstOption.innerText()).includes("UAE National"),
    "it is offered first in the list so it can be kept"
  );
  expect(
    (await firstOption.innerText()).toLowerCase().includes("on record"),
    "it is marked as the value already on record"
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Save WITHOUT touching either country box — the realistic case, someone
  // editing a phone number on an old record.
  const newPhone = `+15556${stamp}`;
  const phone = dlg.locator('input[name="phone"]').first();
  await phone.fill(newPhone);
  await dlg.getByRole("button", { name: /save|update/i }).first().click();

  // Wait on the PHONE, not on the country fields. Waiting for "nationality is
  // still UAE National" would be satisfied instantly by the save not having
  // happened yet, and the two assertions below would prove nothing.
  const untouched = await waitForLead(unlistedLeadId, (r) => r?.phone === newPhone);
  expect(
    untouched.phone === newPhone,
    "the save actually went through",
    "without this the two checks below would pass even if nothing was saved"
  );
  expect(
    untouched.nationality === "UAE National",
    "editing an unrelated field does not blank the unlisted nationality",
    `stored ${JSON.stringify(untouched.nationality)} — this is silent data loss if it fails`
  );
  expect(
    untouched.countryOfResidence === "U.A.E.",
    "nor the unlisted country of residence",
    `stored ${JSON.stringify(untouched.countryOfResidence)}`
  );

  // ── 4. No client-side crashes ────────────────────────────────────────────
  startSection("no page errors");
  expect(
    pageErrors.length === 0,
    "the form threw no client-side errors",
    pageErrors.slice(0, 3).join(" | ")
  );
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of [leadId, unlistedLeadId]) {
    if (id) await db.lead.delete({ where: { id } }).catch(() => {});
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

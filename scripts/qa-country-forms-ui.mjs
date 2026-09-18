/**
 * The country dropdown on the five remaining record forms.
 *
 *   npx tsx --env-file=.env scripts/qa-country-forms-ui.mjs
 *
 * Events, Institutions, Partners, Campaigns and HR Assets each had their own
 * free-text Country box. They now use the same ISO 3166-1 list as the student
 * fields.
 *
 * WHAT THIS IS ACTUALLY CHECKING
 *
 * The component itself is already covered by qa-country-combobox-ui and
 * qa-offline-country-ui. What is NOT covered by those is the per-form wiring,
 * and that is where this class of change goes wrong quietly:
 *
 *   - Two of these forms did not destructure `watch` from useForm at all. One
 *     was caught by tsc; a form that happened to have `watch` in scope for some
 *     other field would NOT have been.
 *   - The trigger reads `watch("country")` and the picker writes
 *     `setValue("country", ...)`. So a trigger that updates after a pick proves
 *     the field name round-trips through react-hook-form state — a typo in
 *     either half leaves the box stubbornly blank.
 *
 * One form (Events) is then saved end to end and read back from the database,
 * because "the box shows Portugal" and "the record stores Portugal" are
 * different claims.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, eventId;

/**
 * The Country combobox inside the open dialog.
 *
 * Found by its placeholder rather than by label, then pinned to an index so the
 * handle stays valid after the text changes to the chosen country. The label is
 * not usable: several of these forms render the required asterisk inside the
 * <Label>, so an exact-text match finds nothing.
 */
async function countryBox(page) {
  const all = page.locator('[role="dialog"] [role="combobox"]');
  const texts = await all.allInnerTexts();
  const i = texts.findIndex((t) => /Select country/i.test(t));
  return i < 0 ? null : all.nth(i);
}

/** Opens the box, searches, and clicks the exact option. */
async function pickCountry(page, box, search, label) {
  await box.scrollIntoViewIfNeeded();
  await box.click();
  await page.waitForTimeout(400);
  await page.keyboard.type(search);
  await page.waitForTimeout(500);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(300);
}

const FORMS = [
  { name: "Events", path: "/events", open: /add event/i },
  { name: "Institutions", path: "/institutions", open: /add institution/i },
  { name: "Partners", path: "/recruitment-network/partners", open: /add partner/i },
  { name: "Campaigns", path: "/recruitment-network/campaigns", open: /add campaign/i },
];

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1250 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // ── 1. Every form offers the list and accepts a pick ─────────────────────
  startSection("each form has a working country dropdown");

  for (const form of FORMS) {
    await page.goto(`${BROWSER_BASE}${form.path}`, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: form.open }).first().click();
    await page.waitForTimeout(2000);

    const box = await countryBox(page);
    expect(box !== null, `${form.name}: the country field is a dropdown`);
    if (!box) continue;

    await box.click();
    await page.waitForTimeout(500);
    const count = await page.locator('[role="option"]').count();
    expect(
      count > 200,
      `${form.name}: the whole country list is offered`,
      `only ${count} options`
    );

    // Typing here also proves the popover keeps focus inside this dialog.
    await page.keyboard.type("portug");
    await page.waitForTimeout(500);
    const opts = await page.locator('[role="option"]').allInnerTexts();
    expect(
      opts.length < 10 && opts.some((t) => /Portugal/.test(t)),
      `${form.name}: search narrows the list`,
      `${opts.length} options shown`
    );

    await page.locator('[role="option"]', { hasText: /^Portugal$/ }).first().click();
    await page.waitForTimeout(400);
    expect(
      (await box.innerText()).trim() === "Portugal",
      `${form.name}: the pick reaches the form state`,
      `trigger reads ${JSON.stringify((await box.innerText()).trim())} — a blank box here means watch/setValue disagree on the field name`
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }

  // ── 2. HR Assets lives behind a tab ──────────────────────────────────────
  startSection("the HR asset form too");

  await page.goto(`${BROWSER_BASE}/hr`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);
  await page.getByRole("tab", { name: /assets/i }).first().click();
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /add asset/i }).first().click();
  await page.waitForTimeout(2000);

  const assetBox = await countryBox(page);
  expect(assetBox !== null, "HR Assets: the country field is a dropdown");
  if (assetBox) {
    await pickCountry(page, assetBox, "portug", "Portugal");
    expect(
      (await assetBox.innerText()).trim() === "Portugal",
      "HR Assets: the pick reaches the form state",
      `trigger reads ${JSON.stringify((await assetBox.innerText()).trim())}`
    );
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── 3. End to end on one form, read back from the database ───────────────
  startSection("an event saved from the form really stores the country");

  const eventName = `ZZCountryEvent ${stamp}`;
  await page.goto(`${BROWSER_BASE}/events`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /add event/i }).first().click();
  await page.waitForTimeout(2000);

  const dlg = page.locator('[role="dialog"]').first();
  await dlg.locator("#name").fill(eventName);
  await dlg.locator("#city").fill("Lisbon");
  await dlg.locator('input[type="datetime-local"]').first().fill("2026-11-20T09:00");

  const box = await countryBox(page);
  await pickCountry(page, box, "portug", "Portugal");

  await dlg.getByRole("button", { name: /^(create|save|add)( event)?$/i }).first().click();

  // Poll: a fixed sleep after Save has produced a false "it does not persist"
  // twice in this codebase already.
  let row = null;
  const started = Date.now();
  while (Date.now() - started < 25000) {
    row = await db.event.findFirst({
      where: { name: eventName },
      select: { id: true, country: true, city: true },
    });
    if (row) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  eventId = row?.id ?? null;

  expect(!!row, "the event was created from the form");
  if (row) {
    expect(
      row.country === "Portugal",
      "the database holds the country exactly as listed",
      `stored ${JSON.stringify(row.country)}`
    );
    expect(row.city === "Lisbon", "the other fields saved as usual");
  }

  startSection("no page errors");
  expect(
    pageErrors.length === 0,
    "no client-side errors across all five forms",
    pageErrors.slice(0, 3).join(" | ")
  );
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (eventId) {
    for (const run of [
      () => db.eventInstitution.deleteMany({ where: { eventId } }),
      () => db.eventParticipation.deleteMany({ where: { eventId } }),
      () => db.event.delete({ where: { id: eventId } }),
    ]) { try { await run(); } catch { /* best effort */ } }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

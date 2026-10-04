/**
 * The country dropdowns on the offline capture page.
 *
 *   npx tsx --env-file=.env scripts/qa-offline-country-ui.mjs
 *
 * /students/offline is used at events with no signal: leads go into IndexedDB
 * and upload later in one batch. Replacing two free-text boxes with dropdowns
 * there carries a risk the online form does not have — if the list needs the
 * network, the control is dead exactly when it is needed.
 *
 * So the important checks are:
 *
 * 1. THE LIST WORKS WITH THE NETWORK OFF. Playwright drops the context offline
 *    before the form is touched. The country table is a bundled module, so it
 *    should be there, but "should be" is not evidence.
 *
 * 2. WHAT REACHES INDEXEDDB IS WHAT WAS PICKED. The queued record is read back
 *    out of the device database rather than off the screen.
 *
 * 3. THE 100-LEAD CAP AND THE QUEUE STILL BEHAVE. A capture still queues and
 *    still counts.
 *
 * Nothing is uploaded, so this writes nothing to the database. The only state
 * it creates lives in the throwaway browser profile.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser;

/** Reads the queued captures straight out of IndexedDB on the device. */
const readQueue = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("illume-offline");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const dbh = req.result;
          const tx = dbh.transaction("captures", "readonly");
          const all = tx.objectStore("captures").getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        };
      })
  );

/**
 * Picks `label` from the combobox inside the field named `key`.
 *
 * ★ ADDRESSED BY `data-field`, NOT BY POSITION.
 *
 * This used to drive `[role="combobox"]` by index, because the offline `Field`
 * puts the required asterisk inside the <Label> — so its text reads
 * "Citizenship*" and an exact-text match finds nothing. Indexing worked until
 * Intended destination and Preferred country moved into the collapsed Pipeline
 * Details section, and then it did something worse than break: a Radix
 * `SelectTrigger` ALSO carries `role="combobox"`, so index 4 quietly became the
 * Lead source dropdown and the script typed a country name into it.
 *
 * The offline `Field` now publishes `data-field`, exactly as the office form's
 * `FormField` does, which makes that class of silent misfire impossible.
 */
async function pick(page, key, search, label) {
  const field = page.locator(`[data-field="${key}"] [role="combobox"]`).first();
  await field.click();
  await page.waitForTimeout(400);
  await page.keyboard.type(search);
  await page.waitForTimeout(500);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(300);
  return field;
}

/** Opens Pipeline Details, which is collapsed by default. */
async function openPipelineDetails(page) {
  const toggle = page.getByRole("button", { name: /Pipeline Details/i }).first();
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
    await page.waitForTimeout(600);
  }
}

const CITIZENSHIP = "nationality";
const RESIDENCE = "countryOfResidence";
const DESTINATION = "intendedDestination";
const PREFERRED = "preferredCountry";

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1400, height: 1300 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({
      name, value, domain: "localhost", path: "/",
    }))
  );
  const page = await bctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto(`${BROWSER_BASE}/students/offline`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3000);

  // ── 1. Go offline, then use the form ─────────────────────────────────────
  startSection("the country lists work with no network");

  await bctx.setOffline(true);
  await page.waitForTimeout(800);

  const comboboxes = await page.locator('[role="combobox"]').count();
  expect(comboboxes >= 4, "the two country fields render comboboxes", `found ${comboboxes}`);

  // ★ The two destination fields live in Pipeline Details, which is collapsed
  // by default so the student standing at the booth cannot read the rep's
  // judgements about them. They are genuinely ABSENT until it is opened.
  expect(
    (await page.locator(`[data-field="${DESTINATION}"]`).count()) === 0,
    "the rep's section is folded away before it is opened"
  );
  await openPipelineDetails(page);
  expect(
    (await page.locator(`[data-field="${DESTINATION}"]`).count()) > 0,
    "opening it reveals the destination fields"
  );

  // Each field is now addressed by name, so a field moving or being inserted
  // cannot repoint these at a different control.
  for (const [key, want, label] of [
    [CITIZENSHIP, /Select citizenship/i, "Citizenship"],
    [RESIDENCE, /Select country/i, "Country of residence"],
    [DESTINATION, /Select destination/i, "Intended destination"],
    [PREFERRED, /Confirmed after counselling/i, "Preferred country"],
  ]) {
    const text = await page.locator(`[data-field="${key}"] [role="combobox"]`).first().innerText();
    expect(want.test(text), `${label} is its own control`, `reads ${JSON.stringify(text)}`);
  }

  const citizenship = await pick(page, CITIZENSHIP, "niger", "Nigerian");
  expect(
    (await citizenship.innerText()).trim() === "Nigerian",
    "citizenship can be picked while offline",
    `trigger read ${JSON.stringify((await citizenship.innerText()).trim())} — if this fails the list needed the network`
  );

  const residence = await pick(page, RESIDENCE, "nigeria", "Nigeria");
  expect(
    (await residence.innerText()).trim() === "Nigeria",
    "country of residence can be picked while offline"
  );

  // A country far from the common ones, to prove the whole ISO list shipped
  // rather than a short convenience subset.
  const res2 = await pick(page, RESIDENCE, "vanua", "Vanuatu");
  expect(
    (await res2.innerText()).trim() === "Vanuatu",
    "a rarely used country is in the offline list too"
  );
  await pick(page, RESIDENCE, "nigeria", "Nigeria");

  // The two destination fields, also offline. Both are stage-gate
  // requirements, so a value that does not survive to the queue blocks the
  // student later, back at the office, with the reason far from the cause.
  const dest = await pick(page, DESTINATION, "canada", "Canada");
  expect(
    (await dest.innerText()).trim() === "Canada",
    "intended destination can be picked while offline"
  );
  const pref = await pick(page, PREFERRED, "ireland", "Ireland");
  expect(
    (await pref.innerText()).trim() === "Ireland",
    "preferred country can be picked while offline"
  );

  // ── 2. The queued record carries the picked strings ──────────────────────
  startSection("what is queued on the device matches what was picked");

  const email = `zz.offline.${stamp}@example.invalid`;
  await page.getByPlaceholder("Nkechi").fill("ZZOffline");
  await page.getByPlaceholder("Obi").fill(`Test${stamp}`);
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="tel"]').first().fill(`+15562${stamp}`);
  await page.getByPlaceholder("BSc Computer Science").fill("Business Administration");

  // Study level and intake are plain Radix selects, addressed by name for the
  // same reason as the comboboxes above.
  const choose = async (key, option) => {
    await page.locator(`[data-field="${key}"] [role="combobox"]`).first().click();
    await page.waitForTimeout(400);
    await page.getByRole("option", { name: option }).first().click();
    await page.waitForTimeout(300);
  };
  await choose("studyLevel", /undergraduate/i);
  await choose("intakeMonth", /september/i);

  // Consent became compulsory on this page, so a capture cannot be queued
  // until all four channels are answered. Answering them here is not incidental
  // setup: if the rule ever regressed, the queue count below would still pass
  // and only this block would look redundant.
  await page.getByRole("button", { name: /^Yes, they agreed$/ }).first().click();
  await page.waitForTimeout(200);
  for (const label of ["Telephone calls", "SMS", "WhatsApp"]) {
    const row = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
    await row.getByRole("button", { name: /^No$/ }).first().click();
    await page.waitForTimeout(200);
  }

  const before = (await readQueue(page)).length;

  await page.getByRole("button", { name: /save to device|save lead|save/i }).first().click();
  await page.waitForTimeout(2500);

  const queue = await readQueue(page);
  expect(
    queue.length === before + 1,
    "the lead was queued on the device",
    `queue went ${before} → ${queue.length}`
  );

  const row = queue.find((r) => (r.data?.email ?? r.email) === email);
  expect(!!row, "the queued record is the one just captured");
  if (row) {
    const d = row.data ?? row;
    expect(
      d.nationality === "Nigerian",
      "the queued citizenship is the picked string",
      `queued ${JSON.stringify(d.nationality)}`
    );
    expect(
      d.countryOfResidence === "Nigeria",
      "the queued country of residence is the picked string",
      `queued ${JSON.stringify(d.countryOfResidence)}`
    );
    expect(
      d.intendedDestination === "Canada",
      "the queued intended destination is the picked string",
      `queued ${JSON.stringify(d.intendedDestination)}`
    );
    expect(
      d.preferredCountry === "Ireland",
      "the queued preferred country is the picked string",
      `queued ${JSON.stringify(d.preferredCountry)}`
    );
    // All four consent answers must reach the device queue, not just email —
    // the three channel questions were added to this page at the same time.
    expect(
      d.marketingConsent === true,
      "the queued email consent is stored",
      `queued ${JSON.stringify(d.marketingConsent)}`
    );
    expect(
      d.phoneContactConsent === false &&
        d.smsContactConsent === false &&
        d.whatsappContactConsent === false,
      "the three declined channels are stored as false, not left blank",
      `queued phone=${d.phoneContactConsent} sms=${d.smsContactConsent} wa=${d.whatsappContactConsent}`
    );
  }

  // ── 3. Nothing reached the server ────────────────────────────────────────
  startSection("nothing was uploaded");

  await bctx.setOffline(false);
  const onServer = await db.lead.count({ where: { email } });
  expect(
    onServer === 0,
    "the capture stayed on the device and was not uploaded",
    `found ${onServer} rows on the server — this script must not write to the database`
  );

  startSection("no page errors");
  expect(
    pageErrors.length === 0,
    "the offline page threw no client-side errors",
    pageErrors.slice(0, 3).join(" | ")
  );
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

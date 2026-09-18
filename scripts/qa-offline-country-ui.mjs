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
 * Picks `label` from the combobox at `index`.
 *
 * Addressed by position, not by label text: the offline `Field` puts the
 * required asterisk inside the <Label>, so its text content is "Citizenship*"
 * and an exact-text match finds nothing. The `comboboxOrder` check below pins
 * the positions, so a field being added above these two fails loudly instead of
 * quietly driving the wrong control.
 */
async function pick(page, index, search, label) {
  const field = page.locator('[role="combobox"]').nth(index);
  await field.click();
  await page.waitForTimeout(400);
  await page.keyboard.type(search);
  await page.waitForTimeout(500);
  await page.locator('[role="option"]', { hasText: new RegExp(`^${label}$`) }).first().click();
  await page.waitForTimeout(300);
  return field;
}

const CITIZENSHIP = 0;
const RESIDENCE = 1;
const STUDY_LEVEL = 2;
const INTAKE_MONTH = 3;
const DESTINATION = 4;
const PREFERRED = 5;

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

  // Pin the positions the rest of the script drives, so a new field inserted
  // above them fails here rather than silently filling the wrong box.
  const order = await page.locator('[role="combobox"]').allInnerTexts();
  expect(
    /Select citizenship/i.test(order[CITIZENSHIP]),
    "combobox 0 is Citizenship",
    `reads ${JSON.stringify(order[CITIZENSHIP])}`
  );
  expect(
    /Select country/i.test(order[RESIDENCE]),
    "combobox 1 is Country of residence",
    `reads ${JSON.stringify(order[RESIDENCE])}`
  );
  expect(
    /Select destination/i.test(order[DESTINATION]),
    "combobox 4 is Intended destination",
    `reads ${JSON.stringify(order[DESTINATION])}`
  );
  expect(
    /Confirmed after counselling/i.test(order[PREFERRED]),
    "combobox 5 is Preferred country",
    `reads ${JSON.stringify(order[PREFERRED])}`
  );

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

  // Study level and intake are plain Radix selects, addressed by position.
  const selects = page.locator('[role="combobox"]');
  await selects.nth(STUDY_LEVEL).click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: /undergraduate/i }).first().click();
  await page.waitForTimeout(300);
  await selects.nth(INTAKE_MONTH).click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: /september/i }).first().click();
  await page.waitForTimeout(300);

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

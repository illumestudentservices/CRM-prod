/**
 * Lead temperature on the OFFLINE capture page, from booth to database.
 *
 *   npx tsx --env-file=.env scripts/qa-offline-lead-temperature.mjs
 *
 * The office form's version of this is covered by demo-lead-temperature.mjs.
 * This is the offline path, which has two extra places to lose the value and
 * both fail silently:
 *
 *   the device queue   a capture is serialised into IndexedDB and may sit there
 *                      for days. A field missing from `toPayload` is simply
 *                      never written, and nothing on screen says so.
 *   the sync route     `capturedLeadSchema` in /api/leads/offline-sync is NOT
 *                      `.strict()`, so a key it does not list is stripped and
 *                      the batch still answers 201. The ICR picks "Hot", the
 *                      upload reports success, and the student arrives with the
 *                      field blank — still stuck behind the New Lead gate, now
 *                      with the cause days and a thousand miles away.
 *                      That exact failure has been paid for twice in this
 *                      codebase already (PR #112, and the four consent fields).
 *
 * So the assertion that matters is the LAST one: the row in Postgres.
 *
 * Footprint: one disposable user, one uploaded lead, both removed in `finally`.
 */
import { chromium } from "playwright";
import {
  BASE, db, createAndLogin, destroyUser,
  startSection, expect, summary,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
const EMAIL = `zz.otemp.${stamp}@example.invalid`;
let ctx, browser, leadId;
let baseline = {};

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

const choose = async (page, key, option) => {
  await page.locator(`[data-field="${key}"] [role="combobox"]`).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("option", { name: option }).first().click();
  await page.waitForTimeout(300);
};

try {
  baseline = { leads: await db.lead.count(), users: await db.user.count() };
  ctx = await createAndLogin({ role: "ICR" });

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
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

  // ── 1. The rep's section is folded away ──────────────────────────────────
  startSection("1. Pipeline Details is hidden from the student at the booth");
  {
    const toggle = page.getByRole("button", { name: /Pipeline Details/i }).first();
    expect(await toggle.count() > 0, "the section exists on this page too");
    expect(/to be filled by university rep/i.test(await toggle.innerText()),
      "★ it is headed the same as the office form",
      await toggle.innerText());
    expect(await toggle.getAttribute("aria-expanded") === "false",
      "it starts collapsed");

    // ★ ABSENT, not hidden. This page is used on a tablet held between the rep
    // and the student; CSS-hidden markup still renders and still flashes.
    expect(await page.locator('[data-field="leadTemperature"]').count() === 0,
      "★ the temperature question is not on screen");
    expect(await page.locator('[data-field="budgetRange"]').count() === 0,
      "  …nor the budget question");

    // The student's own questions must still be right there.
    for (const k of ["firstName", "email", "nationality", "interestedProgram"]) {
      expect(await page.locator(`[data-field="${k}"]`).count() > 0,
        `  the student's own "${k}" question is still shown`);
    }
    // And so must Source, which the New Lead gate names.
    expect(await page.locator('[data-field="sourceId"]').count() > 0,
      "★ Lead source stays visible — the gate names it, so it must be reachable");
  }

  // ── 2. Capture a lead with a temperature ─────────────────────────────────
  startSection("2. An ICR opens it and records a judgement");
  {
    await page.getByRole("button", { name: /Pipeline Details/i }).first().click();
    await page.waitForTimeout(700);
    expect(await page.locator('[data-field="leadTemperature"]').count() > 0,
      "one tap reveals the temperature dropdown");

    await page.locator('[data-field="leadTemperature"] [role="combobox"]').first().click();
    await page.waitForTimeout(400);
    const options = await page.locator('[role="option"]').allInnerTexts();
    for (const want of [/^Not assessed/i, /^Hot/i, /^Warm/i, /^Cold/i]) {
      expect(options.some((o) => want.test(o)),
        `the list offers ${String(want).replace(/[\\/i^]/g, "")}`, options.join(" | "));
    }
    await page.locator('[role="option"]', { hasText: /^Hot/i }).first().click();
    await page.waitForTimeout(300);

    // The rest of the form, as a booth capture.
    await page.locator('[data-field="firstName"] input').fill("ZZOtemp");
    await page.locator('[data-field="lastName"] input').fill(`Test${stamp}`);
    await page.locator('[data-field="email"] input').fill(EMAIL);
    await page.locator('[data-field="phone"] input').fill(`+15563${stamp}`);
    await page.locator('[data-field="interestedProgram"] input').fill("Business Administration");
    await choose(page, "nationality", /^Indian$/);
    await choose(page, "countryOfResidence", /^India$/);
    await choose(page, "studyLevel", /undergraduate/i);
    await choose(page, "intakeMonth", /september/i);

    // Consent is compulsory on this page — all four channels.
    await page.getByRole("button", { name: /^Yes, they agreed$/ }).first().click();
    await page.waitForTimeout(200);
    // Same row addressing as qa-offline-country-ui.mjs, which this page's
    // consent block was written against.
    for (const label of ["Telephone calls", "SMS", "WhatsApp"]) {
      const row = page.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
      await row.getByRole("button", { name: /^No$/ }).first().click();
      await page.waitForTimeout(200);
    }

    await page.getByRole("button", { name: /save to device|save lead|save/i }).first().click();
    await page.waitForTimeout(2500);
  }

  // ── 3. It reached the device queue ───────────────────────────────────────
  startSection("3. The judgement is written into the device queue");
  {
    const queued = await readQueue(page);
    const mine = queued.find((q) => q?.data?.email === EMAIL);
    expect(!!mine, "★ the capture is in IndexedDB",
      `${queued.length} queued, none matching ${EMAIL}`);
    expect(mine?.data?.leadTemperature === "HOT",
      "★ and it carries HOT, not a blank",
      `queued ${JSON.stringify(mine?.data?.leadTemperature)} — if undefined, toPayload dropped it`);
  }

  // ── 4. …and survives the upload ──────────────────────────────────────────
  startSection("4. It survives the upload into a real student record");
  {
    const upload = page.getByRole("button", { name: /^Upload/i }).first();
    expect(await upload.count() > 0, "the upload button is there");
    await upload.click();

    // Poll rather than sleep: the batch is a round trip and a fixed wait is a
    // race that reports "stripped" on a value that simply had not landed yet.
    let row = null;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      row = await db.lead.findFirst({
        where: { email: EMAIL },
        select: { id: true, leadTemperature: true, stage: true },
      });
      if (row) break;
      await page.waitForTimeout(600);
    }
    expect(!!row, "★ the lead reached the database", "the batch never arrived");
    leadId = row?.id;

    // ★ THE ASSERTION THIS SCRIPT EXISTS FOR. `capturedLeadSchema` is not
    // `.strict()`; an unlisted key is stripped in silence and the batch still
    // answers 201.
    expect(row?.leadTemperature === "HOT",
      "★ the temperature survived the sync route",
      `stored ${JSON.stringify(row?.leadTemperature)} — if null, offline-sync stripped it`);
    expect(row?.stage === "NEW_LEAD", "and the student starts at New Lead",
      `stage ${row?.stage}`);
  }

  // ── 5. The form folds itself back up ─────────────────────────────────────
  startSection("5. It re-folds for the next student in the queue");
  {
    // ★ Unlike the office form this page never closes — the rep saves one lead
    // and the next student steps up. If the section stayed open, the second
    // student would read the first one's section header and then their own
    // temperature being chosen.
    expect(
      await page.getByRole("button", { name: /Pipeline Details/i }).first()
        .getAttribute("aria-expanded") === "false",
      "★ saving a capture folds the rep's section again");
    expect(await page.locator('[data-field="leadTemperature"]').count() === 0,
      "  …and the fields are gone with it");
  }

  startSection("6. No errors in the browser");
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
  // Find it even if the run failed before `leadId` was set, or the whole
  // fixture leaks into the mirror.
  const stray = await db.lead.findFirst({ where: { email: EMAIL }, select: { id: true } });
  const id = leadId ?? stray?.id;
  if (id) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.leadNote.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.activity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
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

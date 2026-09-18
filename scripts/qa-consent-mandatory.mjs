/**
 * Consent is compulsory when capturing a student, and only then.
 *
 *   npx tsx --env-file=.env scripts/qa-consent-mandatory.mjs
 *
 * The consent panel used to sit at the very bottom of the lead form, below
 * Notes, and every channel was optional. It now sits directly under the
 * required personal details, and all four channels must be answered to create a
 * student.
 *
 * WHAT THIS IS PROTECTING
 *
 * Consent is three-valued on purpose: NULL means nobody asked, false means they
 * were asked and declined. Under anti-spam law those are different facts, and
 * only one of them is a record of something that happened.
 *
 * So the rule binds at CAPTURE, where the student is in front of you, and NOT
 * on edit. If editing enforced it, someone fixing a phone number on an old
 * record would be forced to answer four questions they were never present for,
 * with only "yes" and "no" on offer — manufacturing a refusal. This script
 * asserts both halves, because the edit half is the one that is easy to break
 * later and impossible to notice.
 *
 * It also checks the offline page, where the three channel questions did not
 * previously exist at all, and the upload route, which silently strips any key
 * its schema does not list.
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, oldLeadId, madeIds = [];

const CHANNELS = ["Telephone calls", "SMS", "WhatsApp"];

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });

  // A student created through the API, so its consent columns are all NULL —
  // exactly like every record that predates this rule.
  const old = await api(ctx.jar, "POST", "/api/leads", {
    firstName: "ZZConsentOld", lastName: `T${stamp}`,
    email: `zz.consent.old.${stamp}@example.invalid`, phone: `+15571${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
    interestedProgram: "Business Administration", studyLevel: "UNDERGRADUATE",
    intakeYear: 2026, intakeMonth: 9, sourceId: source?.id,
    intendedDestination: "Canada",
  });
  oldLeadId = idOf(old.payload);
  madeIds.push(oldLeadId);

  startSection("the fixture for the edit case is genuinely blank");
  const before = await db.lead.findUnique({
    where: { id: oldLeadId },
    select: { marketingConsent: true, phoneContactConsent: true },
  });
  expect(
    before.marketingConsent === null && before.phoneContactConsent === null,
    "the fixture really has blank consent",
    "otherwise the edit checks below prove nothing"
  );

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

  // ── 1. Position: consent now sits above the later sections ───────────────
  startSection("the consent panel sits under the required details");

  await page.goto(`${BROWSER_BASE}/students`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /add lead|new lead|add student/i }).first().click();
  await page.waitForTimeout(2000);

  let dlg = page.locator('[role="dialog"]').first();
  let text = await dlg.innerText();

  // Lowercased: the section headings carry Tailwind's `uppercase`, and
  // innerText returns the RENDERED text, so "Academic Information" comes back
  // as "ACADEMIC INFORMATION" and indexOf finds nothing. The first version of
  // this check compared two -1s and passed while proving nothing.
  const lower = text.toLowerCase();
  const at = (needle) => lower.indexOf(needle.toLowerCase());
  const iPersonal = at("Personal Information");
  const iConsent = at("May we email them?");
  const iAcademic = at("Academic Information");
  const iNotes = lower.lastIndexOf("notes");

  // Every marker must actually be present, or the ordering checks below are
  // comparisons between -1s.
  expect(iPersonal >= 0, "the Personal Information heading was found");
  expect(iConsent >= 0, "the consent panel was found");
  expect(iAcademic >= 0, "the Academic Information heading was found");
  expect(iNotes >= 0, "the Notes field was found");

  expect(
    iConsent > iPersonal,
    "it comes after the personal details",
    `consent at ${iConsent}, personal at ${iPersonal}`
  );
  expect(
    iConsent < iAcademic,
    "and before Academic Information",
    `consent at ${iConsent}, academic at ${iAcademic}`
  );
  expect(
    iConsent < iNotes,
    "it is no longer stranded at the bottom under Notes",
    `consent at ${iConsent}, notes at ${iNotes}`
  );
  for (const label of CHANNELS) {
    expect(text.includes(label), `the ${label} question is on the create form`);
  }

  // ── 2. Creating: the answers are compulsory ──────────────────────────────
  startSection("a student cannot be captured without the answers");

  expect(
    !/Didn't ask/i.test(text),
    "\"Didn't ask\" is not offered while capturing",
    "the student is in front of you, so there is no honest 'didn't ask'"
  );

  const email = `zz.consent.new.${stamp}@example.invalid`;
  await dlg.locator('input[name="firstName"]').fill("ZZConsentNew");
  await dlg.locator('input[name="lastName"]').fill(`T${stamp}`);
  await dlg.locator('input[name="email"]').fill(email);
  await dlg.locator('input[name="phone"]').fill(`+15572${stamp}`);
  await dlg.locator('[data-field="nationality"] [role="combobox"]').click();
  await page.waitForTimeout(400);
  await page.keyboard.type("indian");
  await page.waitForTimeout(400);
  await page.locator('[role="option"]', { hasText: /^Indian$/ }).first().click();
  await dlg.locator('[data-field="countryOfResidence"] [role="combobox"]').click();
  await page.waitForTimeout(400);
  await page.keyboard.type("india");
  await page.waitForTimeout(400);
  await page.locator('[role="option"]', { hasText: /^India$/ }).first().click();
  await dlg.locator('input[name="interestedProgram"]').fill("Business Administration");

  // Submit with consent untouched. It must be refused.
  await dlg.getByRole("button", { name: /^(create|save|add)/i }).first().click();
  await page.waitForTimeout(2500);

  const leakedEarly = await db.lead.count({ where: { email } });
  expect(
    leakedEarly === 0,
    "the student is NOT created while consent is unanswered",
    `${leakedEarly} row(s) written — the rule is not being enforced`
  );
  text = await dlg.innerText();
  expect(
    /record their answer/i.test(text),
    "the form says which answer is missing",
    "refusing to save without saying why is worse than not refusing"
  );

  // Now answer all four and save.
  await dlg.getByRole("button", { name: /^Yes, they agreed$/ }).first().click();
  for (const label of CHANNELS) {
    const row = dlg.locator("div").filter({ hasText: new RegExp(`^${label}`) }).last();
    await row.getByRole("button", { name: /^No$/ }).first().click();
    await page.waitForTimeout(200);
  }
  await dlg.getByRole("button", { name: /^(create|save|add)/i }).first().click();

  let made = null;
  const started = Date.now();
  while (Date.now() - started < 25000) {
    made = await db.lead.findFirst({
      where: { email },
      select: {
        id: true, marketingConsent: true, phoneContactConsent: true,
        smsContactConsent: true, whatsappContactConsent: true,
      },
    });
    if (made) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (made) madeIds.push(made.id);

  expect(!!made, "with every answer given, the student is created");
  if (made) {
    expect(made.marketingConsent === true, "the email answer is stored as agreed");
    expect(
      made.phoneContactConsent === false &&
        made.smsContactConsent === false &&
        made.whatsappContactConsent === false,
      "a declined channel is stored as false, not left blank",
      `phone=${made.phoneContactConsent} sms=${made.smsContactConsent} wa=${made.whatsappContactConsent}`
    );
  }

  // ── 3. Editing an older student must NOT force an answer ─────────────────
  startSection("editing an older student is not forced to invent consent");

  await page.goto(`${BROWSER_BASE}/students/${oldLeadId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: /edit lead|edit/i }).first().click();
  await page.waitForTimeout(2000);
  dlg = page.locator('[role="dialog"]').first();
  text = await dlg.innerText();

  expect(
    /Didn't ask/i.test(text),
    "\"Didn't ask\" is still offered when editing",
    "without it, staff must manufacture a refusal for records nobody asked"
  );

  const newPhone = `+15573${stamp}`;
  await dlg.locator('input[name="phone"]').fill(newPhone);
  await dlg.getByRole("button", { name: /save|update/i }).first().click();

  let after = null;
  const t2 = Date.now();
  while (Date.now() - t2 < 25000) {
    after = await db.lead.findUnique({
      where: { id: oldLeadId },
      select: {
        phone: true, marketingConsent: true, phoneContactConsent: true,
        smsContactConsent: true, whatsappContactConsent: true,
      },
    });
    if (after?.phone === newPhone) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  expect(after?.phone === newPhone, "the edit saved without answering consent");
  expect(
    after?.marketingConsent === null &&
      after?.phoneContactConsent === null &&
      after?.smsContactConsent === null &&
      after?.whatsappContactConsent === null,
    "and the blanks stayed blank rather than becoming refusals",
    `stored ${JSON.stringify(after)}`
  );

  // ── 4. The upload route must accept all four ─────────────────────────────
  // The offline schema is not `.strict()`, so an unlisted key is dropped and
  // the route still answers 201. Four questions on screen, one stored.
  startSection("the offline upload keeps every channel");

  const capEmail = `zz.consent.sync.${stamp}@example.invalid`;
  const res = await api(ctx.jar, "POST", "/api/leads/offline-sync", {
    leads: [{
      // Must be a real UUID: the route validates it as the idempotency key.
      captureId: randomUUID(),
      firstName: "ZZConsentSync", lastName: `T${stamp}`,
      email: capEmail, phone: `+15574${stamp}`,
      nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "Business Administration", studyLevel: "UNDERGRADUATE",
      intakeYear: 2026, intakeMonth: 9,
      capturedAt: new Date().toISOString(),
      marketingConsent: true,
      phoneContactConsent: false,
      smsContactConsent: true,
      whatsappContactConsent: false,
      doNotContact: false,
    }],
  });
  expect(res.status < 300, "the batch uploaded", `status ${res.status} ${JSON.stringify(res.payload).slice(0, 200)}`);

  const synced = await db.lead.findFirst({
    where: { email: capEmail },
    select: {
      id: true, marketingConsent: true, phoneContactConsent: true,
      smsContactConsent: true, whatsappContactConsent: true, doNotContact: true,
    },
  });
  if (synced) madeIds.push(synced.id);
  expect(!!synced, "the uploaded lead exists");
  if (synced) {
    expect(
      synced.marketingConsent === true && synced.phoneContactConsent === false &&
        synced.smsContactConsent === true && synced.whatsappContactConsent === false,
      "all four channels survived the upload",
      `stored ${JSON.stringify(synced)} — a stripped key would show as null here, not as an error`
    );
  }

  startSection("no page errors");
  expect(pageErrors.length === 0, "no client-side errors", pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("\nSCRIPT ERROR:", e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const id of madeIds.filter(Boolean)) {
    for (const run of [
      () => db.leadActivity.deleteMany({ where: { leadId: id } }),
      () => db.leadChecklistItem.deleteMany({ where: { leadId: id } }),
      () => db.lead.delete({ where: { id } }),
    ]) { try { await run(); } catch { /* best effort */ } }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

/**
 * Three bugs found by walking a test student through the pipeline on
 * production by hand.
 *
 *   npx tsx --env-file=.env scripts/qa-lead-save-bugs.mjs
 *
 * 1. EDITING ANY STUDENT FAILED. `updateLeadSchema` is `.strict()` and did not
 *    list `passportNumber`, which the edit form sends on every save — so zod
 *    rejected the whole request with 422 and nothing on the form could be
 *    changed. This is the one that made the stage gates look unsatisfiable.
 *
 * 2. CREATE SILENTLY DISCARDED FIVE FIELDS. The form sends
 *    `counsellingOutcomeEnum` and the four contact-consent answers; the create
 *    schema listed none of them, so zod stripped them and creation returned
 *    201 having thrown them away.
 *
 * 3. THE BLOCKER PANEL LIED. The gate reads a boolean
 *    `hasInstitutionInterest`; only the stage route derived it, so the student
 *    page always reported "at least one institution interest is required",
 *    however many journeys existed.
 */
import { chromium } from "playwright";
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary, idOf,
} from "./qa-lib.mjs";

const BROWSER_BASE = BASE.replace("127.0.0.1", "localhost");
const stamp = Date.now().toString().slice(-6);
let ctx, browser, leadId, interestId;

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });

  // ── 2. Create must keep everything the form sends ────────────────────────
  startSection("create keeps the fields the form sends");

  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });

  const created = await api(ctx.jar, "POST", "/api/leads", {
    firstName: "ZZSave", lastName: `Test${stamp}`,
    email: `zz.save.${stamp}@example.invalid`, phone: `+15552${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
    interestedProgram: "Business Administration",
    studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
    sourceId: source?.id,
    intendedDestination: "Canada", preferredCountry: "Canada",
    budgetRange: "UNDER_10K", currentQualification: "BSc Computer Science",
    counsellingOutcome: "Agreed to apply.",
    // The five that used to vanish.
    counsellingOutcomeEnum: "PROCEED_TO_ELIGIBILITY",
    phoneContactConsent: true,
    smsContactConsent: false,
    whatsappContactConsent: true,
    doNotContact: false,
  });
  expect(created.status === 201, "the student is created", `status ${created.status}`);
  leadId = idOf(created.payload);

  const row = await db.lead.findUnique({
    where: { id: leadId },
    select: {
      counsellingOutcomeEnum: true, phoneContactConsent: true,
      smsContactConsent: true, whatsappContactConsent: true,
      doNotContact: true, doNotContactAt: true,
    },
  });
  expect(
    row.counsellingOutcomeEnum === "PROCEED_TO_ELIGIBILITY",
    "the counselling outcome is stored",
    `got ${row.counsellingOutcomeEnum} — this is what left the Contacted gate unsatisfiable`
  );
  expect(row.phoneContactConsent === true, "a granted phone consent is stored");
  expect(
    row.smsContactConsent === false,
    "a REFUSED sms consent is stored as false, not lost",
    "the difference between 'declined' and 'never asked' is the whole point of a consent record"
  );
  expect(row.whatsappContactConsent === true, "whatsapp consent is stored");
  expect(row.doNotContact === false, "do-not-contact is stored");
  expect(
    row.doNotContactAt === null,
    "no do-not-contact date when no instruction was given",
    "a stale date would read as a standing request"
  );

  // ── 1. Editing must work at all ──────────────────────────────────────────
  startSection("editing a student works");

  // Exactly what the form sends: passportNumber on every save, and a dateOfBirth
  // when the box is filled. Both used to be rejected outright.
  const edited = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
    firstName: "ZZSave",
    passportNumber: "X1234567",
    dateOfBirth: new Date("2001-05-14T00:00:00.000Z").toISOString(),
    currentQualification: "BSc Computer Science (updated)",
  });
  expect(
    edited.status === 200,
    "a save carrying passportNumber is accepted",
    `status ${edited.status} — ${JSON.stringify(edited.payload).slice(0, 200)}`
  );

  const afterEdit = await db.lead.findUnique({
    where: { id: leadId },
    select: { passportNumber: true, dateOfBirth: true, currentQualification: true },
  });
  expect(afterEdit.passportNumber === "X1234567", "the passport number is saved");
  expect(!!afterEdit.dateOfBirth, "the date of birth is saved");
  expect(
    afterEdit.currentQualification?.includes("updated"),
    "the other edited fields are saved too",
    "the whole request used to be refused, so nothing changed"
  );

  // Clearing the passport must also work — that is the `null` the form sends
  // for an empty box.
  const cleared = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, { passportNumber: null });
  expect(cleared.status === 200, "an empty passport box is accepted", `status ${cleared.status}`);

  // ── 3. The blocker panel must not lie about journeys ─────────────────────
  startSection("the blocker panel counts journeys that exist");

  const institution = await db.institution.findFirst({
    where: { deletedAt: null }, select: { id: true },
  });
  // The collection endpoint, with `leadId` in the body — not a nested route,
  // and the field is `program`, not `programme`.
  const interest = await api(ctx.jar, "POST", "/api/institution-interests", {
    leadId,
    institutionId: institution.id,
    program: "Business Administration",
    intakeYear: 2026,
    intakeMonth: 9,
    studyLevel: "UNDERGRADUATE",
  });
  expect(interest.status === 201 || interest.status === 200,
    "an institution interest is created",
    `status ${interest.status} — ${JSON.stringify(interest.payload).slice(0, 200)}`);
  interestId = idOf(interest.payload);
  const journeys = await db.institutionInterest.count({ where: { leadId, closedAt: null } });
  expect(journeys > 0, "the student has an open journey", `count ${journeys}`);

  // The panel only ever shows the NEXT stage's gate, and the interest rule
  // belongs to Contacted (to reach Qualified). At New Lead it is correctly
  // silent — so the student has to be moved on before this can be asserted at
  // all. Checking it at New Lead passes for the wrong reason.
  await db.lead.update({ where: { id: leadId }, data: { stage: "CONTACTED" } });

  browser = await chromium.launch();
  const bctx = await browser.newContext({ viewport: { width: 1500, height: 1200 } });
  await bctx.addCookies(
    [...ctx.jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" }))
  );
  const page = await bctx.newPage();
  await page.goto(`${BROWSER_BASE}/students/${leadId}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();

  expect(
    !/At least one institution interest is required/i.test(body),
    "the panel no longer asks for an interest the student already has",
    "the on-screen blocker list disagrees with the database"
  );
  ok("(the move itself was never blocked — the route computed the flag correctly)");
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  if (browser) await browser.close();
  if (leadId) {
    for (const run of [
      () => db.leadChecklistItem.deleteMany({ where: { leadId } }),
      () => db.leadActivity.deleteMany({ where: { leadId } }),
      () => db.institutionInterest.deleteMany({ where: { leadId } }),
      () => db.lead.delete({ where: { id: leadId } }),
    ]) { try { await run(); } catch { /* best effort */ } }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

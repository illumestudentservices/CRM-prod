/**
 * Post-deploy verification for the Student Pipeline work, run ON PRODUCTION.
 *
 * Deliberately minimal. The full suites belong on the mirror; this exists only
 * to prove the three things a code inspection cannot:
 *
 *   1. a real account can log in through the real form, MFA included;
 *   2. the interest stage route is genuinely gated on the live build — this is
 *      the exact request that returned 200 before the deploy;
 *   3. the migration 037 columns accept and persist a write.
 *
 * Must run ON the VPS from /var/www/illume-crm: production's database is not
 * reachable from a local tunnel by design, and Node resolves node_modules by
 * walking up from the script's own path.
 *
 *   cd /var/www/illume-crm
 *   BASE_URL=https://illumestudentservices.cloud ALLOW_PROD_QA=yes-i-mean-it \
 *     node --import tsx --env-file=.env scripts/prod-verify-pipeline.mjs
 *
 * Creates one disposable SUPER_ADMIN and a handful of fixture rows, removes all
 * of them, and asserts every row count returns to the baseline it recorded
 * first. `destroyUser` only WARNS on a foreign key and leaves the account
 * behind, so fixtures are deleted BEFORE the account and the counts are the
 * real check — never assume the delete ran.
 */
import {
  BASE,
  db,
  api,
  createAndLogin,
  destroyUser,
  startSection,
  expect,
  ok,
  summary,
  idOf,
  TAG,
} from "./qa-lib.mjs";

const created = { leads: [], interests: [], applications: [] };
let ctx = null;

const TABLES = [
  "user",
  "employee",
  "lead",
  "institutionInterest",
  "leadApplication",
  "institution",
  "auditLog",
];

async function snapshot() {
  const out = {};
  for (const t of TABLES) out[t] = await db[t].count();
  return out;
}

try {
  startSection("Target");
  const who = await db.$queryRawUnsafe("SELECT current_database() AS db, current_user AS usr");
  console.log(`  database: ${JSON.stringify(who)}`);
  console.log(`  base URL: ${BASE}`);
  const baseline = await snapshot();
  console.log(`  baseline: ${JSON.stringify(baseline)}`);

  startSection("Real login through the real form");
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  ok("disposable SUPER_ADMIN created, MFA enrolled, logged in");

  const me = await api(ctx.jar, "GET", "/api/leads?limit=1");
  expect(me.status === 200, "an authenticated API call succeeds", `status ${me.status}`);

  startSection("THE HEADLINE — interest stage route is gated on the live build");

  const institution = await db.institution.findFirstOrThrow({ where: { deletedAt: null } });

  const leadRes = await api(ctx.jar, "POST", "/api/leads", {
    firstName: TAG,
    lastName: "ProdVerify",
    email: `pverify-${TAG.toLowerCase()}@illume.local`,
    phone: "+971500000199",
    nationality: "British",
    countryOfResidence: "United Arab Emirates",
    interestedProgram: "Verification",
    studyLevel: "UNDERGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
  });
  const leadId = idOf(leadRes.payload);
  expect(!!leadId, "fixture student created", `status ${leadRes.status}`);
  if (leadId) created.leads.push(leadId);

  const intRes = await api(ctx.jar, "POST", "/api/institution-interests", {
    leadId,
    institutionId: institution.id,
    program: "Verification",
    intakeYear: 2027,
    intakeMonth: 9,
    studyLevel: "UNDERGRADUATE",
  });
  const interestId = idOf(intRes.payload);
  expect(!!interestId, "fixture journey created", `status ${intRes.status}`);
  if (interestId) created.interests.push(interestId);

  // Before this deploy, this exact request returned 200 and took a brand-new
  // student to Enrolled, skipping all six intermediate stages.
  const jump = await api(ctx.jar, "POST", `/api/institution-interests/${interestId}/stage`, {
    toStage: "ENROLLED",
  });
  expect(jump.status === 422, "New Lead → Enrolled is REFUSED (was 200)", `got ${jump.status}`);
  expect(
    Array.isArray(jump.payload?.blockers) && jump.payload.blockers.length > 0,
    "the refusal names its blockers",
    JSON.stringify(jump.payload)?.slice(0, 160)
  );

  const intAfter = await db.institutionInterest.findUnique({ where: { id: interestId } });
  const leadAfter = await db.lead.findUnique({ where: { id: leadId } });
  expect(intAfter?.stage === "NEW_LEAD", "the journey did not move", `stage=${intAfter?.stage}`);
  expect(leadAfter?.stage === "NEW_LEAD", "the student did not move", `stage=${leadAfter?.stage}`);
  expect(leadAfter?.isConverted === false, "the student was not marked converted");

  startSection("Migration 037 columns accept a write on production");

  const appRes = await api(ctx.jar, "POST", `/api/leads/${leadId}/applications`, {
    institutionId: institution.id,
    program: "Verification",
  });
  const appId = appRes.payload?.application?.id ?? idOf(appRes.payload);
  expect(!!appId, "fixture application created", `status ${appRes.status}`);
  if (appId) created.applications.push(appId);

  const patched = await api(ctx.jar, "PATCH", `/api/leads/${leadId}/applications`, {
    applicationId: appId,
    submissionEvidence: "Prod verification — confirmation email on file",
    expectedDecisionDate: "2026-12-01T00:00:00.000Z",
    outstandingRequirement: "Certified transcript",
    acceptanceDate: "2026-11-01T00:00:00.000Z",
    status: "ADDITIONAL_DOCUMENTS_REQUIRED",
    depositStatus: "WAIVED",
  });
  const appRow = await db.leadApplication.findUnique({ where: { id: appId } });
  expect(patched.ok, "the new application fields are accepted", `status ${patched.status}`);
  expect(
    !!appRow?.submissionEvidence,
    "submissionEvidence persisted — this is what unblocks an application with no reference"
  );
  expect(!!appRow?.expectedDecisionDate, "expectedDecisionDate persisted");
  expect(!!appRow?.acceptanceDate, "acceptanceDate persisted");
  expect(appRow?.status === "ADDITIONAL_DOCUMENTS_REQUIRED", "institution-side status persisted", String(appRow?.status));
  expect(appRow?.depositStatus === "WAIVED", "deposit status WAIVED persisted", String(appRow?.depositStatus));
  expect(appRow?.depositPaid === false, "depositPaid derived false from WAIVED", String(appRow?.depositPaid));

  const consent = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
    phoneContactConsent: false,
    doNotContact: true,
  });
  const leadRow = await db.lead.findUnique({ where: { id: leadId } });
  expect(consent.ok, "the new consent fields are accepted", `status ${consent.status}`);
  expect(
    leadRow?.phoneContactConsent === false,
    "a DECLINED phone consent is stored as false, not null",
    String(leadRow?.phoneContactConsent)
  );
  expect(!!leadRow?.doNotContactAt, "doNotContact stamped its date", String(leadRow?.doNotContactAt));

  startSection("Teardown — footprint must return to zero");

  for (const id of created.applications) await db.leadApplication.deleteMany({ where: { id } });
  for (const id of created.interests) await db.institutionInterest.deleteMany({ where: { id } });
  for (const id of created.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } });
    await db.leadChecklistItem.deleteMany({ where: { leadId: id } });
    await db.leadNote.deleteMany({ where: { leadId: id } });
    await db.leadDocument.deleteMany({ where: { leadId: id } });
    await db.institutionInterest.deleteMany({ where: { leadId: id } });
    await db.leadApplication.deleteMany({ where: { leadId: id } });
    await db.lead.deleteMany({ where: { id } });
  }
  ok("fixture rows removed");

  await destroyUser(ctx);
  ctx = null;

  const after = await snapshot();
  console.log(`  after:    ${JSON.stringify(after)}`);
  for (const t of TABLES) {
    // audit_logs is expected to GROW: the login and the writes above are real
    // recorded actions and deleting the trail would be the wrong instinct.
    if (t === "auditLog") {
      expect(after[t] >= baseline[t], `auditLog kept its trail (${baseline[t]} → ${after[t]})`);
      continue;
    }
    expect(after[t] === baseline[t], `${t} back to baseline`, `${baseline[t]} → ${after[t]}`);
  }
} catch (e) {
  startSection("Fatal");
  console.error(String(e?.stack ?? e).slice(0, 1200));
  expect(false, "suite threw", String(e?.message ?? e).slice(0, 200));
} finally {
  if (ctx) {
    try {
      await destroyUser(ctx);
    } catch {
      /* the count assertions are the real check */
    }
  }
  await db.$disconnect();
  summary();
}

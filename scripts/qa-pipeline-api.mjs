/**
 * Spec pages 2-11 (Student Pipeline) — API surface conformance.
 *
 * Covers what the pure gate suite cannot: that the routes ACCEPT the values the
 * specification names, that they PERSIST them, and that the interest stage route
 * is gated at all. The gate's own rules are proven in qa-pipeline-gate.mjs.
 *
 * Creates a disposable SUPER_ADMIN and its fixtures, then removes both and
 * asserts the row counts return to baseline.
 *
 * Run: npx tsx scripts/qa-pipeline-api.mjs
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
  fail,
  summary,
  idOf,
  TAG,
} from "./qa-lib.mjs";

const created = { leads: [], interests: [], applications: [], institutions: [] };
let ctx = null;

/** Row counts we must return to. */
async function snapshot() {
  const out = {};
  for (const m of ["lead", "institutionInterest", "leadApplication", "user", "institution"]) {
    out[m] = await db[m].count();
  }
  return out;
}

async function main() {
  startSection("Setup");
  const baseline = await snapshot();
  console.log(`BASE=${BASE}  baseline=${JSON.stringify(baseline)}`);

  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  ok("disposable SUPER_ADMIN logged in");

  // ── Fixtures ─────────────────────────────────────────────────────────────
  startSection("Fixtures");

  // Reuse a real institution if one exists; otherwise make one and clean it up.
  let institution = await db.institution.findFirst({ where: { deletedAt: null } });
  if (!institution) {
    institution = await db.institution.create({
      data: { name: `${TAG} Test University`, country: "Canada", createdById: ctx.user.id },
    });
    created.institutions.push(institution.id);
  }
  ok(`institution ${institution.name}`);

  const leadRes = await api(ctx.jar, "POST", "/api/leads", {
    firstName: TAG,
    lastName: "Pipeline",
    email: `${TAG.toLowerCase()}-pipeline@illume.local`,
    phone: "+971500111222",
    nationality: "British",
    countryOfResidence: "United Arab Emirates",
    interestedProgram: "Computer Science",
    studyLevel: "UNDERGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
  });
  expect(leadRes.status === 201 || leadRes.status === 200, "lead created", `status ${leadRes.status} ${JSON.stringify(leadRes.payload)?.slice(0, 200)}`);
  const leadId = idOf(leadRes.payload);
  if (!leadId) {
    fail("no lead id returned — aborting", JSON.stringify(leadRes.payload)?.slice(0, 300));
    return;
  }
  created.leads.push(leadId);

  const intRes = await api(ctx.jar, "POST", "/api/institution-interests", {
    leadId,
    institutionId: institution.id,
    program: "Computer Science",
    intakeYear: 2027,
    intakeMonth: 9,
    studyLevel: "UNDERGRADUATE",
  });
  expect(intRes.status === 200 || intRes.status === 201, "interest created", `status ${intRes.status}`);
  const interestId = idOf(intRes.payload);
  if (interestId) created.interests.push(interestId);

  // ── THE HEADLINE: the interest stage route is gated ──────────────────────
  startSection("Interest stage route is gated (was completely open)");

  const jump = await api(ctx.jar, "POST", `/api/institution-interests/${interestId}/stage`, {
    toStage: "ENROLLED",
  });
  expect(
    jump.status === 422,
    "New Lead → Enrolled in one request is refused with 422",
    `got ${jump.status}: ${JSON.stringify(jump.payload)?.slice(0, 200)}`
  );
  expect(
    Array.isArray(jump.payload?.blockers) && jump.payload.blockers.length > 0,
    "refusal names its blockers",
    JSON.stringify(jump.payload)?.slice(0, 200)
  );

  const afterJump = await db.institutionInterest.findUnique({ where: { id: interestId } });
  expect(afterJump?.stage === "NEW_LEAD", "the interest did not move", `stage=${afterJump?.stage}`);
  const leadAfterJump = await db.lead.findUnique({ where: { id: leadId } });
  expect(
    leadAfterJump?.stage === "NEW_LEAD",
    "the student profile did not move either",
    `stage=${leadAfterJump?.stage}`
  );
  expect(
    leadAfterJump?.isConverted === false,
    "the student was not marked converted",
    `isConverted=${leadAfterJump?.isConverted}`
  );

  // A one-step move is still gated on its own conditions rather than waved through.
  const oneStep = await api(ctx.jar, "POST", `/api/institution-interests/${interestId}/stage`, {
    toStage: "CONTACTED",
  });
  expect(
    oneStep.status === 422,
    "New Lead → Contacted is gated on its own conditions",
    `got ${oneStep.status}`
  );

  // Backwards still needs a reason, and same-stage is rejected.
  const same = await api(ctx.jar, "POST", `/api/institution-interests/${interestId}/stage`, {
    toStage: "NEW_LEAD",
  });
  expect(same.status === 400, "moving to the current stage is refused", `got ${same.status}`);

  // ── Spec §5 — counsellingOutcomeEnum is now writable ────────────────────
  startSection("§5 counselling outcome (column was read by nothing)");

  for (const value of [
    "PROCEED_TO_ELIGIBILITY",
    "FURTHER_COUNSELLING_REQUIRED",
    "NOT_READY_YET",
    "UNABLE_TO_CONTACT",
    "NOT_SUITABLE",
    "LOST",
    "DEFERRED",
  ]) {
    const r = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
      counsellingOutcomeEnum: value,
    });
    const row = await db.lead.findUnique({ where: { id: leadId } });
    expect(
      r.ok && row?.counsellingOutcomeEnum === value,
      `counselling outcome ${value} saved`,
      `status ${r.status}, stored ${row?.counsellingOutcomeEnum}`
    );
  }
  const badOutcome = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
    counsellingOutcomeEnum: "NOT_A_REAL_OUTCOME",
  });
  expect(badOutcome.status === 422, "an invalid counselling outcome is refused", `got ${badOutcome.status}`);

  // ── Spec §6 / §11 — eligibility outcome and enrolment status ────────────
  startSection("§6 eligibility outcome, §11 enrolment status");

  for (const value of ["ELIGIBLE", "PROVISIONALLY_ELIGIBLE", "FURTHER_INFO_REQUIRED", "NOT_ELIGIBLE"]) {
    const r = await api(ctx.jar, "PATCH", `/api/institution-interests/${interestId}`, {
      eligibilityOutcome: value,
    });
    const row = await db.institutionInterest.findUnique({ where: { id: interestId } });
    expect(
      r.ok && row?.eligibilityOutcome === value,
      `eligibility outcome ${value} saved`,
      `status ${r.status}, stored ${row?.eligibilityOutcome}`
    );
  }

  for (const value of [
    "ENROLLED",
    "REGISTERED",
    "STARTED_STUDIES",
    "DID_NOT_ARRIVE",
    "WITHDREW_BEFORE_START",
    "DEFERRED_AFTER_DEPOSIT",
  ]) {
    const r = await api(ctx.jar, "PATCH", `/api/institution-interests/${interestId}`, {
      enrolmentStatus: value,
    });
    const row = await db.institutionInterest.findUnique({ where: { id: interestId } });
    expect(
      r.ok && row?.enrolmentStatus === value,
      `enrolment status ${value} saved`,
      `status ${r.status}, stored ${row?.enrolmentStatus}`
    );
  }

  // ── Application enum widening ───────────────────────────────────────────
  startSection("Application values the API used to refuse");

  const appRes = await api(ctx.jar, "POST", `/api/leads/${leadId}/applications`, {
    institutionId: institution.id,
    program: "Computer Science",
  });
  expect(appRes.ok, "application created", `status ${appRes.status} ${JSON.stringify(appRes.payload)?.slice(0, 200)}`);
  const appId = appRes.payload?.application?.id ?? idOf(appRes.payload);
  if (appId) created.applications.push(appId);

  const patchApp = (body) =>
    api(ctx.jar, "PATCH", `/api/leads/${leadId}/applications`, { applicationId: appId, ...body });

  // Spec §9 offer types — three of five were rejected outright before.
  for (const v of ["CONDITIONAL", "UNCONDITIONAL", "ALTERNATIVE_PROGRAMME", "WAITLIST", "OTHER"]) {
    const r = await patchApp({ offerType: v });
    const row = await db.leadApplication.findUnique({ where: { id: appId } });
    expect(r.ok && row?.offerType === v, `offer type ${v} accepted`, `status ${r.status}, stored ${row?.offerType}`);
  }

  // Spec §9 student decisions — four of six were rejected outright before.
  for (const v of [
    "ACCEPTED",
    "INTENDS_TO_ACCEPT",
    "CONSIDERING",
    "AWAITING_OTHERS",
    "DECLINED",
    "REQUESTING_DEFERRAL",
  ]) {
    const r = await patchApp({ studentDecision: v });
    const row = await db.leadApplication.findUnique({ where: { id: appId } });
    expect(
      r.ok && row?.studentDecision === v,
      `student decision ${v} accepted`,
      `status ${r.status}, stored ${row?.studentDecision}`
    );
  }

  // Spec §7 submission methods — "internal admissions support" was unreachable.
  for (const v of ["UNIVERSITY_PORTAL", "AGENT_PORTAL", "EMAIL", "DIRECT", "INTERNAL", "OTHER"]) {
    const r = await patchApp({ submissionMethod: v });
    const row = await db.leadApplication.findUnique({ where: { id: appId } });
    expect(
      r.ok && row?.submissionMethod === v,
      `submission method ${v} accepted`,
      `status ${r.status}, stored ${row?.submissionMethod}`
    );
  }

  // Spec §10 deposit statuses — all six were unreachable.
  startSection("§10 deposit status, amount and currency");
  for (const v of ["NOT_REQUIRED", "PENDING", "PAID", "PARTIALLY_PAID", "WAIVED", "REFUNDED"]) {
    const r = await patchApp({ depositStatus: v });
    const row = await db.leadApplication.findUnique({ where: { id: appId } });
    expect(r.ok && row?.depositStatus === v, `deposit status ${v} accepted`, `status ${r.status}, stored ${row?.depositStatus}`);
    // The boolean must agree with the enum, since old readers still use it.
    expect(
      row?.depositPaid === (v === "PAID"),
      `depositPaid derived correctly for ${v}`,
      `depositPaid=${row?.depositPaid}`
    );
  }

  const money = await patchApp({ depositAmount: 2500.5, depositCurrency: "cad" });
  const moneyRow = await db.leadApplication.findUnique({ where: { id: appId } });
  expect(money.ok && moneyRow?.depositAmount === 2500.5, "deposit amount saved", `stored ${moneyRow?.depositAmount}`);
  expect(moneyRow?.depositCurrency === "CAD", "currency normalised to upper case", `stored ${moneyRow?.depositCurrency}`);

  // ── Fields the API accepted but no screen sent ──────────────────────────
  startSection("§8/§9 fields that had no input control");

  const conds = await patchApp({ offerConditions: "IELTS 6.5 overall, no band below 6.0" });
  const condRow = await db.leadApplication.findUnique({ where: { id: appId } });
  expect(
    conds.ok && condRow?.offerConditions?.includes("IELTS 6.5"),
    "offer conditions saved",
    `stored ${condRow?.offerConditions}`
  );

  const offerDate = await patchApp({ offerReceivedAt: "2026-05-01T00:00:00.000Z" });
  const dateRow = await db.leadApplication.findUnique({ where: { id: appId } });
  expect(
    offerDate.ok && dateRow?.offerReceivedAt?.toISOString().startsWith("2026-05-01"),
    "offer date saved",
    `stored ${dateRow?.offerReceivedAt?.toISOString()}`
  );

  for (const v of ["SUBMITTED", "AWAITING_DECISION", "OFFER_RECEIVED", "ACCEPTED", "REJECTED", "WITHDRAWN"]) {
    const r = await patchApp({ status: v });
    const row = await db.leadApplication.findUnique({ where: { id: appId } });
    expect(r.ok && row?.status === v, `application status ${v} accepted`, `status ${r.status}, stored ${row?.status}`);
  }

  // ── The backwards-reset bug ─────────────────────────────────────────────
  startSection("Adding a first journey no longer resets the student backwards");

  const advanced = await api(ctx.jar, "POST", "/api/leads", {
    firstName: TAG,
    lastName: "Advanced",
    email: `${TAG.toLowerCase()}-advanced@illume.local`,
    phone: "+971500333444",
    nationality: "British",
    countryOfResidence: "United Arab Emirates",
    interestedProgram: "Law",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
  });
  const advId = idOf(advanced.payload);
  if (!advId) {
    fail("could not create the second lead", JSON.stringify(advanced.payload)?.slice(0, 200));
  } else {
    created.leads.push(advId);
    // Put the student well down the funnel directly, the way the old data got
    // there — this is about the mirror, not about the gate.
    await db.lead.update({ where: { id: advId }, data: { stage: "DEPOSIT_PAID" } });

    const newInterest = await api(ctx.jar, "POST", "/api/institution-interests", {
      leadId: advId,
      institutionId: institution.id,
      program: "Law",
      intakeYear: 2027,
      intakeMonth: 9,
      studyLevel: "POSTGRADUATE",
    });
    if (idOf(newInterest.payload)) created.interests.push(idOf(newInterest.payload));

    const after = await db.lead.findUnique({ where: { id: advId } });
    expect(
      after?.stage === "DEPOSIT_PAID",
      "student at Deposit Paid stays there when a New Lead journey is added",
      `stage=${after?.stage} (was thrown back to NEW_LEAD before this fix)`
    );
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
  startSection("Cleanup");

  // Fixtures BEFORE the user: destroyUser only warns on a foreign key and
  // leaves the account behind, so a leaked lead leaks the account with it.
  for (const id of created.applications) {
    await db.leadApplication.deleteMany({ where: { id } });
  }
  for (const id of created.interests) {
    await db.institutionInterest.deleteMany({ where: { id } });
  }
  for (const id of created.leads) {
    await db.leadActivity.deleteMany({ where: { leadId: id } });
    await db.leadChecklistItem.deleteMany({ where: { leadId: id } });
    await db.leadNote.deleteMany({ where: { leadId: id } });
    await db.leadDocument.deleteMany({ where: { leadId: id } });
    await db.institutionInterest.deleteMany({ where: { leadId: id } });
    await db.leadApplication.deleteMany({ where: { leadId: id } });
    await db.lead.deleteMany({ where: { id } });
  }
  for (const id of created.institutions) {
    await db.institution.deleteMany({ where: { id } });
  }
  ok("fixtures removed");

  await destroyUser(ctx);
  ctx = null;

  const after = await snapshot();
  for (const k of Object.keys(baseline)) {
    expect(after[k] === baseline[k], `${k} count back to baseline`, `${baseline[k]} -> ${after[k]}`);
  }
}

main()
  .catch((e) => {
    console.error("SUITE THREW:", String(e?.stack ?? e).slice(0, 1500));
    startSection("Fatal");
    fail("suite threw", String(e?.message ?? e).slice(0, 300));
  })
  .finally(async () => {
    if (ctx) {
      try {
        await destroyUser(ctx);
      } catch {
        /* reported by the count assertions */
      }
    }
    await db.$disconnect();
    summary();
  });

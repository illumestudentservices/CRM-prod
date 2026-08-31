/**
 * Spec pages 2-11 (Student Pipeline) — stage gate conformance.
 *
 * Pure-function tests over `evaluateStageGate` and `evaluateInterestStageGate`.
 * No server and no database: the gate is a state machine, and driving it over
 * HTTP would mean satisfying every upstream stage just to observe one rule.
 * Same approach as scripts/qa-plan-approval-chain.mjs.
 *
 * Run: npx tsx scripts/qa-pipeline-gate.mjs
 */

const { STAGE_CONFIG, evaluateStageGate, bestEligibilityOutcome } = await import(
  "../lib/lead-gate.ts"
);
const { evaluateInterestStageGate, buildInterestGateSubject } = await import(
  "../lib/interest-gate.ts"
);

let pass = 0;
const failures = [];

function check(label, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ${"─".repeat(Math.max(0, 62 - name.length))}`);
}

/** A blocker mentioning `field`, if any. */
const blocked = (r, field) => r.blockers.some((b) => b.field === field);
const messages = (r) => r.blockers.map((b) => b.message).join(" | ");

const HOUR = 3600_000;
const now = new Date("2026-06-15T12:00:00Z");
const past = new Date(now.getTime() - HOUR);
const future = new Date(now.getTime() + 24 * HOUR);

/** An engagement completed inside the current stage, of the given type. */
const completed = (engagementType, stage) => ({
  kind: "ENGAGEMENT",
  engagementType,
  stageAtCompletion: stage,
  completedAt: past,
  scheduledFor: past,
  cancelledAt: null,
});

/** A future booking, which every non-terminal stage requires. */
const scheduled = () => ({
  kind: "ENGAGEMENT",
  engagementType: "FOLLOW_UP",
  stageAtCompletion: null,
  completedAt: null,
  scheduledFor: future,
  cancelledAt: null,
});

/** Person-level fields, all populated. Stage/stageEnteredAt supplied per test. */
const LEAD = {
  firstName: "Ada",
  lastName: "Byron",
  email: "ada@example.com",
  phone: "+971500000000",
  nationality: "British",
  countryOfResidence: "United Arab Emirates",
  sourceId: "src-1",
  intakeYear: 2027,
  intakeMonth: 9,
  intendedDestination: "Canada",
  preferredCountry: "Canada",
  interestedProgram: "Computer Science",
  budgetRange: "FROM_20K_TO_35K",
  currentQualification: "A-levels",
  counsellingOutcome: "Keen, wants Canada",
  counsellingOutcomeEnum: "PROCEED_TO_ELIGIBILITY",
  institutionId: "inst-1",
  academicQualification: "A-levels AAB",
  englishStatus: "IELTS",
  studyLevel: "UNDERGRADUATE",
  eligibilityOutcome: "ELIGIBLE",
  hasInstitutionInterest: true,
  enrolmentDate: null,
};

const APP = {
  applicationNumber: "APP-1",
  submissionDate: past,
  submissionMethod: "UNIVERSITY_PORTAL",
  offerType: "CONDITIONAL",
  offerReceivedAt: past,
  studentDecision: "ACCEPTED",
  depositDeadline: future,
  depositDeadlineNotApplicable: false,
  depositPaid: true,
  depositDate: past,
  depositStatus: "PAID",
  acceptanceStatus: "ACCEPTED",
};

const at = (stage, over = {}) => ({
  ...LEAD,
  stage,
  stageEnteredAt: new Date(now.getTime() - 48 * HOUR),
  ...over,
});

// ─── Spec §5 — counselling outcome must support progression ──────────────────
section("§5 Contacted → Qualified: counselling outcome");

{
  const acts = [completed("COUNSELLING", "CONTACTED"), scheduled()];
  const base = at("CONTACTED");

  const good = evaluateStageGate(base, "QUALIFIED", acts, { now });
  check("PROCEED_TO_ELIGIBILITY progresses", good.canProgress, messages(good));

  for (const bad of [
    "FURTHER_COUNSELLING_REQUIRED",
    "NOT_READY_YET",
    "UNABLE_TO_CONTACT",
    "NOT_SUITABLE",
    "LOST",
    "DEFERRED",
  ]) {
    const r = evaluateStageGate(
      at("CONTACTED", { counsellingOutcomeEnum: bad }),
      "QUALIFIED",
      acts,
      { now }
    );
    check(
      `${bad} is refused`,
      !r.canProgress && blocked(r, "counsellingOutcomeEnum"),
      messages(r)
    );
  }

  // The regression this replaced: free text alone used to satisfy the rule.
  const textOnly = evaluateStageGate(
    at("CONTACTED", { counsellingOutcomeEnum: null, counsellingOutcome: "went fine" }),
    "QUALIFIED",
    acts,
    { now }
  );
  check(
    "free-text outcome alone no longer satisfies the rule",
    !textOnly.canProgress && blocked(textOnly, "counsellingOutcomeEnum"),
    messages(textOnly)
  );

  // Spec §5 — at least one Institution Interest must exist.
  const noInterest = evaluateStageGate(
    at("CONTACTED", { hasInstitutionInterest: false }),
    "QUALIFIED",
    acts,
    { now }
  );
  check(
    "no institution interest is refused",
    !noInterest.canProgress && blocked(noInterest, "hasInstitutionInterest"),
    messages(noInterest)
  );
}

// ─── Spec §6 — eligibility outcome gates Qualified ───────────────────────────
section("§6 Qualified → Application Submitted: eligibility outcome");

{
  const acts = [completed("ELIGIBILITY_REVIEW", "QUALIFIED"), scheduled()];
  const checklist = [{ category: "DOCUMENT" }];

  for (const outcome of ["ELIGIBLE", "PROVISIONALLY_ELIGIBLE"]) {
    const r = evaluateStageGate(
      at("QUALIFIED", { eligibilityOutcome: outcome }),
      "APPLICATION_SUBMITTED",
      acts,
      { now, checklist, application: APP }
    );
    check(`${outcome} progresses`, r.canProgress, messages(r));
  }

  for (const outcome of ["FURTHER_INFO_REQUIRED", "NOT_ELIGIBLE"]) {
    const r = evaluateStageGate(
      at("QUALIFIED", { eligibilityOutcome: outcome }),
      "APPLICATION_SUBMITTED",
      acts,
      { now, checklist, application: APP }
    );
    check(
      `${outcome} is refused`,
      !r.canProgress && blocked(r, "eligibilityOutcome"),
      messages(r)
    );
  }

  const unassessed = evaluateStageGate(
    at("QUALIFIED", { eligibilityOutcome: null }),
    "APPLICATION_SUBMITTED",
    acts,
    { now, checklist, application: APP }
  );
  check(
    "no eligibility assessment is refused",
    !unassessed.canProgress && blocked(unassessed, "eligibilityOutcome"),
    messages(unassessed)
  );

  // Study level and intake are §6 required fields that were never gated.
  for (const [field, value] of [["studyLevel", null], ["intakeYear", null]]) {
    const r = evaluateStageGate(
      at("QUALIFIED", { [field]: value }),
      "APPLICATION_SUBMITTED",
      acts,
      { now, checklist, application: APP }
    );
    check(`missing ${field} is refused`, !r.canProgress && blocked(r, field), messages(r));
  }
}

section("§6 bestEligibilityOutcome derives a student-level answer");
check(
  "picks the most favourable across journeys",
  bestEligibilityOutcome([
    { eligibilityOutcome: "NOT_ELIGIBLE" },
    { eligibilityOutcome: "PROVISIONALLY_ELIGIBLE" },
    { eligibilityOutcome: "FURTHER_INFO_REQUIRED" },
  ]) === "PROVISIONALLY_ELIGIBLE"
);
check("null when nothing is assessed", bestEligibilityOutcome([{ eligibilityOutcome: null }]) === null);
check("null for no journeys at all", bestEligibilityOutcome([]) === null);

// ─── Spec §9 — student decision must support progression ─────────────────────
section("§9 Offer Received → Deposit Paid: student decision");

{
  const acts = [completed("OFFER_REVIEW", "OFFER_RECEIVED"), scheduled()];
  const base = at("OFFER_RECEIVED");

  for (const d of [
    "ACCEPTED",
    "INTENDS_TO_ACCEPT",
    "CONSIDERING",
    "AWAITING_OTHERS",
    "REQUESTING_DEFERRAL",
  ]) {
    const r = evaluateStageGate(base, "DEPOSIT_PAID", acts, {
      now,
      application: { ...APP, studentDecision: d },
    });
    check(`${d} progresses`, r.canProgress, messages(r));
  }

  for (const d of ["DECLINED", "UNDECIDED"]) {
    const r = evaluateStageGate(base, "DEPOSIT_PAID", acts, {
      now,
      application: { ...APP, studentDecision: d },
    });
    check(
      `${d} is refused`,
      !r.canProgress && blocked(r, "studentDecision"),
      messages(r)
    );
  }

  // Spec §9 "Offer date" — a required field that was never gated.
  const noDate = evaluateStageGate(base, "DEPOSIT_PAID", acts, {
    now,
    application: { ...APP, offerReceivedAt: null },
  });
  check(
    "missing offer date is refused",
    !noDate.canProgress && blocked(noDate, "offerReceivedAt"),
    messages(noDate)
  );
}

// ─── Spec §10 — deposit Paid, Waived OR Not Required ─────────────────────────
section("§10 Deposit Paid → Enrolled: deposit status");

{
  // Deposit Paid is not a terminal stage, so it still requires a booked
  // follow-up on the way out — pre-existing behaviour, unchanged here.
  const acts = [
    completed("POST_OFFER_SUPPORT", "DEPOSIT_PAID"),
    completed("ENROLMENT_CONFIRMATION", "DEPOSIT_PAID"),
    scheduled(),
  ];
  const base = at("DEPOSIT_PAID", { enrolmentDate: past });

  // The bug: a waived or not-required deposit could never reach Enrolled.
  for (const status of ["PAID", "WAIVED", "NOT_REQUIRED"]) {
    const app = {
      ...APP,
      depositStatus: status,
      // Only a real payment has a date; the point is that the other two no
      // longer need one.
      depositPaid: status === "PAID",
      depositDate: status === "PAID" ? past : null,
    };
    const r = evaluateStageGate(base, "ENROLLED", acts, { now, application: app });
    check(`deposit ${status} progresses`, r.canProgress, messages(r));
  }

  for (const status of ["PENDING", "REFUNDED"]) {
    const r = evaluateStageGate(base, "ENROLLED", acts, {
      now,
      application: { ...APP, depositStatus: status, depositPaid: false, depositDate: null },
    });
    check(
      `deposit ${status} is refused`,
      !r.canProgress && blocked(r, "depositStatus"),
      messages(r)
    );
  }

  // PARTIALLY_PAID is not settled, but it must still demand the date.
  const partial = evaluateStageGate(base, "ENROLLED", acts, {
    now,
    application: { ...APP, depositStatus: "PARTIALLY_PAID", depositPaid: false, depositDate: null },
  });
  check(
    "deposit PARTIALLY_PAID is refused, and asks for the date",
    !partial.canProgress && blocked(partial, "depositStatus") && blocked(partial, "depositDate"),
    messages(partial)
  );

  // A paid deposit with no date must still be refused.
  const paidNoDate = evaluateStageGate(base, "ENROLLED", acts, {
    now,
    application: { ...APP, depositStatus: "PAID", depositDate: null },
  });
  check(
    "PAID with no deposit date is refused",
    !paidNoDate.canProgress && blocked(paidNoDate, "depositDate"),
    messages(paidNoDate)
  );

  // Legacy rows: boolean only, no depositStatus. Must not be newly blocked.
  const legacy = evaluateStageGate(base, "ENROLLED", acts, {
    now,
    application: { ...APP, depositStatus: null, depositPaid: true, depositDate: past },
  });
  check(
    "legacy row with only depositPaid=true still progresses",
    legacy.canProgress,
    messages(legacy)
  );

  const legacyUnpaid = evaluateStageGate(base, "ENROLLED", acts, {
    now,
    application: { ...APP, depositStatus: null, depositPaid: false, depositDate: null },
  });
  check(
    "legacy row with depositPaid=false is refused",
    !legacyUnpaid.canProgress && blocked(legacyUnpaid, "depositStatus"),
    messages(legacyUnpaid)
  );
}

// ─── The headline: the interest path is gated at all ─────────────────────────
section("Interest path: gate applies, and no stage skipping");

{
  const interest = {
    stage: "NEW_LEAD",
    stageEnteredAt: new Date(now.getTime() - 48 * HOUR),
    institutionId: "inst-1",
    program: "Computer Science",
    intakeYear: 2027,
    intakeMonth: 9,
    studyLevel: "UNDERGRADUATE",
    assignedICRId: "user-1",
    academicQualification: "A-levels AAB",
    englishStatus: "IELTS",
    eligibilityOutcome: null,
    enrolmentDate: null,
  };
  const leadOnly = { ...LEAD };
  delete leadOnly.stage;
  delete leadOnly.stageEnteredAt;

  // This is the exact request that used to succeed: New Lead → Enrolled.
  const jump = evaluateInterestStageGate(leadOnly, interest, "ENROLLED", [], {
    interestId: "int-1",
    now,
  });
  check(
    "New Lead → Enrolled on an interest is refused",
    !jump.canProgress && jump.blockers.some((b) => b.kind === "TRANSITION"),
    messages(jump)
  );

  for (const target of [
    "QUALIFIED",
    "APPLICATION_SUBMITTED",
    "AWAITING_DECISION",
    "OFFER_RECEIVED",
    "DEPOSIT_PAID",
  ]) {
    const r = evaluateInterestStageGate(leadOnly, interest, target, [], {
      interestId: "int-1",
      now,
    });
    check(`New Lead → ${target} is refused`, !r.canProgress, messages(r));
  }

  // One legal step, still gated on its own conditions.
  const oneStep = evaluateInterestStageGate(leadOnly, interest, "CONTACTED", [], {
    interestId: "int-1",
    now,
  });
  check(
    "New Lead → Contacted is gated (needs a booked activity)",
    !oneStep.canProgress && oneStep.blockers.some((b) => b.kind === "ACTIVITY_SCHEDULED"),
    messages(oneStep)
  );
  const oneStepOk = evaluateInterestStageGate(leadOnly, interest, "CONTACTED", [scheduled()], {
    interestId: "int-1",
    now,
  });
  check("New Lead → Contacted passes once satisfied", oneStepOk.canProgress, messages(oneStepOk));
}

section("Interest subject: the journey wins over the person");

{
  const subject = buildInterestGateSubject(
    { ...LEAD, interestedProgram: "Toronto programme", eligibilityOutcome: "ELIGIBLE" },
    {
      stage: "QUALIFIED",
      stageEnteredAt: now,
      institutionId: "inst-manchester",
      program: "Manchester programme",
      intakeYear: 2028,
      intakeMonth: 1,
      studyLevel: "POSTGRADUATE",
      eligibilityOutcome: "NOT_ELIGIBLE",
    }
  );
  check("programme comes from the journey", subject.interestedProgram === "Manchester programme");
  check("institution comes from the journey", subject.institutionId === "inst-manchester");
  check("intake comes from the journey", subject.intakeYear === 2028);
  check("study level comes from the journey", subject.studyLevel === "POSTGRADUATE");
  check("eligibility comes from the journey", subject.eligibilityOutcome === "NOT_ELIGIBLE");
  check("hasInstitutionInterest is true by construction", subject.hasInstitutionInterest === true);
  check("person fields still carry through", subject.email === "ada@example.com");

  // Falls back to the person where the journey holds nothing.
  const fallback = buildInterestGateSubject(LEAD, {
    stage: "QUALIFIED",
    stageEnteredAt: now,
    institutionId: "inst-1",
    program: null,
    intakeYear: null,
    academicQualification: null,
  });
  check("programme falls back to the person", fallback.interestedProgram === "Computer Science");
  check("intake falls back to the person", fallback.intakeYear === 2027);
  check(
    "academic qualification falls back to the person",
    fallback.academicQualification === "A-levels AAB"
  );
}

// ─── Guard: every stage config is still reachable and coherent ───────────────
section("Config sanity");

{
  const stages = Object.keys(STAGE_CONFIG);
  check("all 13 stages configured", stages.length === 13, `got ${stages.length}`);
  const enumIn = [];
  for (const [stage, cfg] of Object.entries(STAGE_CONFIG)) {
    for (const f of cfg.requiredFields) {
      if (f.kind === "enumIn") {
        enumIn.push(`${stage}.${f.key}`);
        check(
          `${stage}.${f.key} has a non-empty allowed list`,
          Array.isArray(f.allowed) && f.allowed.length > 0
        );
      }
    }
  }
  check(
    "the three value-based rules from the spec are present",
    enumIn.length === 4,
    `enumIn rules: ${enumIn.join(", ")}`
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(66)}`);
console.log(`passed ${pass}, failed ${failures.length}`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("all green");

/**
 * The stage gate's requirement list, and the loosened typed-task rule.
 *
 * Pure `evaluateStageGate` calls — no server, no database, no browser. The rules
 * are a function of their inputs, so driving them directly is both exhaustive
 * and instant; an HTTP suite would prove the same thing for whichever handful of
 * cases happened to exist as rows.
 *
 *   npx tsx scripts/qa-stage-requirements.mjs
 */

// A DYNAMIC import, deliberately. Under tsx a static `import ... from "x.ts"`
// inside a .mjs file fails with "does not provide an export named ..." — the
// named bindings are resolved before the transform has run. Already recorded
// against the nav-permission check; it costs a confusing crash every time.
const { evaluateStageGate, STAGE_CONFIG } = await import("../lib/lead-gate.ts");

let pass = 0;
let fail = 0;

function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DAY = 86_400_000;
const now = new Date("2026-09-15T12:00:00.000Z");
const enteredContacted = new Date(now.getTime() - 2 * DAY);

/** A student who satisfies every FIELD rule for leaving Contacted. */
const contactedLead = (over = {}) => ({
  stage: "CONTACTED",
  stageEnteredAt: enteredContacted,
  firstName: "Test",
  lastName: "Student",
  email: "t@example.com",
  phone: "+1 555 0100",
  preferredCountry: "Canada",
  interestedProgram: "Computer Science",
  budgetRange: "20-30k",
  intakeYear: 2027,
  currentQualification: "High school",
  // The ONLY value in PROGRESSING_COUNSELLING_OUTCOMES. "PROCEED" looks right
  // and is not a member, which the gate correctly refused.
  counsellingOutcomeEnum: "PROCEED_TO_ELIGIBILITY",
  hasInstitutionInterest: true,
  ...over,
});

const engagement = (over = {}) => ({
  kind: "ENGAGEMENT",
  engagementType: "COUNSELLING",
  completedAt: null,
  scheduledFor: null,
  cancelledAt: null,
  stageAtCompletion: null,
  ...over,
});

/** The universal "book the next step" rule, kept satisfied so it stays out. */
const futureBooking = engagement({
  engagementType: "FOLLOW_UP",
  scheduledFor: new Date(now.getTime() + 7 * DAY),
});

const gate = (lead, activities, opts = {}) =>
  evaluateStageGate(lead, "QUALIFIED", activities, { now, ...opts });

const req = (result, id) => result.requirements.find((r) => r.id === id);

// ─── 1. Counselling completed at an EARLIER stage now counts ────────────────
console.log("\nTyped Required Task completed at an earlier stage");
{
  const doneAtNewLead = engagement({
    completedAt: new Date(now.getTime() - 5 * DAY), // before Contacted was entered
    stageAtCompletion: "NEW_LEAD",
  });
  const r = gate(contactedLead(), [doneAtNewLead, futureBooking]);

  check("the counselling requirement is met", req(r, "activity:COUNSELLING")?.done === true);
  check(
    "no blocker demands it",
    !r.blockers.some((b) => /counselling/i.test(b.message)),
    JSON.stringify(r.blockers.map((b) => b.message))
  );
  check("the student can move to Qualified", r.canProgress === true, JSON.stringify(r.blockers));
  check(
    "the tick says where the credit came from",
    /New Lead/.test(req(r, "activity:COUNSELLING")?.doneNote ?? ""),
    req(r, "activity:COUNSELLING")?.doneNote
  );
}

// ─── 2. ...but a LATER stage cannot reach back ──────────────────────────────
console.log("\nA task stamped against a later stage does not count");
{
  const doneAtQualified = engagement({
    completedAt: new Date(now.getTime() - 1 * DAY),
    stageAtCompletion: "QUALIFIED",
  });
  const r = gate(contactedLead(), [doneAtQualified, futureBooking]);
  check("the counselling requirement is NOT met", req(r, "activity:COUNSELLING")?.done === false);
  check("and it blocks", r.canProgress === false);
}

// ─── 3. Work from before a reopen does not count ────────────────────────────
console.log("\nWork from before a close-and-reopen does not count");
{
  const oldWork = engagement({
    completedAt: new Date(now.getTime() - 200 * DAY),
    stageAtCompletion: "CONTACTED",
  });
  const reopened = new Date(now.getTime() - 3 * DAY);

  const without = gate(contactedLead(), [oldWork, futureBooking]);
  check("without a reopen marker it counts", req(without, "activity:COUNSELLING")?.done === true);

  const withReopen = gate(contactedLead(), [oldWork, futureBooking], {
    pipelineRestartedAt: reopened,
  });
  check(
    "after a reopen it does not",
    req(withReopen, "activity:COUNSELLING")?.done === false
  );
  check("and the student is blocked again", withReopen.canProgress === false);
}

// ─── 4. Legacy rows with no stamp are still trusted ─────────────────────────
console.log("\nRows predating the stageAtCompletion column");
{
  const unstamped = engagement({
    completedAt: new Date(now.getTime() - 1 * DAY),
    stageAtCompletion: null,
  });
  const r = gate(contactedLead(), [unstamped, futureBooking]);
  check("an unstamped completion counts", req(r, "activity:COUNSELLING")?.done === true);
}

// ─── 5. A cancelled activity never counts ───────────────────────────────────
console.log("\nCancelled work");
{
  const cancelled = engagement({
    completedAt: new Date(now.getTime() - 1 * DAY),
    stageAtCompletion: "CONTACTED",
    cancelledAt: new Date(now.getTime() - 1 * DAY),
  });
  const r = gate(contactedLead(), [cancelled, futureBooking]);
  check("a cancelled counselling does not count", req(r, "activity:COUNSELLING")?.done === false);
}

// ─── 6. Requirements cover every rule, met and unmet ────────────────────────
console.log("\nThe requirement list");
{
  const r = gate(contactedLead({ budgetRange: null, counsellingOutcomeEnum: null }), []);

  // Matched by id, NOT by string. The requirement label is a short noun phrase
  // for a checklist ("A next step booked") while the blocker is a sentence
  // explaining a failure ("A future activity must be scheduled before moving
  // on."). Asserting one is a prefix of the other was an assertion about
  // wording, and it failed on correct code.
  check(
    "every blocker corresponds to an unmet requirement, one for one",
    r.blockers.length === r.requirements.filter((q) => !q.done).length &&
      r.blockers.every((b) =>
        r.requirements.some((q) => !q.done && q.target && b.kind)
      ),
    JSON.stringify(r.blockers.map((b) => b.message))
  );
  check(
    "met rules are listed too",
    r.requirements.some((q) => q.done),
    `${r.requirements.filter((q) => q.done).length} met`
  );
  check(
    "the count of unmet requirements equals the count of blockers",
    r.requirements.filter((q) => !q.done).length === r.blockers.length
  );
  check("budget range is pending", req(r, "field:budgetRange")?.done === false);
  check(
    "budget range points at the student record",
    req(r, "field:budgetRange")?.target.where === "lead"
  );
  check(
    "the interest rule points at creating one, not at a form field",
    req(r, "field:hasInstitutionInterest") === undefined ||
      req(r, "field:hasInstitutionInterest")?.target.where === "interestCreate"
  );
  check(
    "the counselling rule points at logging an activity of that type",
    req(r, "activity:COUNSELLING")?.target.where === "activityLog" &&
      req(r, "activity:COUNSELLING")?.target.engagementType === "COUNSELLING"
  );
  check(
    "the booking rule points at scheduling",
    req(r, "activity:scheduled")?.target.where === "activitySchedule"
  );
}

// ─── 7. Destinations resolve for every stage, so no row is a dead end ───────
console.log("\nEvery requirement on every stage has a destination");
{
  const STAGES = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED",
    "AWAITING_DECISION", "OFFER_RECEIVED", "DEPOSIT_PAID"];
  const KNOWN = new Set(["lead", "application", "interest", "interestCreate",
    "activityLog", "activitySchedule", "checklist", "none"]);

  let dead = [];
  for (const stage of STAGES) {
    const next = STAGE_CONFIG[stage].allowedNext[0];
    if (!next) continue;
    const r = evaluateStageGate(
      { stage, stageEnteredAt: enteredContacted, firstName: "T", lastName: "S" },
      next,
      [],
      { now }
    );
    for (const q of r.requirements) {
      if (!KNOWN.has(q.target.where)) dead.push(`${stage}/${q.id}`);
      if (!q.label) dead.push(`${stage}/${q.id} has no label`);
    }
  }
  check("no requirement has an unknown or missing destination", dead.length === 0, dead.join(", "));
}

// ─── 8. The eligibility outcome points at the journey, not the student ──────
console.log("\nThe eligibility outcome belongs to the journey");
{
  const r = evaluateStageGate(
    {
      stage: "QUALIFIED",
      stageEnteredAt: enteredContacted,
      firstName: "T",
      lastName: "S",
      eligibilityOutcome: null,
    },
    "APPLICATION_SUBMITTED",
    [],
    { now }
  );
  const q = req(r, "field:eligibilityOutcome");
  check("it is pending", q?.done === false);
  check("and it points at the interest record", q?.target.where === "interest", q?.target.where);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

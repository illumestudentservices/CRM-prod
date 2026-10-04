/**
 * Lead temperature — optional at capture, mandatory to leave New Lead.
 *
 *   npx tsx --env-file=.env scripts/qa-lead-temperature.mjs
 *
 * The gate rule itself is covered as a pure function in qa-pipeline-gate.mjs.
 * This script exists for the part that file cannot see: the round trip. A gate
 * rule is only as good as the field behind it, and the ways that field can be
 * missing are all silent —
 *
 *   stripped on create   the create schema is zod-parsed; a field it does not
 *                        list is DROPPED and the route still answers 201. The
 *                        ICR picks "Hot", the save succeeds, and the gate goes
 *                        on saying the temperature is required. This has
 *                        already happened once in this codebase, to five
 *                        fields at a time — see qa-lead-save-bugs.mjs.
 *   stripped on update   the same, with a 200.
 *   absent from the fetch
 *                        the gate's two call sites use `include`, so a scalar
 *                        comes through. Switch one to `select` and the column
 *                        reads `undefined` for everyone — which does not fail
 *                        open, it fails CLOSED, and every lead in the business
 *                        is stuck at New Lead with no way out.
 *   required at capture  the opposite mistake. The field must never block
 *                        creation: an ICR logging a walk-in or a stack of
 *                        event cards has not spoken to the student yet.
 *
 * Footprint: one disposable user and one disposable lead, removed in `finally`.
 */
import {
  BASE, db, api, createAndLogin, destroyUser,
  startSection, expect, summary, idOf,
} from "./qa-lib.mjs";

const stamp = Date.now().toString().slice(-6);
let ctx, leadId;
let baseline = {};

/** Everything the New Lead gate asks for EXCEPT the temperature. */
const baseLead = (source) => ({
  firstName: "ZZTemp", lastName: `Test${stamp}`,
  email: `zz.temp.${stamp}@example.invalid`, phone: `+15553${stamp}`,
  nationality: "Indian", countryOfResidence: "India",
  interestedProgram: "Business Administration",
  studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
  sourceId: source?.id,
  intendedDestination: "Canada", preferredCountry: "Canada",
});

/** The New Lead → Contacted gate, as the server reports it. */
const gateToContacted = async () => {
  const res = await api(ctx.jar, "GET", `/api/leads/${leadId}/stage?target=CONTACTED`);
  return res.payload?.gates?.find((g) => g.stage === "CONTACTED") ?? null;
};

try {
  baseline = { leads: await db.lead.count(), users: await db.user.count() };
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });

  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });

  // ── Capture is not blocked ────────────────────────────────────────────────
  startSection("A lead can be captured without a temperature");
  {
    const created = await api(ctx.jar, "POST", "/api/leads", baseLead(source));
    expect(created.status === 201,
      "★ creation succeeds with no temperature given",
      `status ${created.status} — ${JSON.stringify(created.payload)?.slice(0, 200)}`);
    leadId = idOf(created.payload);
    expect(!!leadId, "and returns an id");

    const row = await db.lead.findUnique({
      where: { id: leadId }, select: { leadTemperature: true },
    });
    expect(row?.leadTemperature === null,
      "the column is NULL, meaning nobody has judged them yet",
      `stored ${JSON.stringify(row?.leadTemperature)}`);
  }

  // ── The gate holds ────────────────────────────────────────────────────────
  startSection("Without it, the lead cannot reach Contacted");
  {
    const gate = await gateToContacted();
    expect(!!gate, "the server reports a gate for Contacted");
    expect(gate?.canProgress === false,
      "★ progress is refused", JSON.stringify(gate?.blockers ?? []).slice(0, 300));
    expect((gate?.blockers ?? []).some((b) => b.field === "leadTemperature"),
      "and the temperature is named as a blocker",
      JSON.stringify(gate?.blockers ?? []).slice(0, 300));
    expect((gate?.blockers ?? []).some((b) => /lead temperature/i.test(b.message ?? "")),
      "  …in words an ICR can act on",
      (gate?.blockers ?? []).map((b) => b.message).join(" | "));

    // The move itself, not just the advisory panel. These are separate code
    // paths and a previous bug had the panel wrong while the move was right.
    const move = await api(ctx.jar, "PATCH", `/api/leads/${leadId}/stage`, {
      stage: "CONTACTED",
    });
    expect(move.status >= 400,
      "★ and the stage change is actually refused, not merely discouraged",
      `status ${move.status}`);
    const after = await db.lead.findUnique({
      where: { id: leadId }, select: { stage: true },
    });
    expect(after?.stage === "NEW_LEAD",
      "the lead is still at New Lead", `stage is ${after?.stage}`);
  }

  // ── The value survives the round trip ─────────────────────────────────────
  startSection("Setting it actually saves it");
  {
    const patched = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
      leadTemperature: "HOT",
    });
    expect(patched.status === 200, "the update is accepted", `status ${patched.status}`);

    // ★ Read it back from the DATABASE, not from the response body. A schema
    // that strips the field answers 200 with a cheerful payload and writes
    // nothing — which is exactly the shape of the bug this guards.
    const row = await db.lead.findUnique({
      where: { id: leadId }, select: { leadTemperature: true },
    });
    expect(row?.leadTemperature === "HOT",
      "★ HOT reached the database",
      `stored ${JSON.stringify(row?.leadTemperature)} — if null, zod stripped it`);

    // The detail route answers `{ data: lead }`; `redactFields` runs over it on
    // the way out, so this also proves the field is not being redacted away
    // from the very role that has to fill it in.
    const fetched = await api(ctx.jar, "GET", `/api/leads/${leadId}`);
    const body = fetched.payload?.data ?? fetched.payload;
    expect(body?.leadTemperature === "HOT",
      "and reads back through the API, unredacted",
      JSON.stringify(body?.leadTemperature));
  }

  // ── The gate opens ────────────────────────────────────────────────────────
  startSection("With it, the lead moves");
  {
    const gate = await gateToContacted();
    expect(!(gate?.blockers ?? []).some((b) => b.field === "leadTemperature"),
      "the temperature is no longer a blocker",
      JSON.stringify(gate?.blockers ?? []).slice(0, 300));

    // Any other blocker here is a different rule (a booked activity, say) and
    // is not this feature's business — so satisfy the gate the way the app
    // does, then assert the move succeeds.
    if (gate?.canProgress) {
      const move = await api(ctx.jar, "PATCH", `/api/leads/${leadId}/stage`, {
        stage: "CONTACTED",
      });
      expect(move.status === 200, "★ the lead moves to Contacted", `status ${move.status}`);
      const after = await db.lead.findUnique({
        where: { id: leadId }, select: { stage: true },
      });
      expect(after?.stage === "CONTACTED", "and the stage is recorded");
    } else {
      // ★ Not `expect(true, ...)`. A null gate would take this branch and pass
      // silently, reporting an empty blocker list as though it were good news
      // — which is the shape of the `[].every()` trap: the check is loudest
      // exactly when it has seen nothing.
      expect(!!gate && (gate.blockers ?? []).length > 0,
        `remaining blockers belong to other rules: ` +
        (gate?.blockers ?? []).map((b) => b.field ?? b.kind).join(", "),
        "the gate came back empty or missing — that is not 'no other rules'");
    }
  }

  // ── All three values are accepted ─────────────────────────────────────────
  startSection("Hot, Warm and Cold are all real answers");
  {
    for (const t of ["HOT", "WARM", "COLD"]) {
      const r = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, { leadTemperature: t });
      const row = await db.lead.findUnique({
        where: { id: leadId }, select: { leadTemperature: true },
      });
      expect(r.status === 200 && row?.leadTemperature === t,
        `${t} is accepted and stored`,
        `status ${r.status}, stored ${JSON.stringify(row?.leadTemperature)}`);
    }

    // A value outside the enum must be refused outright rather than silently
    // dropped, or a typo in a future caller becomes an empty field nobody sees.
    const bad = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
      leadTemperature: "LUKEWARM",
    });
    expect(bad.status === 422,
      "★ an unknown value is rejected, not swallowed", `status ${bad.status}`);
    const still = await db.lead.findUnique({
      where: { id: leadId }, select: { leadTemperature: true },
    });
    expect(still?.leadTemperature === "COLD",
      "and the previous value is untouched",
      `stored ${JSON.stringify(still?.leadTemperature)}`);
  }

  // ── It can be taken back off ──────────────────────────────────────────────
  startSection("A judgement set by mistake can be withdrawn");
  {
    const cleared = await api(ctx.jar, "PATCH", `/api/leads/${leadId}`, {
      leadTemperature: null,
    });
    expect(cleared.status === 200, "null is accepted", `status ${cleared.status}`);
    const row = await db.lead.findUnique({
      where: { id: leadId }, select: { leadTemperature: true },
    });
    expect(row?.leadTemperature === null,
      "the field is cleared rather than left wrong",
      `stored ${JSON.stringify(row?.leadTemperature)}`);
  }
} catch (e) {
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  if (leadId) {
    // A stage move is recorded as a SYSTEM LeadActivity, not a history table.
    await db.leadActivity.deleteMany({ where: { leadId } }).catch(() => {});
    await db.leadNote.deleteMany({ where: { leadId } }).catch(() => {});
    await db.activity.deleteMany({ where: { leadId } }).catch(() => {});
    await db.lead.delete({ where: { id: leadId } }).catch(() => {});
  }
  // Dependent rows first: destroyUser fails SILENTLY when an FK still points
  // at the account, and the user survives as a quiet leak.
  await destroyUser(ctx);

  startSection("Footprint");
  const after = { leads: await db.lead.count(), users: await db.user.count() };
  for (const k of Object.keys(baseline)) {
    expect(after[k] === baseline[k], `${k} back to ${baseline[k]}`, `now ${after[k]}`);
  }
  summary();
  await db.$disconnect();
}

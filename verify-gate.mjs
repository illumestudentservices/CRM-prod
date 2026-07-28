import { signIn, BASE } from "./test-helper.mjs";

const { browser, page: p } = await signIn({ as: "admin" });
const J = { "Content-Type": "application/json" };
const soon = (d) => new Date(Date.now() + d * 86400000).toISOString();

let pass = 0, fail = 0;
const check = (label, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};
const msgs = (j) => (j.blockers ?? []).map((b) => b.message);
const has = (j, re) => msgs(j).some((m) => re.test(m));

// ── create a throwaway lead ─────────────────────────────────────────────
const created = await p.request.post(`${BASE}/api/leads`, {
  headers: J,
  data: {
    fullName: "GATE TEST — delete me",
    email: `gate-test-${Date.now()}@example.invalid`,
    phone: "+10000000000",
    nationality: "Nigerian",
    countryOfResidence: "Nigeria",
    interestedProgram: "MSc Computer Science",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
  },
});
const lead = (await created.json()).data;
console.log(`test lead ${lead.id} | stage ${lead.stage}\n`);
const L = `${BASE}/api/leads/${lead.id}`;

// ── STAGE 1 ─────────────────────────────────────────────────────────────
console.log("SCHEMA STRICTNESS");
{
  const bad = await p.request.patch(L, { headers: J, data: { notAField: "x" } });
  check("unknown fields are refused, not silently dropped", bad.status() === 422);
}

console.log("
STAGE 1 — New Lead");
let r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "CONTACTED" } });
let j = await r.json();
check("blocked while incomplete", r.status() === 422, `${msgs(j).length} blockers`);
msgs(j).forEach((m) => console.log("        · " + m));
check("wants intended destination", has(j, /intended destination/i));
check("wants lead source", has(j, /lead source/i));
check("wants a future activity", has(j, /future activity/i));
check("does NOT demand a completed activity (Stage 1 exception)", !has(j, /at least one activity must be completed/i));

// skipping ahead must be refused
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "QUALIFIED" } });
j = await r.json();
check("cannot skip New Lead -> Qualified", r.status() === 422 && has(j, /can only move to/i), msgs(j)[0] ?? "");

// closed outcomes must go through /close
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "LOST" } });
check("stage route refuses closed outcomes", r.status() === 400, (await r.json()).error?.slice(0, 60));

// satisfy stage 1
const dr = await p.request.patch(L, { headers: J, data: { intendedDestination: "United Kingdom" } });
check("intendedDestination is accepted", dr.status() === 200);
{
  const chk = await (await p.request.get(L)).json();
  check("intendedDestination actually persisted", (chk.data ?? chk).intendedDestination === "United Kingdom");
}
// /api/sources returns a bare array
const srcList = await (await p.request.get(`${BASE}/api/sources`)).json();
const sourceId = (Array.isArray(srcList) ? srcList : srcList.data ?? [])[0]?.id;
if (!sourceId) throw new Error("no source available to attach");
const sr = await p.request.patch(L, { headers: J, data: { sourceId } });
check("lead PATCH persists pipeline fields", sr.status() === 200);

r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "CONTACTED" } });
j = await r.json();
check("still blocked with no scheduled activity", r.status() === 422 && has(j, /future activity/i));

// a PAST date must be refused as a "future" activity
r = await p.request.post(`${L}/activities`, {
  headers: J,
  data: { engagementType: "CALL", description: "past", scheduledFor: soon(-2) },
});
check("rejects scheduling in the past", r.status() === 422);

await p.request.post(`${L}/activities`, {
  headers: J,
  data: { engagementType: "FOLLOW_UP", description: "Intro call", scheduledFor: soon(3) },
});
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "CONTACTED" } });
check("advances once satisfied", r.status() === 200);

// ── STAGE 2 ─────────────────────────────────────────────────────────────
console.log("\nSTAGE 2 — Contacted (typed required task)");
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "QUALIFIED" } });
j = await r.json();
check("blocked", r.status() === 422);
check("demands COUNSELLING specifically", has(j, /initial counselling/i));
check("wants budget range", has(j, /budget range/i));
check("wants counselling outcome", has(j, /counselling outcome/i));

// a completed activity of the WRONG type must not satisfy it
await p.request.post(`${L}/activities`, {
  headers: J,
  data: { engagementType: "WHATSAPP", description: "quick ping", completed: true },
});
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "QUALIFIED" } });
j = await r.json();
check("wrong activity type does NOT satisfy the required task", has(j, /initial counselling/i));

await p.request.patch(L, {
  headers: J,
  data: {
    preferredCountry: "United Kingdom",
    budgetRange: "FROM_20K_TO_35K",
    currentQualification: "BSc Computer Science",
    counsellingOutcome: "Wants Sept 2027, budget confirmed.",
  },
});
await p.request.post(`${L}/activities`, {
  headers: J,
  data: { engagementType: "COUNSELLING", description: "Initial counselling", completed: true, outcome: "Shortlisted 3" },
});
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "QUALIFIED" } });
j = await r.json();
check("advances with the right type completed", r.status() === 200, r.status() !== 200 ? msgs(j).join("; ") : "");

// ── ICR vs override ─────────────────────────────────────────────────────
console.log("\nROLE — ICR hard-blocked, admin may override");
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "APPLICATION_SUBMITTED" } });
j = await r.json();
check("admin sees canOverride=true", j.canOverride === true);

r = await p.request.patch(`${L}/stage`, {
  headers: J,
  data: { stage: "APPLICATION_SUBMITTED", override: true, overrideReason: "short" },
});
check("override needs a real reason", r.status() === 422);

// assign to the ICR account so it can act on this lead
const icrUser = await (await p.request.get(`${BASE}/api/settings/users`)).json();
const icr = (icrUser.users ?? []).find((u) => u.email?.startsWith("pipeline-icr"));
await p.request.patch(L, { headers: J, data: { assignedICRId: icr?.id } });

const icrSession = await signIn({ as: "icr" });
r = await icrSession.page.request.patch(`${L}/stage`, {
  headers: J,
  data: { stage: "APPLICATION_SUBMITTED", override: true, overrideReason: "ICR attempting to force this through" },
});
j = await r.json();
check("ICR cannot override", r.status() === 422 && j.canOverride === false);
await icrSession.browser.close();

r = await p.request.patch(`${L}/stage`, {
  headers: J,
  data: { stage: "APPLICATION_SUBMITTED", override: true, overrideReason: "Verifying override path end to end" },
});
j = await r.json();
check("admin override succeeds", r.status() === 200 && j.overrode === true);

// ── double advance ──────────────────────────────────────────────────────
console.log("\nCONCURRENCY");
const both = await Promise.all([
  p.request.patch(`${L}/stage`, { headers: J, data: { stage: "AWAITING_DECISION", override: true, overrideReason: "concurrency probe one" } }),
  p.request.patch(`${L}/stage`, { headers: J, data: { stage: "AWAITING_DECISION", override: true, overrideReason: "concurrency probe two" } }),
]);
const codes = both.map((x) => x.status()).sort();
check("simultaneous advance yields one winner", codes.filter((c) => c === 200).length === 1, `got ${codes.join(" & ")}`);

// ── stage 5 transition restriction ──────────────────────────────────────
console.log("\nSTAGE 5 — Awaiting Decision");
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "DEPOSIT_PAID" } });
j = await r.json();
check("can only go to Offer Received or Application Rejected", r.status() === 422 && has(j, /can only move to/i), msgs(j)[0] ?? "");
check("does NOT demand a completed activity (Stage 5 exception)", !has(j, /must be completed in this stage/i));

// ── closed outcomes ─────────────────────────────────────────────────────
console.log("\nCLOSED OUTCOMES");
r = await p.request.post(`${L}/close`, { headers: J, data: { outcome: "LOST" } });
check("Lost rejects missing mandatory fields", r.status() === 422);

r = await p.request.post(`${L}/close`, {
  headers: J,
  data: { outcome: "LOST", lostReason: "FINANCIAL", lostDate: new Date().toISOString(), notes: "Could not fund." },
});
j = await r.json();
check("Lost accepted with all fields", r.status() === 200);
check("records the stage closed from", j.data?.stageBeforeClose === "AWAITING_DECISION", `got ${j.data?.stageBeforeClose}`);
check("cancels open future activities", (j.cancelledActivities ?? 0) > 0, `${j.cancelledActivities} cancelled`);

r = await p.request.delete(`${L}/close`);
j = await r.json();
check("reopen restores the prior stage", r.status() === 200 && j.stage === "AWAITING_DECISION", `-> ${j.stage}`);

// deferred reopen date
await p.request.post(`${L}/close`, {
  headers: J,
  data: { outcome: "DEFERRED", deferredIntakeYear: 2028, deferredIntakeMonth: 9, reason: "Postponing a year", followUpDate: soon(30) },
});
const def = await (await p.request.get(L)).json();
const d = def.data ?? def;
check("deferred stores a reopen date ahead of intake", !!d.deferredReopenAt, d.deferredReopenAt?.slice(0, 10));

// ── cleanup ─────────────────────────────────────────────────────────────
await p.request.delete(L);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

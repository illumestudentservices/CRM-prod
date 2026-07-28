import { signIn, BASE } from "./test-helper.mjs";
import { mkdirSync } from "fs";
import { join } from "path";

const OUT = join(import.meta.dirname, "audit-shots");
mkdirSync(OUT, { recursive: true });

const { browser, page: p } = await signIn({ as: "admin" });
const J = { "Content-Type": "application/json" };
const soon = (d) => new Date(Date.now() + d * 86400000).toISOString();

let pass = 0, fail = 0;
const check = (l, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  — " + d : ""}`); };
const msgs = (j) => (j.blockers ?? []).map((b) => b.message);

const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
p.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

const srcs = await (await p.request.get(`${BASE}/api/sources`)).json();
const sourceId = (Array.isArray(srcs) ? srcs : [])[0]?.id;
const inst = await (await p.request.get(`${BASE}/api/institutions`)).json();
const institutions = Array.isArray(inst) ? inst : inst.data ?? [];
const institutionId = institutions[0]?.id;
const altInstitutionId = institutions[1]?.id ?? institutionId;

const lead = (await (await p.request.post(`${BASE}/api/leads`, { headers: J, data: {
  fullName: "FULL JOURNEY TEST — delete me",
  email: `journey-${Date.now()}@example.invalid`, phone: "+10000000003",
  nationality: "Kenyan", countryOfResidence: "Kenya",
  interestedProgram: "MSc Data Science", studyLevel: "POSTGRADUATE",
  intakeYear: 2027, intakeMonth: 9, sourceId,
}})).json()).data;
const L = `${BASE}/api/leads/${lead.id}`;
console.log(`lead ${lead.id}\n`);

const move = async (stage) => {
  const r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage } });
  return { status: r.status(), body: await r.json().catch(() => ({})) };
};
const schedule = (d = 5) =>
  p.request.post(`${L}/activities`, { headers: J, data: { engagementType: "FOLLOW_UP", description: "Next step", scheduledFor: soon(d) } });
const complete = (engagementType) =>
  p.request.post(`${L}/activities`, { headers: J, data: { engagementType, description: engagementType, completed: true } });

console.log("FULL JOURNEY — New Lead to Enrolled");

// 1 -> 2
await p.request.patch(L, { headers: J, data: { intendedDestination: "United Kingdom" } });
await schedule();
check("1. New Lead -> Contacted", (await move("CONTACTED")).status === 200);

// 2 -> 3
await p.request.patch(L, { headers: J, data: {
  preferredCountry: "United Kingdom", budgetRange: "FROM_20K_TO_35K",
  currentQualification: "BSc Statistics", counsellingOutcome: "Confirmed Sept 2027.",
}});
await complete("COUNSELLING");
check("2. Contacted -> Qualified", (await move("QUALIFIED")).status === 200);

// 3 -> 4
await p.request.patch(L, { headers: J, data: { institutionId, academicQualification: "BSc 2:1", englishStatus: "IELTS" } });
await complete("ELIGIBILITY_REVIEW");
await schedule(6);
check("3. Qualified -> Application Submitted", (await move("APPLICATION_SUBMITTED")).status === 200);

// 4 -> 5 : needs an application record
let res = await move("AWAITING_DECISION");
check("4. blocked without an application record", res.status === 422, msgs(res.body)[0] ?? "");

const app = (await (await p.request.post(`${L}/applications`, { headers: J, data: {
  institutionId, program: "MSc Data Science",
  applicationNumber: "APP-2027-0001", submissionMethod: "ONLINE_PORTAL",
  submissionDate: new Date().toISOString(),
}})).json()).application;
check("   application record created", !!app?.id);

await complete("CALL");
await schedule(7);
res = await move("AWAITING_DECISION");
check("4. Application Submitted -> Awaiting Decision", res.status === 200, msgs(res.body).join("; "));

// 5 -> 6
await schedule(8);
res = await move("OFFER_RECEIVED");
check("5. Awaiting Decision -> Offer Received", res.status === 200, msgs(res.body).join("; "));

// 6 -> 7 : conditional deposit-deadline field
res = await move("DEPOSIT_PAID");
check("6. blocked pending offer details", res.status === 422);
check("   deposit deadline offers a not-applicable route", msgs(res.body).some((m) => /not applicable/i.test(m)), msgs(res.body).find((m) => /deadline/i.test(m)) ?? "");

await p.request.patch(`${L}/applications`, { headers: J, data: {
  applicationId: app.id, offerType: "CONDITIONAL", studentDecision: "ACCEPTED",
  depositDeadlineNotApplicable: true,
}});
await complete("OFFER_REVIEW");
await schedule(9);
res = await move("DEPOSIT_PAID");
check("6. Offer Received -> Deposit Paid", res.status === 200, msgs(res.body).join("; "));

// checklists generated on Deposit Paid
const cl = await (await p.request.get(`${L}/checklist`)).json();
const cats = [...new Set((cl.items ?? []).map((i) => i.category))];
check("   visa / pre-departure / accommodation generated", ["VISA", "PRE_DEPARTURE", "ACCOMMODATION"].every((c) => cats.includes(c)), cats.join(", "));

// 7 -> 8. Enrolled is terminal, so its own requirements are entry conditions —
// otherwise a student could be marked converted with no enrolment date.
await p.request.patch(`${L}/applications`, { headers: J, data: {
  applicationId: app.id, depositPaid: true, depositDate: new Date().toISOString(), acceptanceStatus: "ACCEPTED",
}});
await complete("POST_OFFER_SUPPORT");
await schedule(10);
res = await move("ENROLLED");
check("7. blocked pending enrolment date and confirmation", res.status === 422, msgs(res.body).join("; "));
check("   demands the enrolment date", msgs(res.body).some((m) => /enrolment date/i.test(m)));
check("   demands enrolment confirmation", msgs(res.body).some((m) => /enrolment confirmation/i.test(m)));

await p.request.patch(L, { headers: J, data: { enrolmentDate: new Date().toISOString() } });
await complete("ENROLMENT_CONFIRMATION");
res = await move("ENROLLED");
check("8. Deposit Paid -> Enrolled", res.status === 200, msgs(res.body).join("; "));

// conversion flags
const fin = (await (await p.request.get(L)).json());
const f = fin.data ?? fin;
check("   marked converted", f.isConverted === true);
check("   commission eligibility flagged", f.commissionEligible === true);
check("   response-time SLA captured", typeof f.responseTimeMinutes === "number", `${f.responseTimeMinutes} min`);

// ── alternative application after rejection ─────────────────────────────
console.log("\nALTERNATIVE APPLICATION AFTER REJECTION");
const alt = (await (await p.request.post(`${L}/applications`, { headers: J, data: {
  institutionId: altInstitutionId, program: "MSc Analytics", applicationNumber: "APP-2027-0002",
}})).json()).application;
const all = await (await p.request.get(`${L}/applications`)).json();
check("previous application retained", (all.applications ?? []).length === 2);
check("only one active", (all.applications ?? []).filter((a) => a.isActive).length === 1);
check("newest is the active one", all.applications.find((a) => a.isActive)?.id === alt.id);

// ── UI render at the end of the journey ─────────────────────────────────
console.log("\nUI");
await p.goto(`${BASE}/students/${lead.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(4500);
const txt = await p.evaluate(() => document.body.innerText);
check("shows Enrolled", /Enrolled/.test(txt));
check("applications panel lists previous applications", /Previous applications/i.test(txt));
check("visa checklist rendered", /Visa checklist/i.test(txt));
await p.screenshot({ path: join(OUT, "p3-journey-complete.png"), fullPage: true });

console.log("\nERRORS:", errs.length ? [...new Set(errs)].slice(0, 5) : "none");
await p.request.delete(L);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

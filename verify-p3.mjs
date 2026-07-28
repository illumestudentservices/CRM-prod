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

const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
p.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

// ── set up a student mid-pipeline via the API, then drive the UI ────────
const inst = await (await p.request.get(`${BASE}/api/institutions`)).json();
const institutionId = (Array.isArray(inst) ? inst : inst.data ?? [])[0]?.id;
const srcs = await (await p.request.get(`${BASE}/api/sources`)).json();
const sourceId = (Array.isArray(srcs) ? srcs : srcs.data ?? [])[0]?.id;

const lead = (await (await p.request.post(`${BASE}/api/leads`, {
  headers: J,
  data: {
    fullName: "UI JOURNEY TEST — delete me",
    email: `ui-journey-${Date.now()}@example.invalid`,
    phone: "+10000000001",
    nationality: "Kenyan",
    countryOfResidence: "Kenya",
    interestedProgram: "MSc Data Science",
    studyLevel: "POSTGRADUATE",
    intakeYear: 2027,
    intakeMonth: 9,
    sourceId,
  },
})).json()).data;
const L = `${BASE}/api/leads/${lead.id}`;
console.log(`lead ${lead.id}\n`);

// ── UI: blockers visible without triggering them ────────────────────────
console.log("UI — stage stepper");
await p.goto(`${BASE}/students/${lead.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(4000);

const body = () => p.evaluate(() => document.body.innerText);
let txt = await body();
check("shows days in current stage", /in New Lead|Entered this stage today/i.test(txt));
check("lists blockers before any click", /To move to Contacted/i.test(txt));
check("names the missing destination", /Intended destination is required/i.test(txt));
check("names the missing future activity", /future activity must be scheduled/i.test(txt));
check("offers the close outcomes", /Close as:/i.test(txt) && /Application Rejected/i.test(txt));
await p.screenshot({ path: join(OUT, "p3-blockers.png"), fullPage: false });

const locked = await p.evaluate(() =>
  Array.from(document.querySelectorAll("button")).filter((b) =>
    /Qualified|Application Submitted/.test(b.innerText) && b.querySelector("svg")
  ).length
);
check("blocked stages render locked", locked > 0, `${locked} locked`);

// ── UI: schedule an activity through the dialog ─────────────────────────
console.log("\nUI — activities panel");
check("prompts that nothing is scheduled", /needs a next step booked/i.test(txt));
await p.click('button:has-text("Add activity")');
await p.waitForTimeout(1200);
check("dialog opens", /Schedule for later|Log something done/i.test(await body()));
await p.screenshot({ path: join(OUT, "p3-activity-dialog.png"), fullPage: false });
await p.keyboard.press("Escape");
await p.waitForTimeout(600);

// ── drive the pipeline via API, checking gate + checklist behaviour ─────
console.log("\nPIPELINE — New Lead to Enrolled");
await p.request.patch(L, { headers: J, data: { intendedDestination: "United Kingdom" } });
await p.request.post(`${L}/activities`, { headers: J, data: { engagementType: "FOLLOW_UP", description: "Intro", scheduledFor: soon(5) } });
let r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "CONTACTED" } });
check("-> Contacted", r.status() === 200);

await p.request.patch(L, { headers: J, data: {
  preferredCountry: "United Kingdom", budgetRange: "FROM_20K_TO_35K",
  currentQualification: "BSc Statistics", counsellingOutcome: "Confirmed Sept 2027.",
}});
await p.request.post(`${L}/activities`, { headers: J, data: { engagementType: "COUNSELLING", description: "Counselling", completed: true } });
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "QUALIFIED" } });
check("-> Qualified", r.status() === 200);

// checklist must have generated on arrival
let cl = await (await p.request.get(`${L}/checklist`)).json();
const docs = (cl.items ?? []).filter((i) => i.category === "DOCUMENT");
check("document checklist auto-generated on Qualified", docs.length > 0, `${docs.length} items`);
check("checklist is destination-aware", docs.some((i) => /ATAS/i.test(i.label)), "UK-specific item present");

// re-entering must not duplicate
await p.request.post(`${L}/checklist`, { headers: J, data: { generate: "DOCUMENT" } });
cl = await (await p.request.get(`${L}/checklist`)).json();
check("regenerating does not duplicate", (cl.items ?? []).filter((i) => i.category === "DOCUMENT").length === docs.length);

await p.request.patch(L, { headers: J, data: { institutionId, academicQualification: "BSc 2:1", englishStatus: "IELTS" } });
await p.request.post(`${L}/activities`, { headers: J, data: { engagementType: "ELIGIBILITY_REVIEW", description: "Eligibility", completed: true } });
await p.request.post(`${L}/activities`, { headers: J, data: { engagementType: "FOLLOW_UP", description: "Next", scheduledFor: soon(6) } });
r = await p.request.patch(`${L}/stage`, { headers: J, data: { stage: "APPLICATION_SUBMITTED" } });
const j = await r.json();
check("Application Submitted blocked without an application record", r.status() === 422, (j.blockers ?? [])[0]?.message ?? "");

// ── UI: checklist panel renders ─────────────────────────────────────────
console.log("\nUI — checklist panel");
await p.goto(`${BASE}/students/${lead.id}`, { waitUntil: "domcontentloaded", timeout: 45000 });
await p.waitForTimeout(4000);
txt = await body();
check("checklist panel shows the document list", /Document checklist/i.test(txt));
check("shows required progress", /\d+\/\d+ required/.test(txt));
check("shows real document items", /Passport/i.test(txt));
await p.screenshot({ path: join(OUT, "p3-checklist.png"), fullPage: true });

// tick an item in the UI
const before = await p.evaluate(() => (document.body.innerText.match(/(\d+)\/\d+ required/) || [])[1]);
const boxes = await p.locator('button[role="checkbox"]').count();
if (boxes > 0) {
  await p.locator('button[role="checkbox"]').first().click();
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => (document.body.innerText.match(/(\d+)\/\d+ required/) || [])[1]);
  check("ticking an item updates progress", Number(after) === Number(before) + 1, `${before} -> ${after}`);
}

// ── UI: close dialog enforces mandatory fields ──────────────────────────
console.log("\nUI — close outcome dialog");
await p.click('button:has-text("Lost")');
await p.waitForTimeout(1200);
txt = await body();
check("Lost dialog opens", /Mark as Lost/i.test(txt));
check("asks for a reason", /Why was this student lost/i.test(txt) || /Reason/i.test(txt));
const confirm = p.locator('button:has-text("Confirm")');
check("Confirm disabled until filled", await confirm.isDisabled());
await p.screenshot({ path: join(OUT, "p3-close-dialog.png"), fullPage: false });
await p.keyboard.press("Escape");

console.log("\nERRORS:", errs.length ? [...new Set(errs)].slice(0, 5) : "none");

await p.request.delete(L);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

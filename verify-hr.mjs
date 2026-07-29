import { signIn, BASE } from "./test-helper.mjs";
import { mkdirSync, readFileSync } from "fs";
import { join } from "path";

const OUT = join(import.meta.dirname, "audit-shots");
mkdirSync(OUT, { recursive: true });

const env = Object.fromEntries(
  // Trim first: the values were captured over SSH and carry a trailing \r,
  // which made the UUID 37 characters and every lookup miss.
  readFileSync(".env.test.local", "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/=(.*)/s))
);
const EMP = env.EMPLOYEE_ID;

const { browser, page: p } = await signIn();
const J = { "Content-Type": "application/json" };

let pass = 0, fail = 0;
const ck = (l, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const body = () => p.evaluate(() => document.body.innerText);

const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
p.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

const setGender = (g) =>
  p.request.patch(`${BASE}/api/hr/employees/${EMP}`, { headers: J, data: { gender: g } });
const apply = (leaveType, start, end) =>
  p.request.post(`${BASE}/api/hr/leave`, {
    headers: J,
    data: { employeeId: EMP, leaveType, startDate: start, endDate: end, reason: "verification" },
  });
const future = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// ── HR onboarding form ───────────────────────────────────────────────────
console.log("HR ONBOARDING FORM");
await p.goto(`${BASE}/hr`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(4000);
ck("HR page loads", /Employee|HR/i.test(await body()));

const addBtn = p.locator('button:has-text("Add Employee"), button:has-text("Add New Employee")').first();
if (await addBtn.count()) {
  await addBtn.click();
  await p.waitForTimeout(1200);
  // Step 1 -> Step 2, where gender lives
  const next = p.locator('button:has-text("Next")').first();
  if (await next.count()) { await next.click(); await p.waitForTimeout(1000); }
  const txt = await body();
  ck("Gender field is on the form", /Gender/i.test(txt));
  ck("explains why it is collected", /maternity and paternity leave eligibility/i.test(txt));
  await p.screenshot({ path: join(OUT, "hr-gender-field.png"), fullPage: false });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(600);
} else {
  ck("Add Employee button present", false, "not found");
}

// ── Leave types offered ──────────────────────────────────────────────────
console.log("\nLEAVE TYPES");
const balances = await (await p.request.get(`${BASE}/api/hr/leave/balances?employeeId=${EMP}`)).json();
const shown = JSON.stringify(balances);
ck("no ANNUAL anywhere", !/\bANNUAL\b/.test(shown));
ck("no UNPAID / COMP_OFF", !/UNPAID|COMP_OFF/.test(shown));
ck("VACATION_PAID present", /VACATION_PAID/.test(shown));

// ── Gender gating, through the real API ──────────────────────────────────
console.log("\nGENDER GATING (gender currently unset)");
let r = await apply("MATERNITY", future(30), future(32));
let j = await r.json();
ck("maternity blocked while gender unset", r.status() === 422, j.error?.slice(0, 70));
ck("message tells them to ask HR", /ask hr/i.test(j.error ?? ""));

r = await apply("PATERNITY", future(35), future(37));
ck("paternity blocked while gender unset", r.status() === 422);

r = await apply("SICK", future(40), future(40));
ck("sick still allowed with no gender", r.status() === 200 || r.status() === 201,
   r.status() === 422 ? (await r.json()).error?.slice(0, 60) : "");

console.log("\nGENDER = FEMALE");
ck("gender saved via API", (await setGender("FEMALE")).status() === 200);
r = await apply("MATERNITY", future(50), future(52));
ck("maternity now allowed", r.status() === 200 || r.status() === 201,
   r.status() >= 400 ? (await r.json()).error?.slice(0, 70) : "");
r = await apply("PATERNITY", future(60), future(62));
j = await r.json();
ck("paternity refused for female", r.status() === 422, j.error?.slice(0, 60));

console.log("\nGENDER = MALE");
await setGender("MALE");
r = await apply("PATERNITY", future(70), future(72));
ck("paternity allowed", r.status() === 200 || r.status() === 201,
   r.status() >= 400 ? (await r.json()).error?.slice(0, 70) : "");
r = await apply("MATERNITY", future(80), future(82));
ck("maternity refused for male", r.status() === 422);

console.log("\nGENDER = OTHER");
await setGender("OTHER");
r = await apply("MATERNITY", future(90), future(92));
ck("maternity allowed for other", r.status() === 200 || r.status() === 201);
r = await apply("PATERNITY", future(100), future(102));
ck("paternity allowed for other", r.status() === 200 || r.status() === 201);

// ── Entitlement figures ──────────────────────────────────────────────────
console.log("\nENTITLEMENT (joined ~300 days ago)");
const bal = await (await p.request.get(`${BASE}/api/hr/leave/balances?employeeId=${EMP}`)).json();
const rows = bal.balances ?? bal.entitlements ?? bal.data ?? [];
const find = (t) => (Array.isArray(rows) ? rows : []).find((x) => (x.leaveType ?? x.type) === t);
for (const t of ["VACATION_PAID", "SICK", "MATERNITY", "PATERNITY"]) {
  const row = find(t);
  console.log(`   ${t.padEnd(15)} ${row ? JSON.stringify({ ent: row.entitlementDays ?? row.entitledDays, avail: row.availableDays }) : "(absent)"}`);
}
ck("all four types returned", ["VACATION_PAID","SICK","MATERNITY","PATERNITY"].every((t) => !!find(t)),
   `${(Array.isArray(rows) ? rows : []).length} rows`);

// ── Leave page renders ───────────────────────────────────────────────────
console.log("\nLEAVE UI");
await p.goto(`${BASE}/hr`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(4000);
const t2 = await body();
ck("shows Vacation (Paid), not Annual", /Vacation/i.test(t2) && !/\bAnnual Leave\b/i.test(t2));
await p.screenshot({ path: join(OUT, "hr-leave.png"), fullPage: true });

console.log("\nERRORS:", errs.length ? [...new Set(errs)].slice(0, 5) : "none");
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

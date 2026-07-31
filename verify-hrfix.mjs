import { signIn, BASE, loadEnv } from "./test-helper.mjs";
import { mkdirSync } from "fs"; import { join } from "path";
const OUT = join(import.meta.dirname, "audit-shots"); mkdirSync(OUT, { recursive: true });
const { TEST_EMAIL } = loadEnv();
let pass = 0, fail = 0;
const ck = (l, c, d = "") => { c ? pass++ : fail++; console.log(`  ${c ? "PASS" : "FAIL"}  ${l}${d ? "  - " + d : ""}`); };
const { browser, page: p } = await signIn();
const body = () => p.evaluate(() => document.body.innerText);
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
p.on("response", (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

console.log("HR DASHBOARD");
await p.goto(`${BASE}/hr`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(5000);
const t = await body();
ck("HR page loads", /Employee|HR/i.test(t));
ck("headcount no longer shows the 7 ghosts", !/\b7\b[\s\S]{0,40}Total Employees|Total Employees[\s\S]{0,20}\b7\b/i.test(t), "");
ck("no ghost seed emails on the page", !/@illume\.edu/i.test(t), "checked for @illume.edu");

console.log("\nUNLINKED-ACCOUNTS BANNER");
ck("banner is shown", /accounts? with no employee record/i.test(t));
ck("explains the consequence", /cannot request\s+leave|HR cannot see them/i.test(t));
ck("tells them how to fix it", /Add Employee/i.test(t));
ck("names the real staff", /jamshid@illumestudentservices\.ca/i.test(t));
ck("names this disposable account too (self-test)", t.includes(TEST_EMAIL),
   "proves the banner is live data, not hardcoded");
await p.screenshot({ path: join(OUT, "hr-fixed.png"), fullPage: true });

console.log("\nAPI");
const u = await (await p.request.get(`${BASE}/api/hr/unlinked-users`)).json();
ck("unlinked endpoint returns the accounts", (u.users ?? []).length >= 4, `${(u.users ?? []).length} users`);
const e = await (await p.request.get(`${BASE}/api/hr/employees`)).json();
ck("employees list excludes deleted users' rows", (e.employees ?? []).length === 0,
   `${(e.employees ?? []).length} employees`);
ck("no seed accounts leak through", !JSON.stringify(e).includes("@illume.edu"));

console.log("\nERRORS:", errs.length ? [...new Set(errs)].slice(0, 4) : "none");
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);

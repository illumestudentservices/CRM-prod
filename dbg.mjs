import { signIn, BASE } from "./test-helper.mjs";
const { browser, page: p } = await signIn({ as: "admin" });
const J = { "Content-Type": "application/json" };

const r = await p.request.get(`${BASE}/api/sources`);
const j = await r.json();
console.log("GET /api/sources ->", r.status(), "| top-level keys:", Object.keys(j).join(", "));
const arr = j.data ?? j.sources ?? [];
console.log("array length:", Array.isArray(arr) ? arr.length : "not an array");
if (Array.isArray(arr) && arr[0]) console.log("first item keys:", Object.keys(arr[0]).slice(0,6).join(", "), "| id:", arr[0].id);

// Can we PATCH sourceId onto a lead?
const c = await p.request.post(`${BASE}/api/leads`, { headers: J, data: {
  fullName: "DBG delete me", email: `dbg-${Date.now()}@example.invalid`, phone: "+10000000000",
  nationality: "Nigerian", countryOfResidence: "Nigeria", interestedProgram: "MSc CS",
  studyLevel: "POSTGRADUATE", intakeYear: 2027, intakeMonth: 9 } });
const lead = (await c.json()).data;
const L = `${BASE}/api/leads/${lead.id}`;

const pr = await p.request.patch(L, { headers: J, data: { intendedDestination: "UK", sourceId: arr[0]?.id } });
console.log("\nPATCH lead ->", pr.status());
if (pr.status() !== 200) console.log("  body:", JSON.stringify(await pr.json()).slice(0,300));

const after = await (await p.request.get(L)).json();
const d = after.data ?? after;
console.log("  intendedDestination:", d.intendedDestination, "| sourceId:", d.sourceId ? "set" : "NULL");

// what does the gate say now?
const g = await (await p.request.get(`${L}/stage?target=CONTACTED`)).json();
console.log("\ngate for CONTACTED:", JSON.stringify(g.gates?.[0]?.blockers ?? [], null, 1));

await p.request.delete(L);
await browser.close();

/**
 * Lead temperature system:
 *   1. GATE RULE — optional at creation, required to move to the 2nd stage.
 *   2. FILTER — /api/leads?leadTemperature=X returns only that temperature.
 *   3. ANALYTICS — overview + regional return temperatureBreakdown.
 *   4. NO REGRESSION — a lead with no temperature still lists / opens / edits.
 *
 *   npx tsx --env-file=.env.local scripts/qa-lead-temperature.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const SRC = "src-003";
let admin, seeded = [];
try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });

  const leadBody = (extra = {}) => ({
    firstName: TAG, lastName: "Temp", email: `${TAG.toLowerCase()}-${Date.now()}@qa.local`,
    phone: "+10000000000", nationality: "Testland", countryOfResidence: "Testland",
    interestedProgram: "Computer Science", studyLevel: "UNDERGRADUATE", intakeYear: 2027, intakeMonth: 9,
    sourceId: SRC, ...extra,
  });

  // ── 1. Gate rule ─────────────────────────────────────────────────────────
  startSection("Optional at creation, required at the 2nd stage");
  let r = await api(admin.jar, "POST", "/api/leads", leadBody());
  expect(r.status === 201 || r.status === 200, "lead created WITHOUT a temperature (optional at creation)", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,160)}`);
  const leadId = r.payload?.data?.id ?? r.payload?.id;
  if (leadId) seeded.push(leadId);

  r = await api(admin.jar, "GET", `/api/leads/${leadId}/stage?target=CONTACTED`);
  const gateBlockers = (r.payload?.gates?.[0]?.blockers ?? []).map((b) => `${b.field ?? ""} ${b.message ?? ""}`.toLowerCase());
  expect(gateBlockers.some((b) => b.includes("temperature")), "moving to CONTACTED is blocked on lead temperature", JSON.stringify(gateBlockers).slice(0,200));

  r = await api(admin.jar, "PATCH", `/api/leads/${leadId}`, { leadTemperature: "HOT" });
  expect(r.ok, "temperature can be set via edit", `got ${r.status}`);
  r = await api(admin.jar, "GET", `/api/leads/${leadId}/stage?target=CONTACTED`);
  const after = (r.payload?.gates?.[0]?.blockers ?? []).map((b) => `${b.field ?? ""} ${b.message ?? ""}`.toLowerCase());
  expect(!after.some((b) => b.includes("temperature")), "once set, temperature no longer blocks the move");

  // ── 2. Filter (3×) ───────────────────────────────────────────────────────
  startSection("Filter by temperature (run 3×)");
  const base = { nationality: "T", countryOfResidence: "T", interestedProgram: "CS", intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE", createdById: admin.user.id, assignedICRId: admin.user.id };
  const hot = await db.lead.create({ data: { ...base, firstName: TAG, lastName: "H", leadTemperature: "HOT" } });
  const warm = await db.lead.create({ data: { ...base, firstName: TAG, lastName: "W", leadTemperature: "WARM" } });
  const cold = await db.lead.create({ data: { ...base, firstName: TAG, lastName: "C", leadTemperature: "COLD" } });
  seeded.push(hot.id, warm.id, cold.id);
  for (let i = 1; i <= 3; i++) {
    const rr = await api(admin.jar, "GET", "/api/leads?leadTemperature=HOT&limit=100");
    const ids = new Set((rr.payload?.data ?? []).map((d) => d.id));
    expect(rr.ok && ids.has(hot.id) && !ids.has(warm.id) && !ids.has(cold.id), `run ${i}: HOT filter returns the hot lead, not warm/cold`, `status ${rr.status}`);
  }

  // ── 3. Analytics breakdown ───────────────────────────────────────────────
  startSection("Analytics returns a temperature breakdown");
  r = await api(admin.jar, "GET", `/api/analytics/overview?startDate=2026-01-01&endDate=2027-12-31`);
  const tb = r.payload?.temperatureBreakdown;
  expect(tb && typeof tb.HOT === "number" && typeof tb.WARM === "number" && typeof tb.COLD === "number", "overview has temperatureBreakdown {HOT,WARM,COLD}", JSON.stringify(tb));
  r = await api(admin.jar, "GET", "/api/analytics/regional");
  expect(r.payload?.temperatureBreakdown && typeof r.payload.temperatureBreakdown.HOT === "number", "regional has temperatureBreakdown");

  // ── 4. No regression (null temperature still works) ──────────────────────
  startSection("A lead with no temperature still works");
  const nullLead = await db.lead.create({ data: { ...base, firstName: TAG, lastName: "Null" } });
  seeded.push(nullLead.id);
  r = await api(admin.jar, "GET", `/api/leads/${nullLead.id}`);
  expect(r.ok, "null-temperature lead opens", `got ${r.status}`);
  r = await api(admin.jar, "PATCH", `/api/leads/${nullLead.id}`, { notes: "edited, temperature untouched" });
  expect(r.ok, "editing it (without setting temperature) still succeeds", `got ${r.status}`);
  r = await api(admin.jar, "GET", "/api/leads?limit=100");
  expect((r.payload?.data ?? []).some((d) => d.id === nullLead.id), "it still appears in the list");
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of seeded) {
    await db.leadActivity.deleteMany({ where: { leadId: id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { entity: "Lead", entityId: id } }).catch(() => {});
    await db.lead.delete({ where: { id } }).catch(() => {});
  }
  if (admin) await destroyUser(admin);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

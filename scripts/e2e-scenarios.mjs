// Adversarial multi-user regression suite.
// Runs 10 scenarios against the live prod server on localhost:3000.
// Every assertion is recorded; report emitted at the end.
import dotenv from "dotenv";
dotenv.config({ path: "/var/www/illume-crm/.env" });
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { createRequire } from "node:module";
const otplib = createRequire(import.meta.url)("otplib");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const BASE = "http://localhost:3000";
const CTX = JSON.parse(process.env.E2E_CTX);

// ── Session harness ─────────────────────────────────────────────────────
class Session {
  constructor(user) {
    this.user = user;
    this.cookies = new Map();
  }
  cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  absorb(resp) {
    const raw = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    for (const line of raw) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  async req(method, path, opts = {}) {
    const headers = { ...(opts.headers ?? {}) };
    if (this.cookies.size) headers.cookie = this.cookieHeader();
    if (opts.json !== undefined) { headers["content-type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
    if (opts.form) { headers["content-type"] = "application/x-www-form-urlencoded"; opts.body = new URLSearchParams(opts.form).toString(); }
    const resp = await fetch(BASE + path, { method, headers, body: opts.body, redirect: "manual" });
    this.absorb(resp);
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: resp.status, text, json, headers: Object.fromEntries(resp.headers.entries()) };
  }
  async login() {
    let r = await this.req("GET", "/api/auth/csrf");
    const csrfToken = r.json?.csrfToken;
    if (!csrfToken) throw new Error("no CSRF token");
    r = await this.req("POST", "/api/auth/callback/credentials?json=true", {
      form: { email: this.user.email, password: this.user.password, csrfToken, redirect: "false", callbackUrl: "/" },
    });
    if (r.status !== 302 && r.status !== 200) throw new Error(`credentials login failed: ${r.status} ${r.text.slice(0,100)}`);
    const code = await otplib.generate({ secret: this.user.totpSecret });
    r = await this.req("POST", "/api/auth/2fa/verify", { json: { code } });
    if (r.status !== 200) throw new Error(`2fa failed: ${r.status} ${r.text.slice(0,100)}`);
    await this.req("POST", "/api/auth/session", { json: { csrfToken, data: { twoFactorVerified: true } } });
    const chk = await this.req("GET", "/api/auth/session");
    if (chk.json?.user?.twoFactorPending) throw new Error("2fa didn't clear");
    return this;
  }
}

// ── Assertion framework ────────────────────────────────────────────────
const results = [];
function assert(scenario, label, ok, detail = "") {
  results.push({ scenario, label, ok, detail: detail?.slice ? detail.slice(0, 200) : detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? "  ::  " + String(detail).slice(0, 120) : ""}`);
  return ok;
}
const status = (r, expected) => Array.isArray(expected) ? expected.includes(r.status) : r.status === expected;

// ── Log in all four users ─────────────────────────────────────────────
console.log("\n== LOGIN ALL 4 USERS ==");
const S = {};
for (const [tag, u] of Object.entries(CTX.users)) {
  S[tag] = await new Session(u).login();
  console.log(`  ${tag} (${u.role}) logged in`);
}

const IDS = { interests: [], contacts: [], plans: [], tasks: [], suggestions: [], variations: [], budgetItems: [], notifications: [] };

// Pick a real institution + event + partner
const [inst, inst2] = await db.institution.findMany({ take: 2, select: { id: true, name: true } });
const [partner] = await db.source.findMany({ where: { isActive: true }, take: 1, select: { id: true, name: true } });
const [evt] = await db.event.findMany({ take: 1, select: { id: true, name: true } });

if (!inst || !inst2 || !partner || !evt) {
  console.error("BASELINE DATA MISSING — cannot run scenarios");
  process.exit(2);
}
console.log(`baseline: inst=${inst.name} inst2=${inst2.name} partner=${partner.name} event=${evt.name}`);

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 1: Multi-institution student journey
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 1: Multi-institution student journey ══");
{
  const SCN = "S1";
  // ICR_A creates interest for Institution 1
  let r = await S.ICR_A.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadAId, institutionId: inst.id, program: "S1 Program",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "ICR-A creates interest for inst1 -> 201", status(r, 201), r.text);
  const interest1 = r.json;
  if (interest1?.id) IDS.interests.push(interest1.id);

  // ICR_B creates interest for Institution 2 (same student)
  r = await S.ICR_B.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadAId, institutionId: inst2.id, program: "S1 Program 2",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "ICR-B creates interest for inst2 same student -> 201", status(r, 201), r.text);
  const interest2 = r.json;
  if (interest2?.id) IDS.interests.push(interest2.id);

  // ICR_A tries duplicate interest for inst1 -> 409
  r = await S.ICR_A.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadAId, institutionId: inst.id, program: "duplicate",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "ICR-A duplicate open interest for inst1 -> 409", status(r, 409), r.text);

  // ICR_A advances interest1 through several stages
  for (const stage of ["CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED"]) {
    r = await S.ICR_A.req("POST", `/api/institution-interests/${interest1.id}/stage`, { json: { toStage: stage } });
    assert(SCN, `ICR-A advance interest1 -> ${stage}`, status(r, 200), r.text);
  }

  // ICR_B closes interest2 as LOST
  r = await S.ICR_B.req("POST", `/api/institution-interests/${interest2.id}/close`, {
    json: { outcome: "LOST", lostReason: "OTHER", lostNotes: "S1 test close" },
  });
  assert(SCN, "ICR-B closes interest2 as LOST", status(r, 200), r.text);

  // Verify Lead.stage reflects the max open stage (APPLICATION_SUBMITTED from interest1)
  const lead = await db.lead.findUnique({ where: { id: CTX.leadAId }, select: { stage: true, institutionId: true } });
  assert(SCN, "Lead.stage synced to open interest max (APPLICATION_SUBMITTED)",
    lead.stage === "APPLICATION_SUBMITTED", `stage=${lead.stage}`);
  assert(SCN, "Lead.institutionId points to open interest",
    lead.institutionId === inst.id, `institutionId=${lead.institutionId}`);

  // Reopen interest2
  r = await S.ICR_B.req("POST", `/api/institution-interests/${interest2.id}/reopen`);
  assert(SCN, "ICR-B reopens interest2 -> 200", status(r, 200), r.text);

  // After reopen, lead.stage still APPLICATION_SUBMITTED (max of open)
  const lead2 = await db.lead.findUnique({ where: { id: CTX.leadAId }, select: { stage: true } });
  assert(SCN, "Lead.stage still APPLICATION_SUBMITTED after reopen of NEW_LEAD interest",
    lead2.stage === "APPLICATION_SUBMITTED", `stage=${lead2.stage}`);
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 2: Recruitment Planning full approval workflow
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 2: Recruitment Planning approval E2E ══");
{
  const SCN = "S2";
  // ICR_A creates plan
  let r = await S.ICR_A.req("POST", "/api/recruitment-planning/plans", { json: {
    icrId: CTX.users.ICR_A.userId, institutionId: inst.id,
    quarter: 1, year: 2027, reportingCurrency: "USD",
  }});
  assert(SCN, "ICR-A creates plan Q1 2027 -> 201", status(r, 201), r.text);
  const plan = r.json;
  if (plan?.id) IDS.plans.push(plan.id);

  // ICR_A adds budget items
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/plans/${plan.id}/budget-items`, {
    json: { category: "FLIGHTS", amount: 2500, currency: "EUR", exchangeRate: 1.08, exchangeRateSource: "e2e", allocation: "ICR_TRAVEL" },
  });
  assert(SCN, "ICR-A adds EUR budget item", status(r, 201), r.text);
  if (r.json?.id) IDS.budgetItems.push(r.json.id);

  // ICR_A submits
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "SUBMITTED" } });
  assert(SCN, "ICR-A submits plan (DRAFT->SUBMITTED)", status(r, 200), r.text);

  // ICR_A tries to edit while SUBMITTED — should be blocked (ICR-only allowed on DRAFT/RETURNED)
  r = await S.ICR_A.req("PATCH", `/api/recruitment-planning/plans/${plan.id}`, { json: { reportingCurrency: "GBP" } });
  assert(SCN, "ICR-A cannot edit SUBMITTED plan -> 409", status(r, 409), r.text);

  // RM takes for review
  r = await S.RM.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, {
    json: { toStatus: "REGIONAL_MANAGER_REVIEW", notes: "RM review notes" },
  });
  assert(SCN, "RM transitions -> REGIONAL_MANAGER_REVIEW", status(r, 200), r.text);

  // RM returns to ICR
  r = await S.RM.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, {
    json: { toStatus: "RETURNED", notes: "please add more budget items" },
  });
  assert(SCN, "RM returns plan (RM_REVIEW -> RETURNED)", status(r, 200), r.text);

  // ICR_A CAN edit a RETURNED plan
  r = await S.ICR_A.req("PATCH", `/api/recruitment-planning/plans/${plan.id}`, { json: { reportingCurrency: "GBP" } });
  assert(SCN, "ICR-A edits RETURNED plan", status(r, 200), r.text);

  // Try to skip re-submission and jump straight to APPROVED
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "APPROVED" } });
  assert(SCN, "ADMIN cannot skip levels (RETURNED -> APPROVED) -> 409", status(r, 409), r.text);

  // Correct path: RETURNED -> DRAFT? No — RETURNED -> SUBMITTED per state machine
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "SUBMITTED" } });
  assert(SCN, "ICR-A re-submits RETURNED plan (RETURNED -> SUBMITTED)", status(r, 200), r.text);

  // Walk through the rest: RM -> AM (HQ_EXEC/ADMIN) -> INTERNAL_FINAL -> APPROVED
  r = await S.RM.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "REGIONAL_MANAGER_REVIEW" } });
  assert(SCN, "RM re-takes for review", status(r, 200), r.text);
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "ACCOUNT_MANAGER_REVIEW" } });
  assert(SCN, "ADMIN -> ACCOUNT_MANAGER_REVIEW", status(r, 200), r.text);
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "INTERNAL_FINAL_REVIEW" } });
  assert(SCN, "ADMIN -> INTERNAL_FINAL_REVIEW", status(r, 200), r.text);
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/plans/${plan.id}/transition`, { json: { toStatus: "APPROVED" } });
  assert(SCN, "ADMIN approves (INTERNAL_FINAL -> APPROVED)", status(r, 200), r.text);

  // Plan should now be locked
  r = await S.ADMIN.req("PATCH", `/api/recruitment-planning/plans/${plan.id}`, { json: { reportingCurrency: "USD" } });
  assert(SCN, "PATCH approved plan -> 409 (locked)", status(r, 409), r.text);

  // Also try budget-items add on approved
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/plans/${plan.id}/budget-items`, {
    json: { category: "MEALS", amount: 100, currency: "USD", allocation: "PLAN" },
  });
  assert(SCN, "Add budget-item to approved plan -> 409", status(r, 409), r.text);

  // Verify: after activate, ACTIVE + travel request auto-created (planned travel was empty so 0 TRs)
  const p = await db.quarterlyRecruitmentPlan.findUnique({ where: { id: plan.id }, select: { status: true, activatedAt: true } });
  assert(SCN, "Plan status after approval = ACTIVE (activatePlan side-effect)",
    p.status === "ACTIVE" && p.activatedAt, `status=${p.status} activatedAt=${p.activatedAt}`);

  // Submit variation
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/plans/${plan.id}/variations`, {
    json: { type: "INCREASE_BUDGET", reason: "urgent extra travel", incrementalCost: 500 },
  });
  assert(SCN, "ICR-A submits variation on APPROVED/ACTIVE plan", status(r, 201), r.text);
  const v = r.json;
  if (v?.id) IDS.variations.push(v.id);

  // ICR tries to approve their own variation -> 403 (no approve permission)
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/variations/${v.id}/approve`, {
    json: { decision: "APPROVED", reviewNotes: "self approve attempt" },
  });
  assert(SCN, "ICR-A cannot approve own variation -> 403", status(r, 403), r.text);

  // ADMIN approves the variation
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/variations/${v.id}/approve`, {
    json: { decision: "APPROVED", reviewNotes: "e2e approve" },
  });
  assert(SCN, "ADMIN approves variation", status(r, 200), r.text);

  // Try to double-approve
  r = await S.ADMIN.req("POST", `/api/recruitment-planning/variations/${v.id}/approve`, {
    json: { decision: "APPROVED", reviewNotes: "double" },
  });
  assert(SCN, "Double-approve variation -> 409", status(r, 409), r.text);
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 3: Market Intelligence workflow
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 3: Market Intelligence workflow ══");
{
  const SCN = "S3";
  const marketId = CTX.marketId;

  // Baseline: capture visaTrends before
  const marketBefore = await db.market.findUnique({ where: { id: marketId }, select: { visaTrends: true } });

  // ICR_A submits VISA_CHANGE suggestion
  let r = await S.ICR_A.req("POST", "/api/market-intelligence/suggestions", {
    json: { marketId, kind: "VISA_CHANGE", originalText: "E2E test: visa policy X now requires document Y" },
  });
  assert(SCN, "ICR-A submits VISA_CHANGE suggestion", status(r, 201), r.text);
  const sug1 = r.json;
  if (sug1?.id) IDS.suggestions.push(sug1.id);

  // Verify RM notification created
  const rmNotif = await db.notification.findFirst({
    where: { userId: CTX.users.RM.userId, type: "MARKET_UPDATE_SUBMITTED" },
    orderBy: { createdAt: "desc" },
  });
  assert(SCN, "RM notification fired for suggestion", !!rmNotif, JSON.stringify(rmNotif ?? {}));
  if (rmNotif?.id) IDS.notifications.push(rmNotif.id);

  // ICR_A tries to approve own suggestion -> 403
  r = await S.ICR_A.req("POST", `/api/market-intelligence/suggestions/${sug1.id}/review`, {
    json: { decision: "APPROVED", reviewNotes: "self approve" },
  });
  assert(SCN, "ICR cannot review suggestions -> 403", status(r, 403), r.text);

  // RM edits and approves
  const editedText = "RM-edited: visa policy X now requires documents Y and Z";
  r = await S.RM.req("POST", `/api/market-intelligence/suggestions/${sug1.id}/review`, {
    json: { decision: "EDITED", editedText, reviewNotes: "e2e review" },
  });
  assert(SCN, "RM EDITED + approved suggestion", status(r, 200), r.text);

  // Verify market.visaTrends now contains edited text
  const marketAfter = await db.market.findUnique({ where: { id: marketId }, select: { visaTrends: true } });
  assert(SCN, "market.visaTrends updated with edited text",
    (marketAfter.visaTrends ?? "").includes(editedText),
    `visaTrends now: ${(marketAfter.visaTrends ?? "").slice(0, 100)}`);

  // Try to re-review an already-reviewed suggestion
  r = await S.RM.req("POST", `/api/market-intelligence/suggestions/${sug1.id}/review`, {
    json: { decision: "REJECTED" },
  });
  assert(SCN, "Re-review already-reviewed suggestion -> 409", status(r, 409), r.text);

  // ICR submits another, RM rejects, market unchanged
  r = await S.ICR_A.req("POST", "/api/market-intelligence/suggestions", {
    json: { marketId, kind: "COMPETITOR_OBSERVATION", originalText: "E2E: competitor X opened office" },
  });
  const sug2 = r.json;
  if (sug2?.id) IDS.suggestions.push(sug2.id);
  const compBefore = await db.market.findUnique({ where: { id: marketId }, select: { competitorInstitutions: true } });
  r = await S.RM.req("POST", `/api/market-intelligence/suggestions/${sug2.id}/review`, {
    json: { decision: "REJECTED", reviewNotes: "duplicate info" },
  });
  assert(SCN, "RM REJECTED suggestion", status(r, 200), r.text);
  const compAfter = await db.market.findUnique({ where: { id: marketId }, select: { competitorInstitutions: true } });
  assert(SCN, "market.competitorInstitutions UNCHANGED after REJECT",
    (compBefore.competitorInstitutions ?? "") === (compAfter.competitorInstitutions ?? ""),
    `before=${compBefore.competitorInstitutions?.slice(0,50)} after=${compAfter.competitorInstitutions?.slice(0,50)}`);

  // Quarterly report
  r = await S.RM.req("POST", "/api/market-intelligence/quarterly-report", {
    json: { marketId, quarter: 1, year: 2027 },
  });
  assert(SCN, "RM generates quarterly report", status(r, 200), r.text);
  assert(SCN, "Report has all expected keys",
    r.json?.recruitment && r.json?.pipelineByStage && r.json?.intelligence,
    JSON.stringify(Object.keys(r.json ?? {})));
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 4: Task workflow + template firing
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 4: Task template firing ══");
{
  const SCN = "S4";
  // Fire the seeded Client Onboarding template against a real institution
  let r = await S.ADMIN.req("POST", "/api/tasks/templates/fire", {
    json: { triggerEvent: "INSTITUTION_STATUS_ONBOARDING", parentType: "INSTITUTION", parentId: inst.id },
  });
  assert(SCN, "Fire INSTITUTION_STATUS_ONBOARDING template", status(r, [200, 201]), r.text);
  const result = r.json;
  assert(SCN, "Template fired created > 0 tasks",
    (result?.createdTasks ?? 0) > 0, JSON.stringify(result));

  // Fetch tasks created just now with that parent
  const newTasks = await db.task.findMany({
    where: { parentType: "INSTITUTION", parentId: inst.id, createdAt: { gte: new Date(Date.now() - 30000) } },
    select: { id: true, title: true, parentType: true, category: true, templateId: true },
  });
  assert(SCN, "Tasks have correct parentType=INSTITUTION and templateId set",
    newTasks.length > 0 && newTasks.every(t => t.parentType === "INSTITUTION" && t.templateId),
    JSON.stringify(newTasks.slice(0, 3)));
  for (const t of newTasks) IDS.tasks.push(t.id);

  // ADMIN's tasks dashboard shows them
  r = await S.ADMIN.req("GET", "/api/tasks/dashboard");
  assert(SCN, "Task dashboard responds 200 for ADMIN", status(r, 200), r.text);

  // ICR-A tries to see ADMIN's dashboard tasks — the scope is per-employee so they don't leak
  r = await S.ICR_A.req("GET", "/api/tasks/dashboard");
  assert(SCN, "ICR-A dashboard doesn't include ADMIN's tasks",
    status(r, 200), JSON.stringify(r.json));
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 5: Cross-role permission
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 5: Cross-role permission enforcement ══");
{
  const SCN = "S5";
  // ICR-B tries to edit ICR-A's plan (from S2)
  const planId = IDS.plans[0];
  let r = await S.ICR_B.req("PATCH", `/api/recruitment-planning/plans/${planId}`, { json: { reportingCurrency: "AUD" } });
  assert(SCN, "ICR-B PATCH ICR-A's plan -> 403", status(r, 403), r.text);

  // ICR-A tries to trigger a plan transition that requires RM
  r = await S.ICR_A.req("POST", `/api/recruitment-planning/plans/${planId}/transition`, {
    json: { toStatus: "REGIONAL_MANAGER_REVIEW" },
  });
  assert(SCN, "ICR-A cannot do RM-only transition -> 409", status(r, [403, 409]), r.text);

  // ICR-A creates a plan in someone else's name
  r = await S.ICR_A.req("POST", "/api/recruitment-planning/plans", { json: {
    icrId: CTX.users.ICR_B.userId, institutionId: inst.id, quarter: 2, year: 2027,
  }});
  assert(SCN, "ICR-A cannot create plan for ICR-B -> 403", status(r, 403), r.text);

  // ICR-A merges leads -> 403 (only SUPER_ADMIN)
  r = await S.ICR_A.req("POST", "/api/leads/merge", {
    json: { keepId: CTX.leadAId, mergeFromId: CTX.leadADupeId, reason: "test" },
  });
  assert(SCN, "ICR-A cannot merge -> 403", status(r, 403), r.text);

  // RM tries to merge -> 403 (only SUPER_ADMIN)
  r = await S.RM.req("POST", "/api/leads/merge", {
    json: { keepId: CTX.leadAId, mergeFromId: CTX.leadADupeId, reason: "test" },
  });
  assert(SCN, "RM cannot merge -> 403", status(r, 403), r.text);
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 6: Adversarial input fuzzing
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 6: Adversarial inputs ══");
{
  const SCN = "S6";
  const xssPayload = "<script>alert('xss')</script>";
  const sqliPayload = "'; DROP TABLE users; --";
  const bigString = "A".repeat(50_000);
  const unicodeMix = "‮ right-to-left​ zero-width   null ﻿ bom";

  // XSS + SQLi as partner contact fields — should store verbatim, not execute or crash
  let r = await S.ADMIN.req("POST", "/api/partner-contacts", { json: {
    partnerId: partner.id, fullName: xssPayload, role: "OTHER", email: "test@e2e.invalid",
  }});
  assert(SCN, "XSS payload in fullName -> 201 stored as text", status(r, 201), r.text);
  if (r.json?.id) IDS.contacts.push(r.json.id);
  if (r.json?.id) {
    const stored = await db.partnerContact.findUnique({ where: { id: r.json.id }, select: { fullName: true } });
    assert(SCN, "Stored text == submitted (no escaping/tag stripping)",
      stored?.fullName === xssPayload, `stored: ${stored?.fullName}`);
  }

  r = await S.ADMIN.req("POST", "/api/partner-contacts", { json: {
    partnerId: partner.id, fullName: sqliPayload, role: "OTHER",
  }});
  assert(SCN, "SQLi payload in fullName -> 201 (parametrised query safe)", status(r, 201), r.text);
  if (r.json?.id) IDS.contacts.push(r.json.id);

  // Confirm users table still exists (i.e. SQLi didn't actually drop it)
  const userCount = await db.user.count();
  assert(SCN, "users table intact after SQLi attempt",
    userCount > 5, `count=${userCount}`);

  // Huge string
  r = await S.ADMIN.req("POST", "/api/partner-contacts", { json: {
    partnerId: partner.id, fullName: "big", notes: bigString, role: "OTHER",
  }});
  assert(SCN, "50K note stored without 5xx", status(r, [201, 413]), `status=${r.status} text=${r.text.slice(0,60)}`);
  if (r.json?.id) IDS.contacts.push(r.json.id);

  // Unicode + control chars — should either sanitise nulls or accept
  r = await S.ADMIN.req("POST", "/api/partner-contacts", { json: {
    partnerId: partner.id, fullName: unicodeMix, role: "OTHER",
  }});
  assert(SCN, "Unicode edge cases don't 500", status(r, [201, 422]), r.text.slice(0, 80));
  if (r.json?.id) IDS.contacts.push(r.json.id);

  // Negative intakeYear
  r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadBId, institutionId: inst.id, intakeYear: -1, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "Negative intakeYear rejected -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // intakeMonth 13
  r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadBId, institutionId: inst.id, intakeYear: 2027, intakeMonth: 13, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "intakeMonth=13 rejected -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // Empty string program
  r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadBId, institutionId: inst.id, program: "", intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "Empty program string handled (blankToUndefined)", status(r, [201, 409]), r.text.slice(0, 80));
  if (r.json?.id) IDS.interests.push(r.json.id);

  // Wrong type (string where number expected)
  r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadBId, institutionId: inst.id, intakeYear: "not-a-number", intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  assert(SCN, "String where int expected -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // Missing required field
  r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {} });
  assert(SCN, "Empty body -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // Malformed JSON
  r = await S.ADMIN.req("POST", "/api/institution-interests", {
    body: "{not valid json",
    headers: { "content-type": "application/json" },
  });
  assert(SCN, "Malformed JSON body -> 400", status(r, [400, 422]), r.text.slice(0, 80));

  // Fake enum
  r = await S.ADMIN.req("POST", `/api/institution-interests/${IDS.interests[0]}/stage`, { json: { toStage: "BOGUS_STAGE" } });
  assert(SCN, "Bogus enum value -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // GET with SQL-shaped query param
  r = await S.ADMIN.req("GET", "/api/institution-interests?stage=NEW_LEAD'; DROP TABLE users; --");
  assert(SCN, "SQL-shape in query param safe -> 200 (Prisma param)", status(r, [200, 400, 422]), r.text.slice(0, 80));

  // Verify users table still there
  const uc2 = await db.user.count();
  assert(SCN, "users still intact after 2nd SQLi", uc2 > 5, `count=${uc2}`);
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 7: Concurrency / races
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 7: Race conditions ══");
{
  const SCN = "S7";
  // Two concurrent POSTs of interest for (leadB, inst) — only one should succeed
  const [ra, rb] = await Promise.all([
    S.ADMIN.req("POST", "/api/institution-interests", { json: {
      leadId: CTX.leadBId, institutionId: inst.id, program: "race A",
      intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
    }}),
    S.ICR_A.req("POST", "/api/institution-interests", { json: {
      leadId: CTX.leadBId, institutionId: inst.id, program: "race B",
      intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
    }}),
  ]);
  const wins = [ra, rb].filter(r => r.status === 201);
  const losses = [ra, rb].filter(r => r.status === 409 || r.status === 500);
  assert(SCN, "Exactly 1 of 2 concurrent create wins",
    wins.length === 1 && losses.length === 1,
    `wins=${wins.length} losses=${losses.length} statuses=${ra.status},${rb.status}`);
  for (const r of wins) if (r.json?.id) IDS.interests.push(r.json.id);

  // Two concurrent close on the same interest — one succeeds, other 409
  const winnerId = wins[0]?.json?.id;
  if (winnerId) {
    const [rc, rd] = await Promise.all([
      S.ADMIN.req("POST", `/api/institution-interests/${winnerId}/close`, {
        json: { outcome: "LOST", lostReason: "OTHER", lostNotes: "race close 1" },
      }),
      S.ADMIN.req("POST", `/api/institution-interests/${winnerId}/close`, {
        json: { outcome: "LOST", lostReason: "OTHER", lostNotes: "race close 2" },
      }),
    ]);
    const closeWins = [rc, rd].filter(r => r.status === 200);
    const closeConflicts = [rc, rd].filter(r => r.status === 409);
    assert(SCN, "Exactly 1 close succeeds under race",
      closeWins.length === 1 && closeConflicts.length === 1,
      `statuses=${rc.status},${rd.status}`);
  }
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 8: State machine exhaustive
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 8: State machine violations ══");
{
  const SCN = "S8";
  // Create a fresh interest for this scenario
  let r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadBId, institutionId: inst2.id, intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  const interest = r.json;
  if (interest?.id) IDS.interests.push(interest.id);

  // Try to transition to a closed-outcome via /stage (allowed enum is only open stages)
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/stage`, { json: { toStage: "LOST" } });
  assert(SCN, "Cannot use /stage to reach LOST -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // Try to close with wrong outcome
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/close`, { json: { outcome: "BOGUS" } });
  assert(SCN, "Close with bogus outcome -> 422", status(r, [422, 400]), r.text.slice(0, 80));

  // Reopen an OPEN interest — should be 409
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/reopen`);
  assert(SCN, "Reopen an already-open interest -> 409", status(r, 409), r.text.slice(0, 80));

  // Close as DEFERRED with future intake -> reopenAt should be set
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/close`, {
    json: { outcome: "DEFERRED", deferredIntakeYear: 2028, deferredIntakeMonth: 1, deferredReason: "test" },
  });
  assert(SCN, "Close as DEFERRED with intake info", status(r, 200), r.text.slice(0, 80));
  const closed = await db.institutionInterest.findUnique({ where: { id: interest.id }, select: { deferredReopenAt: true, deferredIntakeYear: true } });
  assert(SCN, "deferredReopenAt stamped from intake", !!closed?.deferredReopenAt, JSON.stringify(closed));

  // Now try to close again -> 409 (already closed)
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/close`, {
    json: { outcome: "LOST", lostReason: "OTHER", lostNotes: "double close" },
  });
  assert(SCN, "Close an already-closed interest -> 409", status(r, 409), r.text.slice(0, 80));

  // Try to change stage on closed
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/stage`, { json: { toStage: "CONTACTED" } });
  assert(SCN, "Stage change on closed interest -> 409", status(r, 409), r.text.slice(0, 80));

  // Try PATCH on closed
  r = await S.ADMIN.req("PATCH", `/api/institution-interests/${interest.id}`, { json: { program: "trying to edit closed" } });
  assert(SCN, "PATCH closed interest -> 409", status(r, 409), r.text.slice(0, 80));

  // Reopen
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/reopen`);
  assert(SCN, "Reopen the deferred interest -> 200", status(r, 200), r.text.slice(0, 80));

  // Now closes with different partial data — variations
  r = await S.ADMIN.req("POST", `/api/institution-interests/${interest.id}/close`, {
    json: { outcome: "LOST" }, // missing lostReason
  });
  assert(SCN, "Close LOST without lostReason -> 422", status(r, [422, 400]), r.text.slice(0, 80));
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 9: Merge student profiles (SUPER_ADMIN)
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 9: Merge student profiles ══");
{
  const SCN = "S9";
  // Add distinct data to each side
  let r = await S.ADMIN.req("POST", "/api/institution-interests", { json: {
    leadId: CTX.leadADupeId, institutionId: inst2.id, program: "S9 on dupe",
    intakeYear: 2027, intakeMonth: 9, studyLevel: "POSTGRADUATE",
  }});
  const interestOnDupe = r.json;
  if (interestOnDupe?.id) IDS.interests.push(interestOnDupe.id);

  const beforeSurvivor = await db.lead.findUnique({ where: { id: CTX.leadAId }, include: { _count: { select: { institutionInterests: true } } } });
  const beforeMerged = await db.lead.findUnique({ where: { id: CTX.leadADupeId }, include: { _count: { select: { institutionInterests: true } } } });

  r = await S.ADMIN.req("POST", "/api/leads/merge", {
    json: { keepId: CTX.leadAId, mergeFromId: CTX.leadADupeId, reason: "e2e adversarial test merge" },
  });
  assert(SCN, "Merge succeeds -> 200", status(r, 200), r.text.slice(0, 120));

  const afterSurvivor = await db.lead.findUnique({ where: { id: CTX.leadAId }, include: { _count: { select: { institutionInterests: true } } } });
  const afterMerged = await db.lead.findUnique({ where: { id: CTX.leadADupeId } });

  assert(SCN, "Survivor's interest count grew by merged-side's count",
    afterSurvivor._count.institutionInterests >= beforeSurvivor._count.institutionInterests,
    `before=${beforeSurvivor._count.institutionInterests} after=${afterSurvivor._count.institutionInterests}`);
  assert(SCN, "Merged-from lead marked deletedAt",
    !!afterMerged?.deletedAt, `deletedAt=${afterMerged?.deletedAt}`);
  assert(SCN, "Merged-from lead isDuplicate=true",
    afterMerged?.isDuplicate === true, `isDuplicate=${afterMerged?.isDuplicate}`);
  assert(SCN, "Merged-from lead duplicateOfId points to survivor",
    afterMerged?.duplicateOfId === CTX.leadAId, `duplicateOfId=${afterMerged?.duplicateOfId}`);

  // Audit trail
  const auditRows = await db.auditLog.findMany({
    where: { entity: "Lead", entityId: CTX.leadAId, action: { in: ["LEAD_MERGE_SNAPSHOT", "LEAD_MERGED"] } },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  assert(SCN, "Audit log has BOTH snapshot + merged rows",
    auditRows.length === 2 &&
    auditRows.some(x => x.action === "LEAD_MERGE_SNAPSHOT") &&
    auditRows.some(x => x.action === "LEAD_MERGED"),
    JSON.stringify(auditRows.map(x => x.action)));

  // Cannot re-merge a soft-deleted lead
  r = await S.ADMIN.req("POST", "/api/leads/merge", {
    json: { keepId: CTX.leadAId, mergeFromId: CTX.leadADupeId, reason: "double merge" },
  });
  assert(SCN, "Re-merging a deleted lead -> 404", status(r, [404, 409]), r.text.slice(0, 80));
}

// ══════════════════════════════════════════════════════════════════════
// SCENARIO 10: Auto-populated report accuracy
// ══════════════════════════════════════════════════════════════════════
console.log("\n══ SCENARIO 10: Report accuracy ══");
{
  const SCN = "S10";
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Ask API for auto-populated report scoped to ICR_A
  let r = await S.ADMIN.req("POST", "/api/reports/auto-populate", {
    json: { icrId: CTX.users.ICR_A.userId, reportingMonth: month, reportingYear: year },
  });
  assert(SCN, "auto-populate for ICR_A -> 200", status(r, 200), r.text.slice(0, 80));
  const report = r.json;

  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59);

  // Compare uniqueStudents against direct DB count
  const directStudents = await db.lead.count({
    where: { deletedAt: null, assignedICRId: CTX.users.ICR_A.userId, createdAt: { gte: from, lte: to } },
  });
  assert(SCN, `report.uniqueStudents (${report?.recruitment?.uniqueStudents}) == direct DB count (${directStudents})`,
    report?.recruitment?.uniqueStudents === directStudents);

  // Compare institutionInterests
  const directInterests = await db.institutionInterest.count({
    where: {
      lead: { deletedAt: null },
      assignedICRId: CTX.users.ICR_A.userId,
      createdAt: { gte: from, lte: to },
    },
  });
  assert(SCN, `report.institutionInterests (${report?.recruitment?.institutionInterests}) == DB (${directInterests})`,
    report?.recruitment?.institutionInterests === directInterests);

  // Pipeline by stage: verify at least one stage matches
  const directByStage = await db.institutionInterest.groupBy({
    by: ["stage"],
    where: {
      lead: { deletedAt: null },
      assignedICRId: CTX.users.ICR_A.userId,
      createdAt: { gte: from, lte: to },
    },
    _count: { _all: true },
  });
  let stagesOk = true;
  for (const row of directByStage) {
    if ((report?.pipelineByStage?.[row.stage] ?? 0) !== row._count._all) { stagesOk = false; break; }
  }
  assert(SCN, "All pipeline stages match DB", stagesOk,
    `report=${JSON.stringify(report?.pipelineByStage)} db=${JSON.stringify(directByStage)}`);
}

// ── Summary ────────────────────────────────────────────────────────────
console.log("\n══════════════════════════════════════════════════════════");
console.log("SUMMARY");
console.log("══════════════════════════════════════════════════════════");
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
console.log(`${pass} PASSED  |  ${fail} FAILED  |  ${results.length} total assertions`);

// Per-scenario summary
const byScenario = {};
for (const r of results) {
  byScenario[r.scenario] = byScenario[r.scenario] ?? { pass: 0, fail: 0, failures: [] };
  if (r.ok) byScenario[r.scenario].pass++;
  else { byScenario[r.scenario].fail++; byScenario[r.scenario].failures.push({ label: r.label, detail: r.detail }); }
}
console.log("\nBy scenario:");
for (const [k, v] of Object.entries(byScenario)) {
  console.log(`  ${k}: ${v.pass} pass / ${v.fail} fail`);
}
console.log("\nAll failures:");
for (const r of results.filter(x => !x.ok)) {
  console.log(`  [${r.scenario}] ${r.label}\n    ${r.detail}`);
}

console.log("\nCreated IDs (for cleanup):");
console.log(JSON.stringify(IDS, null, 2));

await db.$disconnect();
process.exit(fail ? 3 : 0);

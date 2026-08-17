/**
 * ICR Transition & Handover — workflow, gates and permissions.
 *
 *   node --import tsx --env-file=.env scripts/qa-icr-transition.mjs
 *
 * Walks a report from assignment to Final through the real API with real
 * logged-in users, and checks the refusals as hard as the successes: the whole
 * value of this module is that it will NOT let a handover close with loose ends.
 *
 * Three passes, each with its own accounts, all destroyed and confirmed gone.
 */

import {
  db, createAndLogin, destroyUser, BASE,
  startSection, expect, ok, fail, summary, TAG, sleep,
} from "./qa-lib.mjs";

const PASSES = 3;
const allCreated = [];
const made = { reports: [], institutions: [] };

async function api(jar, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: jar.header(), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  await sleep(40);
  return { status: res.status, payload };
}

const iso = (days) => new Date(Date.now() + days * 864e5).toISOString();

async function runPass(pass) {
  startSection(`PASS ${pass} — assignment and permissions`);

  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  const other = await createAndLogin({ role: "EMPLOYEE" });
  allCreated.push(rm, icr, other);

  const inst = await db.institution.create({
    data: {
      name: `${TAG}-p${pass}-Transition Uni`, country: "Malaysia",
      type: "UNIVERSITY", createdById: rm.user.id,
    },
  });
  made.institutions.push(inst.id);

  // An EMPLOYEE holds no icr_transition permission at all.
  const denied = await api(other.jar, "GET", "/api/transition-reports");
  expect(denied.status === 403, "*** a role without the permission is refused ***", `status=${denied.status}`);

  // Spec 6: only a manager assigns. An ICR must not be able to.
  const byIcr = await api(icr.jar, "POST", "/api/transition-reports", {
    outgoingIcrId: icr.user.id, institutionId: inst.id,
    regionalManagerId: rm.user.id, transitionType: "LEAVING_ILLUME",
    effectiveTransitionDate: iso(30), reportDueDate: iso(20),
  });
  expect(byIcr.status === 403, "*** an ICR cannot assign their own transition ***", `status=${byIcr.status}`);

  // Spec 32: the outgoing ICR cannot also be the reviewer.
  const selfReview = await api(rm.jar, "POST", "/api/transition-reports", {
    outgoingIcrId: rm.user.id, institutionId: inst.id,
    regionalManagerId: rm.user.id, transitionType: "LEAVING_ILLUME",
    effectiveTransitionDate: iso(30), reportDueDate: iso(20),
  });
  expect(selfReview.status === 422, "*** the ICR cannot review their own report ***", `status=${selfReview.status}`);

  // A due date after the person has gone defeats the point.
  const lateDue = await api(rm.jar, "POST", "/api/transition-reports", {
    outgoingIcrId: icr.user.id, institutionId: inst.id,
    regionalManagerId: rm.user.id, transitionType: "LEAVING_ILLUME",
    effectiveTransitionDate: iso(10), reportDueDate: iso(40),
  });
  expect(lateDue.status === 422, "*** a due date after the transition is refused ***", `status=${lateDue.status}`);

  const created = await api(rm.jar, "POST", "/api/transition-reports", {
    outgoingIcrId: icr.user.id, institutionId: inst.id,
    regionalManagerId: rm.user.id, transitionType: "LEAVING_ILLUME",
    effectiveTransitionDate: iso(30), reportDueDate: iso(20),
    finalWorkingDay: iso(29),
  });
  const reportId = created.payload?.data?.id;
  expect(created.status === 201 && !!reportId, "Regional Manager assigns the report", `status=${created.status}`);
  if (!reportId) return teardown(pass, [rm, icr, other]);
  made.reports.push(reportId);

  const sectionCount = await db.transitionReportSection.count({ where: { reportId } });
  expect(sectionCount === 15, "*** all 15 sections are created up front ***", `${sectionCount}`);

  const dup = await api(rm.jar, "POST", "/api/transition-reports", {
    outgoingIcrId: icr.user.id, institutionId: inst.id,
    regionalManagerId: rm.user.id, transitionType: "LEAVING_ILLUME",
    effectiveTransitionDate: iso(30), reportDueDate: iso(20),
  });
  expect(dup.status === 409, "*** a second open report for the same assignment is refused ***", `status=${dup.status}`);

  // ── Workflow ──────────────────────────────────────────────────────────
  startSection(`PASS ${pass} — workflow and gates`);

  const skip = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "FINAL" });
  expect(skip.status === 409, "*** the workflow cannot be skipped to Final ***", `status=${skip.status}`);

  const start = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "IN_PROGRESS" });
  expect(start.status === 200, "ICR starts the report", `status=${start.status}`);

  // Submitting an empty report must be refused, and must say what is missing.
  const early = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "SUBMITTED_TO_RM" });
  expect(early.status === 422, "*** an incomplete report cannot be submitted ***", `status=${early.status}`);
  expect(Array.isArray(early.payload?.reasons) && early.payload.reasons.length > 0,
    "*** the refusal lists what is incomplete ***",
    `${early.payload?.reasons?.length ?? 0} reasons`);

  // ── Section editing, through the real API ─────────────────────────────
  const detail = await api(icr.jar, "GET", `/api/transition-reports/${reportId}`);
  expect(detail.status === 200, "ICR can open the report", `status=${detail.status}`);
  expect(detail.payload?.data?.sections?.length === 15, "detail returns all 15 sections",
    `${detail.payload?.data?.sections?.length}`);
  expect(detail.payload?.data?.context?.source === "live",
    "*** an open report reads live CRM context ***", String(detail.payload?.data?.context?.source));
  expect(detail.payload?.data?.permissions?.canEdit === true, "ICR may edit while in progress");

  // A manager must not rewrite the ICR's account of the handover.
  const rmEdit = await api(rm.jar, "PATCH", `/api/transition-reports/${reportId}/sections`, {
    section: "EXECUTIVE_HANDOVER_SUMMARY", narrative: "RM rewriting the ICR",
  });
  expect(rmEdit.status === 403, "*** the Regional Manager cannot edit the ICR's sections ***",
    `status=${rmEdit.status}`);

  // Ticking complete with nothing written is refused.
  const emptyComplete = await api(icr.jar, "PATCH", `/api/transition-reports/${reportId}/sections`, {
    section: "EXECUTIVE_HANDOVER_SUMMARY", completed: true,
  });
  expect(emptyComplete.status === 422, "*** a section cannot be completed while empty ***",
    `status=${emptyComplete.status}`);

  // Declaration before the work is done is refused.
  const earlyDecl = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/declaration`, {
    confirmed: true,
  });
  expect(earlyDecl.status === 422, "*** the declaration cannot be confirmed before the sections ***",
    `status=${earlyDecl.status}`);

  // Complete every section through the API.
  let saved = 0;
  for (const def of detail.payload.data.sections) {
    const r = await api(icr.jar, "PATCH", `/api/transition-reports/${reportId}/sections`, {
      section: def.key, narrative: `${TAG} handover notes for ${def.title}`, completed: true,
    });
    if (r.status === 200) saved++;
  }
  expect(saved === 15, "all 15 sections saved through the API", `${saved}/15`);

  const noDecl = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "SUBMITTED_TO_RM" });
  expect(noDecl.status === 422, "*** sections complete but no declaration still blocks submission ***",
    `status=${noDecl.status}`);

  const rmDecl = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/declaration`, {
    confirmed: true,
  });
  expect(rmDecl.status === 403, "*** only the outgoing ICR can sign their own declaration ***",
    `status=${rmDecl.status}`);

  const decl = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/declaration`, {
    confirmed: true,
  });
  expect(decl.status === 200, "ICR confirms the declaration", `status=${decl.status}`);

  const submitted = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "SUBMITTED_TO_RM" });
  expect(submitted.status === 200, "ICR submits a complete report", `status=${submitted.status}`);

  // The ICR must not be able to accept their own work.
  const selfAccept = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "ACCEPTED_BY_RM" });
  expect(selfAccept.status === 403, "*** the ICR cannot accept their own report ***", `status=${selfAccept.status}`);

  const noReason = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "AMENDMENTS_REQUIRED" });
  expect(noReason.status === 422, "*** returning a report requires a reason ***", `status=${noReason.status}`);

  const returned = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/status`, {
    to: "AMENDMENTS_REQUIRED", comments: "Expand the agent handover section.",
  });
  expect(returned.status === 200, "RM returns the report for amendments", `status=${returned.status}`);

  const resub = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "RESUBMITTED" });
  expect(resub.status === 200, "ICR resubmits", `status=${resub.status}`);

  const accepted = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "ACCEPTED_BY_RM" });
  expect(accepted.status === 200, "RM accepts", `status=${accepted.status}`);

  // ── Finalisation blocks on loose ends ─────────────────────────────────
  const lead = await db.lead.create({
    data: {
      firstName: `${TAG}p${pass}`, lastName: "Handover",
      email: `${TAG.toLowerCase()}-p${pass}-h@example.com`,
      nationality: "Malaysian", countryOfResidence: "Malaysia",
      interestedProgram: "CS", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9, createdById: rm.user.id,
    },
  });
  const interest = await db.institutionInterest.create({
    data: {
      leadId: lead.id, institutionId: inst.id, assignedICRId: icr.user.id,
      intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
      stage: "NEW_LEAD",
    },
  });

  const blocked = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "FINAL" });
  expect(blocked.status === 422,
    "*** cannot finalise while a student is still assigned to the outgoing ICR ***",
    `status=${blocked.status}`);
  expect(JSON.stringify(blocked.payload?.reasons ?? "").includes("student interest"),
    "*** the refusal names the unowned student interest ***",
    JSON.stringify(blocked.payload?.reasons ?? "").slice(0, 90));

  // Hand the student over, then it should close.
  await db.institutionInterest.update({ where: { id: interest.id }, data: { assignedICRId: rm.user.id } });

  const finalised = await api(rm.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "FINAL" });
  expect(finalised.status === 200, "*** the report finalises once nothing is unowned ***", `status=${finalised.status}`);

  const row = await db.transitionReport.findUnique({
    where: { id: reportId },
    select: { status: true, snapshot: true, finalisedAt: true },
  });
  expect(row?.status === "FINAL", "status is FINAL");
  expect(row?.snapshot !== null, "*** a historical snapshot was frozen at finalisation ***");
  expect(row?.finalisedAt !== null, "finalisedAt recorded");

  const locked = await api(icr.jar, "POST", `/api/transition-reports/${reportId}/status`, { to: "IN_PROGRESS" });
  expect(locked.status === 409, "*** a Final report cannot be reopened ***", `status=${locked.status}`);

  const afterFinal = await api(rm.jar, "GET", `/api/transition-reports/${reportId}`);
  expect(afterFinal.payload?.data?.context?.source === "snapshot",
    "*** a Final report reads the frozen snapshot, not live data ***",
    String(afterFinal.payload?.data?.context?.source));

  const lockedEdit = await api(icr.jar, "PATCH", `/api/transition-reports/${reportId}/sections`, {
    section: "EXECUTIVE_HANDOVER_SUMMARY", narrative: "changing history",
  });
  expect(lockedEdit.status === 403, "*** a Final report's sections cannot be edited ***",
    `status=${lockedEdit.status}`);

  const events = await db.transitionWorkflowEvent.count({ where: { reportId } });
  expect(events >= 7, "*** the full workflow history is retained ***", `${events} events`);

  // ── Cleanup ───────────────────────────────────────────────────────────
  await db.institutionInterest.deleteMany({ where: { id: interest.id } }).catch(() => {});
  await db.lead.deleteMany({ where: { id: lead.id } }).catch(() => {});
  await teardown(pass, [rm, icr, other]);
}

async function teardown(pass, users) {
  if (made.reports.length) {
    await db.transitionReport.deleteMany({ where: { id: { in: made.reports } } }).catch(() => {});
    made.reports.length = 0;
  }
  if (made.institutions.length) {
    await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
    await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
    made.institutions.length = 0;
  }
  for (const u of users) {
    await destroyUser(u);
    const left = await db.user.count({ where: { id: u.user.id } });
    expect(left === 0, `pass ${pass}: ${u.user.role} account deleted`, `${left} remaining`);
    if (left === 0) {
      const i = allCreated.indexOf(u);
      if (i >= 0) allCreated.splice(i, 1);
    }
  }
}

async function main() {
  startSection("Baseline");
  const before = await db.user.count();
  ok(`users=${before}`);

  for (let p = 1; p <= PASSES; p++) await runPass(p);

  startSection("Footprint");
  expect(await db.user.count() === before, "*** user count back to baseline ***");
  expect(await db.transitionReport.count() === 0, "*** no transition report survived ***");
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", String(e?.message).slice(0, 140));
} finally {
  await db.transitionReport.deleteMany({ where: { id: { in: made.reports } } }).catch(() => {});
  await db.institution.deleteMany({ where: { id: { in: made.institutions } } }).catch(() => {});
  for (const c of allCreated) await destroyUser(c);
  const leaked = await db.user.count({ where: { email: { contains: TAG.toLowerCase() } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked users: ${leaked}\n`);
  await db.$disconnect();
}
summary();

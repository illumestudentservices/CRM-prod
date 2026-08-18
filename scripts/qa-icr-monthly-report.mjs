/**
 * ICR Monthly Report — behaviour, not just reachability.
 *
 * The point of this module is that a rep does not retype figures the CRM
 * already holds, so the test seeds a month of real pipeline movement and then
 * checks the report's numbers against what was seeded. A report that renders
 * with zeros would pass a smoke test and be worthless.
 *
 * Also proves the things that would quietly rot: that a rep cannot overwrite a
 * computed figure by posting it back, that another rep cannot read the report,
 * and that a submitted report stops being editable.
 *
 *   node --env-file=.env scripts/qa-icr-monthly-report.mjs
 */
import {
  db, api, createAndLogin, destroyUser, startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

// Report on last month — the month a rep would actually be filing.
const now = new Date();
const YEAR = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
const MONTH = now.getMonth() === 0 ? 12 : now.getMonth();
const midPeriod = new Date(YEAR, MONTH - 1, 15, 12, 0, 0);

/** How many leads to seed at each stage, so the assertions have known answers. */
const SEED = { leads: 6, applications: 4, offers: 3, deposits: 2, enrolments: 1 };

let icr, rm, otherIcr;
const made = { region: null, institution: null, partner: null, event: null, leadIds: [], reportId: null };

async function seed(icrId, regionId) {
  const institution = await db.institution.create({
    data: {
      name: `${TAG} College`,
      country: "Canada",
      type: "COLLEGE",
      createdById: icrId,
      ...(regionId ? { regionId } : {}),
    },
  });
  made.institution = institution;

  const partner = await db.recruitmentPartner.create({
    data: {
      name: `${TAG} Agency`,
      type: "AGENT",
      country: "Nigeria",
      createdById: icrId,
      createdAt: midPeriod,
      ...(regionId ? { regionId } : {}),
    },
  });
  made.partner = partner;

  const event = await db.event.create({
    data: {
      name: `${TAG} Fair`,
      type: "EDUCATION_FAIR",
      date: midPeriod,
      city: "Lagos",
      country: "Nigeria",
      totalCost: 1000,
      createdById: icrId,
      assignedICRId: icrId,
      ...(regionId ? { regionId } : {}),
    },
  }).catch(async () => {
    // EventType is an enum and its members have moved between phases; fall back
    // to whichever value the live schema actually has rather than failing the
    // whole seed on a label.
    const [{ enumlabel }] = await db.$queryRawUnsafe(
      `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
        WHERE t.typname='EventType' LIMIT 1`
    );
    return db.event.create({
      data: {
        name: `${TAG} Fair`, type: enumlabel, date: midPeriod, city: "Lagos",
        country: "Nigeria", totalCost: 1000, createdById: icrId, assignedICRId: icrId,
        ...(regionId ? { regionId } : {}),
      },
    });
  });
  made.event = event;

  // Leads created inside the period, sourced from the partner and the event.
  for (let i = 0; i < SEED.leads; i++) {
    const lead = await db.lead.create({
      data: {
        firstName: `${TAG}Student`,
        lastName: String(i),
        email: `${TAG.toLowerCase()}-lead-${i}-${Date.now()}@illume.local`,
        phone: "+2340000000",
        nationality: "Nigerian",
        countryOfResidence: "Nigeria",
        interestedProgram: "Business Administration",
        studyLevel: "UNDERGRADUATE",
        intakeYear: YEAR + 1,
        intakeMonth: 9,
        createdById: icrId,
        assignedICRId: icrId,
        institutionId: made.institution.id,
        sourceId: made.partner.id,
        eventId: made.event.id,
        createdAt: midPeriod,
        ...(regionId ? { regionId } : {}),
      },
    });
    made.leadIds.push(lead.id);
  }

  // Stage movement, written the way the app writes it, because that trail is
  // what the report counts. Anything else would test a fiction.
  const move = async (leadId, to, at) => {
    await db.leadActivity.create({
      data: {
        leadId, userId: icrId, kind: "SYSTEM", type: "STAGE_CHANGE",
        description: `Stage moved to ${to}`,
        metadata: { from: null, to },
        createdAt: at,
      },
    });
    await db.lead.update({ where: { id: leadId }, data: { stage: to, stageEnteredAt: at } });
  };

  for (let i = 0; i < SEED.applications; i++) {
    await move(made.leadIds[i], "APPLICATION_SUBMITTED", midPeriod);
  }
  for (let i = 0; i < SEED.offers; i++) {
    await move(made.leadIds[i], "OFFER_RECEIVED", midPeriod);
  }
  for (let i = 0; i < SEED.deposits; i++) {
    await move(made.leadIds[i], "DEPOSIT_PAID", midPeriod);
  }
  for (let i = 0; i < SEED.enrolments; i++) {
    await move(made.leadIds[i], "ENROLLED", midPeriod);
  }

  // One agent meeting and one training, so §2.1 is not all zeros.
  for (const type of ["AGENT_MEETING", "AGENT_TRAINING"]) {
    await db.activity.create({
      data: {
        type, title: `${TAG} ${type}`, date: midPeriod, actualDate: midPeriod,
        userId: icrId, sourceId: made.partner.id,
      },
    }).catch(() => {});
  }
}

async function cleanup() {
  await db.icrReportApproval.deleteMany({ where: { report: { icrId: icr?.user?.id } } }).catch(() => {});
  await db.icrMonthlyReport.deleteMany({ where: { icrId: icr?.user?.id } }).catch(() => {});
  if (made.leadIds.length) {
    await db.leadActivity.deleteMany({ where: { leadId: { in: made.leadIds } } }).catch(() => {});
    await db.lead.deleteMany({ where: { id: { in: made.leadIds } } }).catch(() => {});
  }
  await db.activity.deleteMany({ where: { title: { startsWith: TAG } } }).catch(() => {});
  if (made.event) await db.event.deleteMany({ where: { id: made.event.id } }).catch(() => {});
  if (made.partner) await db.recruitmentPartner.deleteMany({ where: { id: made.partner.id } }).catch(() => {});
  if (made.institution) await db.institution.deleteMany({ where: { id: made.institution.id } }).catch(() => {});
  for (const ctx of [icr, rm, otherIcr]) await destroyUser(ctx).catch(() => {});
  if (made.region) await db.region.deleteMany({ where: { id: made.region.id } }).catch(() => {});
}

try {
  // ── Setup ───────────────────────────────────────────────────────────────
  startSection("Setup");
  made.region = await db.region.create({
    data: { name: `${TAG} Region`, code: `${TAG.slice(0, 6)}`, createdById: "seed" },
  }).catch(async () => {
    // `createdById` is required on some revisions of this model and free on
    // others; retry without it rather than guessing.
    return db.region.create({ data: { name: `${TAG} Region`, code: `${TAG.slice(0, 6)}` } });
  });
  ok("region created");

  icr = await createAndLogin({ role: "ICR", extra: { regionId: made.region.id } });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", extra: { regionId: made.region.id } });
  otherIcr = await createAndLogin({ role: "ICR" });
  ok("ICR, Regional Manager and an unrelated ICR logged in with MFA");

  await seed(icr.user.id, made.region.id);
  ok(`seeded ${SEED.leads} leads, ${SEED.applications} applications, ${SEED.offers} offers, ${SEED.deposits} deposits`);

  // ── Generation ──────────────────────────────────────────────────────────
  startSection("Generating the report");
  const created = await api(icr.jar, "POST", "/api/icr-reports", {
    reportingMonth: MONTH, reportingYear: YEAR, intakesCovered: "Sep 2026 / Jan 2027",
  });
  if (!expect(created.status === 201, "POST /api/icr-reports returns 201", `status ${created.status} ${JSON.stringify(created.payload).slice(0, 120)}`)) {
    throw new Error("cannot continue without a report");
  }
  made.reportId = created.payload.id;

  const dup = await api(icr.jar, "POST", "/api/icr-reports", { reportingMonth: MONTH, reportingYear: YEAR });
  expect(dup.status === 409, "a second report for the same month is refused (409)", `status ${dup.status}`);
  expect(dup.payload?.reportId === made.reportId, "and points at the existing report");

  const future = await api(icr.jar, "POST", "/api/icr-reports", {
    reportingMonth: 12, reportingYear: now.getFullYear() + 2,
  });
  expect(future.status === 400, "a period that has not started is refused", `status ${future.status}`);

  // ── The numbers ─────────────────────────────────────────────────────────
  startSection("Auto-filled figures match the CRM");
  const got = await api(icr.jar, "GET", `/api/icr-reports/${made.reportId}`);
  expect(got.status === 200, "GET the report returns 200", `status ${got.status}`);
  const r = got.payload;

  const perf = Object.fromEntries((r.performance ?? []).map((x) => [x.key, x]));
  expect(perf.leads?.thisMonth === SEED.leads,
    `*** Leads Generated = ${SEED.leads} ***`, `got ${perf.leads?.thisMonth}`);
  expect(perf.applications?.thisMonth === SEED.applications,
    `*** Applications Submitted = ${SEED.applications}, counted from the stage trail ***`,
    `got ${perf.applications?.thisMonth}`);
  expect(perf.offers?.thisMonth === SEED.offers,
    `*** Offers Issued = ${SEED.offers} ***`, `got ${perf.offers?.thisMonth}`);
  expect(perf.deposits?.thisMonth === SEED.deposits,
    `*** Deposits Received = ${SEED.deposits} ***`, `got ${perf.deposits?.thisMonth}`);
  expect(perf.enrolments?.thisMonth === SEED.enrolments,
    `Enrolments = ${SEED.enrolments}`, `got ${perf.enrolments?.thisMonth}`);
  expect(perf.visaApprovals?.thisMonth === null,
    "*** Visa Approvals reports null, not a fabricated zero ***",
    `got ${perf.visaApprovals?.thisMonth}`);
  expect(typeof perf.visaApprovals?.notTrackedNote === "string",
    "and says why it is blank");
  expect(perf.leads?.target === null, "targets start empty for the rep to set");

  // A flow count is not a stage headcount: only ONE lead sits in
  // APPLICATION_SUBMITTED now (the others moved on), but four crossed the line.
  const inApp = await db.lead.count({
    where: { assignedICRId: icr.user.id, deletedAt: null, stage: "APPLICATION_SUBMITTED" },
  });
  expect(inApp !== SEED.applications && perf.applications.thisMonth === SEED.applications,
    "*** flow, not stock: 4 applications counted while only 1 lead sits in that stage ***",
    `in-stage now = ${inApp}`);

  const pipe = r.pipelineSnapshot ?? {};
  expect(pipe.activeLeads === SEED.leads - SEED.applications,
    `pipeline snapshot: ${SEED.leads - SEED.applications} active leads`, `got ${pipe.activeLeads}`);
  expect(pipe.offersPending === SEED.offers - SEED.deposits,
    "offers pending deposit is a current headcount", `got ${pipe.offersPending}`);

  const inst = r.institutionBreakdown ?? [];
  expect(inst.length === 1 && inst[0].name === `${TAG} College`,
    "*** breakdown names the institution the rep worked ***", JSON.stringify(inst).slice(0, 120));
  expect(inst[0]?.leads === SEED.leads && inst[0]?.applications === SEED.applications,
    "and its figures match the rollup");

  const agents = r.topAgents ?? [];
  expect(agents.length === 1 && agents[0].name === `${TAG} Agency`,
    "*** §2.2 names the sourcing agent ***", JSON.stringify(agents).slice(0, 120));
  expect(agents[0]?.leads === SEED.leads && agents[0]?.applications === SEED.applications,
    "with that agent's leads and applications");

  const eng = r.agentEngagement ?? {};
  expect(eng.agentMeetings === 1, "§2.1 counts the agent meeting", `got ${eng.agentMeetings}`);
  expect(eng.trainingsDelivered === 1, "and the training", `got ${eng.trainingsDelivered}`);
  expect(eng.newAgentsIdentified === 1, "and the agent identified this month", `got ${eng.newAgentsIdentified}`);

  const evs = r.eventActivities ?? [];
  expect(evs.length === 1 && evs[0].leadsGenerated === SEED.leads,
    "*** §3.1 lists the event with its lead count ***", JSON.stringify(evs).slice(0, 140));
  expect(evs[0]?.costPerLead === Math.round((1000 / SEED.leads) * 100) / 100,
    "and computes cost per lead", `got ${evs[0]?.costPerLead}`);

  // ── The rep cannot rewrite a computed figure ────────────────────────────
  startSection("Computed figures are not writable");
  const tamper = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}`, {
    performance: [{ key: "leads", label: "Leads Generated", target: null, thisMonth: 9999, previousMonth: 0, trend: "UP" }],
    topAgents: [{ partnerId: "x", name: "Made up", leads: 9999, applications: 0, deposits: 0, note: "" }],
    keyHighlights: "A good month.",
  });
  expect(tamper.status === 200, "the request itself succeeds (the narrative field saves)", `status ${tamper.status}`);
  const after = await api(icr.jar, "GET", `/api/icr-reports/${made.reportId}`);
  const perfAfter = Object.fromEntries((after.payload.performance ?? []).map((x) => [x.key, x]));
  expect(perfAfter.leads?.thisMonth === SEED.leads,
    "*** but the posted figure is ignored — Leads is still the CRM's number ***",
    `got ${perfAfter.leads?.thisMonth}`);
  expect((after.payload.topAgents ?? [])[0]?.name === `${TAG} Agency`,
    "*** and the agent table was not replaced ***");
  expect(after.payload.keyHighlights === "A good month.", "the narrative field did save");

  // ── The editable cells ──────────────────────────────────────────────────
  startSection("Editable cells");
  const edit = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}`, {
    performanceTargets: { leads: 10 },
    agentNotes: { [made.partner.id]: "Strong month, wants co-branded material." },
  });
  expect(edit.status === 200, "targets and agent notes save", `status ${edit.status}`);
  const edited = await api(icr.jar, "GET", `/api/icr-reports/${made.reportId}`);
  const pe = Object.fromEntries((edited.payload.performance ?? []).map((x) => [x.key, x]));
  expect(pe.leads?.target === 10, "the target is stored", `got ${pe.leads?.target}`);
  expect(pe.leads?.thisMonth === SEED.leads, "and setting it did not disturb the computed figure");
  expect((edited.payload.topAgents ?? [])[0]?.note?.startsWith("Strong month"), "the agent note is stored");

  // ── Refresh keeps the rep's typing ──────────────────────────────────────
  startSection("Refresh");
  const refreshed = await api(icr.jar, "POST", `/api/icr-reports/${made.reportId}/refresh`);
  expect(refreshed.status === 200, "refresh returns 200", `status ${refreshed.status}`);
  const afterRefresh = await api(icr.jar, "GET", `/api/icr-reports/${made.reportId}`);
  const pr = Object.fromEntries((afterRefresh.payload.performance ?? []).map((x) => [x.key, x]));
  expect(pr.leads?.target === 10, "*** the rep's target survived the refresh ***", `got ${pr.leads?.target}`);
  expect((afterRefresh.payload.topAgents ?? [])[0]?.note?.startsWith("Strong month"),
    "*** and so did their agent note ***");

  // ── Scope ───────────────────────────────────────────────────────────────
  startSection("Who can see it");
  const stranger = await api(otherIcr.jar, "GET", `/api/icr-reports/${made.reportId}`);
  expect(stranger.status === 404, "*** another ICR gets 404, not 403 ***", `status ${stranger.status}`);
  const strangerList = await api(otherIcr.jar, "GET", "/api/icr-reports");
  expect(!(strangerList.payload?.reports ?? []).some((x) => x.id === made.reportId),
    "and it is absent from their list");
  const rmSees = await api(rm.jar, "GET", `/api/icr-reports/${made.reportId}`);
  expect(rmSees.status === 200, "the Regional Manager for that region can read it", `status ${rmSees.status}`);

  const rmCreate = await api(rm.jar, "POST", "/api/icr-reports", { reportingMonth: MONTH, reportingYear: YEAR });
  expect(rmCreate.status === 403, "a manager cannot file a report on a rep's behalf", `status ${rmCreate.status}`);

  // ── Workflow ────────────────────────────────────────────────────────────
  startSection("Submit and approve");
  const rmApproveEarly = await api(rm.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "APPROVE" });
  expect(rmApproveEarly.status === 400, "a draft cannot be approved", `status ${rmApproveEarly.status}`);

  const submit = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "SUBMIT" });
  expect(submit.status === 200, "the rep submits", `status ${submit.status} ${JSON.stringify(submit.payload).slice(0, 120)}`);
  expect(submit.payload?.status === "PENDING_REVIEW", "status becomes PENDING_REVIEW");

  const editAfter = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}`, { keyHighlights: "changed my mind" });
  expect(editAfter.status === 409, "*** a submitted report can no longer be edited ***", `status ${editAfter.status}`);
  const refreshAfter = await api(icr.jar, "POST", `/api/icr-reports/${made.reportId}/refresh`);
  expect(refreshAfter.status === 409, "*** and its figures are frozen ***", `status ${refreshAfter.status}`);

  const notified = await db.notification.count({
    where: { userId: rm.user.id, type: "REPORT", link: `/reports/icr-monthly/${made.reportId}` },
  });
  expect(notified === 1, "the manager was notified", `got ${notified}`);

  const selfApprove = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "APPROVE" });
  expect(selfApprove.status === 403, "*** the rep cannot approve their own report ***", `status ${selfApprove.status}`);

  const badReturn = await api(rm.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "RETURN" });
  expect(badReturn.status === 400, "returning without a reason is refused", `status ${badReturn.status}`);

  const returned = await api(rm.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, {
    action: "RETURN", comment: "Please expand section 4.2.",
  });
  expect(returned.status === 200 && returned.payload?.status === "RETURNED",
    "the manager returns it with a reason", `status ${returned.status}`);

  const editAgain = await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}`, {
    competitiveActivity: "Two competitors ran deposit waivers.",
  });
  expect(editAgain.status === 200, "*** a returned report is editable again ***", `status ${editAgain.status}`);

  await api(icr.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "SUBMIT" });
  const approved = await api(rm.jar, "PATCH", `/api/icr-reports/${made.reportId}/approve`, { action: "APPROVE" });
  expect(approved.status === 200 && approved.payload?.status === "FINAL_APPROVED",
    "*** and the manager approves the resubmission ***", `status ${approved.status}`);

  const trail = await db.icrReportApproval.count({ where: { reportId: made.reportId } });
  expect(trail === 4, "every decision is on the trail (submit, return, submit, approve)", `got ${trail}`);

  // ── Blank-report guard ──────────────────────────────────────────────────
  startSection("A report with no writing is not a report");
  const blank = await db.icrMonthlyReport.create({
    data: { icrId: icr.user.id, regionId: made.region.id, reportingMonth: MONTH === 1 ? 12 : MONTH - 1,
            reportingYear: MONTH === 1 ? YEAR - 1 : YEAR, status: "DRAFT" },
  });
  const blankSubmit = await api(icr.jar, "PATCH", `/api/icr-reports/${blank.id}/approve`, { action: "SUBMIT" });
  expect(blankSubmit.status === 400,
    "*** submitting with every narrative section empty is refused ***", `status ${blankSubmit.status}`);
  await db.icrMonthlyReport.delete({ where: { id: blank.id } }).catch(() => {});
} catch (e) {
  fail("run completed", String(e?.message ?? e).slice(0, 300));
} finally {
  await cleanup();
  const leftUsers = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } }).catch(() => -1);
  const leftReports = await db.icrMonthlyReport.count({ where: { icrId: icr?.user?.id ?? "x" } }).catch(() => -1);
  startSection("Cleanup");
  expect(leftUsers === 0, "no test users left behind", `${leftUsers} remaining`);
  expect(leftReports === 0, "no test reports left behind", `${leftReports} remaining`);
  summary();
  await db.$disconnect();
}

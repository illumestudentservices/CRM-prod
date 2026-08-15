/**
 * Bulk workload reassignment — HTTP verification.
 *
 * The parts worth testing hardest are the ones where a wrong answer is silent:
 *
 *  - the LIVE/CLOSED split. Moving an enrolled student would hand the receiving
 *    ICR someone else's conversion, and nothing would ever flag it. This
 *    includes WITHDRAWN, which is a closed outcome the shared CLOSED_STAGES
 *    list does not know about — the reason ACTIVE_LEAD_STAGES is an allowlist.
 *  - the Employee-vs-User id split on Task.assigneeId. Every other column in
 *    the registry holds a users.id; that one holds an employees.id, so a naive
 *    move either does nothing or moves the wrong rows.
 *  - the offboarding block. It is the whole point of the feature: access must
 *    not be revocable while a caseload still points at the leaving account.
 *
 * NOT COVERED HERE, deliberately, and stated rather than implied: events, event
 * participations and field activities get counted and moved by the same
 * `updateMany` shape as leads, so they are exercised by the registry test but
 * not by dedicated fixtures.
 *
 *   node --import tsx --env-file=.env scripts/qa-reassignment.mjs
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const created = [];
const fixtures = { regions: [], users: [], employees: [], leads: [], interests: [], institutions: [], tasks: [], requests: [] };

async function makePerson(label, regionId, role = "ICR") {
  const u = await db.user.create({
    data: {
      email: `${TAG.toLowerCase()}-${label}-${Date.now()}@illume.local`,
      firstName: TAG, lastName: label, name: `${TAG} ${label}`,
      role, isActive: true, regionId,
    },
  });
  const e = await db.employee.create({
    data: {
      userId: u.id,
      employeeId: `${TAG}-${label}-${Date.now().toString().slice(-5)}`,
      jobTitle: `QA ${label}`, employmentType: "FULL_TIME", startDate: new Date(),
    },
  });
  fixtures.users.push(u.id);
  fixtures.employees.push(e.id);
  return { user: u, employee: e };
}

async function makeLead(stage, ownerId, creatorId, regionId, extra = {}) {
  const l = await db.lead.create({
    data: {
      firstName: TAG, lastName: `${stage}-${Date.now().toString().slice(-5)}`,
      email: `${TAG.toLowerCase()}-${stage}-${Date.now()}@illume.local`,
      phone: "+10000000000",
      nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "QA", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9,
      stage, assignedICRId: ownerId, createdById: creatorId, regionId,
      ...extra,
    },
  });
  fixtures.leads.push(l.id);
  return l;
}

async function main() {
  startSection("Setup");

  const regionA = await db.region.create({ data: { name: `${TAG}-RA`, code: `${TAG}RA` } });
  const regionB = await db.region.create({ data: { name: `${TAG}-RB`, code: `${TAG}RB` } });
  fixtures.regions.push(regionA.id, regionB.id);

  const admin = await createAndLogin({ role: "SUPER_ADMIN" });        created.push(admin);
  const rmA   = await createAndLogin({ role: "REGIONAL_MANAGER" });   created.push(rmA);
  const rmB   = await createAndLogin({ role: "REGIONAL_MANAGER" });   created.push(rmB);
  const rmNone= await createAndLogin({ role: "REGIONAL_MANAGER" });   created.push(rmNone);
  const emp   = await createAndLogin({ role: "EMPLOYEE" });           created.push(emp);
  const icrOut= await createAndLogin({ role: "ICR" });                created.push(icrOut);

  // Set regions AFTER login: the routes re-read the region from the DB rather
  // than the 48h JWT, and this is what proves it.
  await db.user.update({ where: { id: rmA.user.id }, data: { regionId: regionA.id } });
  await db.user.update({ where: { id: rmB.user.id }, data: { regionId: regionB.id } });

  // The leaver, the successor, and a decoy in the other region.
  const leaver    = await makePerson("leaver", regionA.id, "ICR");
  const successor = await makePerson("succ",   regionA.id, "ICR");
  const otherReg  = await makePerson("otherR", regionB.id, "ICR");
  const noEmpUser = await db.user.create({
    data: {
      email: `${TAG.toLowerCase()}-noemp-${Date.now()}@illume.local`,
      firstName: TAG, lastName: "NoEmp", name: `${TAG} NoEmp`,
      role: "ICR", isActive: true, regionId: regionA.id,
    },
  });
  fixtures.users.push(noEmpUser.id);
  const inactive = await makePerson("inact", regionA.id, "ICR");
  await db.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });

  // ── Lead fixtures: 3 live, 4 that must NOT move ─────────────────────────
  await makeLead("NEW_LEAD", leaver.user.id, admin.user.id, regionA.id);
  await makeLead("QUALIFIED", leaver.user.id, admin.user.id, regionA.id);
  await makeLead("OFFER_RECEIVED", leaver.user.id, admin.user.id, regionA.id);
  await makeLead("ENROLLED", leaver.user.id, admin.user.id, regionA.id);
  await makeLead("LOST", leaver.user.id, admin.user.id, regionA.id);
  // The two stages missing from CLOSED_STAGES. A denylist implementation would
  // wrongly treat these as live and move them.
  await makeLead("WITHDRAWN", leaver.user.id, admin.user.id, regionA.id);
  await makeLead("VISA_REFUSED", leaver.user.id, admin.user.id, regionA.id);
  const softDeleted = await makeLead("CONTACTED", leaver.user.id, admin.user.id, regionA.id);
  await db.lead.update({ where: { id: softDeleted.id }, data: { deletedAt: new Date() } });

  const EXPECTED_LIVE_LEADS = 3;

  // ── Interests: 2 open, 1 closed ─────────────────────────────────────────
  const inst = await db.institution.create({
    data: { name: `${TAG}-Uni`, country: "Canada", type: "UNIVERSITY", createdById: admin.user.id },
  });
  fixtures.institutions.push(inst.id);
  const anyLead = await db.lead.findFirst({ where: { id: { in: fixtures.leads } } });
  for (const closed of [null, null, new Date()]) {
    const i = await db.institutionInterest.create({
      data: {
        leadId: anyLead.id, institutionId: inst.id,
        intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
        assignedICRId: leaver.user.id, closedAt: closed,
      },
    });
    fixtures.interests.push(i.id);
  }
  const EXPECTED_LIVE_INTERESTS = 2;

  // ── Tasks: 2 open, 1 done, 1 soft-deleted. Owned by the EMPLOYEE row. ────
  for (const [status, deletedAt] of [["TODO", null], ["IN_PROGRESS", null], ["COMPLETED", null], ["TODO", new Date()]]) {
    const t = await db.task.create({
      data: {
        title: `${TAG} ${status}`, status, deletedAt,
        assigneeId: leaver.employee.id, createdById: admin.employee?.id ?? leaver.employee.id,
        category: "PERSONAL",
      },
    });
    fixtures.tasks.push(t.id);
  }
  const EXPECTED_LIVE_TASKS = 2;
  ok("fixtures created", `${fixtures.leads.length} leads, ${fixtures.interests.length} interests, ${fixtures.tasks.length} tasks`);

  // ── Access control ──────────────────────────────────────────────────────
  startSection("Who may reassign");
  {
    const path = `/api/hr/reassignment?userId=${leaver.user.id}`;
    for (const [who, ctx, want] of [
      ["EMPLOYEE", emp, 403],
      ["ICR", icrOut, 403],
      ["SUPER_ADMIN", admin, 200],
      ["REGIONAL_MANAGER (in region)", rmA, 200],
    ]) {
      const r = await api(ctx.jar, "GET", path);
      expect(r.status === want, `${who} → ${want} on preview`, `got ${r.status}`);
    }
    // Region scoping. 404 not 403 so an out-of-region id cannot be confirmed.
    const cross = await api(rmB.jar, "GET", path);
    expect(cross.status === 404, "RM in another region → 404 (id not confirmed)", `got ${cross.status}`);
    const none = await api(rmNone.jar, "GET", path);
    expect(none.status === 403, "RM with no region → 403, not everybody", `got ${none.status}`);

    const targets = await api(emp.jar, "GET", "/api/hr/reassignment/targets");
    expect(targets.status === 403, "EMPLOYEE → 403 on targets picker", `got ${targets.status}`);
  }

  // ── Preview counts only live work ───────────────────────────────────────
  startSection("Preview counts live work only");
  let preview;
  {
    const r = await api(admin.jar, "GET", `/api/hr/reassignment?userId=${leaver.user.id}`);
    preview = r.payload?.summary;
    const by = Object.fromEntries((preview?.buckets ?? []).map((b) => [b.key, b.count]));

    expect(by.leads === EXPECTED_LIVE_LEADS,
      `leads: ${EXPECTED_LIVE_LEADS} live of 8 (enrolled, lost, withdrawn, visa-refused and deleted excluded)`,
      `got ${by.leads}`);
    expect(by.interests === EXPECTED_LIVE_INTERESTS,
      `interests: ${EXPECTED_LIVE_INTERESTS} open of 3`, `got ${by.interests}`);
    expect(by.tasks === EXPECTED_LIVE_TASKS,
      `tasks: ${EXPECTED_LIVE_TASKS} open of 4 (resolved via the employee id)`, `got ${by.tasks}`);
    expect(preview?.isClear === false, "isClear false while work is outstanding");
    expect(preview?.taskCountUnavailable === false, "task count available (leaver has an employee record)");
  }

  // A user with no Employee row must report 0 tasks AND say why.
  {
    const r = await api(admin.jar, "GET", `/api/hr/reassignment?userId=${noEmpUser.id}`);
    expect(r.payload?.summary?.taskCountUnavailable === true,
      "user without an employee record → taskCountUnavailable true, not a silent 0",
      JSON.stringify(r.payload?.summary?.taskCountUnavailable));
  }

  // ── Target validation ───────────────────────────────────────────────────
  startSection("Recipient validation");
  {
    const cases = [
      ["self", { fromUserId: leaver.user.id, toUserId: leaver.user.id }, 422],
      ["inactive account", { fromUserId: leaver.user.id, toUserId: inactive.user.id }, 422],
      ["role that cannot hold a caseload", { fromUserId: leaver.user.id, toUserId: emp.user.id }, 422],
      ["unknown recipient", { fromUserId: leaver.user.id, toUserId: "00000000-0000-0000-0000-000000000000" }, 404],
    ];
    for (const [label, body, want] of cases) {
      const r = await api(admin.jar, "POST", "/api/hr/reassignment", body);
      expect(r.status === want, `${label} → ${want}`, `got ${r.status} ${JSON.stringify(r.payload?.error ?? "")}`);
    }
    // Cross-region move refused for a scoped operator, both directions.
    const r = await api(rmA.jar, "POST", "/api/hr/reassignment",
      { fromUserId: leaver.user.id, toUserId: otherReg.user.id });
    expect(r.status === 404, "RM cannot move a caseload out of their region → 404", `got ${r.status}`);

    // Nothing above may have written anything.
    const stillLeaver = await db.lead.count({
      where: { assignedICRId: leaver.user.id, deletedAt: null, stage: { in: ["NEW_LEAD", "QUALIFIED", "OFFER_RECEIVED"] } },
    });
    expect(stillLeaver === EXPECTED_LIVE_LEADS, "no rejected attempt moved anything", `${stillLeaver} live leads remain`);
  }

  // ── The offboarding block ───────────────────────────────────────────────
  startSection("Offboarding hard block");
  let request;
  {
    request = await db.offboardingRequest.create({
      data: {
        employeeId: leaver.employee.id, reason: "RESIGNATION",
        lastWorkingDay: new Date(), notes: `${TAG} block test fixture`,
        requestedById: admin.user.id, status: "APPROVED",
        reviewedById: admin.user.id, reviewedAt: new Date(),
      },
    });
    fixtures.requests.push(request.id);

    const blocked = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${request.id}`, { action: "MARK_COMPLETE" });
    expect(blocked.status === 409, "MARK_COMPLETE refused while work is owned → 409", `got ${blocked.status}`);
    expect(blocked.payload?.blocked === "UNREASSIGNED_WORKLOAD",
      "refusal is machine-readable (blocked=UNREASSIGNED_WORKLOAD)", JSON.stringify(blocked.payload?.blocked));
    expect(blocked.payload?.workload?.total === EXPECTED_LIVE_LEADS + EXPECTED_LIVE_INTERESTS + EXPECTED_LIVE_TASKS,
      "refusal carries the itemised counts", `got ${blocked.payload?.workload?.total}`);

    const fresh = await db.offboardingRequest.findUnique({ where: { id: request.id } });
    expect(fresh.completedAt === null, "a blocked attempt did NOT stamp completedAt");

    // Override without a reason is refused by validation.
    const noReason = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${request.id}`,
      { action: "MARK_COMPLETE", override: true });
    expect(noReason.status === 422, "override with no reason → 422", `got ${noReason.status}`);
    const shortReason = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${request.id}`,
      { action: "MARK_COMPLETE", override: true, overrideReason: "urgent" });
    expect(shortReason.status === 422, "override with a one-word reason → 422", `got ${shortReason.status}`);
  }

  // ── Executing the move ──────────────────────────────────────────────────
  startSection("Reassignment moves exactly the live rows");
  {
    const r = await api(admin.jar, "POST", "/api/hr/reassignment",
      { fromUserId: leaver.user.id, toUserId: successor.user.id });
    expect(r.status === 200, "reassign → 200", `got ${r.status} ${JSON.stringify(r.payload?.error ?? "")}`);
    expect(r.payload?.total === EXPECTED_LIVE_LEADS + EXPECTED_LIVE_INTERESTS + EXPECTED_LIVE_TASKS,
      "moved total matches the preview", `got ${r.payload?.total}`);

    // What moved.
    const succLive = await db.lead.count({
      where: { assignedICRId: successor.user.id, deletedAt: null,
               stage: { in: ["NEW_LEAD", "QUALIFIED", "OFFER_RECEIVED"] } },
    });
    expect(succLive === EXPECTED_LIVE_LEADS, "successor received the live leads", `got ${succLive}`);
    const succTasks = await db.task.count({
      where: { assigneeId: successor.employee.id, deletedAt: null, status: { in: ["TODO", "IN_PROGRESS"] } },
    });
    expect(succTasks === EXPECTED_LIVE_TASKS, "successor received the open tasks (employee id mapped)", `got ${succTasks}`);

    // What must NOT have moved — checked per stage, because a single total
    // could hide one wrong stage cancelling out another.
    for (const stage of ["ENROLLED", "LOST", "WITHDRAWN", "VISA_REFUSED"]) {
      const stayed = await db.lead.count({
        where: { id: { in: fixtures.leads }, stage, assignedICRId: leaver.user.id },
      });
      expect(stayed === 1, `${stage} stayed with the leaver`, `got ${stayed}`);
    }
    const deletedStayed = await db.lead.count({
      where: { id: softDeleted.id, assignedICRId: leaver.user.id },
    });
    expect(deletedStayed === 1, "soft-deleted lead stayed with the leaver", `got ${deletedStayed}`);
    const closedInterest = await db.institutionInterest.count({
      where: { id: { in: fixtures.interests }, closedAt: { not: null }, assignedICRId: leaver.user.id },
    });
    expect(closedInterest === 1, "closed interest stayed with the leaver", `got ${closedInterest}`);
    const doneTask = await db.task.count({
      where: { id: { in: fixtures.tasks }, status: "COMPLETED", assigneeId: leaver.employee.id },
    });
    expect(doneTask === 1, "completed task stayed with the leaver", `got ${doneTask}`);

    // Idempotent: keyed on the source owner, so a repeat finds nothing.
    const again = await api(admin.jar, "POST", "/api/hr/reassignment",
      { fromUserId: leaver.user.id, toUserId: successor.user.id });
    expect(again.payload?.total === 0, "re-running moves 0 (idempotent)", `got ${again.payload?.total}`);

    // The recipient is told.
    const note = await db.notification.count({
      where: { userId: successor.user.id, type: "WORKLOAD_REASSIGNED" },
    });
    expect(note === 1, "recipient got exactly one notification", `got ${note}`);
  }

  // ── Block clears ────────────────────────────────────────────────────────
  startSection("Block clears once the workload is gone");
  {
    const p = await api(admin.jar, "GET", `/api/hr/reassignment?userId=${leaver.user.id}`);
    expect(p.payload?.summary?.isClear === true, "preview now reports clear", JSON.stringify(p.payload?.summary?.total));

    const done = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${request.id}`, { action: "MARK_COMPLETE" });
    expect(done.status === 200, "MARK_COMPLETE now succeeds → 200", `got ${done.status}`);
    const fresh = await db.offboardingRequest.findUnique({ where: { id: request.id } });
    expect(fresh.completedAt !== null, "completedAt stamped");
  }

  // ── The override path, on a second leaver who keeps their caseload ───────
  startSection("Override path");
  {
    const leaver2 = await makePerson("leaver2", regionA.id, "ICR");
    await makeLead("NEW_LEAD", leaver2.user.id, admin.user.id, regionA.id);
    const req2 = await db.offboardingRequest.create({
      data: {
        employeeId: leaver2.employee.id, reason: "TERMINATION",
        lastWorkingDay: new Date(), notes: `${TAG} override test fixture`,
        requestedById: admin.user.id, status: "APPROVED",
        reviewedById: admin.user.id, reviewedAt: new Date(),
      },
    });
    fixtures.requests.push(req2.id);

    const blocked = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${req2.id}`, { action: "MARK_COMPLETE" });
    expect(blocked.status === 409, "second leaver is blocked too", `got ${blocked.status}`);

    const forced = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${req2.id}`, {
      action: "MARK_COMPLETE", override: true,
      overrideReason: "Dismissed for cause; access must be cut today.",
    });
    expect(forced.status === 200, "override with a real reason → 200", `got ${forced.status}`);
    const fresh2 = await db.offboardingRequest.findUnique({ where: { id: req2.id } });
    expect(fresh2.completedAt !== null, "override stamped completedAt");

    // The lead is knowingly orphaned — that is the documented trade-off.
    const orphan = await db.lead.count({ where: { assignedICRId: leaver2.user.id, stage: "NEW_LEAD" } });
    expect(orphan === 1, "the record is left owned by the departed account, as designed", `got ${orphan}`);

    const audit = await db.auditLog.findMany({
      where: { action: "OFFBOARDING_REVOKE_OVERRIDE", entityId: req2.id },
      select: { changes: true, ipAddress: true, userId: true },
    });
    expect(audit.length === 1, "override wrote exactly one dedicated audit row", `got ${audit.length}`);
    if (audit[0]) {
      expect(!!audit[0].ipAddress, "override audit row captured an IP", String(audit[0].ipAddress));
      expect(String(audit[0].changes?.reason ?? "").includes("Dismissed"),
        "override audit row stored the reason", JSON.stringify(audit[0].changes?.reason));
      expect(audit[0].changes?.orphanedTotal === 1,
        "override audit row recorded how much was orphaned", JSON.stringify(audit[0].changes?.orphanedTotal));
    }
  }

  // ── Audit for the move itself ───────────────────────────────────────────
  startSection("Audit trail");
  {
    const rows = await db.auditLog.findMany({
      where: { action: "REASSIGN_WORKLOAD" },
      select: { changes: true, ipAddress: true, entity: true },
    });
    expect(rows.length >= 1, "REASSIGN_WORKLOAD audited", `${rows.length} rows`);
    expect(rows.every((r) => r.ipAddress !== null), "every reassignment audit row captured an IP",
      `${rows.filter((r) => r.ipAddress === null).length} null`);
    expect(rows.some((r) => r.changes?.total === EXPECTED_LIVE_LEADS + EXPECTED_LIVE_INTERESTS + EXPECTED_LIVE_TASKS),
      "audit row records what actually moved");
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────
async function teardown() {
  for (const id of fixtures.requests) await db.offboardingRequest.delete({ where: { id } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { action: { in: ["REASSIGN_WORKLOAD", "OFFBOARDING_REVOKE_OVERRIDE"] } } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entity: "OffboardingRequest" } }).catch(() => {});
  await db.deletedRecord.deleteMany({ where: { entityType: "OffboardingRequest" } }).catch(() => {});
  for (const id of fixtures.tasks) await db.task.delete({ where: { id } }).catch(() => {});
  for (const id of fixtures.interests) await db.institutionInterest.delete({ where: { id } }).catch(() => {});
  for (const id of fixtures.leads) await db.lead.delete({ where: { id } }).catch(() => {});
  for (const id of fixtures.institutions) await db.institution.delete({ where: { id } }).catch(() => {});
  for (const ctx of created) await destroyUser(ctx);
  for (const id of fixtures.employees) {
    await db.task.deleteMany({ where: { assigneeId: id } }).catch(() => {});
    await db.task.deleteMany({ where: { createdById: id } }).catch(() => {});
    await db.offboardingRequest.deleteMany({ where: { employeeId: id } }).catch(() => {});
    await db.employee.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fixtures.users) {
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.lead.deleteMany({ where: { createdById: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fixtures.regions) await db.region.delete({ where: { id } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty message)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leakedLeads = await db.lead.count({ where: { firstName: TAG } }).catch(() => -1);
  const leakedTasks = await db.task.count({ where: { title: { startsWith: TAG } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked leads: ${leakedLeads}, leaked tasks: ${leakedTasks}\n`);
  await db.$disconnect();
}
summary();

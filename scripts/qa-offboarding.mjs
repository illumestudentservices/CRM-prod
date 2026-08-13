/**
 * Offboarding request flow — HTTP verification.
 *
 * Focused on the parts that are security decisions rather than CRUD: who may
 * read the queue at all, the regional-manager row scope, the Super-Admin target
 * rule, and the fact that approving revokes nothing. Region scoping is the piece
 * worth testing hardest — the same "the filter existed but did not apply" bug
 * has landed three times in this codebase.
 *
 *   node --import tsx --env-file=.env scripts/qa-offboarding.mjs
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const created = [];       // disposable users to tear down
const fixtures = { regions: [], employees: [], users: [], requests: [] };

/** An employee in a given region, with its own login. */
async function makeEmployee(label, regionId, role = "EMPLOYEE") {
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

async function main() {
  // Opened before anything can throw: qa-lib's fail() writes into the current
  // section, so an exception during fixture setup would otherwise crash inside
  // the error handler and hide the real cause.
  startSection("Setup");

  // ── Fixtures: two regions, so scoping has something to exclude ──────────
  const regionA = await db.region.create({ data: { name: `${TAG}-Region-A`, code: `${TAG}A` } });
  const regionB = await db.region.create({ data: { name: `${TAG}-Region-B`, code: `${TAG}B` } });
  fixtures.regions.push(regionA.id, regionB.id);

  const empA = await makeEmployee("inA", regionA.id);
  const empB = await makeEmployee("inB", regionB.id);
  const empAdminA = await makeEmployee("adminA", regionA.id, "SUPER_ADMIN");
  const empInactive = await makeEmployee("gone", regionA.id);
  await db.employee.update({ where: { id: empInactive.employee.id }, data: { isActive: false } });

  // ── Actors ──────────────────────────────────────────────────────────────
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });           created.push(admin);
  const rmA   = await createAndLogin({ role: "REGIONAL_MANAGER" });      created.push(rmA);
  const rmNone= await createAndLogin({ role: "REGIONAL_MANAGER" });      created.push(rmNone);
  const emp   = await createAndLogin({ role: "EMPLOYEE" });              created.push(emp);
  const icr   = await createAndLogin({ role: "ICR" });                   created.push(icr);

  // rmA manages region A. Set after login on purpose: the route re-reads the
  // region from the DB rather than the JWT, and this proves it.
  await db.user.update({ where: { id: rmA.user.id }, data: { regionId: regionA.id } });
  // rmNone deliberately keeps regionId = null.

  // ── Who may read the queue ──────────────────────────────────────────────
  startSection("Queue visibility");
  for (const [name, ctx] of [["EMPLOYEE", emp], ["ICR", icr]]) {
    const r = await api(ctx.jar, "GET", "/api/hr/offboarding-requests");
    expect(r.status === 403, `${name} cannot read the queue`, `got ${r.status}`);
  }
  {
    const r = await api(admin.jar, "GET", "/api/hr/offboarding-requests");
    expect(r.status === 200 && r.payload?.canReview === true,
      "SUPER_ADMIN reads the queue and canReview=true", `got ${r.status}`);
  }
  {
    const r = await api(rmA.jar, "GET", "/api/hr/offboarding-requests");
    expect(r.status === 200 && r.payload?.canReview === false && r.payload?.canRequest === true,
      "REGIONAL_MANAGER reads the queue, canRequest but not canReview", `got ${r.status}`);
  }

  // ── Candidate picker scoping ────────────────────────────────────────────
  startSection("Candidate scoping");
  {
    const r = await api(rmA.jar, "GET", "/api/hr/offboarding-requests/candidates");
    const ids = (r.payload?.candidates ?? []).map((c) => c.id);
    expect(ids.includes(empA.employee.id), "RM sees an employee in their own region");
    expect(!ids.includes(empB.employee.id), "RM does NOT see an employee in another region");
    expect(!ids.includes(empAdminA.employee.id), "RM does NOT see a SUPER_ADMIN");
    expect(!ids.includes(empInactive.employee.id), "RM does NOT see an inactive employee");
  }
  {
    const r = await api(rmNone.jar, "GET", "/api/hr/offboarding-requests/candidates");
    expect(r.status === 200 && (r.payload?.candidates ?? []).length === 0 && !!r.payload?.reason,
      "RM with no region gets an empty list and a reason", JSON.stringify(r.payload)?.slice(0, 120));
  }
  {
    const r = await api(emp.jar, "GET", "/api/hr/offboarding-requests/candidates");
    expect(r.status === 403, "EMPLOYEE cannot list candidates", `got ${r.status}`);
  }

  // ── Raising a departure: the scope is enforced server-side ──────────────
  startSection("POST scoping");
  const body = (employeeId, extra = {}) => ({
    employeeId, reason: "RESIGNATION",
    lastWorkingDay: new Date(Date.now() + 14 * 864e5).toISOString(),
    notes: "QA harness — resignation with four weeks notice.", ...extra,
  });

  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests", body(empB.employee.id));
    expect(r.status === 404,
      "RM cannot offboard outside their region, and gets 404 not 403 (no id confirmation)",
      `got ${r.status}`);
  }
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests", body(empAdminA.employee.id));
    expect(r.status === 403, "RM cannot offboard a SUPER_ADMIN", `got ${r.status}`);
  }
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests", body(empInactive.employee.id));
    expect(r.status === 409, "Already-closed employee is refused", `got ${r.status}`);
  }
  {
    const r = await api(rmNone.jar, "POST", "/api/hr/offboarding-requests", body(empA.employee.id));
    expect(r.status === 403, "RM with no region cannot offboard anyone", `got ${r.status}`);
  }
  {
    const r = await api(emp.jar, "POST", "/api/hr/offboarding-requests", body(empA.employee.id));
    expect(r.status === 403, "EMPLOYEE cannot raise a departure", `got ${r.status}`);
  }
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests",
      body(empA.employee.id, { notes: "too short" }));
    expect(r.status === 422, "Short notes rejected", `got ${r.status}`);
  }

  let reqId = null;
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests",
      body(empA.employee.id, { forwardingEmail: "Leaver@Gmail.com" }));
    reqId = r.payload?.request?.id ?? null;
    if (reqId) fixtures.requests.push(reqId);
    expect(r.status === 201 && !!reqId, "RM raises a departure in their own region", `got ${r.status}`);
    expect(r.payload?.request?.forwardingEmail === "leaver@gmail.com",
      "Forwarding email normalised to lowercase",
      String(r.payload?.request?.forwardingEmail));
    expect(r.payload?.request?.status === "PENDING", "New departure is PENDING");
  }
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests", body(empA.employee.id));
    expect(r.status === 409, "Duplicate pending departure refused", `got ${r.status}`);
  }
  {
    const r = await api(rmA.jar, "GET", "/api/hr/offboarding-requests/candidates");
    const ids = (r.payload?.candidates ?? []).map((c) => c.id);
    expect(!ids.includes(empA.employee.id),
      "Someone already queued disappears from the picker");
  }

  // ── Row-level read scope ────────────────────────────────────────────────
  startSection("Requester sees only their own");
  {
    const other = await createAndLogin({ role: "HR_MANAGER" }); created.push(other);
    const r = await api(other.jar, "GET", "/api/hr/offboarding-requests");
    const ids = (r.payload?.requests ?? []).map((x) => x.id);
    expect(!ids.includes(reqId), "Another manager cannot see a departure they did not raise");
    const a = await api(admin.jar, "GET", "/api/hr/offboarding-requests");
    expect((a.payload?.requests ?? []).map((x) => x.id).includes(reqId),
      "Reviewer sees every departure");
  }

  // ── Review ──────────────────────────────────────────────────────────────
  startSection("Review and completion");
  {
    const r = await api(rmA.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`, { action: "APPROVE" });
    expect(r.status === 403, "Requester cannot approve their own departure", `got ${r.status}`);
  }
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`, { action: "REJECT" });
    expect(r.status === 422, "Declining with no reason is refused", `got ${r.status}`);
  }
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`,
      { action: "MARK_COMPLETE" });
    expect(r.status === 400, "Cannot mark complete before approval", `got ${r.status}`);
  }
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`, { action: "APPROVE" });
    expect(r.status === 200 && r.payload?.request?.status === "APPROVED",
      "Reviewer approves", `got ${r.status}`);
    expect(r.payload?.request?.completedAt == null,
      "Approval does NOT set completedAt — access is untouched");
  }
  {
    // The whole point of the manual design: approval must not disable the login.
    const u = await db.user.findUnique({
      where: { id: empA.user.id }, select: { isActive: true, sessionsRevokedAt: true },
    });
    expect(u.isActive === true && u.sessionsRevokedAt === null,
      "Approval leaves the employee's login active (manual revocation by design)");
  }
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`, { action: "APPROVE" });
    expect(r.status === 409, "Re-deciding an already-decided departure is refused", `got ${r.status}`);
  }
  let firstCompletedAt = null;
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`,
      { action: "MARK_COMPLETE" });
    firstCompletedAt = r.payload?.request?.completedAt ?? null;
    expect(r.status === 200 && !!firstCompletedAt, "Reviewer marks access revoked", `got ${r.status}`);
  }
  {
    const r = await api(admin.jar, "PATCH", `/api/hr/offboarding-requests/${reqId}`,
      { action: "MARK_COMPLETE" });
    expect(r.status === 200 && r.payload?.request?.completedAt === firstCompletedAt,
      "Marking complete twice does not move the timestamp");
  }

  // ── Withdrawal ──────────────────────────────────────────────────────────
  startSection("Withdrawal");
  {
    const r = await api(rmA.jar, "POST", "/api/hr/offboarding-requests", body(empA.employee.id));
    const id2 = r.payload?.request?.id;
    if (!id2) { fail("could not create a second departure to withdraw", `status ${r.status}`); }
    else {
      fixtures.requests.push(id2);
      const other = created.find((c) => c.user.role === "HR_MANAGER");
      const bad = await api(other.jar, "DELETE", `/api/hr/offboarding-requests/${id2}`);
      expect(bad.status === 403, "A different manager cannot withdraw it", `got ${bad.status}`);
      const good = await api(rmA.jar, "DELETE", `/api/hr/offboarding-requests/${id2}`);
      expect(good.status === 200, "The raiser can withdraw their own pending departure",
        `got ${good.status}`);
      const stillThere = await db.offboardingRequest.findUnique({ where: { id: id2 } });
      expect(stillThere === null, "Withdrawn row is removed (snapshotted into the recycle bin)");
      const binned = await db.deletedRecord.findFirst({
        where: { entityType: "OffboardingRequest", entityId: id2 },
      });
      expect(!!binned, "Withdrawal landed in the recycle bin");
      if (binned) {
        // `entityLabel`, NOT `label` — checking the wrong field made this assert
        // nothing and pass on a literal "undefined". Same trap the ITAsset and
        // AccountRequest label bugs fell into, one layer up.
        const lbl = binned.entityLabel;
        expect(typeof lbl === "string" && lbl.length > 0 && !/undefined|null/.test(lbl),
          "Recycle-bin label is meaningful", `entityLabel="${lbl}"`);
        expect(/offboarding/i.test(lbl ?? ""), "Label identifies it as an offboarding row");
        ok(`bin label: "${lbl}"`);
      }
    }
  }

  // ── Audit trail ─────────────────────────────────────────────────────────
  startSection("Audit trail");
  {
    const rows = await db.auditLog.findMany({
      where: { entity: "OffboardingRequest" },
      select: { action: true, ipAddress: true },
    });
    const actions = new Set(rows.map((r) => r.action));
    expect(actions.has("CREATE") && actions.has("APPROVE"),
      "CREATE and APPROVE are audited", [...actions].join(","));
    expect(rows.length > 0 && rows.every((r) => r.ipAddress !== null),
      "Every offboarding audit row captured an IP",
      `${rows.filter((r) => r.ipAddress === null).length} null of ${rows.length}`);
  }
}

// ── Teardown ──────────────────────────────────────────────────────────────
async function teardown() {
  for (const id of fixtures.requests) {
    await db.offboardingRequest.delete({ where: { id } }).catch(() => {});
  }
  await db.deletedRecord.deleteMany({ where: { entityType: "OffboardingRequest" } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entity: "OffboardingRequest" } }).catch(() => {});
  for (const ctx of created) await destroyUser(ctx);
  for (const id of fixtures.employees) {
    await db.offboardingRequest.deleteMany({ where: { employeeId: id } }).catch(() => {});
    await db.employee.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fixtures.users) {
    await db.notification.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.auditLog.deleteMany({ where: { userId: id } }).catch(() => {});
    await db.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of fixtures.regions) await db.region.delete({ where: { id } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  // Printed before fail() is called: an empty Prisma message with code
  // ECONNREFUSED means the SSH tunnel died, and that must not be hidden.
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leaked = await db.offboardingRequest.count().catch(() => -1);
  process.stdout.write(`\n[cleanup] offboarding_requests rows remaining: ${leaked}\n`);
  await db.$disconnect();
}
summary();

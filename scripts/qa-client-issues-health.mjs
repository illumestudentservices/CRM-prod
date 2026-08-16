/**
 * Client issues and account health — verification.
 *
 *   node --import tsx --env-file=.env scripts/qa-client-issues-health.mjs
 *
 * Both the ClientIssue model and the account-health rating were built and
 * tested and had NO user interface, so neither could be used. The routes are
 * exercised here directly; the UI check is separate.
 *
 * The assertion that matters most is the Account Manager one. Spec §11 says
 * "The status should initially be selected by the Account Manager", and the
 * capability wiring had excluded exactly that role.
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const created = [];
const made = { institutions: [], issues: [] };

async function main() {
  startSection("Setup");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });      created.push(admin);
  const am    = await createAndLogin({ role: "ACCOUNT_MANAGER" });  created.push(am);
  const icr   = await createAndLogin({ role: "ICR" });              created.push(icr);

  const inst = await db.institution.create({
    data: { name: `${TAG}-Client`, country: "Canada", type: "UNIVERSITY", createdById: admin.user.id },
  });
  made.institutions.push(inst.id);
  ok(`institution created, health starts ${inst.accountHealth}`);

  // ── The spec's named role ───────────────────────────────────────────────
  startSection("The Account Manager can set account health (spec §11)");
  {
    const r = await api(am.jar, "PATCH", `/api/institutions/${inst.id}/health`, { health: "GREEN" });
    expect(r.status === 200,
      "*** ACCOUNT_MANAGER can set health — the role the spec names ***",
      `got ${r.status} ${JSON.stringify(r.payload?.error ?? "")}`);
    const row = await db.institution.findUnique({ where: { id: inst.id } });
    expect(row.accountHealth === "GREEN", "rating persisted", row.accountHealth);
  }

  // ── The validation rule ─────────────────────────────────────────────────
  startSection("Amber and Red require a corrective action");
  {
    for (const health of ["AMBER", "RED"]) {
      const bare = await api(am.jar, "PATCH", `/api/institutions/${inst.id}/health`, { health });
      expect(bare.status === 422 || bare.status === 400,
        `${health} with no intervention is refused`, `got ${bare.status}`);
    }
    const still = await db.institution.findUnique({ where: { id: inst.id } });
    expect(still.accountHealth === "GREEN", "a refused change did not alter the rating", still.accountHealth);

    const full = await api(am.jar, "PATCH", `/api/institutions/${inst.id}/health`, {
      health: "RED",
      intervention: {
        reason: "Enrolments 40% below target for two consecutive intakes",
        correctiveAction: "Weekly pipeline review with the ICR team until the gap closes",
        actionOwnerId: am.user.id,
        reviewDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      },
    });
    expect(full.status === 200, "RED with a full intervention is accepted", `got ${full.status} ${JSON.stringify(full.payload?.error ?? "")}`);

    const row = await db.institution.findUnique({ where: { id: inst.id } });
    expect(row.accountHealth === "RED", "rating is now RED", row.accountHealth);

    const iv = await db.accountIntervention.findMany({ where: { institutionId: inst.id } });
    expect(iv.length === 1, "*** exactly one intervention was recorded alongside it ***", `${iv.length}`);
    if (iv[0]) {
      expect(iv[0].reason.includes("40%"), "the reason was stored", iv[0].reason?.slice(0, 40));
      expect(!!iv[0].actionOwnerId, "an action owner was stored", String(iv[0].actionOwnerId));
      expect(!!iv[0].reviewDate, "a review date was stored", String(iv[0].reviewDate));
    }

    const get = await api(am.jar, "GET", `/api/institutions/${inst.id}/health`);
    expect(get.status === 200, "GET health returns 200", `got ${get.status}`);
    // The route wraps as { data: { health, openInterventions } } — asserted in
    // that exact shape because the card reads it, and reading the wrong key is
    // what made the card display nothing.
    const hp = get.payload?.data ?? get.payload;
    expect(hp?.health === "RED", "GET returns the current rating", String(hp?.health));
    expect(Array.isArray(hp?.openInterventions) && hp.openInterventions.length >= 1,
      "the open intervention is returned for display",
      JSON.stringify(hp?.openInterventions?.length));
  }

  // ── Issues ──────────────────────────────────────────────────────────────
  startSection("Client issues can be raised and worked");
  {
    const before = await api(am.jar, "GET", `/api/institutions/${inst.id}/issues`);
    expect(before.status === 200, "GET issues returns 200", `got ${before.status}`);

    const create = await api(am.jar, "POST", `/api/institutions/${inst.id}/issues`, {
      title: `${TAG} offer turnaround slipping`,
      description: "Offers taking 14 working days against an agreed 10.",
      category: "SERVICE_DELIVERY",
      severity: "HIGH",
      ownerId: am.user.id,
      targetResolutionAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    expect(create.status === 200 || create.status === 201, "*** an issue can be raised ***",
      `got ${create.status} ${JSON.stringify(create.payload?.error ?? "")}`);

    const rows = await db.clientIssue.findMany({ where: { institutionId: inst.id } });
    made.issues.push(...rows.map((r) => r.id));
    expect(rows.length === 1, "the issue is stored", `${rows.length}`);
    expect(rows[0]?.severity === "HIGH", "severity stored", rows[0]?.severity);
    expect(!!rows[0]?.ownerId, "owner stored", String(rows[0]?.ownerId));

    // Every category the form offers must be accepted, or the form lies.
    const CATS = ["CLIENT_RELATIONSHIP","SERVICE_DELIVERY","RECRUITMENT_PERFORMANCE","STAFFING",
      "CONTRACT","FINANCE","COMPLIANCE","TECHNOLOGY","STUDENT_CASE","OTHER"];
    let accepted = 0;
    for (const category of CATS) {
      const r = await api(am.jar, "POST", `/api/institutions/${inst.id}/issues`, {
        title: `${TAG} ${category}`, category, severity: "LOW", ownerId: am.user.id,
      });
      if (r.status === 200 || r.status === 201) accepted++;
    }
    expect(accepted === CATS.length,
      `all ${CATS.length} categories the form offers are accepted by the API`,
      `${accepted} of ${CATS.length}`);

    const all = await db.clientIssue.findMany({ where: { institutionId: inst.id }, select: { id: true } });
    made.issues.push(...all.map((r) => r.id));

    const first = rows[0];
    const patch = await api(am.jar, "PATCH", `/api/institutions/${inst.id}/issues/${first.id}`, {
      status: "IN_PROGRESS",
    });
    expect(patch.status === 200, "an issue's status can be moved on", `got ${patch.status}`);
    const moved = await db.clientIssue.findUnique({ where: { id: first.id } });
    expect(moved.status === "IN_PROGRESS", "status persisted", moved.status);
  }

  // ── Access ──────────────────────────────────────────────────────────────
  startSection("Access control");
  {
    const r = await api(icr.jar, "POST", `/api/institutions/${inst.id}/issues`, {
      title: `${TAG} icr attempt`, category: "OTHER", severity: "LOW", ownerId: icr.user.id,
    });
    expect(r.status === 403, "an ICR cannot raise a client issue → 403", `got ${r.status}`);

    const h = await api(icr.jar, "PATCH", `/api/institutions/${inst.id}/health`, { health: "GREEN" });
    expect(h.status === 403, "an ICR cannot change account health → 403", `got ${h.status}`);
    const unchanged = await db.institution.findUnique({ where: { id: inst.id } });
    expect(unchanged.accountHealth === "RED", "the rating was not altered by a refused attempt", unchanged.accountHealth);
  }
}

async function teardown() {
  await db.accountIntervention.deleteMany({ where: { institutionId: { in: made.institutions } } }).catch(() => {});
  await db.clientIssue.deleteMany({ where: { institutionId: { in: made.institutions } } }).catch(() => {});
  await db.auditLog.deleteMany({ where: { entityId: { in: made.institutions } } }).catch(() => {});
  for (const c of created) await destroyUser(c);
  for (const id of made.institutions) await db.institution.delete({ where: { id } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leaked = await db.clientIssue.count({ where: { title: { startsWith: TAG } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked issues: ${leaked}\n`);
  await db.$disconnect();
}
summary();

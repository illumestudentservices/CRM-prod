/**
 * Institution child-route tenancy (IDOR):
 *   - an INSTITUTION_CLIENT assigned to institution A can read A and all of A's
 *     sub-resources (contacts, contracts, deliverables, documents, engagement,
 *     health, issues, knowledge, kpis);
 *   - the SAME client gets 404 on institution B (not theirs) and on EVERY one of
 *     B's sub-resources — so a rival's contract values etc. never leak by
 *     swapping the id in the URL;
 *   - the guard is a no-op for staff: a SUPER_ADMIN still reads B and its
 *     contracts (incl. the contract value) normally.
 *
 *   npx tsx --env-file=.env.local scripts/qa-institution-idor.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

let admin, client, instA, instB, contractB, assignmentId;

// Every GET child route, as a path suffix under /api/institutions/:id
const CHILD = ["contacts", "contracts", "deliverables", "documents", "engagement", "health", "issues", "knowledge", "kpis"];

const mkInst = async (name, createdById) =>
  db.institution.create({ data: { name: `${name}`, country: "QA", type: "UNIVERSITY", createdById } });

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  instA = await mkInst("QA Inst A (client's)", admin.user.id);
  instB = await mkInst("QA Inst B (rival)", admin.user.id);

  // The client is assigned to A only.
  const asg = await db.institutionUser.create({
    data: { institutionId: instA.id, userId: client.user.id, assignmentStatus: "ACTIVE" },
  });
  assignmentId = asg.id;

  // A real, sensitive row on B — the exact thing the IDOR leaked.
  contractB = await db.contract.create({
    data: { institutionId: instB.id, title: "Rival secret deal", value: 999999, startDate: new Date(), endDate: new Date(Date.now() + 8.64e7 * 365), createdById: admin.user.id },
  });

  // ── The client reaches their OWN institution and all its sub-resources ──
  startSection("Client CAN read their own institution A + every child route");
  let r = await api(client.jar, "GET", `/api/institutions/${instA.id}`);
  expect(r.ok, "client reads institution A (parent)", `got ${r.status}`);
  for (const c of CHILD) {
    r = await api(client.jar, "GET", `/api/institutions/${instA.id}/${c}`);
    expect(r.ok, `client reads A/${c}`, `got ${r.status}`);
  }

  // ── IDOR closed: the client gets 404 on B and all of B's sub-resources ──
  for (let run = 1; run <= 3; run++) {
    startSection(`Client is 404 on rival institution B + every child route (run ${run})`);
    r = await api(client.jar, "GET", `/api/institutions/${instB.id}`);
    expect(r.status === 404, "client cannot read institution B (parent) — 404", `got ${r.status}`);
    for (const c of CHILD) {
      r = await api(client.jar, "GET", `/api/institutions/${instB.id}/${c}`);
      expect(r.status === 404, `client blocked from B/${c} — 404`, `got ${r.status}`);
    }
    // The money shot: the rival's contract value must not come back.
    r = await api(client.jar, "GET", `/api/institutions/${instB.id}/contracts`);
    const leaked = JSON.stringify(r.payload ?? "").includes("999999");
    expect(r.status === 404 && !leaked, "rival contract value is NOT leaked to the client", `status ${r.status}, leaked=${leaked}`);
  }

  // ── Staff are unaffected: the guard is a no-op for non-clients ──────────
  startSection("SUPER_ADMIN still reads B and its contracts (guard is a no-op for staff)");
  r = await api(admin.jar, "GET", `/api/institutions/${instB.id}`);
  expect(r.ok, "admin reads institution B", `got ${r.status}`);
  r = await api(admin.jar, "GET", `/api/institutions/${instB.id}/contracts`);
  const adminSees = JSON.stringify(r.payload ?? "").includes("999999");
  expect(r.ok && adminSees, "admin sees B's contract (incl. value) — legitimately", `status ${r.status}, sees=${adminSees}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (contractB) await db.contract.delete({ where: { id: contractB.id } }).catch(() => {});
  if (assignmentId) await db.institutionUser.delete({ where: { id: assignmentId } }).catch(() => {});
  for (const i of [instA, instB]) if (i) await db.institution.delete({ where: { id: i.id } }).catch(() => {});
  for (const u of [admin, client]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

/**
 * Contract.value field redaction (pentest MEDIUM).
 *
 * The contract amount is commercial data: FIELD_CATALOG restricts the
 * institutions `contractValue` field to SUPER_ADMIN / HQ_EXECUTIVE /
 * HQ_ANALYTICS / REGIONAL_MANAGER / ACCOUNT_MANAGER / VP_GLOBAL_SALES. The
 * Contract model names the same figure `value`, and two reads returned it
 * whole — so ICR / ADMISSIONS_SUPPORT / INSTITUTION_CLIENT (institutions:read
 * but not contractValue) saw the money:
 *   - GET /api/institutions/[id]/contracts
 *   - GET /api/institutions/[id]            (institution.contracts[])
 * Fix: redactContractValue strips `value` for roles that may not read it.
 *
 *   npx tsx --env-file=.env.local scripts/qa-contract-value.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const VALUE = 500000;
let admin, rm, icr, client, instA, contract, asgId;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const findContract = (arr) => (Array.isArray(arr) ? arr.find((c) => c.id === contract.id) : undefined);

try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  icr = await createAndLogin({ role: "ICR" });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  instA = await db.institution.create({
    data: { name: `${TAG} Inst A`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id },
  });
  asgId = (await db.institutionUser.create({
    data: { institutionId: instA.id, userId: client.user.id, assignmentStatus: "ACTIVE" },
  })).id;
  contract = await db.contract.create({
    data: {
      institutionId: instA.id, title: `${TAG} Deal`, value: VALUE,
      startDate: new Date("2027-01-01"), endDate: new Date("2027-12-31"),
      status: "ACTIVE", createdById: admin.user.id,
    },
  });

  for (let run = 1; run <= 3; run++) {
    // ── contracts child route ────────────────────────────────────────────────
    startSection(`institutions/[id]/contracts value (run ${run})`);
    let r = await api(admin.jar, "GET", `/api/institutions/${instA.id}/contracts`);
    let c = findContract(r.payload);
    expect(r.ok && c, "SUPER_ADMIN reads the contracts list", `got ${r.status}`);
    expect(c && c.value === VALUE, "SUPER_ADMIN sees the contract value", `value=${c && c.value}`);

    r = await api(rm.jar, "GET", `/api/institutions/${instA.id}/contracts`);
    c = findContract(r.payload);
    expect(c && c.value === VALUE, "REGIONAL_MANAGER sees the contract value (permitted)", `value=${c && c.value}`);

    r = await api(icr.jar, "GET", `/api/institutions/${instA.id}/contracts`);
    c = findContract(r.payload);
    expect(c, "ICR reads the contracts list", `got ${r.status}`);
    expect(c && !has(c, "value"), "ICR does NOT see the contract value", `present=${c && has(c, "value")}`);

    r = await api(client.jar, "GET", `/api/institutions/${instA.id}/contracts`);
    c = findContract(r.payload);
    expect(c, "INSTITUTION_CLIENT reads their own institution's contracts", `got ${r.status}`);
    expect(c && !has(c, "value"), "INSTITUTION_CLIENT does NOT see the contract value", `present=${c && has(c, "value")}`);

    // ── parent institution detail (nested contracts[]) ─────────────────────────
    startSection(`institutions/[id] nested contract value (run ${run})`);
    r = await api(admin.jar, "GET", `/api/institutions/${instA.id}`);
    c = findContract(r.payload?.contracts);
    expect(c && c.value === VALUE, "SUPER_ADMIN sees nested contract value", `value=${c && c.value}`);

    r = await api(icr.jar, "GET", `/api/institutions/${instA.id}`);
    c = findContract(r.payload?.contracts);
    expect(c && !has(c, "value"), "ICR does NOT see nested contract value", `present=${c && has(c, "value")}`);

    r = await api(client.jar, "GET", `/api/institutions/${instA.id}`);
    c = findContract(r.payload?.contracts);
    expect(c && !has(c, "value"), "INSTITUTION_CLIENT does NOT see nested contract value", `present=${c && has(c, "value")}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (contract) await db.contract.delete({ where: { id: contract.id } }).catch(() => {});
  if (asgId) await db.institutionUser.delete({ where: { id: asgId } }).catch(() => {});
  if (instA) await db.institution.delete({ where: { id: instA.id } }).catch(() => {});
  for (const u of [admin, rm, icr, client]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

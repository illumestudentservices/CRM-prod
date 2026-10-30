/**
 * Onboarding form changes (business request 2026-10-30):
 *   1. HQ_EXECUTIVE can now raise onboarding (account) AND offboarding requests.
 *   2. The onboarding form has two new optional fields: country of residence
 *      and the client university the joiner reports to.
 *
 *   npx tsx --env-file=.env.local scripts/qa-onboarding-form.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

let hqe, icr, other, inst, otherReq;
const createdReqIds = [];

const base = (extra = {}) => ({
  firstName: "QA", lastName: "Joiner",
  personalEmail: `qa.onb.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`,
  jobTitle: "Recruitment Officer", requestedRole: "EMPLOYEE",
  employmentType: "FULL_TIME", startDate: "2027-06-01",
  justification: "Replacing a leaver; needs pipeline access from day one.",
  ...extra,
});

try {
  hqe = await createAndLogin({ role: "HQ_EXECUTIVE", withEmployee: true });
  icr = await createAndLogin({ role: "ICR" });
  other = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  inst = await db.institution.create({ data: { name: `${TAG} Reports-To Univ`, country: "QA", type: "UNIVERSITY", createdById: hqe.user.id } });

  // A PENDING request raised by SOMEONE ELSE, to prove HQ_EXECUTIVE can neither
  // see it nor act on it.
  otherReq = await db.accountRequest.create({
    data: {
      firstName: "Someone", lastName: "Else", personalEmail: `other.${Date.now()}@example.com`,
      jobTitle: "Officer", requestedRole: "EMPLOYEE", startDate: new Date("2027-06-01"),
      justification: "Raised by another manager entirely.", requestedById: other.user.id,
    },
  });

  for (let run = 1; run <= 3; run++) {
    // ── 1. Role access: onboarding ───────────────────────────────────────────
    startSection(`HQ_EXECUTIVE onboarding access (run ${run})`);
    let r = await api(hqe.jar, "GET", "/api/hr/account-requests");
    expect(r.ok && r.payload?.canRequest === true, "HQ_EXECUTIVE canRequest = true", `${r.status} canRequest=${r.payload?.canRequest}`);
    expect(r.payload?.canReview === false, "HQ_EXECUTIVE canReview = FALSE (cannot approve)", `canReview=${r.payload?.canReview}`);
    // Scope: they see only their own submissions, never another manager's.
    const hqeIds = (r.payload?.requests ?? []).map((x) => x.id);
    expect(!hqeIds.includes(otherReq.id), "HQ_EXECUTIVE does NOT see another manager's request", `rows=${hqeIds.length}`);
    r = await api(icr.jar, "GET", "/api/hr/account-requests");
    expect(r.ok && r.payload?.canRequest === false, "ICR canRequest = false (unchanged)", `${r.status} canRequest=${r.payload?.canRequest}`);

    // HQ_EXECUTIVE cannot approve/reject anyone's request — reviewer is SUPER_ADMIN only.
    r = await api(hqe.jar, "PATCH", `/api/hr/account-requests/${otherReq.id}`, { action: "APPROVE" });
    expect(r.status === 403, "HQ_EXECUTIVE cannot approve a request (403)", `got ${r.status}`);
    const still = await db.accountRequest.findUnique({ where: { id: otherReq.id }, select: { status: true } });
    expect(still?.status === "PENDING", "the other request is untouched (still PENDING)", still?.status);

    // ── 2. Institutions picker endpoint ──────────────────────────────────────
    startSection(`university picker endpoint (run ${run})`);
    r = await api(hqe.jar, "GET", "/api/hr/institutions");
    const ids = (r.payload?.institutions ?? []).map((i) => i.id);
    expect(r.ok && ids.includes(inst.id), "HQ_EXECUTIVE gets the university list", `${r.status} ${ids.length} rows`);
    r = await api(icr.jar, "GET", "/api/hr/institutions");
    expect(r.status === 403, "ICR is refused the university list (403)", `got ${r.status}`);

    // ── 3. POST with the new fields ──────────────────────────────────────────
    startSection(`onboarding POST new fields (run ${run})`);
    r = await api(hqe.jar, "POST", "/api/hr/account-requests", base({ countryOfResidence: "Nigeria", reportsToInstitutionId: inst.id }));
    expect(r.status === 201, "HQ_EXECUTIVE raises an onboarding request (201)", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,120)}`);
    const newId = r.payload?.request?.id;
    if (newId) createdReqIds.push(newId);

    r = await api(hqe.jar, "GET", "/api/hr/account-requests");
    const row = (r.payload?.requests ?? []).find((x) => x.id === newId);
    expect(!!row, "the new request shows in the queue", `found=${!!row}`);
    expect(row?.countryOfResidence === "Nigeria", "country of residence is stored and returned", row?.countryOfResidence);
    expect(row?.reportsToInstitution?.name === inst.name, "reporting university is stored and returned", JSON.stringify(row?.reportsToInstitution));

    // ── 4. Bad institution id → 422 ──────────────────────────────────────────
    r = await api(hqe.jar, "POST", "/api/hr/account-requests", base({ reportsToInstitutionId: "does-not-exist-0000" }));
    expect(r.status === 422, "an unknown university is rejected (422)", `got ${r.status}`);

    // ── 5. ICR still cannot raise one ────────────────────────────────────────
    r = await api(icr.jar, "POST", "/api/hr/account-requests", base());
    expect(r.status === 403, "ICR cannot raise an onboarding request (403)", `got ${r.status}`);

    // ── 6. Role access: offboarding ──────────────────────────────────────────
    startSection(`HQ_EXECUTIVE offboarding access (run ${run})`);
    r = await api(hqe.jar, "GET", "/api/hr/offboarding-requests");
    expect(r.ok && r.payload?.canRequest === true, "HQ_EXECUTIVE can request offboarding", `${r.status} canRequest=${r.payload?.canRequest}`);
    expect(r.payload?.canReview === false, "HQ_EXECUTIVE canReview offboarding = FALSE", `canReview=${r.payload?.canReview}`);
    r = await api(hqe.jar, "GET", "/api/hr/offboarding-requests/candidates");
    expect(r.ok && Array.isArray(r.payload?.candidates), "HQ_EXECUTIVE sees the offboarding candidate roster", `got ${r.status}`);
    r = await api(icr.jar, "GET", "/api/hr/offboarding-requests");
    expect(r.status === 403, "ICR cannot access offboarding (403)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of createdReqIds) await db.accountRequest.delete({ where: { id } }).catch(() => {});
  if (otherReq) await db.accountRequest.delete({ where: { id: otherReq.id } }).catch(() => {});
  if (inst) await db.institution.delete({ where: { id: inst.id } }).catch(() => {});
  for (const u of [hqe, icr, other]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

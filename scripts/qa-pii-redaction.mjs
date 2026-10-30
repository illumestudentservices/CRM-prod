/**
 * Nested PII redaction (HIGH pentest #6).
 *
 * Field-level read control (lib/granular-permissions.ts) is shallow: it strips
 * only the TOP-LEVEL resource's columns. Three routes embed a lead (or an array
 * of leads) under another record, so the student's controlled fields rode along
 * unredacted:
 *   - GET /api/institutions/[id]            — institution.leads[]  (partner + AM/VP/HQ_ANALYTICS)
 *   - GET /api/institution-interests/[id]   — interest.lead        (partner)
 *   - GET /api/sources/[id]                 — source.leads[]       (AM/VP/HQ_ANALYTICS)
 *
 * The fix redacts the nested lead(s) against the "leads" catalog, so each role
 * sees only the student columns it may read:
 *   - ICR / SUPER_ADMIN  → everything (email, phone, dateOfBirth, budget, consent)
 *   - ACCOUNT_MANAGER    → staff fields yes, dateOfBirth NO (not in its readRoles)
 *   - INSTITUTION_CLIENT → none of the controlled fields (not ALL_STAFF)
 *
 * No passportNumber is seeded (it is encrypted at rest); dateOfBirth is the
 * restricted, non-encrypted signal and behaves identically in the catalog.
 *
 *   npx tsx --env-file=.env.local scripts/qa-pii-redaction.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary, TAG } from "./qa-lib.mjs";

const YEAR = 2027;
// Controlled lead columns and who may read each (from FIELD_CATALOG).
const STAFF_FIELDS = ["email", "phone", "budgetRange", "marketingConsent"]; // readable by ALL_STAFF
const RESTRICTED = "dateOfBirth"; // SUPER_ADMIN/HQ_EXEC/RM/ICR/ADMISSIONS only

let admin, icr, am, client, r1, instA, partner, lead, interest, asgId;

const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const present = (o) => [...STAFF_FIELDS, RESTRICTED].filter((k) => has(o, k));
const absent = (o) => [...STAFF_FIELDS, RESTRICTED].filter((k) => !has(o, k));

/** Find our seeded lead inside a leads[] array by id. */
const findLead = (arr) => (Array.isArray(arr) ? arr.find((l) => l.id === lead.id) : undefined);

try {
  r1 = await db.region.create({ data: { name: `${TAG} R1`, code: `${TAG}1` } });

  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  icr = await createAndLogin({ role: "ICR", extra: { regionId: r1.id } });
  am = await createAndLogin({ role: "ACCOUNT_MANAGER", withEmployee: true });
  client = await createAndLogin({ role: "INSTITUTION_CLIENT" });

  instA = await db.institution.create({
    data: { name: `${TAG} Inst A`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id },
  });
  asgId = (await db.institutionUser.create({
    data: { institutionId: instA.id, userId: client.user.id, assignmentStatus: "ACTIVE" },
  })).id;

  partner = await db.recruitmentPartner.create({
    data: { name: `${TAG} Partner`, type: "AGENT", country: "QA", createdById: admin.user.id, regionId: r1.id },
  });

  lead = await db.lead.create({
    data: {
      firstName: "QA", lastName: "Student",
      email: "qa.student@example.com", phone: "+10000000000",
      nationality: "QA", countryOfResidence: "QA",
      interestedProgram: "QA Program", intakeYear: YEAR, intakeMonth: 9,
      studyLevel: "UNDERGRADUATE",
      dateOfBirth: new Date("2000-01-01"),
      budgetRange: "OVER_50K",
      marketingConsent: true,
      createdById: admin.user.id,
      institutionId: instA.id,
      assignedICRId: icr.user.id,
      sourceId: partner.id,
      regionId: r1.id,
      stage: "NEW_LEAD",
    },
  });

  interest = await db.institutionInterest.create({
    data: {
      leadId: lead.id, institutionId: instA.id,
      intakeYear: YEAR, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
      assignedICRId: icr.user.id, stage: "NEW_LEAD",
    },
  });

  // ── Core redaction matrix — idempotent, run x3 ─────────────────────────────
  for (let run = 1; run <= 3; run++) {
    // 1) GET /api/institutions/[id] → institution.leads[]
    startSection(`institutions/[id] nested leads (run ${run})`);
    let r = await api(icr.jar, "GET", `/api/institutions/${instA.id}`);
    let l = findLead(r.payload?.leads);
    expect(r.ok && l, "ICR reads institution A and sees the lead", `got ${r.status}`);
    expect(l && present(l).length === 5, "ICR sees ALL controlled fields incl dateOfBirth", `present: ${l && present(l)}`);

    r = await api(admin.jar, "GET", `/api/institutions/${instA.id}`);
    l = findLead(r.payload?.leads);
    expect(l && has(l, RESTRICTED), "SUPER_ADMIN sees dateOfBirth", `present: ${l && present(l)}`);

    r = await api(am.jar, "GET", `/api/institutions/${instA.id}`);
    l = findLead(r.payload?.leads);
    expect(l && has(l, "email"), "ACCOUNT_MANAGER still sees email (staff field)", `present: ${l && present(l)}`);
    expect(l && !has(l, RESTRICTED), "ACCOUNT_MANAGER does NOT see dateOfBirth", `present: ${l && present(l)}`);

    r = await api(client.jar, "GET", `/api/institutions/${instA.id}`);
    l = findLead(r.payload?.leads);
    expect(l, "INSTITUTION_CLIENT reads their own institution A and sees the lead row", `got ${r.status}`);
    expect(l && absent(l).length === 5, "INSTITUTION_CLIENT sees NONE of the controlled fields", `present: ${l && present(l)}`);

    // 2) GET /api/institution-interests/[id] → interest.lead
    startSection(`institution-interests/[id] nested lead (run ${run})`);
    r = await api(icr.jar, "GET", `/api/institution-interests/${interest.id}`);
    expect(r.ok && has(r.payload?.lead, RESTRICTED), "ICR sees dateOfBirth on the interest's lead", `got ${r.status} present: ${present(r.payload?.lead ?? {})}`);

    r = await api(admin.jar, "GET", `/api/institution-interests/${interest.id}`);
    expect(r.ok && has(r.payload?.lead, RESTRICTED), "SUPER_ADMIN sees dateOfBirth on the interest's lead", `got ${r.status}`);

    r = await api(client.jar, "GET", `/api/institution-interests/${interest.id}`);
    expect(r.ok, "INSTITUTION_CLIENT reaches their own institution's interest", `got ${r.status}`);
    expect(r.payload?.lead && absent(r.payload.lead).length === 5, "INSTITUTION_CLIENT sees NONE of the controlled fields on the lead", `present: ${present(r.payload?.lead ?? {})}`);

    r = await api(am.jar, "GET", `/api/institution-interests/${interest.id}`);
    expect(r.status === 404, "ACCOUNT_MANAGER cannot reach this interest at all (row gate)", `got ${r.status}`);

    // 3) GET /api/sources/[id] → source.leads[]
    startSection(`sources/[id] nested leads (run ${run})`);
    r = await api(admin.jar, "GET", `/api/sources/${partner.id}`);
    l = findLead(r.payload?.leads);
    expect(r.ok && l && has(l, RESTRICTED), "SUPER_ADMIN sees dateOfBirth on the source's lead", `got ${r.status} present: ${l && present(l)}`);

    r = await api(icr.jar, "GET", `/api/sources/${partner.id}`);
    l = findLead(r.payload?.leads);
    expect(r.ok && l && has(l, RESTRICTED), "ICR sees dateOfBirth on the source's lead", `got ${r.status}`);

    r = await api(am.jar, "GET", `/api/sources/${partner.id}`);
    l = findLead(r.payload?.leads);
    expect(l && has(l, "email"), "ACCOUNT_MANAGER still sees email on the source's lead", `present: ${l && present(l)}`);
    expect(l && !has(l, RESTRICTED), "ACCOUNT_MANAGER does NOT see dateOfBirth on the source's lead", `present: ${l && present(l)}`);

    r = await api(client.jar, "GET", `/api/sources/${partner.id}`);
    expect(r.status === 403, "INSTITUTION_CLIENT has no sources access (403)", `got ${r.status}`);
  }
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  if (interest) await db.institutionInterest.delete({ where: { id: interest.id } }).catch(() => {});
  if (lead) await db.lead.delete({ where: { id: lead.id } }).catch(() => {});
  if (partner) await db.recruitmentPartner.delete({ where: { id: partner.id } }).catch(() => {});
  if (asgId) await db.institutionUser.delete({ where: { id: asgId } }).catch(() => {});
  if (instA) await db.institution.delete({ where: { id: instA.id } }).catch(() => {});
  for (const u of [admin, icr, am, client]) if (u) await destroyUser(u);
  if (r1) await db.region.delete({ where: { id: r1.id } }).catch(() => {});
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}

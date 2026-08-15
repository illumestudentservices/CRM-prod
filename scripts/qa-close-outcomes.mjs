/**
 * Spec §15 close outcomes — HTTP verification.
 *
 * WITHDRAWN and VISA_REFUSED sat in the LeadStage enum, in lead-gate's
 * STAGE_CONFIG and in every exhaustive Record<LeadStage, ...> map, but no code
 * path could set them: the stage route validated against ALL_STAGES (built from
 * CLOSED_STAGES, which never listed them) and the close route's discriminated
 * union only accepted LOST / DEFERRED / APPLICATION_REJECTED.
 *
 * The subtle assertions here are the ones about NOT collapsing outcomes:
 *  - a withdrawal must not write lostReason, or the "why do we lose students"
 *    breakdown silently fills with students nobody lost
 *  - visaReapplying must stay NULL when unanswered, not default to false
 *
 *   node --import tsx --env-file=.env scripts/qa-close-outcomes.mjs
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const created = [];
const leads = [];

async function makeLead(label, creatorId, stage = "QUALIFIED") {
  const l = await db.lead.create({
    data: {
      firstName: TAG, lastName: `${label}-${Date.now().toString().slice(-5)}`,
      email: `${TAG.toLowerCase()}-${label}-${Date.now()}@illume.local`,
      phone: "+10000000000", nationality: "Indian", countryOfResidence: "India",
      interestedProgram: "QA", studyLevel: "UNDERGRADUATE",
      intakeYear: 2027, intakeMonth: 9, stage, createdById: creatorId,
    },
  });
  leads.push(l.id);
  return l;
}

const iso = (d) => new Date(d).toISOString();

async function main() {
  startSection("Setup");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);
  ok("admin logged in");

  // ── Withdrawal ──────────────────────────────────────────────────────────
  startSection("WITHDRAWN");
  {
    const lead = await makeLead("withdraw", admin.user.id, "OFFER_RECEIVED");
    const r = await api(admin.jar, "POST", `/api/leads/${lead.id}/close`, {
      outcome: "WITHDRAWN",
      reason: "Decided to stay and work locally for a year",
      withdrawnDate: iso("2026-08-10"),
      notes: "Called to confirm; may return for the 2028 intake.",
    });
    expect(r.status === 200, "close as WITHDRAWN → 200", `got ${r.status} ${JSON.stringify(r.payload)}`);

    const row = await db.lead.findUnique({ where: { id: lead.id } });
    expect(row.stage === "WITHDRAWN", "stage is WITHDRAWN", row.stage);
    expect(row.withdrawnReason?.includes("work locally"), "withdrawnReason written", row.withdrawnReason);
    expect(row.withdrawnDate !== null, "withdrawnDate written");
    expect(row.withdrawnNotes?.includes("2028"), "withdrawnNotes written", row.withdrawnNotes);
    expect(row.stageBeforeClose === "OFFER_RECEIVED",
      "stageBeforeClose preserves where they were lost from", row.stageBeforeClose);
    // The point of a separate outcome: it must NOT masquerade as a loss.
    expect(row.lostReason === null, "withdrawal did NOT write lostReason", String(row.lostReason));
    expect(row.lostNotes === null, "withdrawal did NOT write lostNotes", String(row.lostNotes));
    expect(row.inactivity14NotifiedAt !== null && row.inactivity21NotifiedAt !== null,
      "closed lead is marked so it will not be chased");
  }

  // ── Visa refusal, three-valued reapplying ───────────────────────────────
  startSection("VISA_REFUSED");
  {
    // (a) not answered → NULL, not false
    const a = await makeLead("visa-null", admin.user.id, "DEPOSIT_PAID");
    const ra = await api(admin.jar, "POST", `/api/leads/${a.id}/close`, {
      outcome: "VISA_REFUSED",
      refusalDate: iso("2026-08-11"),
      refusalReason: "Insufficient evidence of funds",
    });
    expect(ra.status === 200, "close as VISA_REFUSED without `reapplying` → 200", `got ${ra.status}`);
    const rowA = await db.lead.findUnique({ where: { id: a.id } });
    expect(rowA.stage === "VISA_REFUSED", "stage is VISA_REFUSED", rowA.stage);
    expect(rowA.visaRefusalReason?.includes("funds"), "visaRefusalReason written", rowA.visaRefusalReason);
    expect(rowA.visaRefusalDate !== null, "visaRefusalDate written");
    expect(rowA.visaReapplying === null,
      "unanswered `reapplying` stays NULL, not false", String(rowA.visaReapplying));
    expect(rowA.lostReason === null, "visa refusal did NOT write lostReason=VISA", String(rowA.lostReason));

    // (b) explicitly yes
    const b = await makeLead("visa-yes", admin.user.id);
    await api(admin.jar, "POST", `/api/leads/${b.id}/close`, {
      outcome: "VISA_REFUSED", refusalDate: iso("2026-08-11"),
      refusalReason: "Interview outcome", reapplying: true,
    });
    const rowB = await db.lead.findUnique({ where: { id: b.id } });
    expect(rowB.visaReapplying === true, "reapplying:true recorded", String(rowB.visaReapplying));

    // (c) explicitly no — must be distinguishable from (a)
    const c = await makeLead("visa-no", admin.user.id);
    await api(admin.jar, "POST", `/api/leads/${c.id}/close`, {
      outcome: "VISA_REFUSED", refusalDate: iso("2026-08-11"),
      refusalReason: "Chose another country", reapplying: false,
    });
    const rowC = await db.lead.findUnique({ where: { id: c.id } });
    expect(rowC.visaReapplying === false, "reapplying:false recorded and distinct from NULL",
      String(rowC.visaReapplying));
  }

  // ── Validation ──────────────────────────────────────────────────────────
  startSection("Validation");
  {
    const lead = await makeLead("invalid", admin.user.id);
    const cases = [
      ["WITHDRAWN with no reason", { outcome: "WITHDRAWN", withdrawnDate: iso("2026-08-10") }],
      ["WITHDRAWN with empty reason", { outcome: "WITHDRAWN", reason: "", withdrawnDate: iso("2026-08-10") }],
      ["VISA_REFUSED with no refusalReason", { outcome: "VISA_REFUSED", refusalDate: iso("2026-08-10") }],
      ["VISA_REFUSED with no refusalDate", { outcome: "VISA_REFUSED", refusalReason: "x" }],
      ["unknown outcome", { outcome: "ABDUCTED", reason: "x" }],
    ];
    for (const [label, body] of cases) {
      const r = await api(admin.jar, "POST", `/api/leads/${lead.id}/close`, body);
      expect(r.status === 422, `${label} → 422`, `got ${r.status}`);
    }
    const still = await db.lead.findUnique({ where: { id: lead.id } });
    expect(still.stage === "QUALIFIED", "no rejected attempt changed the stage", still.stage);
  }

  // ── The stage route must still refuse to close ──────────────────────────
  startSection("Stage route redirects to close");
  {
    const lead = await makeLead("viastage", admin.user.id);
    for (const stage of ["WITHDRAWN", "VISA_REFUSED"]) {
      const r = await api(admin.jar, "PATCH", `/api/leads/${lead.id}/stage`, { stage });
      // Previously this was a 422 "invalid enum value" because the stage was
      // not in ALL_STAGES at all. Now it is a deliberate 400 naming the right
      // endpoint — the mandatory outcome fields must not be bypassable.
      expect(r.status === 400, `PATCH stage → ${stage} is refused with 400`, `got ${r.status}`);
      expect(String(r.payload?.error ?? "").includes("/close"),
        `refusal points at the close endpoint`, JSON.stringify(r.payload?.error));
    }
    const still = await db.lead.findUnique({ where: { id: lead.id } });
    expect(still.stage === "QUALIFIED", "stage route did not close the lead", still.stage);
  }

  // ── Audit ───────────────────────────────────────────────────────────────
  startSection("Audit trail");
  {
    const rows = await db.auditLog.findMany({
      where: { action: "LEAD_CLOSED", entityId: { in: leads } },
      select: { ipAddress: true },
    });
    expect(rows.length >= 4, "each close wrote a LEAD_CLOSED audit row", `${rows.length} rows`);
    expect(rows.every((r) => r.ipAddress !== null), "every close audit row captured an IP",
      `${rows.filter((r) => r.ipAddress === null).length} null`);
  }
}

async function teardown() {
  await db.auditLog.deleteMany({ where: { entityId: { in: leads } } }).catch(() => {});
  await db.leadActivity.deleteMany({ where: { leadId: { in: leads } } }).catch(() => {});
  for (const id of leads) await db.lead.delete({ where: { id } }).catch(() => {});
  for (const c of created) await destroyUser(c);
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty message)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leaked = await db.lead.count({ where: { firstName: TAG } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked leads: ${leaked}\n`);
  await db.$disconnect();
}
summary();

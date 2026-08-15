/**
 * Phase 0 — the fixes for the things that were losing data.
 *
 *   node --import tsx --env-file=.env scripts/qa-phase0.mjs
 *
 * 1. Field activity types. The form offered fourteen; three API routes accepted
 *    five, two of which were retired legacy values. Eleven of the fourteen were
 *    rejected, and the form only logged the failure to the console — so the
 *    activity was silently discarded.
 * 2. Institution edit. Claimed to wipe legalName and serviceScope on save.
 *    Tested here rather than assumed; the finding was second-hand.
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

const { ACTIVITY_TYPES, LEGACY_ACTIVITY_TYPES } = await import("../lib/activity-types.ts");

const created = [];
const made = { institutions: [], activities: [], regions: [] };

async function main() {
  startSection("Setup");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);
  ok(`admin ready; ${ACTIVITY_TYPES.length} writable activity types, ${LEGACY_ACTIVITY_TYPES.length} legacy`);

  // ── 1. Every offered activity type must actually save ───────────────────
  startSection("Every activity type the form offers can be saved");
  {
    let okCount = 0;
    for (const type of ACTIVITY_TYPES) {
      const r = await api(admin.jar, "POST", "/api/activities", {
        type,
        title: `${TAG} ${type}`,
        date: new Date().toISOString(),
        description: "Phase 0 verification",
      });
      if (r.status === 200 || r.status === 201) {
        okCount++;
        const id = r.payload?.id ?? r.payload?.activity?.id;
        if (id) made.activities.push(id);
      } else {
        fail(`${type} rejected`, `status ${r.status} ${JSON.stringify(r.payload?.error ?? r.payload?.details ?? "")}`);
      }
    }
    expect(okCount === ACTIVITY_TYPES.length,
      `all ${ACTIVITY_TYPES.length} activity types saved`, `${okCount} of ${ACTIVITY_TYPES.length}`);

    // Query by title, not by ids harvested from the response: the create route's
    // payload shape is not guaranteed, and an empty id list made this assertion
    // silently vacuous rather than failing honestly.
    const stored = await db.activity.findMany({
      where: { title: { startsWith: TAG } },
      select: { id: true, type: true },
    });
    made.activities.push(...stored.map((a) => a.id));
    const distinct = new Set(stored.map((a) => a.type));
    expect(distinct.size === ACTIVITY_TYPES.length,
      "each one is stored under its own type, not coerced",
      `${distinct.size} distinct types stored`);
  }

  // ── Retired values must NOT be writable ─────────────────────────────────
  startSection("Retired legacy types are refused on new rows");
  {
    for (const legacy of LEGACY_ACTIVITY_TYPES) {
      const r = await api(admin.jar, "POST", "/api/activities", {
        type: legacy,
        title: `${TAG} legacy ${legacy}`,
        date: new Date().toISOString(),
      });
      expect(r.status === 422,
        `${legacy} is refused (migration 019 retired it) → 422`,
        `got ${r.status}`);
      const id = r.payload?.id ?? r.payload?.activity?.id;
      if (id) made.activities.push(id);
    }
  }

  // ── A genuinely invalid type still fails, and says so ───────────────────
  startSection("Invalid input still fails loudly");
  {
    const r = await api(admin.jar, "POST", "/api/activities", {
      type: "NOT_A_REAL_TYPE",
      title: `${TAG} bogus`,
      date: new Date().toISOString(),
    });
    expect(r.status === 422, "an unknown type → 422", `got ${r.status}`);
    expect(!!(r.payload?.error || r.payload?.details),
      "the refusal carries something the UI can display",
      JSON.stringify(r.payload).slice(0, 120));
  }

  // ── 2. Institution edit must not wipe unsent fields ─────────────────────
  startSection("Institution edit preserves legalName and serviceScope");
  {
    const region = await db.region.create({ data: { name: `${TAG}-IR`, code: `${TAG}I` } });
    made.regions.push(region.id);

    const created0 = await api(admin.jar, "POST", "/api/institutions", {
      name: `${TAG}-Uni`,
      legalName: `${TAG} Governing Council`,
      country: "Canada",
      type: "UNIVERSITY",
      serviceScope: ["STUDENT_RECRUITMENT", "MARKET_INTELLIGENCE"],
    });
    const instId = created0.payload?.id ?? created0.payload?.institution?.id;
    expect(!!instId, "institution created", `status ${created0.status}`);
    if (!instId) return;
    made.institutions.push(instId);

    const before = await db.institution.findUnique({ where: { id: instId } });
    expect(before.legalName === `${TAG} Governing Council`, "legalName stored on create", String(before.legalName));
    expect((before.serviceScope ?? []).length === 2, "serviceScope stored on create", JSON.stringify(before.serviceScope));

    // (a) A partial edit that does not mention them at all.
    const partial = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, {
      name: `${TAG}-Uni renamed`,
    });
    expect(partial.status === 200, "partial edit → 200", `got ${partial.status}`);
    const afterPartial = await db.institution.findUnique({ where: { id: instId } });
    expect(afterPartial.legalName === before.legalName,
      "*** legalName survives an edit that omits it ***", String(afterPartial.legalName));
    expect((afterPartial.serviceScope ?? []).length === 2,
      "*** serviceScope survives an edit that omits it ***", JSON.stringify(afterPartial.serviceScope));

    // (b) The shape the edit form actually sends: every field, populated from
    // the record it loaded. This is the path the finding blamed.
    const formLike = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, {
      name: afterPartial.name,
      legalName: afterPartial.legalName,
      country: afterPartial.country,
      type: afterPartial.type,
      website: afterPartial.website ?? "",
      primaryContact: afterPartial.primaryContact ?? "",
      accountStatus: afterPartial.accountStatus,
      notes: afterPartial.notes ?? "",
      serviceScope: afterPartial.serviceScope,
    });
    expect(formLike.status === 200, "full form-shaped edit → 200", `got ${formLike.status}`);
    const afterForm = await db.institution.findUnique({ where: { id: instId } });
    expect(afterForm.legalName === before.legalName,
      "legalName survives a full form save", String(afterForm.legalName));
    expect((afterForm.serviceScope ?? []).length === 2,
      "serviceScope survives a full form save", JSON.stringify(afterForm.serviceScope));

    // (c) Clearing them must still be possible when genuinely intended.
    const cleared = await api(admin.jar, "PATCH", `/api/institutions/${instId}`, {
      legalName: "", serviceScope: [],
    });
    expect(cleared.status === 200, "explicit clear → 200", `got ${cleared.status}`);
    const afterClear = await db.institution.findUnique({ where: { id: instId } });
    expect(afterClear.legalName === null && (afterClear.serviceScope ?? []).length === 0,
      "an explicit clear still works (not over-corrected)",
      `${afterClear.legalName} / ${JSON.stringify(afterClear.serviceScope)}`);
  }
}

async function teardown() {
  await db.activity.deleteMany({ where: { id: { in: made.activities } } }).catch(() => {});
  await db.activity.deleteMany({ where: { title: { startsWith: TAG } } }).catch(() => {});
  for (const id of made.institutions) {
    await db.auditLog.deleteMany({ where: { entityId: id } }).catch(() => {});
    await db.institution.delete({ where: { id } }).catch(() => {});
  }
  for (const c of created) await destroyUser(c);
  for (const id of made.regions) await db.region.delete({ where: { id } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leaked = await db.activity.count({ where: { title: { startsWith: TAG } } }).catch(() => -1);
  process.stdout.write(`\n[cleanup] leaked activities: ${leaked}\n`);
  await db.$disconnect();
}
summary();

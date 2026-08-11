#!/usr/bin/env node
/**
 * Granular-permission enforcement suite.
 *
 * The question this answers is the one that matters about any permission UI:
 * does flipping the switch change what the API actually does? A screen full of
 * toggles that resolve to nothing is worse than no screen, because it reports
 * a protection that isn't there.
 *
 * For each tier: read the baseline, flip the toggle through the real admin
 * endpoint, assert the behaviour changed, flip it back, assert it restored.
 */

import {
  db, TAG, api, idOf, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary,
} from "./qa-lib.mjs";

const created = [];
function track(model, id) { if (id) created.push({ model, id }); }

/** Apply a granular change as the admin. */
async function setGranular(adminJar, change) {
  const r = await api(adminJar, "PUT", "/api/settings/permissions/granular", {
    changes: [change],
  });
  if (!r.ok) throw new Error(`setGranular failed: ${r.status} ${JSON.stringify(r.payload)}`);
  return r;
}

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });
  process.stdout.write(`[setup] admin + ICR\n`);

  // A lead the ICR owns, so ownership checks pass and we isolate field rules.
  const leadRes = await api(admin.jar, "POST", "/api/leads", {
    firstName: `${TAG}Gran`, lastName: "Fields",
    email: `${TAG.toLowerCase()}.gran@example.test`, phone: "+15550004444",
    nationality: "Testland", countryOfResidence: "Testland",
    interestedProgram: "MSc Permissions", studyLevel: "POSTGRADUATE",
    intakeYear: 2030, intakeMonth: 9,
    passportNumber: "P1234567",
    assignedICRId: icr.user.id,
  });
  const leadId = idOf(leadRes.payload);
  track("lead", leadId);

  try {
    if (!leadId) {
      fail("setup", `lead not created: ${leadRes.status} ${JSON.stringify(leadRes.payload)?.slice(0, 200)}`);
      return;
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Admin surface");
    {
      const g = await api(admin.jar, "GET", "/api/settings/permissions/granular");
      if (expect(g.ok, "GET granular matrix → 200", `got ${g.status}`)) {
        const roleCount = (g.payload?.roles ?? []).length;
        expect(roleCount >= 11, "all matrix roles exposed (drift regression guard)", `got ${roleCount}`);
        const icrMatrix = g.payload?.byRole?.ICR;
        expect(!!icrMatrix?.capabilities?.length, "capabilities present for ICR");
        expect(!!icrMatrix?.fields?.length, "field groups present for ICR");
        const merge = icrMatrix?.capabilities?.find((c) => c.key === "leads.merge");
        expect(merge && merge.granted === false, "ICR does not hold leads.merge by default");
      }

      // Non-admins must not reach it.
      const denied = await api(icr.jar, "GET", "/api/settings/permissions/granular");
      expect(!denied.ok, "ICR cannot read the granular matrix", `got ${denied.status}`);
      const deniedWrite = await api(icr.jar, "PUT", "/api/settings/permissions/granular", { changes: [] });
      expect(!deniedWrite.ok, "ICR cannot write the granular matrix", `got ${deniedWrite.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Field read: revoke → redacted, restore → returned");
    {
      // Baseline: ICR sees passportNumber.
      const before = await api(icr.jar, "GET", `/api/leads/${leadId}`);
      const beforeData = before.payload?.data ?? {};
      expect("passportNumber" in beforeData,
        "baseline: ICR can read passportNumber",
        `keys=${Object.keys(beforeData).length}`);

      // Revoke it.
      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "passportNumber", access: "read", granted: false,
      });

      const after = await api(icr.jar, "GET", `/api/leads/${leadId}`);
      const afterData = after.payload?.data ?? {};
      expect(after.ok, "record still readable after field revoke", `got ${after.status}`);
      expect(!("passportNumber" in afterData),
        "passportNumber removed from the detail response");
      expect("firstName" in afterData,
        "other fields still present (redaction is surgical, not blanket)");

      // And from the list, not just the detail view.
      const list = await api(icr.jar, "GET", `/api/leads?search=${TAG}Gran`);
      const rows = list.payload?.data ?? [];
      const row = rows.find((l) => l.id === leadId);
      if (row) {
        expect(!("passportNumber" in row), "passportNumber also removed from the list response");
      } else {
        ok("lead not in ICR's list scope — list redaction not exercised");
      }

      // Restore.
      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "passportNumber", access: "read", granted: true,
      });
      const restored = await api(icr.jar, "GET", `/api/leads/${leadId}`);
      expect("passportNumber" in (restored.payload?.data ?? {}),
        "passportNumber returns after restore");

      // Restoring to the default should leave no row behind.
      const rows2 = await db.granularPermission.count({
        where: { role: "ICR", resource: "leads", target: "passportNumber", access: "read" },
      });
      expect(rows2 === 0, "restoring the default deletes the override row", `count=${rows2}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Field write: revoke → rejected, others still apply");
    {
      // Baseline: ICR can write phone.
      const base = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { phone: "+15550005555" });
      expect(base.ok, "baseline: ICR can write phone", `got ${base.status}`);

      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "phone", access: "write", granted: false,
      });

      const blocked = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { phone: "+15550006666" });
      expect(blocked.status === 403, "write to withheld field → 403", `got ${blocked.status}`);
      expect(Array.isArray(blocked.payload?.fields) && blocked.payload.fields.includes("phone"),
        "response names the offending field",
        JSON.stringify(blocked.payload)?.slice(0, 140));

      const row = await db.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
      expect(row?.phone === "+15550005555", "value unchanged after rejected write", `got ${row?.phone}`);

      // A payload touching only permitted fields must still succeed — the
      // rejection has to be field-scoped, not request-scoped.
      const allowed = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, {
        interestedProgram: "MSc Still Writable",
      });
      expect(allowed.ok, "unrelated field still writable while phone is withheld", `got ${allowed.status}`);
      const row2 = await db.lead.findUnique({ where: { id: leadId }, select: { interestedProgram: true } });
      expect(row2?.interestedProgram === "MSc Still Writable", "permitted field did persist");

      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "phone", access: "write", granted: true,
      });
      const reallowed = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { phone: "+15550007777" });
      expect(reallowed.ok, "phone writable again after restore", `got ${reallowed.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Write implies read");
    {
      // Revoking read must revoke write with it, or the role keeps a column it
      // can overwrite but not see.
      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "notes", access: "read", granted: false,
      });
      const w = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { notes: `${TAG} should be refused` });
      expect(w.status === 403, "write refused when read is withheld", `got ${w.status}`);

      await setGranular(admin.jar, {
        role: "ICR", scope: "FIELD", resource: "leads",
        target: "notes", access: "read", granted: true,
      });
      const w2 = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { notes: `${TAG} ok now` });
      expect(w2.ok, "write allowed once read is restored", `got ${w2.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Capability: grant → allowed, revoke → refused");
    {
      // leads.merge requires leads:delete, which ICR lacks — so granting the
      // capability alone must NOT make it work. This is the subtractive rule.
      await setGranular(admin.jar, {
        role: "ICR", scope: "CAPABILITY", resource: "leads",
        target: "leads.merge", granted: true,
      });
      const stillDenied = await api(icr.jar, "POST", "/api/leads/merge", {
        keepId: leadId, mergeFromId: leadId, reason: "test",
      });
      expect(!stillDenied.ok,
        "capability granted but underlying action missing → still denied",
        `got ${stillDenied.status}`);

      // Revoke it from SUPER_ADMIN and confirm the admin loses the operation.
      await setGranular(admin.jar, {
        role: "SUPER_ADMIN", scope: "CAPABILITY", resource: "leads",
        target: "leads.merge", granted: false,
      });
      const adminDenied = await api(admin.jar, "POST", "/api/leads/merge", {
        keepId: leadId, mergeFromId: leadId, reason: "test",
      });
      expect(adminDenied.status === 403,
        "revoking the capability blocks even SUPER_ADMIN",
        `got ${adminDenied.status}`);

      // Restore both.
      await setGranular(admin.jar, {
        role: "SUPER_ADMIN", scope: "CAPABILITY", resource: "leads",
        target: "leads.merge", granted: true,
      });
      await setGranular(admin.jar, {
        role: "ICR", scope: "CAPABILITY", resource: "leads",
        target: "leads.merge", granted: false,
      });
      const adminBack = await api(admin.jar, "POST", "/api/leads/merge", {
        keepId: leadId, mergeFromId: leadId, reason: "test",
      });
      // Same-id merge is nonsense, so a 4xx validation error is the expected
      // outcome — what matters is that it is no longer the 403.
      expect(adminBack.status !== 403, "SUPER_ADMIN regains the capability", `got ${adminBack.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Guard rails");
    {
      const bogusCap = await api(admin.jar, "PUT", "/api/settings/permissions/granular", {
        changes: [{ role: "ICR", scope: "CAPABILITY", resource: "leads", target: "leads.not_real", granted: true }],
      });
      expect(bogusCap.status === 422, "unknown capability rejected", `got ${bogusCap.status}`);

      const bogusField = await api(admin.jar, "PUT", "/api/settings/permissions/granular", {
        changes: [{ role: "ICR", scope: "FIELD", resource: "leads", target: "not_a_column", access: "read", granted: false }],
      });
      expect(bogusField.status === 422, "unknown field rejected", `got ${bogusField.status}`);

      const noAccess = await api(admin.jar, "PUT", "/api/settings/permissions/granular", {
        changes: [{ role: "ICR", scope: "FIELD", resource: "leads", target: "phone", granted: false }],
      });
      expect(noAccess.status === 422, "FIELD change without access mode rejected", `got ${noAccess.status}`);

      const bogusRole = await api(admin.jar, "PUT", "/api/settings/permissions/granular", {
        changes: [{ role: "WIZARD", scope: "CAPABILITY", resource: "leads", target: "leads.merge", granted: true }],
      });
      expect(bogusRole.status === 422, "unknown role rejected", `got ${bogusRole.status}`);

      const selfLock = await api(admin.jar, "PUT", "/api/settings/permissions/granular", {
        changes: [{ role: "SUPER_ADMIN", scope: "CAPABILITY", resource: "users", target: "users.change_role", granted: false }],
      });
      expect(selfLock.status === 409, "SUPER_ADMIN cannot revoke its own admin rights", `got ${selfLock.status}`);
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Unlisted fields are unaffected");
    {
      // Only catalogued columns are controlled; everything else must behave as
      // before, or adding the feature would have silently restricted the app.
      const r = await api(icr.jar, "GET", `/api/leads/${leadId}`);
      const d = r.payload?.data ?? {};
      for (const f of ["firstName", "lastName", "nationality", "studyLevel", "intakeYear"]) {
        expect(f in d, `uncatalogued field "${f}" still returned`);
      }
      const w = await api(icr.jar, "PATCH", `/api/leads/${leadId}`, { nationality: "Elsewhere" });
      expect(w.ok, "uncatalogued field still writable", `got ${w.status}`);
    }

  } finally {
    process.stdout.write(`\n[cleanup]\n`);
    // Remove every override the test created so prod returns to defaults.
    const cleared = await db.granularPermission.deleteMany({
      where: { role: { in: ["ICR", "SUPER_ADMIN"] } },
    }).catch(() => ({ count: 0 }));
    process.stdout.write(`  · cleared ${cleared.count} granular override(s)\n`);
    for (const c of created.filter((x) => x.model === "lead")) {
      await db.lead.delete({ where: { id: c.id } }).catch(() => {});
    }
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '${TAG}%'`).catch(() => {});
    await destroyUser(icr);
    await destroyUser(admin);
    process.stdout.write(`[cleanup] done\n`);
  }

  const f = summary();
  process.exit(f > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); })
  .finally(() => db.$disconnect());

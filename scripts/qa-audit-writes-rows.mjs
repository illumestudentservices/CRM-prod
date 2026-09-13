/**
 * Do the new audit calls actually write rows?
 *
 *   npx tsx --env-file=.env scripts/qa-audit-writes-rows.mjs
 *
 * `qa-audit-coverage.mjs` reads the source and proves every mutating route
 * CONTAINS a logging call. That is necessary and not sufficient: a call placed
 * after an early return, or one that throws, still satisfies a grep.
 *
 * This drives a representative action over real HTTP for each shape the
 * codemod produced — a plain create, a create inside a transaction, an update,
 * and a delete routed through trashRecord — and checks a row appeared, with the
 * right actor and the origin captured.
 */
import {
  db, api, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary, idOf,
} from "./qa-lib.mjs";

const stamp = Date.now().toString().slice(-6);
let ctx;
const made = { leads: [], partners: [] };

/**
 * Newest audit row for an entity, waiting for it to appear.
 *
 * `logActivity` is deliberately fire-and-forget — an audit write must never
 * delay or fail the request it describes — so the row lands a moment after the
 * response. Reading once races it: this suite passed, then failed on the same
 * code, which is the signature of that race rather than of a missing row.
 */
async function rowFor(entityId, where = {}, tries = 12) {
  for (let i = 0; i < tries; i++) {
    const row = await db.auditLog.findFirst({
      where: { entityId, ...where },
      orderBy: { createdAt: "desc" },
    });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

try {
  ctx = await createAndLogin({ role: "SUPER_ADMIN" });
  const before = await db.auditLog.count();

  // ── A plain create ───────────────────────────────────────────────────────
  startSection("a create writes a row");

  const partner = await api(ctx.jar, "POST", "/api/sources", {
    name: `ZZAudit Partner ${stamp}`,
    type: "AGENT",
    country: "India",
  });
  expect(partner.status === 201 || partner.status === 200, "partner created", `status ${partner.status}`);
  const partnerId = idOf(partner.payload);
  made.partners.push(partnerId);

  const pRow = await rowFor(partnerId);
  expect(!!pRow, "an audit row exists for the new partner", "the call is in the file but wrote nothing");
  expect(pRow?.userId === ctx.user.id, "it names the person who did it", `userId ${pRow?.userId}`);
  expect(
    !!pRow?.ipAddress,
    "the origin IP was captured",
    "logActivity fell back to no request context"
  );
  ok(`  action=${pRow?.action} entity=${pRow?.entity}`);

  // ── A create inside a transaction ────────────────────────────────────────
  startSection("a create inside a transaction writes a row");

  const source = await db.recruitmentPartner.findFirst({
    where: { deletedAt: null, isActive: true }, select: { id: true },
  });
  const lead = await api(ctx.jar, "POST", "/api/leads", {
    firstName: "ZZAudit", lastName: `Lead${stamp}`,
    email: `zz.audit.${stamp}@example.invalid`, phone: `+15554${stamp}`,
    nationality: "Indian", countryOfResidence: "India",
    interestedProgram: "Business Administration",
    studyLevel: "UNDERGRADUATE", intakeYear: 2026, intakeMonth: 9,
    sourceId: source?.id,
  });
  const leadId = idOf(lead.payload);
  made.leads.push(leadId);

  const note = await api(ctx.jar, "POST", `/api/leads/${leadId}/notes`, {
    content: "Audit coverage probe.",
  });
  expect(note.status === 201 || note.status === 200, "note created", `status ${note.status}`);
  const noteId = idOf(note.payload);
  const nRow = await rowFor(noteId);
  expect(
    !!nRow,
    "the note created inside a $transaction still produced a row",
    "the call sits after the transaction; if this fails it is in the wrong place"
  );
  ok(`  action=${nRow?.action} entity=${nRow?.entity}`);

  // ── An update ────────────────────────────────────────────────────────────
  startSection("an update writes a row");

  const upd = await api(ctx.jar, "PATCH", `/api/sources/${partnerId}`, { city: "Mumbai" });
  expect(upd.status === 200, "partner updated", `status ${upd.status}`);
  await rowFor(partnerId, { action: "UPDATE" });
  const uRows = await db.auditLog.count({ where: { entityId: partnerId } });
  expect(uRows >= 2, "the update added a second row", `only ${uRows} row(s) for this partner`);

  // ── A delete, via trashRecord ────────────────────────────────────────────
  startSection("a delete writes a row — from trashRecord, not the route");

  const del = await api(ctx.jar, "DELETE", `/api/sources/${partnerId}`);
  expect(del.status === 200 || del.status === 204, "partner deleted", `status ${del.status}`);

  // Pinned to the entity trashRecord uses. `/api/sources/[id]` ALSO logs its
  // own DELETE — as "Source", with a full before-snapshot — so a bare
  // action:"DELETE" lookup returns whichever of the two sorts first and the
  // assertion below passes or fails at random. The two rows are complementary,
  // not duplicates: the route keeps the old values, trashRecord names what was
  // deleted and what it belonged to.
  const dRow = await rowFor(partnerId, { action: "DELETE", entity: "RecruitmentPartner" });
  expect(
    !!dRow,
    "the deletion was recorded",
    "33 call sites delete through trashRecord and none of them logged before this"
  );
  expect(
    !!(dRow?.changes && typeof dRow.changes === "object" && "label" in dRow.changes),
    "the row carries the label of what was deleted",
    "'DELETE RecruitmentPartner <uuid>' answers nothing once the row is gone"
  );
  ok(`  changes=${JSON.stringify(dRow?.changes)?.slice(0, 120)}`);

  const after = await db.auditLog.count();
  ok(`audit rows: ${before} → ${after}`);
} catch (e) {
  startSection("fatal");
  fail("suite threw", e?.stack ?? String(e));
} finally {
  for (const id of made.leads) {
    try {
      await db.leadActivity.deleteMany({ where: { leadId: id } });
      await db.leadNote.deleteMany({ where: { leadId: id } });
      await db.lead.delete({ where: { id } });
    } catch { /* best effort */ }
  }
  for (const id of made.partners) {
    try { await db.recruitmentPartner.delete({ where: { id } }); } catch { /* soft-deleted */ }
  }
  if (ctx) await destroyUser(ctx);
  await db.$disconnect();
  summary();
}

#!/usr/bin/env node
/**
 * CRUD round-trip suite.
 *
 * For each entity: POST a record with known field values → read it back →
 * assert every field persisted → PATCH one field → assert the change stuck →
 * DELETE → assert it's gone (and landed in the recycle bin).
 *
 * The persistence assertions are the point: a POST returning 201 proves
 * nothing about whether the fields you sent were actually written. Silent
 * field-drop is the most common CRM bug class and status-code testing
 * cannot see it.
 */

import {
  db, TAG, api, idOf, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary,
} from "./qa-lib.mjs";

const created = [];   // { model, id } for cleanup
function track(model, id) { if (id) created.push({ model, id }); }

/** Assert every key of `sent` shows up with the same value in `got`. */
function assertPersisted(sent, got, label) {
  const drops = [];
  for (const [k, v] of Object.entries(sent)) {
    if (v === undefined || v === null) continue;
    let actual = got?.[k];
    // Dates come back as ISO strings
    if (v instanceof Date) {
      if (!actual || new Date(actual).getTime() !== v.getTime()) drops.push(k);
      continue;
    }
    if (typeof v === "number" && typeof actual === "string") actual = Number(actual);
    if (String(actual) !== String(v)) drops.push(`${k}(sent=${v} got=${actual})`);
  }
  if (drops.length === 0) ok(`${label}: all ${Object.keys(sent).length} fields persisted`);
  else fail(`${label}: field drop`, drops.join(", "));
}

async function main() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const { jar, user } = ctx;
  process.stdout.write(`[setup] ${user.email}\n`);

  // Reference rows we need as FK parents
  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  const event = await db.event.findFirst({ where: { deletedAt: null }, select: { id: true } });

  try {
    // ══════════════════════════════════════════════════════════════════
    startSection("Lead");
    {
      const sent = {
        firstName: `${TAG}First`, lastName: `${TAG}Last`,
        email: `${TAG.toLowerCase()}.lead@example.test`,
        phone: "+15550001111",
        nationality: "Testland", countryOfResidence: "Testland",
        interestedProgram: "MSc Testing", studyLevel: "POSTGRADUATE",
        intakeYear: 2027, intakeMonth: 9,
      };
      const c = await api(jar, "POST", "/api/leads", sent);
      if (!expect(c.status === 201, "POST /api/leads → 201", `got ${c.status} ${JSON.stringify(c.payload)?.slice(0,200)}`)) return;
      const id = idOf(c.payload);
      track("lead", id);

      const r = await api(jar, "GET", `/api/leads/${id}`);
      expect(r.ok, "GET /api/leads/[id] → 200", `got ${r.status}`);
      const got = r.payload?.data ?? r.payload;
      assertPersisted(sent, got, "Lead create");

      // Update
      const upd = await api(jar, "PATCH", `/api/leads/${id}`, { interestedProgram: "MSc Updated", phone: "+15559998888" });
      expect(upd.ok, "PATCH /api/leads/[id] → 2xx", `got ${upd.status}`);
      const r2 = await api(jar, "GET", `/api/leads/${id}`);
      const got2 = r2.payload?.data ?? r2.payload;
      assertPersisted({ interestedProgram: "MSc Updated", phone: "+15559998888" }, got2, "Lead update");

      // Stage transition endpoint
      const st = await api(jar, "PATCH", `/api/leads/${id}/stage`, { stage: "CONTACTED" });
      expect([200, 201].includes(st.status) || st.status === 422,
        "PATCH lead stage → 200 or gated 422", `got ${st.status}`);

      // Notes sub-resource
      const note = await api(jar, "POST", `/api/leads/${id}/notes`, { content: `${TAG} note body` });
      expect(note.status === 201 || note.ok, "POST lead note → 2xx", `got ${note.status}`);
      const notes = await api(jar, "GET", `/api/leads/${id}/notes`);
      const noteArr = Array.isArray(notes.payload) ? notes.payload : notes.payload?.data ?? [];
      expect(noteArr.some((n) => n.content?.includes(TAG)), "Lead note readable after create");

      // Delete → recycle bin
      const del = await api(jar, "DELETE", `/api/leads/${id}`);
      expect(del.ok, "DELETE /api/leads/[id] → 2xx", `got ${del.status}`);
      const row = await db.lead.findUnique({ where: { id } });
      expect(row?.deletedAt != null, "Lead soft-deleted (deletedAt set)");
      const bin = await db.deletedRecord.findFirst({ where: { entityType: "Lead", entityId: id, purgedAt: null } });
      expect(bin != null, "Lead landed in recycle bin");
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Institution");
    {
      const sent = {
        name: `${TAG} Test University`,
        country: "Testland",
        type: "University",
        website: "https://test.example.com",
        accountStatus: "PROSPECT",
      };
      const c = await api(jar, "POST", "/api/institutions", sent);
      if (!expect(c.status === 201 || c.ok, "POST /api/institutions → 2xx", `got ${c.status} ${JSON.stringify(c.payload)?.slice(0,200)}`)) {
        // fall through so later sections still run
      } else {
        const id = idOf(c.payload);
        track("institution", id);
        const r = await api(jar, "GET", `/api/institutions/${id}`);
        const got = r.payload?.data ?? r.payload;
        assertPersisted(sent, got, "Institution create");

        const upd = await api(jar, "PATCH", `/api/institutions/${id}`, { accountStatus: "ACTIVE", country: "Newland" });
        expect(upd.ok, "PATCH institution → 2xx", `got ${upd.status}`);
        const r2 = await api(jar, "GET", `/api/institutions/${id}`);
        assertPersisted({ accountStatus: "ACTIVE", country: "Newland" }, r2.payload?.data ?? r2.payload, "Institution update");

        // Sub-resources
        const contact = await api(jar, "POST", `/api/institutions/${id}/contacts`, {
          name: `${TAG} Contact`, email: `${TAG.toLowerCase()}@c.test`, isPrimary: true,
        });
        expect(contact.ok || contact.status === 201, "POST institution contact → 2xx", `got ${contact.status}`);

        const kpi = await api(jar, "POST", `/api/institutions/${id}/kpis`, {
          name: `${TAG} KPI`, category: "RECRUITMENT", targetValue: 100, currentValue: 40, unit: "students",
        });
        expect(kpi.ok || kpi.status === 201, "POST institution KPI → 2xx", `got ${kpi.status}`);
        if (kpi.ok || kpi.status === 201) {
          const kid = idOf(kpi.payload);
          const kr = await api(jar, "GET", `/api/institutions/${id}/kpis`);
          const arr = Array.isArray(kr.payload) ? kr.payload : kr.payload?.data ?? [];
          const found = arr.find((k) => k.id === kid);
          expect(found != null, "KPI readable after create");
          if (found) assertPersisted({ targetValue: 100, currentValue: 40, unit: "students" }, found, "KPI create");
          const kdel = await api(jar, "DELETE", `/api/institutions/${id}/kpis/${kid}`);
          expect(kdel.ok, "DELETE KPI → 2xx", `got ${kdel.status}`);
          const kbin = await db.deletedRecord.findFirst({ where: { entityType: "ClientKPI", entityId: kid, purgedAt: null } });
          expect(kbin != null, "Deleted KPI landed in recycle bin (hard-delete snapshot)");
        }

        const issue = await api(jar, "POST", `/api/institutions/${id}/issues`, {
          title: `${TAG} Issue`, category: "SERVICE_DELIVERY", severity: "HIGH", ownerId: user.id,
        });
        expect(issue.ok || issue.status === 201, "POST institution issue → 2xx", `got ${issue.status}`);

        const eng = await api(jar, "POST", `/api/institutions/${id}/engagement`, {
          type: "MEETING", date: new Date().toISOString(), notes: `${TAG} engagement`,
        });
        expect(eng.ok || eng.status === 201, "POST engagement log → 2xx", `got ${eng.status}`);

        const del = await api(jar, "DELETE", `/api/institutions/${id}`);
        expect(del.ok, "DELETE institution → 2xx", `got ${del.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("RecruitmentPartner (source)");
    {
      const sent = {
        name: `${TAG} Partner`, type: "AGENT", country: "Testland",
        city: "Testville", contactPerson: "QA Person",
        email: `${TAG.toLowerCase()}@partner.test`, phone: "+15551234567",
        agreementStatus: "PENDING", rating: 4,
      };
      const c = await api(jar, "POST", "/api/sources", sent);
      if (expect(c.status === 201, "POST /api/sources → 201", `got ${c.status}`)) {
        const id = idOf(c.payload);
        track("recruitmentPartner", id);
        const r = await api(jar, "GET", `/api/sources/${id}`);
        assertPersisted(sent, r.payload?.data ?? r.payload, "Partner create");

        const upd = await api(jar, "PATCH", `/api/sources/${id}`, { rating: 2, city: "Newville" });
        expect(upd.ok, "PATCH partner → 2xx", `got ${upd.status}`);
        const r2 = await api(jar, "GET", `/api/sources/${id}`);
        assertPersisted({ rating: 2, city: "Newville" }, r2.payload?.data ?? r2.payload, "Partner update");

        // Partner contact sub-resource
        const pc = await api(jar, "POST", "/api/partner-contacts", {
          partnerId: id, fullName: `${TAG} PC`, role: "COUNSELLOR",
          email: `${TAG.toLowerCase()}@pc.test`,
        });
        expect(pc.ok || pc.status === 201, "POST partner-contact → 2xx", `got ${pc.status}`);
        if (pc.ok || pc.status === 201) {
          const pcid = idOf(pc.payload);
          const pcdel = await api(jar, "DELETE", `/api/partner-contacts/${pcid}`);
          expect(pcdel.ok, "DELETE partner-contact → 2xx", `got ${pcdel.status}`);
          const b = await db.deletedRecord.findFirst({ where: { entityType: "PartnerContact", entityId: pcid, purgedAt: null } });
          expect(b != null, "PartnerContact in recycle bin");
        }

        const del = await api(jar, "DELETE", `/api/sources/${id}`);
        expect(del.ok, "DELETE partner → 2xx", `got ${del.status}`);
        const row = await db.recruitmentPartner.findUnique({ where: { id } });
        expect(row?.deletedAt != null, "Partner soft-deleted");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Event + expenses");
    {
      const sent = {
        name: `${TAG} Event`, type: "FAIR", date: new Date(Date.now() + 86400000).toISOString(),
        city: "Testville", country: "Testland", status: "PLANNED", budget: 5000,
      };
      const c = await api(jar, "POST", "/api/events", sent);
      if (expect(c.status === 201 || c.ok, "POST /api/events → 2xx", `got ${c.status} ${JSON.stringify(c.payload)?.slice(0,160)}`)) {
        const id = idOf(c.payload);
        track("event", id);
        const r = await api(jar, "GET", `/api/events/${id}`);
        const got = r.payload?.data ?? r.payload;
        assertPersisted({ name: sent.name, city: sent.city, country: sent.country, budget: sent.budget }, got, "Event create");

        const exp = await api(jar, "POST", `/api/events/${id}/expenses`, {
          description: `${TAG} expense`, amount: 250, category: "TRAVEL",
        });
        expect(exp.ok || exp.status === 201, "POST event expense → 2xx", `got ${exp.status}`);
        const r2 = await api(jar, "GET", `/api/events/${id}`);
        const evt = r2.payload?.data ?? r2.payload;
        const expenses = evt?.expenses ?? [];
        expect(expenses.some((e) => e.description?.includes(TAG)), "Expense visible on event after create");

        const upd = await api(jar, "PATCH", `/api/events/${id}`, { status: "CONFIRMED" });
        expect(upd.ok, "PATCH event → 2xx", `got ${upd.status}`);

        const del = await api(jar, "DELETE", `/api/events/${id}`);
        expect(del.ok, "DELETE event → 2xx", `got ${del.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Task");
    {
      const sent = { title: `${TAG} Task`, description: "QA task body", priority: "HIGH" };
      const c = await api(jar, "POST", "/api/tasks", sent);
      if (expect(c.status === 201 || c.ok, "POST /api/tasks → 2xx", `got ${c.status} ${JSON.stringify(c.payload)?.slice(0,160)}`)) {
        const id = idOf(c.payload);
        track("task", id);
        const list = await api(jar, "GET", "/api/tasks");
        const arr = Array.isArray(list.payload) ? list.payload : list.payload?.data ?? [];
        const found = arr.find((t) => t.id === id);
        expect(found != null, "Task appears in list after create");
        if (found) assertPersisted(sent, found, "Task create");

        const upd = await api(jar, "PATCH", `/api/tasks/${id}`, { status: "IN_PROGRESS", priority: "URGENT" });
        expect(upd.ok, "PATCH task → 2xx", `got ${upd.status}`);
        const dbRow = await db.task.findUnique({ where: { id } });
        assertPersisted({ status: "IN_PROGRESS", priority: "URGENT" }, dbRow, "Task update");

        const del = await api(jar, "DELETE", `/api/tasks/${id}`);
        expect(del.ok, "DELETE task → 2xx", `got ${del.status}`);
        const bin = await db.deletedRecord.findFirst({ where: { entityType: "Task", entityId: id, purgedAt: null } });
        expect(bin != null, "Task in recycle bin");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Risk + Compliance");
    {
      const rs = { type: "MARKET", title: `${TAG} Risk`, likelihood: 4, impact: 5, status: "OPEN", ownerId: user.id };
      const c = await api(jar, "POST", "/api/risks", rs);
      if (expect(c.status === 201 || c.ok, "POST /api/risks → 2xx", `got ${c.status}`)) {
        const id = idOf(c.payload);
        track("riskRegister", id);
        const dbRow = await db.riskRegister.findUnique({ where: { id } });
        assertPersisted({ title: rs.title, likelihood: 4, impact: 5 }, dbRow, "Risk create");
        expect(dbRow?.riskScore === 20, "riskScore auto-computed = likelihood × impact", `got ${dbRow?.riskScore}`);

        const upd = await api(jar, "PATCH", `/api/risks/${id}`, { likelihood: 2, impact: 2 });
        expect(upd.ok, "PATCH risk → 2xx", `got ${upd.status}`);
        const dbRow2 = await db.riskRegister.findUnique({ where: { id } });
        expect(dbRow2?.riskScore === 4, "riskScore recomputed on update", `got ${dbRow2?.riskScore}`);

        const del = await api(jar, "DELETE", `/api/risks/${id}`);
        expect(del.ok, "DELETE risk → 2xx", `got ${del.status}`);
      }

      const cs = { complianceType: "GDPR", title: `${TAG} Compliance`, status: "PENDING" };
      const c2 = await api(jar, "POST", "/api/compliance", cs);
      if (expect(c2.status === 201 || c2.ok, "POST /api/compliance → 2xx", `got ${c2.status}`)) {
        const id = idOf(c2.payload);
        track("complianceItem", id);
        const dbRow = await db.complianceItem.findUnique({ where: { id } });
        assertPersisted(cs, dbRow, "Compliance create");
        const del = await api(jar, "DELETE", `/api/compliance/${id}`);
        expect(del.ok, "DELETE compliance → 2xx", `got ${del.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Stakeholders (school + counsellor)");
    {
      const ss = {
        name: `${TAG} School`, country: "Testland", city: "Testville",
        type: "PRIVATE", relationshipStatus: "DEVELOPING",
        principalName: "QA Principal", studentVolume: 500,
      };
      const c = await api(jar, "POST", "/api/stakeholders/schools", ss);
      if (expect(c.status === 201 || c.ok, "POST school → 2xx", `got ${c.status}`)) {
        const sid = idOf(c.payload);
        track("school", sid);
        const dbRow = await db.school.findUnique({ where: { id: sid } });
        assertPersisted(ss, dbRow, "School create");

        const cc = { name: `${TAG} Counsellor`, schoolId: sid, position: "Head", influenceScore: 8 };
        const c2 = await api(jar, "POST", "/api/stakeholders/counsellors", cc);
        if (expect(c2.status === 201 || c2.ok, "POST counsellor → 2xx", `got ${c2.status}`)) {
          const cid = idOf(c2.payload);
          track("counsellor", cid);
          const dbc = await db.counsellor.findUnique({ where: { id: cid } });
          assertPersisted({ name: cc.name, position: cc.position, influenceScore: 8 }, dbc, "Counsellor create");
          const del2 = await api(jar, "DELETE", `/api/stakeholders/counsellors/${cid}`);
          expect(del2.ok, "DELETE counsellor → 2xx", `got ${del2.status}`);
        }

        const del = await api(jar, "DELETE", `/api/stakeholders/schools/${sid}`);
        expect(del.ok, "DELETE school → 2xx", `got ${del.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Campaign");
    {
      const sent = {
        name: `${TAG} Campaign`, channel: "email", type: "WEBINAR",
        startDate: new Date().toISOString(), country: "Testland",
        budget: 1200, status: "PLANNED",
      };
      const c = await api(jar, "POST", "/api/campaigns", sent);
      if (expect(c.status === 201 || c.ok, "POST /api/campaigns → 2xx", `got ${c.status}`)) {
        const id = idOf(c.payload);
        track("campaign", id);
        const dbRow = await db.campaign.findUnique({ where: { id } });
        assertPersisted({ name: sent.name, channel: sent.channel, country: sent.country, budget: sent.budget }, dbRow, "Campaign create");

        // Duplicate detection: same name+country within 14 days must 409
        const dup = await api(jar, "POST", "/api/campaigns", sent);
        expect(dup.status === 409, "Duplicate campaign refused with 409", `got ${dup.status}`);
        // SUPER_ADMIN forceCreate should succeed
        const forced = await api(jar, "POST", "/api/campaigns", { ...sent, forceCreate: true });
        expect(forced.status === 201 || forced.ok, "SUPER_ADMIN forceCreate bypasses dedup", `got ${forced.status}`);
        if (forced.ok || forced.status === 201) track("campaign", idOf(forced.payload));
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Institution-interest lifecycle");
    {
      // Need a live lead
      const lead = await api(jar, "POST", "/api/leads", {
        firstName: `${TAG}I`, lastName: "Interest",
        email: `${TAG.toLowerCase()}.int@example.test`, phone: "+15550002222",
        nationality: "Testland", countryOfResidence: "Testland",
        interestedProgram: "BSc Testing", studyLevel: "UNDERGRADUATE",
        intakeYear: 2027, intakeMonth: 9,
      });
      const leadId = idOf(lead.payload);
      track("lead", leadId);

      if (leadId && inst) {
        const ii = await api(jar, "POST", "/api/institution-interests", {
          leadId, institutionId: inst.id, program: `${TAG} Programme`,
          intakeYear: 2027, intakeMonth: 9, studyLevel: "UNDERGRADUATE",
        });
        if (expect(ii.status === 201 || ii.ok, "POST institution-interest → 2xx", `got ${ii.status}`)) {
          const iid = idOf(ii.payload);
          track("institutionInterest", iid);
          const dbRow = await db.institutionInterest.findUnique({ where: { id: iid } });
          assertPersisted({ program: `${TAG} Programme`, intakeYear: 2027, intakeMonth: 9 }, dbRow, "Interest create");

          // stage transition
          const stg = await api(jar, "PATCH", `/api/institution-interests/${iid}/stage`, { stage: "CONTACTED" });
          expect([200, 201, 422].includes(stg.status), "Interest stage transition handled", `got ${stg.status}`);

          // close then reopen
          const close = await api(jar, "POST", `/api/institution-interests/${iid}/close`, {
            outcome: "LOST", lostReason: "OTHER",
          });
          expect(close.ok, "Close interest → 2xx", `got ${close.status}`);
          const closed = await db.institutionInterest.findUnique({ where: { id: iid } });
          expect(closed?.closedAt != null, "closedAt set after close");

          const reopen = await api(jar, "POST", `/api/institution-interests/${iid}/reopen`);
          expect(reopen.ok, "Reopen interest → 2xx", `got ${reopen.status}`);
          const reopened = await db.institutionInterest.findUnique({ where: { id: iid } });
          expect(reopened?.closedAt == null, "closedAt cleared after reopen");
        }
      } else {
        fail("Institution-interest setup", "no lead or institution available");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Attachment round-trip");
    {
      const lead = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
      if (lead) {
        const fd = new FormData();
        const content = `${TAG} attachment payload`;
        fd.append("file", new Blob([content], { type: "text/plain" }), `${TAG}.txt`);
        const res = await fetch(
          `${process.env.BASE_URL ?? "https://illumestudentservices.cloud"}/api/attachments?parentType=LEAD&parentId=${lead.id}`,
          { method: "POST", headers: { Cookie: jar.header() }, body: fd }
        );
        if (expect(res.ok, "POST attachment → 2xx", `got ${res.status}`)) {
          const body = await res.json();
          const aid = body.data.id;
          track("attachment", aid);
          const dbRow = await db.attachment.findUnique({ where: { id: aid } });
          expect(dbRow?.size === content.length, "Attachment size matches payload", `got ${dbRow?.size} want ${content.length}`);
          expect(dbRow?.mimeType === "text/plain", "Canonical MIME stored", `got ${dbRow?.mimeType}`);

          const dl = await api(jar, "GET", `/api/attachments/${aid}`);
          expect(dl.status === 200, "GET attachment → 200", `got ${dl.status}`);
          expect(String(dl.payload).includes(TAG), "Downloaded bytes match uploaded content");

          const del = await api(jar, "DELETE", `/api/attachments/${aid}`);
          expect(del.ok, "DELETE attachment → 2xx", `got ${del.status}`);
          const after = await db.attachment.findUnique({ where: { id: aid } });
          expect(after?.deletedAt != null, "Attachment soft-deleted (file bytes retained)");
          expect(after?.data != null, "Attachment bytes still present for restore");
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Recycle-bin restore integrity");
    {
      // Delete a partner, restore it, confirm the row is fully back.
      const c = await api(jar, "POST", "/api/sources", {
        name: `${TAG} RestoreMe`, type: "AGENT", country: "Testland", rating: 3,
      });
      const id = idOf(c.payload);
      track("recruitmentPartner", id);
      if (id) {
        await api(jar, "DELETE", `/api/sources/${id}`);
        const bin = await db.deletedRecord.findFirst({
          where: { entityType: "RecruitmentPartner", entityId: id, restoredAt: null, purgedAt: null },
        });
        if (expect(bin != null, "Deleted partner present in bin")) {
          const restore = await api(jar, "POST", `/api/recycle-bin/${bin.id}/restore`);
          expect(restore.ok, "Restore → 2xx", `got ${restore.status}`);
          const row = await db.recruitmentPartner.findUnique({ where: { id } });
          expect(row?.deletedAt == null, "Restored row is live again");
          expect(row?.rating === 3, "Restored row kept its field values", `rating=${row?.rating}`);
          const binAfter = await db.deletedRecord.findUnique({ where: { id: bin.id } });
          expect(binAfter?.restoredAt != null, "Bin entry marked restored");
        }
      }
    }

  } finally {
    // ── Cleanup ────────────────────────────────────────────────────────
    process.stdout.write(`\n[cleanup] removing ${created.length} tracked rows\n`);
    // Children first
    const order = [
      "attachment", "counsellor", "institutionInterest", "clientKPI",
      "riskRegister", "complianceItem", "task", "campaign",
      "school", "event", "recruitmentPartner", "lead", "institution",
    ];
    for (const model of order) {
      const ids = created.filter((c) => c.model === model).map((c) => c.id);
      for (const id of ids) {
        try { await db[model].delete({ where: { id } }); } catch { /* cascade or already gone */ }
      }
    }
    // Anything left tagged
    await db.deletedRecord.deleteMany({ where: { deletedById: ctx.user.id } }).catch(() => {});
    await db.leadNote.deleteMany({ where: { content: { contains: TAG } } }).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM client_issues WHERE title LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM engagement_logs WHERE notes LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM institution_contacts WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM campaigns WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM sources WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM institutions WHERE name LIKE '${TAG}%'`).catch(() => {});
    await destroyUser(ctx);
    process.stdout.write(`[cleanup] done\n`);
  }

  const failCount = summary();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("\nHARNESS ERROR:", e);
  process.exit(2);
}).finally(() => db.$disconnect());

#!/usr/bin/env node
/**
 * Validation + error-handling hard test.
 *
 * Rule under test: bad client input must produce a 4xx with a clean message.
 * A 500 means unvalidated input reached the database layer — that is always
 * a bug, and it leaks stack context into logs.
 *
 * Probes, per endpoint:
 *   1. empty body                → expect 400/422
 *   2. missing required fields   → expect 400/422
 *   3. invalid enum value        → expect 400/422  (NOT 500)
 *   4. wrong scalar type         → expect 400/422
 *   5. malformed JSON            → expect 400
 *   6. XSS payload in text field → expect stored-escaped or rejected, never 500
 *   7. SQLi payload in text/query→ expect no error and no data leak
 *   8. oversized string          → expect 400/413/422, never 500
 */

import {
  db, TAG, api, apiRaw, idOf, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary, BASE, sleep,
} from "./qa-lib.mjs";

const XSS = `<script>alert("${TAG}")</script>`;
const SQLI = `'; DROP TABLE leads;-- ${TAG}`;
const HUGE = "A".repeat(100_000);

const createdIds = [];

/** A 500 from client input is always a bug. */
function classify(status) {
  if (status >= 500) return "SERVER_ERROR";
  if (status === 400 || status === 422 || status === 413 || status === 415) return "REJECTED";
  if (status === 401 || status === 403) return "AUTHZ";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status >= 200 && status < 300) return "ACCEPTED";
  return `OTHER_${status}`;
}

async function probe(jar, label, method, path, body, { allowAccept = false } = {}) {
  const r = await api(jar, method, path, body);
  const kind = classify(r.status);
  if (kind === "SERVER_ERROR") {
    fail(`${label} → 500 (unvalidated input reached DB)`, JSON.stringify(r.payload)?.slice(0, 120));
    return r;
  }
  if (kind === "ACCEPTED" && !allowAccept) {
    fail(`${label} → accepted invalid input (${r.status})`, "expected 4xx");
    if (idOf(r.payload)) createdIds.push({ path, id: idOf(r.payload) });
    return r;
  }
  ok(`${label} → ${r.status} ${kind}`);
  return r;
}

async function main() {
  const ctx = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const { jar, user } = ctx;
  process.stdout.write(`[setup] ${user.email}\n`);

  const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });
  const lead = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });

  try {
    // ══════════════════════════════════════════════════════════════════
    startSection("Empty body / missing required fields");
    {
      const endpoints = [
        ["POST", "/api/leads"],
        ["POST", "/api/institutions"],
        ["POST", "/api/sources"],
        ["POST", "/api/events"],
        ["POST", "/api/campaigns"],
        ["POST", "/api/risks"],
        ["POST", "/api/compliance"],
        ["POST", "/api/markets"],
        ["POST", "/api/travel"],
        ["POST", "/api/stakeholders/schools"],
        ["POST", "/api/stakeholders/counsellors"],
        ["POST", "/api/hr/tasks"],
        ["POST", "/api/hr/holidays"],
        ["POST", "/api/hr/assets"],
        ["POST", "/api/hr/announcements"],
        ["POST", "/api/hr/performance-reviews"],
        ["POST", "/api/hr/succession-plans"],
        ["POST", "/api/knowledge/proposals"],
        ["POST", "/api/settings/regions"],
        ...(inst ? [
          ["POST", `/api/institutions/${inst.id}/contacts`],
          ["POST", `/api/institutions/${inst.id}/kpis`],
          ["POST", `/api/institutions/${inst.id}/issues`],
          ["POST", `/api/institutions/${inst.id}/engagement`],
          ["POST", `/api/institutions/${inst.id}/deliverables`],
          ["POST", `/api/institutions/${inst.id}/contracts`],
        ] : []),
        ...(lead ? [["POST", `/api/leads/${lead.id}/notes`]] : []),
      ];
      for (const [m, p] of endpoints) {
        await probe(jar, `empty {} ${p}`, m, p, {});
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Invalid enum values (must be 4xx, never 500)");
    {
      const cases = [
        ["/api/events", {
          name: `${TAG}E`, type: "NOT_A_REAL_TYPE", date: new Date().toISOString(),
          city: "X", country: "Y",
        }, "EventType"],
        ["/api/sources", {
          name: `${TAG}S`, type: "NOT_A_REAL_TYPE", country: "Y",
        }, "SourceType"],
        ["/api/institutions", {
          name: `${TAG}I`, country: "Y", type: "University", accountStatus: "NOT_A_STATUS",
        }, "AccountStatus"],
        ["/api/campaigns", {
          name: `${TAG}C`, channel: "x", startDate: new Date().toISOString(), status: "NOT_A_STATUS",
        }, "CampaignStatus"],
        ["/api/risks", {
          type: "NOT_A_RISK_TYPE", title: `${TAG}R`, likelihood: 3, impact: 3, ownerId: user.id,
        }, "RiskType"],
        ["/api/compliance", {
          complianceType: "NOT_A_TYPE", title: `${TAG}X`,
        }, "ComplianceType"],
        ["/api/stakeholders/schools", {
          name: `${TAG}Sc`, country: "Y", type: "NOT_A_SCHOOL_TYPE",
        }, "SchoolType"],
        ["/api/leads", {
          firstName: `${TAG}`, lastName: "X", email: `${TAG.toLowerCase()}@e.test`,
          phone: "+15550000000", nationality: "Y", countryOfResidence: "Y",
          interestedProgram: "P", studyLevel: "NOT_A_LEVEL",
          intakeYear: 2027, intakeMonth: 9,
        }, "StudyLevel"],
        ...(inst ? [[`/api/institutions/${inst.id}/kpis`, {
          category: "NOT_A_CATEGORY", name: `${TAG}K`, targetValue: 1,
          unit: "x", period: "MONTHLY", year: 2027,
        }, "KPICategory"],
        [`/api/institutions/${inst.id}/engagement`, {
          type: "NOT_A_TYPE", date: new Date().toISOString(),
        }, "InteractionType"],
        [`/api/institutions/${inst.id}/issues`, {
          title: `${TAG}Is`, category: "NOT_A_CATEGORY", ownerId: user.id,
        }, "IssueCategory"]] : []),
      ];
      for (const [path, body, enumName] of cases) {
        await probe(jar, `bad ${enumName} → ${path}`, "POST", path, body);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Wrong scalar types");
    {
      const cases = [
        ["/api/leads", {
          firstName: 12345, lastName: { nested: true },
          email: "not-an-email", phone: [], nationality: "Y",
          countryOfResidence: "Y", interestedProgram: "P",
          studyLevel: "UNDERGRADUATE", intakeYear: "not-a-year", intakeMonth: 99,
        }, "types + bad email + month 99"],
        ["/api/risks", {
          type: "MARKET", title: `${TAG}`, likelihood: "high", impact: -5, ownerId: user.id,
        }, "string likelihood, negative impact"],
        ["/api/campaigns", {
          name: `${TAG}`, channel: "x", startDate: "not-a-date", budget: "free",
        }, "bad date, string budget"],
        ...(inst ? [[`/api/institutions/${inst.id}/kpis`, {
          category: "RECRUITMENT", name: `${TAG}`, targetValue: "lots",
          unit: "x", period: "MONTHLY", year: "soon",
        }, "string numerics"]] : []),
      ];
      for (const [path, body, desc] of cases) {
        await probe(jar, `${desc} → ${path}`, "POST", path, body);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Malformed JSON");
    {
      const paths = ["/api/leads", "/api/sources", "/api/events", "/api/risks", "/api/tasks", "/api/campaigns"];
      for (const p of paths) {
        const r = await apiRaw(jar, "POST", p, "{ this is not json ");
        const kind = classify(r.status);
        if (kind === "SERVER_ERROR") fail(`malformed JSON ${p} → 500`);
        else if (kind === "ACCEPTED") fail(`malformed JSON ${p} → accepted!`);
        else ok(`malformed JSON ${p} → ${r.status} ${kind}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("XSS payloads (stored, must be escaped not executed)");
    {
      const c = await api(jar, "POST", "/api/sources", {
        name: XSS, type: "AGENT", country: "Testland", notes: XSS,
      });
      if (c.status >= 500) {
        fail("XSS in partner name → 500");
      } else if (c.ok || c.status === 201) {
        const id = idOf(c.payload);
        createdIds.push({ path: "/api/sources", id });
        const row = await db.recruitmentPartner.findUnique({ where: { id } });
        // Storing raw is fine (React escapes on render); what matters is it
        // round-trips intact and doesn't corrupt the row.
        expect(row?.name === XSS, "XSS payload stored verbatim (React escapes at render)");
        const back = await api(jar, "GET", `/api/sources/${id}`);
        const got = back.payload?.data ?? back.payload;
        expect(got?.name === XSS, "XSS payload round-trips through API unchanged");
        await api(jar, "DELETE", `/api/sources/${id}`);
        ok("XSS test row cleaned up");
      } else {
        ok(`XSS in partner name → rejected ${c.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("SQL injection payloads");
    {
      // In a text field
      const c = await api(jar, "POST", "/api/sources", {
        name: SQLI, type: "AGENT", country: "Testland",
      });
      if (c.status >= 500) fail("SQLi in partner name → 500");
      else {
        ok(`SQLi in text field → ${c.status}`);
        if (c.ok || c.status === 201) createdIds.push({ path: "/api/sources", id: idOf(c.payload) });
      }
      // Verify the leads table still exists and is intact
      const leadCount = await db.lead.count();
      expect(leadCount > 0, "leads table intact after SQLi attempt", `count=${leadCount}`);

      // In query params
      const qs = [
        `/api/leads?search=${encodeURIComponent(SQLI)}`,
        `/api/institutions?search=${encodeURIComponent(SQLI)}`,
        `/api/sources?search=${encodeURIComponent(SQLI)}`,
        `/api/leads?stage=${encodeURIComponent("' OR 1=1--")}`,
        `/api/leads?limit=${encodeURIComponent("99999999")}`,
        `/api/leads?page=-1`,
      ];
      for (const q of qs) {
        const r = await api(jar, "GET", q);
        const kind = classify(r.status);
        if (kind === "SERVER_ERROR") fail(`query-param injection ${q.slice(0, 60)} → 500`);
        else ok(`query-param ${q.slice(0, 58)} → ${r.status}`);
      }
      const leadCountAfter = await db.lead.count();
      expect(leadCountAfter === leadCount, "lead count unchanged after all injection attempts");
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Oversized payloads");
    {
      const r = await api(jar, "POST", "/api/sources", {
        name: HUGE, type: "AGENT", country: "Testland",
      });
      const kind = classify(r.status);
      if (kind === "SERVER_ERROR") fail("100KB string → 500");
      else {
        ok(`100KB name → ${r.status} ${kind}`);
        if (kind === "ACCEPTED") {
          createdIds.push({ path: "/api/sources", id: idOf(r.payload) });
          fail("100KB name accepted", "no max-length guard on partner name");
        }
      }

      // Deeply nested object (JSON bomb-lite)
      let nested = { a: 1 };
      for (let i = 0; i < 500; i++) nested = { nested };
      const r2 = await api(jar, "POST", "/api/sources", {
        name: `${TAG}deep`, type: "AGENT", country: "Testland", notes: nested,
      });
      if (classify(r2.status) === "SERVER_ERROR") fail("deeply-nested object → 500");
      else ok(`deeply-nested object → ${r2.status}`);
      if (r2.ok || r2.status === 201) createdIds.push({ path: "/api/sources", id: idOf(r2.payload) });
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Nonexistent / malformed IDs");
    {
      const badIds = [
        "00000000-0000-0000-0000-000000000000",
        "not-a-uuid",
        "../../etc/passwd",
        "%2e%2e%2f",
      ];
      for (const bad of badIds) {
        for (const base of ["/api/leads", "/api/sources", "/api/institutions", "/api/tasks"]) {
          const r = await api(jar, "GET", `${base}/${encodeURIComponent(bad)}`);
          const kind = classify(r.status);
          if (kind === "SERVER_ERROR") {
            fail(`GET ${base}/${bad.slice(0, 20)} → 500`);
          } else if (kind === "ACCEPTED") {
            fail(`GET ${base}/${bad.slice(0, 20)} → 200 for nonexistent id!`);
          } else {
            ok(`GET ${base}/${bad.slice(0, 18)} → ${r.status}`);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Attachment upload guards (H-4 allowlist)");
    {
      const target = await db.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
      if (target) {
        const blocked = [
          ["evil.html", "text/html", "<html><script>alert(1)</script></html>"],
          ["evil.svg", "image/svg+xml", '<svg onload="alert(1)"/>'],
          ["evil.exe", "application/x-msdownload", "MZ\x00\x00"],
          ["evil.js", "text/javascript", "alert(1)"],
          ["evil.php", "application/x-php", "<?php system($_GET[0]); ?>"],
          // MIME spoof: .txt extension but claims to be html
          ["spoof.txt", "text/html", "<script>alert(1)</script>"],
        ];
        for (const [fname, mime, content] of blocked) {
          await sleep(120);
          const fd = new FormData();
          fd.append("file", new Blob([content], { type: mime }), fname);
          const res = await fetch(
            `${BASE}/api/attachments?parentType=LEAD&parentId=${target.id}`,
            { method: "POST", headers: { Cookie: jar.header() }, body: fd }
          );
          if (res.status >= 500) {
            fail(`upload ${fname} → 500`);
          } else if (res.ok) {
            const b = await res.json().catch(() => ({}));
            const aid = b?.data?.id;
            const row = aid ? await db.attachment.findUnique({ where: { id: aid } }) : null;
            if (fname === "spoof.txt") {
              // Accepting is fine IF the stored MIME was canonicalised to text/plain
              if (row?.mimeType === "text/plain") {
                ok(`spoofed MIME canonicalised to ${row.mimeType} (not text/html)`);
              } else {
                fail(`spoofed MIME stored as ${row?.mimeType}`, "should canonicalise from extension");
              }
            } else {
              fail(`dangerous upload ${fname} ACCEPTED`, `stored mime=${row?.mimeType}`);
            }
            if (aid) await db.attachment.delete({ where: { id: aid } }).catch(() => {});
          } else {
            ok(`upload ${fname} blocked → ${res.status}`);
          }
        }

        // Download headers must be hardened
        const fd = new FormData();
        fd.append("file", new Blob([`${TAG} ok`], { type: "text/plain" }), `${TAG}-safe.txt`);
        const up = await fetch(
          `${BASE}/api/attachments?parentType=LEAD&parentId=${target.id}`,
          { method: "POST", headers: { Cookie: jar.header() }, body: fd }
        );
        if (up.ok) {
          const aid = (await up.json()).data.id;
          await sleep(120);
          const dl = await fetch(`${BASE}/api/attachments/${aid}`, { headers: { Cookie: jar.header() } });
          const cd = dl.headers.get("content-disposition") ?? "";
          const nosniff = dl.headers.get("x-content-type-options") ?? "";
          const csp = dl.headers.get("content-security-policy") ?? "";
          expect(cd.includes("attachment"), "download Content-Disposition: attachment", cd);
          expect(nosniff === "nosniff", "download X-Content-Type-Options: nosniff", nosniff);
          expect(csp.includes("sandbox"), "download CSP sandbox present", csp.slice(0, 60));
          await db.attachment.delete({ where: { id: aid } }).catch(() => {});
        }
      }
    }

  } finally {
    process.stdout.write(`\n[cleanup]\n`);
    for (const c of createdIds) {
      if (!c.id) continue;
      await api(jar, "DELETE", `${c.path}/${c.id}`).catch(() => {});
    }
    await db.$executeRawUnsafe(`DELETE FROM sources WHERE name LIKE '%${TAG}%' OR name LIKE '%<script>%' OR name LIKE '%DROP TABLE%' OR length(name) > 5000`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '%${TAG}%'`).catch(() => {});
    await db.deletedRecord.deleteMany({ where: { deletedById: ctx.user.id } }).catch(() => {});
    await destroyUser(ctx);
    process.stdout.write(`[cleanup] done\n`);
  }

  const f = summary();
  process.exit(f > 0 ? 1 : 0);
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); })
  .finally(() => db.$disconnect());

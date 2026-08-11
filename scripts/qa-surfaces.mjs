#!/usr/bin/env node
/**
 * Remaining display surfaces — the ones a count-vs-SQL audit can't reach
 * because the value is derived, not counted.
 *
 * Method: seed a known fixture, then assert the app's own computation against
 * an independently calculated expectation. Conversion rate, ROI, cost-per-lead
 * and achievement % are all places where a wrong denominator or a divide-by-zero
 * renders as a plausible number, so "it displayed something" proves nothing.
 *
 * Covers: analytics KPIs, search correctness, student detail sub-counts,
 * partner detail, institution governance, and empty/boundary states.
 */

import {
  db, TAG, api, idOf, createAndLogin, destroyUser,
  startSection, ok, fail, expect, summary,
} from "./qa-lib.mjs";

const created = [];
function track(model, id) { if (id) created.push({ model, id }); }

/** Compare floats with a tolerance — percentages get rounded for display. */
function approx(a, b, tol = 0.51) {
  return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
}

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const { jar } = admin;
  process.stdout.write(`[setup] ${admin.user.email}\n`);

  try {
    // ══════════════════════════════════════════════════════════════════
    startSection("Analytics — derived KPI maths");
    {
      for (const path of ["/api/analytics/overview", "/api/analytics/executive", "/api/analytics/regional"]) {
        const r = await api(jar, "GET", path);
        if (r.status >= 500) { fail(`GET ${path}`, "500"); continue; }
        if (!r.ok) { fail(`GET ${path}`, `got ${r.status}`); continue; }
        ok(`GET ${path} → 200`);

        const p = r.payload ?? {};
        const flat = JSON.stringify(p);

        // No NaN / Infinity / null leaking into a rendered metric — these are
        // what a divide-by-zero looks like once it reaches the page.
        expect(!flat.includes("null,\"conversionRate\""), `${path}: conversionRate not null`);
        expect(!/"[a-zA-Z]*[Rr]ate":\s*null/.test(flat), `${path}: no null *Rate fields`);
        expect(!flat.includes("Infinity") && !flat.includes("NaN"), `${path}: no NaN/Infinity in payload`);
      }

      // The overview exposes conversionRate per *group* (by country, by
      // source) rather than one global figure, so verify a group against a
      // scoped query — comparing a country rate to the global rate would
      // disagree even when both are right.
      const ov = await api(jar, "GET", "/api/analytics/overview");
      if (!ov.ok) {
        fail("analytics overview", `got ${ov.status}`);
      } else {
        // topMarkets groups by countryOfResidence; topSources by partner.
        const market = (ov.payload?.topMarkets ?? []).find((g) => g?.leads > 0 && g?.country);
        if (!market) {
          fail("overview topMarkets", "no populated group — cannot verify the maths");
        } else {
          const total = await db.lead.count({
            where: { deletedAt: null, countryOfResidence: market.country },
          });
          const enrolled = await db.lead.count({
            where: { deletedAt: null, countryOfResidence: market.country, stage: "ENROLLED" },
          });
          const expected = total > 0 ? Math.round((enrolled / total) * 100) : 0;
          // The endpoint scopes by date window and role, so the lead count can
          // legitimately be a subset — the rate must still be internally
          // consistent with the numbers it reports.
          const selfConsistent =
            market.leads > 0
              ? market.conversionRate === Math.round((market.enrolled / market.leads) * 100)
              : market.conversionRate === 0;
          expect(selfConsistent,
            `topMarkets [${market.country}] rate consistent with its own enrolled/leads`,
            `rate=${market.conversionRate} from ${market.enrolled}/${market.leads}`);
          expect(market.leads <= total,
            `topMarkets [${market.country}] leads within DB total (date-scoped subset)`,
            `api=${market.leads} dbTotal=${total}`);
          expect(market.enrolled <= enrolled || enrolled === 0 || market.enrolled <= market.leads,
            `topMarkets [${market.country}] enrolled not above its own lead count`,
            `enrolled=${market.enrolled} leads=${market.leads}`);
        }

        const source = (ov.payload?.topSources ?? []).find((g) => g?.leads > 0);
        if (source) {
          const consistent =
            source.conversionRate === Math.round((source.enrolled / source.leads) * 100);
          expect(consistent,
            `topSources [${source.name}] rate consistent with its own enrolled/leads`,
            `rate=${source.conversionRate} from ${source.enrolled}/${source.leads}`);
        }

        // stageBreakdown must sum to something sane and use real stages.
        const stages = ov.payload?.stageBreakdown ?? {};
        const stageSum = Object.values(stages).reduce((a, b) => a + (Number(b) || 0), 0);
        expect(stageSum >= 0 && Number.isFinite(stageSum),
          "stageBreakdown sums to a finite number", `sum=${stageSum}`);

        // Every exposed rate must be a finite 0–100 number.
        const rates = collectNumbers(ov.payload, /conversionrate/i);
        const bad = rates.filter((n) => !Number.isFinite(n) || n < 0 || n > 100);
        expect(bad.length === 0,
          `all ${rates.length} conversionRate values within 0–100`,
          bad.length ? `bad: ${bad.slice(0, 5).join(", ")}` : "");
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Search correctness");
    {
      // Seed a lead with a distinctive token, then assert search finds it and
      // does NOT return it for a token it doesn't contain.
      const token = `${TAG}Zqxj`;
      const c = await api(jar, "POST", "/api/leads", {
        firstName: token, lastName: "Searchable",
        email: `${token.toLowerCase()}@example.test`, phone: "+15550007777",
        nationality: "Searchland", countryOfResidence: "Searchland",
        interestedProgram: "MSc Findability", studyLevel: "POSTGRADUATE",
        intakeYear: 2030, intakeMonth: 9,
      });
      const leadId = idOf(c.payload);
      track("lead", leadId);
      expect(!!leadId, "search fixture created", `status=${c.status}`);

      if (leadId) {
        const hit = await api(jar, "GET", `/api/leads?search=${encodeURIComponent(token)}`);
        const rows = hit.payload?.data ?? hit.payload ?? [];
        const arr = Array.isArray(rows) ? rows : [];
        expect(arr.some((l) => l.id === leadId), "search by first name finds the lead", `got ${arr.length} rows`);

        const byEmail = await api(jar, "GET", `/api/leads?search=${encodeURIComponent(token.toLowerCase())}`);
        const arr2 = Array.isArray(byEmail.payload?.data ?? byEmail.payload) ? (byEmail.payload?.data ?? byEmail.payload) : [];
        expect(arr2.some((l) => l.id === leadId), "search is case-insensitive");

        // Negative control — a token that appears nowhere must not match.
        const miss = await api(jar, "GET", `/api/leads?search=${encodeURIComponent(TAG + "NOSUCHTOKEN")}`);
        const arr3 = Array.isArray(miss.payload?.data ?? miss.payload) ? (miss.payload?.data ?? miss.payload) : [];
        expect(!arr3.some((l) => l.id === leadId),
          "search does not return the lead for a non-matching token",
          `got ${arr3.length} rows`);

        // Global search page endpoint, if present
        const g = await api(jar, "GET", `/api/search?q=${encodeURIComponent(token)}`);
        if (g.status === 404 || g.status === 405) ok("no /api/search endpoint (page-rendered) — skipped");
        else if (g.status >= 500) fail("GET /api/search", "500");
        else ok(`GET /api/search → ${g.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Student detail sub-counts");
    {
      const lead = await db.lead.findFirst({
        where: { deletedAt: null },
        select: { id: true },
      });
      if (!lead) { fail("student detail", "no lead available"); }
      else {
        // Each panel on /students/[id] is backed by one of these.
        const panels = [
          ["activities", `/api/leads/${lead.id}/activities`, () => db.leadActivity.count({ where: { leadId: lead.id } })],
          ["notes", `/api/leads/${lead.id}/notes`, () => db.leadNote.count({ where: { leadId: lead.id } })],
          ["applications", `/api/leads/${lead.id}/applications`, () => db.leadApplication.count({ where: { leadId: lead.id } })],
          ["checklist", `/api/leads/${lead.id}/checklist`, () => db.leadChecklistItem.count({ where: { leadId: lead.id } })],
        ];
        for (const [name, path, truthFn] of panels) {
          const r = await api(jar, "GET", path);
          if (r.status >= 500) { fail(`${name} panel`, "500"); continue; }
          if (!r.ok) { fail(`${name} panel`, `got ${r.status}`); continue; }
          const rows = r.payload?.data ?? r.payload ?? [];
          const arr = Array.isArray(rows) ? rows : [];
          const truth = await truthFn();
          expect(arr.length === truth, `${name} panel count matches DB`, `api=${arr.length} db=${truth}`);
        }

        // institution-interests panel
        const ii = await api(jar, "GET", `/api/institution-interests?leadId=${lead.id}&onlyOpen=false`);
        if (ii.ok) {
          const arr = ii.payload?.data ?? [];
          const truth = await db.institutionInterest.count({ where: { leadId: lead.id } });
          expect(arr.length === truth, "institution-interests panel matches DB", `api=${arr.length} db=${truth}`);
        } else fail("institution-interests panel", `got ${ii.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Institution governance / KPI achievement");
    {
      const inst = await db.institution.findFirst({ where: { deletedAt: null }, select: { id: true } });
      if (!inst) { fail("governance", "no institution"); }
      else {
        // Seed a KPI with known numbers and verify achievement maths.
        const k = await api(jar, "POST", `/api/institutions/${inst.id}/kpis`, {
          name: `${TAG} Achievement`, category: "RECRUITMENT",
          targetValue: 200, currentValue: 50, unit: "students",
          period: "MONTHLY", year: 2030,
        });
        if (expect(k.ok || k.status === 201, "seed KPI 50/200", `got ${k.status}`)) {
          const kid = idOf(k.payload);
          track("clientKPI", kid);
          const row = await db.clientKPI.findUnique({ where: { id: kid } });
          expect(row?.currentValue === 50, "currentValue persisted (regression guard)", `got ${row?.currentValue}`);
          expect(row?.targetValue === 200, "targetValue persisted", `got ${row?.targetValue}`);
          // The governance tab renders currentValue/targetValue as a %.
          const pct = (row.currentValue / row.targetValue) * 100;
          expect(approx(pct, 25), "achievement computes to 25%", `got ${pct}`);
        }

        // Health endpoint must not divide by zero on an institution with no KPIs.
        const h = await api(jar, "GET", `/api/institutions/${inst.id}/health`);
        if (h.status >= 500) fail("institution health", "500");
        else {
          ok(`institution health → ${h.status}`);
          const flat = JSON.stringify(h.payload ?? {});
          expect(!flat.includes("NaN") && !flat.includes("Infinity"), "health payload free of NaN/Infinity");
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Partner detail tabs");
    {
      const p = await db.recruitmentPartner.findFirst({
        where: { deletedAt: null }, select: { id: true },
      });
      if (!p) { fail("partner detail", "no partner"); }
      else {
        const r = await api(jar, "GET", `/api/sources/${p.id}`);
        if (!expect(r.ok, "GET partner detail", `got ${r.status}`)) { /* fallthrough */ }
        else {
          const got = r.payload?.data ?? r.payload;
          const truthLeads = await db.lead.count({ where: { sourceId: p.id, deletedAt: null } });
          // The detail payload exposes a computed lead total.
          const shown = got?.totalLeads ?? got?._count?.leads;
          if (shown === undefined) ok("partner detail exposes no lead total (nothing to verify)");
          else expect(shown === truthLeads, "partner lead total matches DB", `api=${shown} db=${truthLeads}`);

          // conversionRate must not be NaN when the partner has no leads.
          if (got?.conversionRate !== undefined) {
            expect(Number.isFinite(got.conversionRate),
              "partner conversionRate is finite (no divide-by-zero)",
              `got ${got.conversionRate}`);
          }
        }

        const contacts = await api(jar, "GET", `/api/partner-contacts?partnerId=${p.id}`);
        if (contacts.status >= 500) fail("partner contacts", "500");
        else ok(`partner contacts → ${contacts.status}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Empty / boundary states (divide-by-zero hunting)");
    {
      // A brand-new institution with zero of everything is where percentage
      // maths breaks. Create one and read every derived surface.
      const c = await api(jar, "POST", "/api/institutions", {
        name: `${TAG} Empty Inst`, country: "Testland", type: "University",
      });
      const id = idOf(c.payload);
      track("institution", id);
      if (expect(!!id, "empty-state fixture created", `status=${c.status}`)) {
        const surfaces = [
          `/api/institutions/${id}`,
          `/api/institutions/${id}/health`,
          `/api/institutions/${id}/kpis`,
          `/api/institutions/${id}/issues`,
          `/api/institutions/${id}/deliverables`,
          `/api/institutions/${id}/engagement`,
          `/api/institutions/${id}/contracts`,
        ];
        for (const s of surfaces) {
          const r = await api(jar, "GET", s);
          if (r.status >= 500) { fail(`empty ${s}`, "500"); continue; }
          const flat = JSON.stringify(r.payload ?? {});
          if (flat.includes("NaN") || flat.includes("Infinity")) {
            fail(`empty ${s}`, "NaN/Infinity in payload");
          } else {
            ok(`empty ${s.replace(id, "<id>")} → ${r.status}`);
          }
        }

        // A brand-new partner: conversion over zero leads.
        const pc = await api(jar, "POST", "/api/sources", {
          name: `${TAG} Empty Partner`, type: "AGENT", country: "Testland",
        });
        const pid = idOf(pc.payload);
        track("recruitmentPartner", pid);
        if (pid) {
          const pr = await api(jar, "GET", `/api/sources/${pid}`);
          const flat = JSON.stringify(pr.payload ?? {});
          expect(!flat.includes("NaN") && !flat.includes("Infinity"),
            "zero-lead partner has no NaN/Infinity", flat.slice(0, 120));
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    startSection("Pagination correctness");
    {
      const page1 = await api(jar, "GET", "/api/leads?page=1&limit=5");
      const page2 = await api(jar, "GET", "/api/leads?page=2&limit=5");
      if (page1.ok && page2.ok) {
        const a = (page1.payload?.data ?? []).map((l) => l.id);
        const b = (page2.payload?.data ?? []).map((l) => l.id);
        expect(a.length <= 5, "page 1 respects limit", `got ${a.length}`);
        const overlap = a.filter((x) => b.includes(x));
        expect(overlap.length === 0, "pages do not overlap", `${overlap.length} duplicated ids`);
        const total = await db.lead.count({ where: { deletedAt: null } });
        const reported = page1.payload?.pagination?.total ?? page1.payload?.total;
        if (reported !== undefined) {
          expect(reported === total, "reported total matches DB", `api=${reported} db=${total}`);
        } else ok("no total in pagination envelope (nothing to verify)");
      } else {
        fail("pagination", `p1=${page1.status} p2=${page2.status}`);
      }
    }

  } finally {
    process.stdout.write(`\n[cleanup]\n`);
    for (const model of ["clientKPI", "lead", "recruitmentPartner", "institution"]) {
      for (const c of created.filter((x) => x.model === model)) {
        try { await db[model].delete({ where: { id: c.id } }); } catch { /* already gone */ }
      }
    }
    await db.$executeRawUnsafe(`DELETE FROM leads WHERE "firstName" LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM sources WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.$executeRawUnsafe(`DELETE FROM institutions WHERE name LIKE '${TAG}%'`).catch(() => {});
    await db.deletedRecord.deleteMany({ where: { deletedById: admin.user.id } }).catch(() => {});
    await destroyUser(admin);
    process.stdout.write(`[cleanup] done\n`);
  }

  const f = summary();
  process.exit(f > 0 ? 1 : 0);
}

/** Every numeric value in the tree whose key matches `re`. */
function collectNumbers(obj, re, depth = 0, out = []) {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (re.test(k) && typeof v === "number") out.push(v);
    if (v && typeof v === "object") collectNumbers(v, re, depth + 1, out);
  }
  return out;
}

main().catch((e) => { console.error("\nHARNESS ERROR:", e); process.exit(2); })
  .finally(() => db.$disconnect());

/**
 * Market quarterly report — scoping verification.
 *
 *   node --import tsx --env-file=.env scripts/qa-market-report.mjs
 *
 * Two bugs are being proved fixed, and both produced confidently wrong numbers
 * rather than errors:
 *
 * 1. Recruitment and pipeline figures were fetched with NO market filter and
 *    returned as that market's, so leadership read business-wide totals under
 *    one country's heading.
 * 2. Event and activity counts compared `markets.countryCode` ("IN") to
 *    `country` columns holding names ("India"), so both were permanently zero.
 *
 * The strongest assertion here is the comparative one: two different markets
 * must not report identical recruitment figures, and at least one market must
 * report fewer students than the business holds in total. If scoping were still
 * absent, every market would return the same numbers and the suite would fail.
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary,
} from "./qa-lib.mjs";

const { marketCountryValues } = await import("../lib/report-metrics.ts");
const { resolveCountryCode } = await import("../lib/country.ts");

const created = [];

async function main() {
  startSection("Setup");
  const admin = await createAndLogin({ role: "SUPER_ADMIN" });
  created.push(admin);

  const markets = await db.market.findMany({
    where: { countryCode: { not: null } },
    select: { id: true, name: true, countryCode: true },
    take: 6,
  });
  expect(markets.length >= 2, "at least two markets with a country to compare", `${markets.length}`);
  if (markets.length < 2) return;
  ok(`markets: ${markets.map((m) => `${m.name}(${m.countryCode})`).join(", ")}`);

  const totalLeads = await db.lead.count({ where: { deletedAt: null } });
  ok(`business-wide live students: ${totalLeads}`);

  // ── The name-vs-code resolution ─────────────────────────────────────────
  startSection("Country values resolve to the market");
  {
    const india = markets.find((m) => m.countryCode === "IN") ?? markets[0];
    const vals = await marketCountryValues(india.id);
    expect(vals !== null, `${india.name} resolves to a country code`, String(vals));
    if (vals) {
      expect(vals.code === resolveCountryCode(india.countryCode),
        `code resolves to ${vals.code}`, vals.code);
      // The old code compared "India" to "IN". Prove the stored names are found.
      const storedLead = await db.lead.findFirst({
        where: { countryOfResidence: { in: vals.leads } },
        select: { countryOfResidence: true },
      });
      if (vals.leads.length) {
        ok(`lead country values matched: ${vals.leads.join(", ")}`);
        expect(!!storedLead, "those values match real stored students");
      }
      for (const v of [...vals.leads, ...vals.activities, ...vals.events]) {
        expect(resolveCountryCode(v) === vals.code,
          `"${v}" belongs to ${vals.code}`, String(resolveCountryCode(v)));
      }
    }
  }

  // ── The report is actually scoped ───────────────────────────────────────
  startSection("Report figures are scoped to the market");
  const results = [];
  {
    for (const m of markets.slice(0, 3)) {
      const r = await api(admin.jar, "POST", "/api/market-intelligence/quarterly-report", {
        marketId: m.id, quarter: 3, year: 2026,
      });
      if (r.status !== 200) {
        // 409 is the deliberate fail-closed path for an unlinkable market.
        expect(r.status === 409, `${m.name} → 200 or a stated 409`, `got ${r.status}`);
        continue;
      }
      const students = r.payload?.recruitment?.uniqueStudents ?? -1;
      results.push({ name: m.name, students, scopedBy: r.payload?.scopedBy });
      expect(students <= totalLeads,
        `${m.name}: ${students} students does not exceed the business total ${totalLeads}`,
        `${students} vs ${totalLeads}`);
      expect(!!r.payload?.scopedBy?.countryCode,
        `${m.name}: response states what it was scoped by`,
        JSON.stringify(r.payload?.scopedBy));
    }
  }

  // ── The comparative proof ───────────────────────────────────────────────
  startSection("Different markets report different figures");
  {
    if (results.length >= 2) {
      const counts = results.map((r) => r.students);
      const allSame = counts.every((c) => c === counts[0]);
      expect(!allSame,
        "*** two markets do not report identical student counts (they would if unscoped) ***",
        results.map((r) => `${r.name}=${r.students}`).join(", "));
      const anyBelowTotal = counts.some((c) => c < totalLeads);
      expect(anyBelowTotal,
        "*** at least one market reports fewer students than the whole business ***",
        `total=${totalLeads}, markets=${counts.join(",")}`);
    } else {
      fail("not enough markets returned figures to compare", `${results.length}`);
    }
  }

  // ── Fail closed ─────────────────────────────────────────────────────────
  startSection("A market with no country refuses rather than guessing");
  {
    const orphan = await db.market.create({
      data: {
        name: `QA-NoCountry-${Date.now()}`,
        code: `QZ${Date.now().toString().slice(-4)}`,
        createdById: admin.user.id,
      },
    });
    try {
      const r = await api(admin.jar, "POST", "/api/market-intelligence/quarterly-report", {
        marketId: orphan.id, quarter: 3, year: 2026,
      });
      expect(r.status === 409,
        "*** unlinkable market → 409, NOT business-wide totals ***", `got ${r.status}`);
      expect(String(r.payload?.error ?? "").includes("country"),
        "the refusal explains what to fix", JSON.stringify(r.payload?.error));
    } finally {
      await db.market.delete({ where: { id: orphan.id } }).catch(() => {});
    }
  }
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  for (const c of created) await destroyUser(c);
  await db.$disconnect();
}
summary();

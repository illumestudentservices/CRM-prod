import { db, createAndLogin, destroyUser, api, Jar, BASE, TAG, startSection, expect, summary } from "./qa-lib.mjs";
import { buildExportPdfHtml } from "@/lib/export-format";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// logActivity is fire-and-forget (the beacon returns before the audit write
// lands), so poll briefly rather than assuming the row is there instantly.
async function findAudit(userId: string, entityId: string) {
  for (let i = 0; i < 12; i++) {
    const row = await db.auditLog.findFirst({ where: { userId, action: "EXPORT", entity: "DataExport", entityId } });
    if (row) return row;
    await sleep(150);
  }
  return null;
}

async function main() {
  // Part A — PDF attribution stamp (escaped).
  startSection("PDF export attribution");
  const withBy = buildExportPdfHtml([{ a: 1 }], [{ key: "a", header: "A" }], "T", `<b>x</b> Jane (j@x.com)`);
  expect(/Exported by/.test(withBy), "PDF includes an 'Exported by' stamp");
  expect(withBy.includes("&lt;b&gt;x&lt;/b&gt; Jane (j@x.com)") && !withBy.includes("<b>x</b> Jane"), "the exporter identity is HTML-escaped");
  const noBy = buildExportPdfHtml([{ a: 1 }], [{ key: "a", header: "A" }], "T");
  expect(!/Exported by/.test(noBy), "no stamp when exporter unknown");

  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  try {
    for (let run = 1; run <= 3; run++) {
      startSection(`export beacon (run ${run})`);
      const dataset = `QA Export ${TAG} ${run}`;
      let r = await api(admin.jar, "POST", "/api/exports/log", { dataset, format: "csv", recordCount: 42 });
      expect(r.ok, "authed export beacon accepted (200)", `got ${r.status}`);
      const row = await findAudit(admin.user.id, dataset);
      expect(!!row, "an EXPORT audit row was written for the dataset", row ? "" : "no row");

      r = await api(new Jar(), "POST", "/api/exports/log", { dataset, format: "csv", recordCount: 1 });
      // Unauthenticated /api/* is bounced by the middleware (307 to /login)
      // before the route's own 401 — either way it is refused, never 2xx.
      expect(r.status === 401 || r.status === 307, "unauthenticated beacon is refused", `got ${r.status}`);

      r = await api(admin.jar, "POST", "/api/exports/log", { dataset });
      expect(r.status === 422, "invalid body is rejected (422)", `got ${r.status}`);
    }
    startSection("bulk export alert");
    {
      const big = await api(admin.jar, "POST", "/api/exports/log", { dataset: `QA Bulk ${TAG}`, format: "csv", recordCount: 1000 });
      expect(big.ok && big.payload?.bulk === true, "large export (1000 rows) flagged bulk", `got ${big.status} ${JSON.stringify(big.payload)}`);
      const bigRow = await findAudit(admin.user.id, `QA Bulk ${TAG}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(!!bigRow && (bigRow.changes as any)?.bulk === true, "audit row records bulk=true", JSON.stringify(bigRow?.changes));
      const small = await api(admin.jar, "POST", "/api/exports/log", { dataset: `QA Small ${TAG}`, format: "csv", recordCount: 5 });
      expect(small.ok && small.payload?.bulk === false, "small export (5 rows) is NOT bulk", `got ${JSON.stringify(small.payload)}`);
    }

    // Rate limit: per-user 120/hr. We already sent 5; push past 120.
    startSection("export beacon rate limit");
    let limited = false;
    for (let i = 0; i < 125; i++) {
      const r = await api(admin.jar, "POST", "/api/exports/log", { dataset: "flood", format: "csv", recordCount: 0 });
      if (r.status === 429) { limited = true; break; }
    }
    expect(limited, "a flood of beacons is eventually rate-limited (429)");
  } finally {
    await db.auditLog.deleteMany({ where: { userId: admin.user.id, action: "EXPORT", entity: "DataExport" } }).catch(() => {});
    await destroyUser(admin);
  }
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : 0);
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });

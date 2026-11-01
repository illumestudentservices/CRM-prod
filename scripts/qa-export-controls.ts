import { db, createAndLogin, destroyUser, api, Jar, BASE, TAG, startSection, expect, summary } from "./qa-lib.mjs";
import { buildExportPdfHtml } from "@/lib/export-format";

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
      const row = await db.auditLog.findFirst({ where: { userId: admin.user.id, action: "EXPORT", entity: "DataExport", entityId: dataset } });
      expect(!!row, "an EXPORT audit row was written for the dataset", row ? "" : "no row");

      r = await api(new Jar(), "POST", "/api/exports/log", { dataset, format: "csv", recordCount: 1 });
      // Unauthenticated /api/* is bounced by the middleware (307 to /login)
      // before the route's own 401 — either way it is refused, never 2xx.
      expect(r.status === 401 || r.status === 307, "unauthenticated beacon is refused", `got ${r.status}`);

      r = await api(admin.jar, "POST", "/api/exports/log", { dataset });
      expect(r.status === 422, "invalid body is rejected (422)", `got ${r.status}`);
    }
    // Rate limit: per-user 120/hr. We already sent 3; push past 120.
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

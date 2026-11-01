import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";
let flagged, normal;
try {
  flagged = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true, extra: { mustChangePassword: true } });
  normal = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  for (let run = 1; run <= 3; run++) {
    startSection(`mustChangePassword API gate (run ${run})`);
    const r = await api(flagged.jar, "GET", "/api/leads");
    expect(r.status === 403, "flagged user is blocked from an API (403)", `got ${r.status}`);
    expect(/password change/i.test(JSON.stringify(r.payload ?? "")), "message says password change required", JSON.stringify(r.payload)?.slice(0,80));
    const n = await api(normal.jar, "GET", "/api/leads");
    expect(n.ok, "a normal user reaches the API (control)", `got ${n.status}`);
  }
} catch (e) { console.error("[fatal]", e?.stack||e); process.exitCode = 1; }
finally { for (const u of [flagged, normal]) if (u) await destroyUser(u); const f = summary(); await db.$disconnect(); process.exit(f?1:(process.exitCode??0)); }

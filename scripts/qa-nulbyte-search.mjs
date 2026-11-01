import { db, createAndLogin, destroyUser, BASE, startSection, expect, summary } from "./qa-lib.mjs";
let admin;
const EPS = ["/api/leads?search=", "/api/institutions?search=", "/api/activity-log?search=", "/api/sources?search="];
try {
  admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const ck = admin.jar.header();
  for (let run = 1; run <= 3; run++) {
    startSection(`nul-byte search no-500 (run ${run})`);
    for (const ep of EPS) {
      const rNul = await fetch(`${BASE}${ep}${encodeURIComponent("\u0000")}`, { headers: { Cookie: ck }, redirect: "manual" });
      expect(rNul.status !== 500, `${ep}<NUL> is not 500`, `got ${rNul.status}`);
      const rOk = await fetch(`${BASE}${ep}test`, { headers: { Cookie: ck }, redirect: "manual" });
      expect(rOk.status >= 200 && rOk.status < 300, `${ep}test still works`, `got ${rOk.status}`);
    }
  }
} catch (e) { console.error("[fatal]", e?.stack||e); process.exitCode = 1; }
finally { if (admin) await destroyUser(admin); const f = summary(); await db.$disconnect(); process.exit(f?1:(process.exitCode??0)); }

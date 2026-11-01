import { BASE, startSection, expect, summary } from "./qa-lib.mjs";
const hit = (ip) => fetch(`${BASE}/api/auth/verify-reset-token?token=nope`, { headers: { "X-Forwarded-For": ip }, redirect: "manual" }).then(r => r.status);
try {
  for (let run = 1; run <= 3; run++) {
    startSection(`verify-reset-token per-IP cap (run ${run})`);
    const ip = `203.0.113.${run}`;          // fresh key per run so counters don't bleed
    let any429 = false;
    for (let i = 1; i <= 40; i++) { if ((await hit(ip)) === 429) any429 = true; }
    expect(!any429, "first 40 requests from one IP are allowed (not 429)");
    const s41 = await hit(ip);
    expect(s41 === 429, "the 41st request from the same IP is blocked (429)", `got ${s41}`);
    const other = await hit(`198.51.100.${run}`);
    expect(other !== 429, "a different IP is unaffected", `got ${other}`);
  }
} catch (e) { console.error("[fatal]", e?.stack||e); process.exitCode = 1; }
finally { const f = summary(); process.exit(f?1:(process.exitCode??0)); }

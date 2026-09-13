/**
 * Every action that changes data must leave an audit row.
 *
 *   node scripts/qa-audit-coverage.mjs
 *
 * Reads the routes off disk rather than calling them: this is about whether the
 * code CAN log, which a request-based check cannot tell you — a handler with no
 * logging call still returns 200.
 *
 * A route counts as covered if it calls `logActivity`, writes `auditLog.create`
 * directly, or delegates to something that does. `trashRecord` is the important
 * one: every deletion in the app goes through it and it now audits centrally, so
 * a route whose only mutation is a delete needs nothing of its own.
 *
 * EXEMPT is explicit and each entry carries its reason. A blanket "skip auth
 * routes" rule would have hidden the forgot-password and MFA paths, which are
 * exactly the ones worth recording.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "app/api";

/**
 * Routes that mutate nothing, or whose mutation is deliberately not an audited
 * business event. Anything added here needs a reason that survives being read
 * back in six months.
 */
const EXEMPT = {
  "assistant/route.ts": "asks the model a question; writes nothing",
  "auth/2fa/disable/route.ts": "a 403 stub — self-service disable is closed off, nothing happens",
  "auth/2fa/generate/route.ts": "returns a QR code for a secret that is not stored until /enable",
  "auth/login-status/route.ts": "read-only probe, deliberately tells an anonymous caller nothing",
  "auth/verify-reset-token/route.ts": "checks a token is valid; the reset itself is audited",
  "leads/find-matches/route.ts": "a search that happens to use POST",
  "recruitment-network/find-duplicates/route.ts": "a search that happens to use POST",
  "market-intelligence/quarterly-report/route.ts": "assembles a report from existing rows",
  "reports/auto-populate/route.ts": "fills a draft from existing data; the submit is audited",
  "notifications/route.ts": "marks a notification read — the user's own UI state, not a business event",
  "hr/announcements/[id]/read/route.ts": "marks an announcement read — same reasoning",
  "whatsapp/webhook/route.ts":
    "inbound from Meta, not a user action — there is no actor to attribute it to, " +
    "and the WhatsAppMessage row it writes IS the record of what arrived",
};

const MUTATING = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/;
const AUDITS = /logActivity|auditLog\.create|auditOrigin/;
/** Deletion is audited inside trashRecord, so calling it is enough. */
const DELEGATES = /trashRecord\s*\(/;
/** Any write that is NOT a delete — those still need their own row. */
const NON_DELETE_WRITE = /\.(create|createMany|update|updateMany|upsert)\s*\(/;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === "route.ts") out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

const files = walk(ROOT).sort();
const covered = [];
const viaTrash = [];
const exempt = [];
const missing = [];

for (const f of files) {
  const rel = f.replace(`${ROOT}/`, "");
  const src = fs.readFileSync(f, "utf8");
  if (!MUTATING.test(src)) continue;

  if (EXEMPT[rel]) { exempt.push(rel); continue; }
  if (AUDITS.test(src)) { covered.push(rel); continue; }

  // Delete-only routes are covered by trashRecord's own audit row.
  if (DELEGATES.test(src) && !NON_DELETE_WRITE.test(src)) { viaTrash.push(rel); continue; }

  missing.push(rel);
}

const total = covered.length + viaTrash.length + exempt.length + missing.length;
const done = covered.length + viaTrash.length + exempt.length;

console.log("\nAUDIT COVERAGE — routes that change data\n");
console.log(`  logs directly          ${covered.length}`);
console.log(`  covered by trashRecord ${viaTrash.length}`);
console.log(`  exempt (with reason)   ${exempt.length}`);
console.log(`  MISSING                ${missing.length}`);
console.log(`  ─────────────────────────────`);
console.log(`  total mutating routes  ${total}   (${Math.round((done / total) * 100)}% covered)\n`);

if (missing.length) {
  console.log("NOT LOGGING ANYTHING:");
  for (const m of missing) console.log(`   ${m}`);
  console.log(
    "\nAdd a logActivity call, or add the route to EXEMPT with the reason it " +
    "is not a business event.\n"
  );
}

process.exit(missing.length ? 1 : 0);

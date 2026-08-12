/**
 * Exhaustive permission sweep: every role against every API handler.
 *
 * Enumerates app/api/**\/route.ts from disk (so it can never drift from the
 * codebase), logs in once per role in PERMISSION_MATRIX, and issues one request
 * per handler per role. ~267 handlers x 11 roles.
 *
 * SAFETY
 *  - Mutating verbs are sent an EMPTY body on purpose. A 400/422 proves the
 *    authorisation gate was passed without performing the side effect; that is
 *    how outbound-email and delete endpoints are probed without consequences.
 *  - Dynamic segments are filled with a token that matches nothing, so no real
 *    record can be read or destroyed.
 *  - /api/auth/* is skipped: probing NextAuth's own handlers would interfere with
 *    the very sessions the sweep depends on. /api/whatsapp/webhook is skipped
 *    because its gate is a Twilio HMAC, not a role.
 *  - Row counts for every table are captured before and after, and any delta is
 *    reported as a failure.
 *
 * ORACLE
 * There is no per-route expectation file, and hand-writing 267 of them would
 * itself be unreviewable. Instead the sweep looks for the shapes that have
 * actually produced holes in this codebase:
 *   OPEN_TO_ALL    every role reached it -> almost certainly an auth-only route
 *   LOW_PRIV_WRITE a mutating verb reachable by EMPLOYEE or INSTITUTION_CLIENT
 *   INVERTED       a low-privilege role is allowed where SUPER_ADMIN is denied
 * Each of the seven holes fixed on 2026-08-12 would have been caught by the
 * first two.
 *
 * Usage:
 *   node --env-file=.env scripts/qa-permission-sweep.mjs
 *   BASE_URL=https://illumestudentservices.cloud ALLOW_PROD_QA=yes-i-mean-it \
 *     node --env-file=.env scripts/qa-permission-sweep.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { BASE, createAndLogin, destroyUser, api, db, sleep } from "./qa-lib.mjs";

const NO_MATCH = "zzz-sweep-no-such-id";
const SKIP = [/^\/api\/auth\//, /^\/api\/whatsapp\/webhook$/];

// ── 1. Enumerate handlers from disk ──────────────────────────────────────────
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry === "route.ts") out.push(p);
  }
  return out;
}

function toUrl(file) {
  const rel = file.split(`app${sep}api${sep}`)[1].replace(`${sep}route.ts`, "");
  const segs = rel.split(sep).map((s) =>
    s.startsWith("[") ? NO_MATCH : s
  );
  return "/api/" + segs.join("/");
}

function handlers() {
  const root = join(process.cwd(), "app", "api");
  const out = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    const url = toUrl(file);
    if (SKIP.some((re) => re.test(url))) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE)\b/g)) {
      out.push({ url, method: m[1] });
    }
  }
  return out.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
}

// ── 2. Row-count snapshot, to prove the sweep wrote nothing ──────────────────
async function snapshot() {
  const rows = await db.$queryRawUnsafe(`
    select table_name, (xpath('/row/cnt/text()', xml_count))[1]::text::int as n
    from (select table_name, query_to_xml(format('select count(*) as cnt from %I.%I', table_schema, table_name), false, true, '') as xml_count
          from information_schema.tables where table_schema='public' and table_type='BASE TABLE') t
  `);
  return Object.fromEntries(rows.map((r) => [r.table_name, Number(r.n)]));
}

// ── 3. Sweep ─────────────────────────────────────────────────────────────────
const DENIED = new Set([401, 403]);

async function request(jar, h) {
  const body = h.method === "GET" || h.method === "DELETE" ? undefined : {};
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await api(jar, h.method, h.url, body);
    if (r.status !== 429) return r.status;
    await sleep(1500 * (attempt + 1)); // nginx limits /api to 10r/s
  }
  return 429;
}

// Roles come from the generated Prisma enum rather than lib/permissions.ts:
// this file runs under plain node, which cannot parse TypeScript, and the enum is
// the same 11 values PERMISSION_MATRIX is keyed by (both derive from schema.prisma).
const { Role } = await import("@prisma/client");
const ALL_ROLES = Object.keys(Role);

const list = handlers();
console.log(`sweep target : ${BASE}`);
console.log(`handlers     : ${list.length}`);
console.log(`roles        : ${ALL_ROLES.length}`);
console.log(`requests     : ${list.length * ALL_ROLES.length}\n`);

const before = await snapshot();
const ctxs = {};
const results = {}; // url|method -> { role: status }

try {
  for (const role of ALL_ROLES) {
    ctxs[role] = await createAndLogin({ role, withEmployee: true });
    let denied = 0, allowed = 0, errored = 0;
    for (const h of list) {
      const key = `${h.method} ${h.url}`;
      const status = await request(ctxs[role].jar, h);
      (results[key] ??= {})[role] = status;
      if (DENIED.has(status)) denied++;
      else if (status >= 500) errored++;
      else allowed++;
    }
    console.log(`${role.padEnd(19)} allowed=${String(allowed).padStart(3)} denied=${String(denied).padStart(3)} 5xx=${String(errored).padStart(3)}`);
  }
} finally {
  for (const c of Object.values(ctxs)) await destroyUser(c);
}

// ── 4. Anomalies ─────────────────────────────────────────────────────────────
const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const LOW_PRIV = ["EMPLOYEE", "INSTITUTION_CLIENT"];
const openToAll = [], lowPrivWrite = [], inverted = [], serverErrors = [];

for (const [key, byRole] of Object.entries(results)) {
  const [method] = key.split(" ");
  const roles = Object.keys(byRole);
  const reached = roles.filter((r) => !DENIED.has(byRole[r]));
  if (reached.length === roles.length) openToAll.push(key);
  const lp = LOW_PRIV.filter((r) => byRole[r] !== undefined && !DENIED.has(byRole[r]));
  if (MUTATING.has(method) && lp.length) lowPrivWrite.push(`${key}  [${lp.join(",")}]`);
  if (DENIED.has(byRole.SUPER_ADMIN) && lp.length) inverted.push(`${key}  SA=${byRole.SUPER_ADMIN} but [${lp.join(",")}] reached`);
  const e5 = roles.filter((r) => byRole[r] >= 500);
  if (e5.length) serverErrors.push(`${key}  5xx for [${e5.join(",")}]`);
}

const after = await snapshot();
const drift = Object.keys(after)
  .filter((t) => (before[t] ?? 0) !== after[t])
  .map((t) => `${t}: ${before[t] ?? 0} -> ${after[t]}`);

function section(title, items, note) {
  console.log(`\n── ${title} (${items.length}) ──`);
  if (note && items.length) console.log(`   ${note}`);
  items.slice(0, 60).forEach((i) => console.log("   " + i));
  if (items.length > 60) console.log(`   … ${items.length - 60} more`);
}

section("OPEN TO ALL ROLES", openToAll, "reached by every role — review each for an auth-only gate");
section("MUTATING, REACHABLE BY LOW-PRIVILEGE ROLE", lowPrivWrite);
section("INVERTED (low priv allowed where SUPER_ADMIN denied)", inverted);
section("SERVER ERRORS (5xx)", serverErrors, "not authorisation faults, but each is a bug");
console.log(`\n── WRITE CHECK ──`);
console.log(drift.length ? "   ROW COUNTS CHANGED:\n   " + drift.join("\n   ") : "   no table changed — sweep performed no writes");

console.log(`\n==== ${Object.keys(results).length} handlers x ${ALL_ROLES.length} roles = ${Object.keys(results).length * ALL_ROLES.length} checks ====`);
await db.$disconnect();
process.exit(0);

#!/usr/bin/env node
/**
 * Static audit of recycle-bin coverage.
 *
 * The integrity test proves the bin can hold and return a record. It cannot
 * prove that every delete route actually *uses* it — and two did not:
 * `settings/regions` called `db.region.delete()` on an entity that was already
 * registered, and the lead checklist deleted a student's document requirement
 * outright. Both looked fine in review; only enumerating the handlers found
 * them.
 *
 * Three checks:
 *
 *   1. every DELETE handler under app/api routes through trashRecord
 *   2. every registry label reads a field that exists on that model
 *   3. every registry delegate maps to a real model
 *
 * (2) matters more than it looks. The label is the only thing identifying an
 * entry in the bin, so a wrong field name renders "undefined" and the deletion
 * becomes unfindable — the record is technically recoverable and practically
 * lost. Two of the 34 entries had this.
 *
 * Run: node scripts/audit-recycle-coverage.mjs
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const problems = [];

/**
 * DELETE handlers that legitimately bypass the bin.
 *
 * Auth material must be irrecoverable by design — a restorable session token
 * or password-reset link is a security hole, not a feature. The bin's own
 * routes obviously cannot recurse into it.
 */
const EXEMPT = new Map([
  ["recycle-bin/[id]/route.ts", "the bin's own restore/purge endpoints"],
  ["auth/sessions/route.ts", "revoking a session must not be undoable"],
  // DELETE here means "un-close this lead" — it clears the closure and moves
  // the student back into the pipeline. Nothing is destroyed.
  ["leads/[id]/close/route.ts", "reopens a closed lead; destroys nothing"],
]);

/**
 * Registry keys that intentionally name a surface rather than a table, so the
 * bin can say where something was deleted from. The delegate still has to
 * resolve — `HRTask` previously pointed at a `hRTask` model that does not
 * exist, so every HR task deletion threw.
 */
const ALIASES = new Map([["HRTask", "Task"]]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name === "route.ts") out.push(full);
  }
  return out;
}

// ── 1. Every DELETE handler goes through the bin ──────────────────────────
for (const file of walk(path.join(ROOT, "app", "api"))) {
  const src = fs.readFileSync(file, "utf8");
  const start = src.search(/export async function DELETE\b/);
  if (start === -1) continue;

  const rel = path.relative(path.join(ROOT, "app", "api"), file).split(path.sep).join("/");
  if (EXEMPT.has(rel)) continue;

  // The handler body runs to the next top-level export, or EOF.
  const rest = src.slice(start);
  const next = rest.slice(1).search(/\nexport (async )?function /);
  const body = next === -1 ? rest : rest.slice(0, next + 1);

  if (/trashRecord\s*\(/.test(body)) continue;

  // A soft-delete written inline is acceptable as long as something records it;
  // report it separately so the two cases aren't conflated.
  const raw = body.match(/db\.(\w+)\.(delete|deleteMany)\s*\(/);
  problems.push(
    raw
      ? `DELETE ${rel} calls db.${raw[1]}.${raw[2]}() directly — bypasses the recycle bin`
      : `DELETE ${rel} does not call trashRecord and has no obvious delete — check by hand`
  );
}

// ── 2 & 3. Registry labels and delegates resolve ──────────────────────────
const schema = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const fields = {};
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
  fields[m[1]] = new Set([...m[2].matchAll(/^\s{2}(\w+)\s+\S/gm)].map((x) => x[1]));
}

const rb = fs.readFileSync(path.join(ROOT, "lib", "recycle-bin.ts"), "utf8");

/**
 * Brace-match each `Key: { … }` in the registry. A regex alternation over
 * one-line and multi-line forms only found 12 of the 34 entries, which meant
 * the audit quietly passed over two thirds of the registry — the same shape of
 * false negative the dark-mode scanner had.
 */
function registryEntries(src) {
  const start = src.search(/const REGISTRY[^=]*=\s*\{/);
  if (start === -1) return [];
  const open = src.indexOf("{", start);
  const out = [];
  let i = open + 1, depth = 0, keyName = null, bodyStart = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (depth === 0) {
      const m = /^\s*(\w+)\s*:\s*\{/.exec(src.slice(i, i + 80));
      if (m) {
        keyName = m[1];
        i += m[0].length - 1;
        bodyStart = i + 1;
        depth = 1;
        continue;
      }
      if (ch === "}") break; // end of REGISTRY
    } else {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) out.push([null, keyName, src.slice(bodyStart, i)]);
      }
    }
  }
  return out;
}

const entries = registryEntries(rb);

let checked = 0;
for (const e of entries) {
  const key = e[1];
  const body = e[2] ?? "";
  const name = ALIASES.get(key) ?? key;
  if (!fields[name]) {
    // Not a Prisma model name — either an unlisted alias or a typo.
    if (/delegate:/.test(body)) problems.push(`registry entry "${key}" is not a model in schema.prisma`);
    continue;
  }
  checked++;

  // The delegate is the camelCased model name; a mismatch means db[delegate]
  // is undefined and trashRecord throws at the point of deletion.
  const delegateName = body.match(/delegate:\s*"(\w+)"/)?.[1];
  const expected = name[0].toLowerCase() + name.slice(1);
  if (delegateName && delegateName !== expected && !ALIASES.has(key)) {
    problems.push(`registry "${key}" delegate is "${delegateName}"; model ${name} maps to db.${expected}`);
  }

  const label = body.match(/label:\s*\(r\)\s*=>([^\n]*)/);
  if (!label) { problems.push(`registry "${name}" has no label`); continue; }
  for (const ref of label[1].matchAll(/r\??\.(\w+)/g)) {
    if (!fields[name].has(ref[1])) {
      problems.push(`registry "${name}" label reads .${ref[1]}, which is not a field on that model`);
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────
process.stdout.write(`\nRecycle-bin coverage audit\n${"─".repeat(60)}\n`);
process.stdout.write(`  registry entries checked   ${checked}\n`);
process.stdout.write(`  DELETE handlers exempted   ${EXEMPT.size}\n`);
process.stdout.write(`  problems                   ${problems.length}\n`);

if (problems.length) {
  process.stdout.write(`\n`);
  for (const p of problems) process.stdout.write(`  · ${p}\n`);
  process.stdout.write(`\n`);
  process.exit(1);
}
process.stdout.write(`\nEvery delete path routes through the recycle bin.\n\n`);

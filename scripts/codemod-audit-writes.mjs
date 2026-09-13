/**
 * Adds the missing audit calls to routes that change data.
 *
 *   node scripts/codemod-audit-writes.mjs          # dry run
 *   node scripts/codemod-audit-writes.mjs --write
 *
 * `qa-audit-coverage.mjs` found 80 routes that write to the database and log
 * nothing. Most share one shape:
 *
 *     const thing = await db.model.create({ ... });
 *
 * so the call can be placed straight after the statement it is about. The end
 * of that statement is found by MATCHING PARENTHESES, not by looking for the
 * next `);` — several of these span forty lines and contain nested calls, and a
 * line-based guess would insert into the middle of one.
 *
 * It only touches writes whose result lands in a variable, because the audit row
 * needs the id. Bare `await db.x.update(...)` calls and anything inside a
 * `$transaction` are left alone and reported, to be done by hand where the
 * right entity and id are a judgement call rather than a pattern.
 */
import fs from "node:fs";
import path from "node:path";

const WRITE = process.argv.includes("--write");
const ROOT = "app/api";

/** prisma delegate → the entity name an audit row should carry. */
function entityName(model) {
  const special = { iTAsset: "ITAsset", iCRTransition: "ICRTransition" };
  if (special[model]) return special[model];
  return model.charAt(0).toUpperCase() + model.slice(1);
}

const ACTION = { create: "CREATE", createMany: "CREATE", update: "UPDATE", updateMany: "UPDATE", upsert: "UPSERT" };

/** Index just past the `)` that closes the call opening at `openIdx`. */
function matchParen(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i + 1;
    } else if (c === '"' || c === "'" || c === "`") {
      // Skip string literals — a paren inside one must not move the depth.
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
    }
  }
  return -1;
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name === "route.ts") out.push(p.replace(/\\/g, "/"));
  }
  return out;
}

const MUTATING = /export\s+async\s+function\s+(POST|PATCH|PUT|DELETE)\b/;
const AUDITS = /logActivity|auditLog\.create|auditOrigin/;

let changedFiles = 0;
let inserted = 0;
const manual = [];

for (const file of walk(ROOT).sort()) {
  let src = fs.readFileSync(file, "utf8");
  const rel = file.replace(`${ROOT}/`, "");
  if (!MUTATING.test(src) || AUDITS.test(src)) continue;

  // Which user to attribute to. Anything else is a judgement call.
  // Most of these never assign the id to a variable — they read
  // `session.user.role` and nothing else — so requiring the literal
  // `session.user.id` to already appear rejected two thirds of them for no
  // reason. A handler with `const session = await auth()` and its null guard
  // can always say `session.user.id`.
  const uid = /const\s+userId\s*=/.test(src)
    ? "userId"
    : /session\.user\.id/.test(src)
    ? "session.user.id"
    : /const\s+session\s*=\s*await\s+auth\(\)/.test(src)
    ? "session.user.id"
    : null;
  if (!uid) { manual.push(`${rel} — no obvious user id`); continue; }

  // `db.` only: a `tx.` write is inside a transaction, where a fire-and-forget
  // audit call would sit in the wrong place.
  const re = /const\s+(\w+)\s*=\s*await\s+db\.(\w+)\.(create|update|upsert)\s*\(/g;
  const hits = [...src.matchAll(re)];
  if (!hits.length) { manual.push(`${rel} — no assigned db write`); continue; }

  // Back to front, so earlier offsets stay valid.
  let localInserts = 0;
  for (const m of hits.reverse()) {
    const [, varName, model, verb] = m;
    const openIdx = src.indexOf("(", m.index + m[0].length - 1);
    const end = matchParen(src, openIdx);
    if (end < 0) continue;
    const after = src.slice(end).match(/^\s*;/);
    if (!after) continue;
    const insertAt = end + after[0].length;

    const indent = (src.slice(0, m.index).match(/\n([ \t]*)$/) ?? [, "    "])[1];
    const call =
      `\n${indent}void logActivity(${uid}, "${ACTION[verb]}", "${entityName(model)}", ` +
      `${varName}.id, { route: "${rel.replace(/\/route\.ts$/, "")}" });`;

    src = src.slice(0, insertAt) + call + src.slice(insertAt);
    localInserts++;
  }
  if (!localInserts) { manual.push(`${rel} — could not place a call`); continue; }

  if (!/from "@\/lib\/activity-logger"/.test(src)) {
    // Insert after the LAST import line.
    //
    // The first attempt used /(^import .*?;\n)/s — and the `s` flag makes `.`
    // match newlines, so `.*?` ran past the first import to a later one and
    // dropped the new import into the middle of the file. Every touched file
    // then failed with "An import declaration can only be used at the top level
    // of a module". Match import lines individually instead.
    // Track where each import STATEMENT ends, not where a line begins. Several
    // of these files have a multi-line `import {` ... `} from "..."`, and
    // inserting after its first line lands inside the braces and breaks the
    // file — which is exactly what the previous attempt did.
    const lines = src.split("\n");
    let endOfLastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!/^import\s/.test(lines[i])) {
        // First real statement: stop, so a dynamic `await import(...)` further
        // down is never mistaken for an import line.
        if (/^(export|const|let|function|async|\/\*\*)/.test(lines[i]) && endOfLastImport >= 0) break;
        continue;
      }
      // Single-line import, or scan forward to the line that closes it.
      let j = i;
      while (j < lines.length && !/from\s+["'].*["'];?\s*$/.test(lines[j]) && !/^import\s+["']/.test(lines[j])) j++;
      endOfLastImport = j;
      i = j;
    }
    if (endOfLastImport < 0) { manual.push(`${rel} — no import block to extend`); continue; }
    lines.splice(endOfLastImport + 1, 0, `import { logActivity } from "@/lib/activity-logger";`);
    src = lines.join("\n");
  }

  inserted += localInserts;
  changedFiles++;
  if (WRITE) fs.writeFileSync(file, src, "utf8");
}

console.log(`\n${WRITE ? "WROTE" : "DRY RUN"}`);
console.log(`  files changed  ${changedFiles}`);
console.log(`  calls inserted ${inserted}`);
console.log(`  needs a human  ${manual.length}\n`);
for (const m of manual) console.log(`   ${m}`);

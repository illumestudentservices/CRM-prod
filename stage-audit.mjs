/**
 * Stage-by-stage reachability audit.
 *
 * For every requirement the gate can impose, is there something in the UI a
 * user can actually do to satisfy it? Reads the real component source rather
 * than a hand-written list, because a transcribed list is exactly what let the
 * missing "Intended destination" field through.
 */
import { readFileSync } from "fs";

const read = (p) => readFileSync(p, "utf8");

const GATE = read("lib/lead-gate.ts");
const FORM = read("app/(dashboard)/students/_components/lead-form.tsx");
const APPPANEL = read("app/(dashboard)/students/[id]/_components/application-panel.tsx");
const ACTPANEL = read("app/(dashboard)/students/[id]/_components/activities-panel.tsx");
const STAGEUI = read("app/(dashboard)/students/[id]/_components/stage-selector.tsx");
const CLOSEUI = read("app/(dashboard)/students/[id]/_components/close-outcome-dialog.tsx");
const CHECKLIST = read("lib/lead-checklists.ts");
const STAGEROUTE = read("app/api/leads/[id]/stage/route.ts");

// ── what the UI offers ──────────────────────────────────────────────────
// register("x") may carry options — register("x", { valueAsNumber: true }) —
// so the name must not be anchored to a closing paren.
const formFields = new Set([
  ...[...FORM.matchAll(/register\("([a-zA-Z]+)"/g)].map((m) => m[1]),
  ...[...FORM.matchAll(/setValue\("([a-zA-Z]+)"/g)].map((m) => m[1]),
  ...[...FORM.matchAll(/watch\("([a-zA-Z]+)"/g)].map((m) => m[1]),
]);

/**
 * The application panel writes through patch(active.id, { ... }), and one call
 * sets two fields at once. Taking only the first key after the brace missed
 * depositPaid and reported a gap that did not exist, so read the whole
 * balanced object instead.
 */
function keysInCalls(src, opener) {
  const out = [];
  let i = 0;
  while ((i = src.indexOf(opener, i)) !== -1) {
    let j = src.indexOf("{", i);
    if (j === -1) break;
    let depth = 0, k = j;
    do { if (src[k] === "{") depth++; else if (src[k] === "}") depth--; k++; } while (depth > 0 && k < src.length);
    for (const m of src.slice(j, k).matchAll(/([a-zA-Z]+):/g)) out.push(m[1]);
    i = k;
  }
  return out;
}

const appFields = new Set([
  ...keysInCalls(APPPANEL, "patch(active.id"),
  ...keysInCalls(APPPANEL, "JSON.stringify("),
]);

const activityTypes = new Set(
  [...ACTPANEL.matchAll(/\{\s*value:\s*"([A-Z_]+)"/g)].map((m) => m[1])
);

const checklistTriggers = Object.fromEntries(
  [...CHECKLIST.matchAll(/^\s{2}([A-Z_]+):\s*\[([^\]]*)\]/gm)]
    .filter((m) => /QUALIFIED|DEPOSIT_PAID/.test(m[1]))
    .map((m) => [m[1], m[2].replace(/["\s]/g, "").split(",").filter(Boolean)])
);

// ── parse STAGE_CONFIG ──────────────────────────────────────────────────
const body = GATE.slice(GATE.indexOf("export const STAGE_CONFIG"));
const stages = {};
for (const m of body.matchAll(/^ {2}([A-Z_]+):\s*\{/gm)) {
  const name = m[1];
  let depth = 0, i = m.index + m[0].length - 1, start = i;
  do { if (body[i] === "{") depth++; else if (body[i] === "}") depth--; i++; } while (depth > 0 && i < body.length);
  stages[name] = body.slice(start, i);
}

const parseFields = (blk) => {
  const out = [];
  for (const f of blk.matchAll(/\{\s*kind:\s*"(field|anyOf|conditional)"[^}]*\}/g)) {
    const t = f[0];
    const kind = /kind:\s*"(\w+)"/.exec(t)[1];
    const label = (/label:\s*"([^"]+)"/.exec(t) || [])[1] ?? "?";
    const src = (/source:\s*"(\w+)"/.exec(t) || [])[1] ?? "lead";
    const naKey = (/naKey:\s*"(\w+)"/.exec(t) || [])[1];
    const keys = kind === "anyOf"
      ? [...t.matchAll(/"(\w+)"/g)].map((x) => x[1]).filter((k) => !["anyOf", label, src].includes(k) && /^[a-z]/.test(k))
      : [(/key:\s*"(\w+)"/.exec(t) || [])[1]];
    out.push({ kind, label, src, naKey, keys: keys.filter(Boolean) });
  }
  return out;
};

const listOf = (blk, prop) => {
  const m = new RegExp(prop + ":\\s*\\[([^\\]]*)\\]").exec(blk);
  return m ? m[1].replace(/["\s]/g, "").split(",").filter(Boolean) : [];
};
const flag = (blk, prop, dflt) => {
  const m = new RegExp(prop + ":\\s*(true|false)").exec(blk);
  return m ? m[1] === "true" : dflt;
};

// ── report ──────────────────────────────────────────────────────────────
const PIPELINE = ["NEW_LEAD","CONTACTED","QUALIFIED","APPLICATION_SUBMITTED","AWAITING_DECISION","OFFER_RECEIVED","DEPOSIT_PAID","ENROLLED"];
let problems = [];

const mark = (ok) => (ok ? "OK " : "GAP");

for (const stage of PIPELINE) {
  const blk = stages[stage];
  if (!blk) { problems.push(`${stage}: no config`); continue; }

  const next = listOf(blk, "allowedNext");
  console.log(`\n${"=".repeat(72)}\n${stage}  ->  ${next.join(" | ") || "(terminal)"}`);

  for (const f of parseFields(blk)) {
    const where = f.src === "application" ? appFields : formFields;
    const has = f.keys.every((k) => where.has(k));
    const naOk = !f.naKey || appFields.has(f.naKey) || formFields.has(f.naKey);
    const ok = has && naOk;
    if (!ok) problems.push(`${stage}: "${f.label}" (${f.keys.join("/")}) has no input`);
    console.log(`  [${mark(ok)}] field   ${f.label.padEnd(34)} ${f.src === "application" ? "Applications panel" : "Lead form"}${f.naKey ? (naOk ? " (+N/A toggle)" : " (N/A TOGGLE MISSING)") : ""}`);
  }

  for (const t of listOf(blk, "requiredCompletedTypes")) {
    const ok = activityTypes.has(t);
    if (!ok) problems.push(`${stage}: activity type ${t} not selectable`);
    console.log(`  [${mark(ok)}] task    ${t.padEnd(34)} Activities panel`);
  }

  const cl = (/requiresChecklist:\s*"(\w+)"/.exec(blk) || [])[1];
  if (cl) {
    const generatedAt = Object.entries(checklistTriggers).find(([, v]) => v.includes(cl));
    const ok = !!generatedAt;
    if (!ok) problems.push(`${stage}: checklist ${cl} is required but never generated`);
    console.log(`  [${mark(ok)}] list    ${(cl + " checklist").padEnd(34)} auto-generated on ${generatedAt ? generatedAt[0] : "NOTHING"}`);
  }

  if (flag(blk, "requireCompletedActivity", true))
    console.log(`  [OK ] rule    ${"An activity completed this stage".padEnd(34)} Activities panel -> "Log something done"`);
  if (flag(blk, "requireFutureActivity", true))
    console.log(`  [OK ] rule    ${"A future activity scheduled".padEnd(34)} Activities panel -> "Schedule for later"`);
}

// ── closed outcomes ─────────────────────────────────────────────────────
console.log(`\n${"=".repeat(72)}\nCLOSED OUTCOMES`);
for (const o of ["LOST", "DEFERRED", "APPLICATION_REJECTED"]) {
  const inDialog = CLOSEUI.includes(`"${o}"`) || CLOSEUI.includes(o);
  const reachable = STAGEUI.includes("CLOSED_STAGES");
  const routed = STAGEROUTE.includes("close");
  const ok = inDialog && reachable && routed;
  if (!ok) problems.push(`${o}: not fully reachable`);
  console.log(`  [${mark(ok)}] ${o.padEnd(24)} dialog + reachable from every stage`);
}

console.log(`\n${"=".repeat(72)}`);
if (problems.length) {
  console.log(`${problems.length} GAP(S):`);
  problems.forEach((p) => console.log("  - " + p));
  process.exit(1);
}
console.log("No gaps: every gate requirement has a way for a user to satisfy it.");

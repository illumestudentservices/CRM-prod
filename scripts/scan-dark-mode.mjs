#!/usr/bin/env node
/**
 * Dark-mode gap scanner.
 *
 * Dark mode here is class-based (`@custom-variant dark`), so anything that
 * sets a colour without a `dark:` counterpart keeps its light value on a dark
 * background. That is invisible in code review and only shows up as a white
 * card or unreadable text once you switch themes.
 *
 * Three classes of finding, roughly in order of how bad they look:
 *
 *   TEXT    a dark text colour with no dark: variant → near-black on near-black
 *   SURFACE a light bg with no dark: variant         → white patch
 *   BORDER  a light border with no dark: variant     → bright outline
 *   LITERAL a hex colour in an inline style or SVG   → never adapts at all
 *
 * The checks are per-`className`, not per-file: a file can legitimately
 * contain `bg-white` in one element and `dark:bg-slate-900` in another, and
 * only looking at the same attribute catches real mismatches.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ONLY = process.argv.includes("--summary") ? "summary" : "full";

// Light-valued utilities that need a dark counterpart of the same property.
//
// The trailing `(?![/\d])` matters: `bg-white/5` is a translucent overlay,
// almost always sitting on a brand gradient or an already-dark panel, and is
// correct in both themes. Without the guard `/` counted as a word boundary and
// every one of those decorative blurs was reported.
const LIGHT_BG = /\b(?:bg-white|bg-slate-(?:50|100|200)|bg-gray-(?:50|100|200)|bg-zinc-(?:50|100|200)|bg-neutral-(?:50|100|200))\b(?![/\d])/;

// Dark text is the readability problem; light text on light bg is a separate
// (rarer) issue we don't chase here.
const DARK_TEXT = /\b(?:text-(?:slate|gray|zinc|neutral)-(?:700|800|900)|text-black)\b(?![/\d])/;

// The brand navy is a background colour that reads 11.5:1 on white and 1.55:1
// on slate-900. As a *label* it therefore needs a dark counterpart, even though
// the literal-hex check below deliberately exempts it as a fill.
const BRAND_TEXT = /\btext-\[#1[eE]3[aA]5[fF]\]/;

const LIGHT_BORDER = /\bborder-(?:slate|gray|zinc|neutral)-(?:100|200|300)\b(?![/\d])/;

// Divide/ring/shadow utilities have the same problem and are easy to miss.
const LIGHT_DIVIDE = /\bdivide-(?:slate|gray|zinc)-(?:100|200)\b/;

/**
 * A dark counterpart may carry further modifiers between `dark:` and the
 * property — `dark:focus:bg-slate-800`, `dark:group-hover:text-slate-100`.
 * Matching a bare `dark:bg-` missed all of those and reported the shadcn
 * primitives, which are in fact correct.
 */
function hasDarkVariant(value, property) {
  // Modifiers between `dark:` and the property may be bracketed —
  // `dark:[&_tr]:border-…`, `dark:data-[state=on]:bg-…`. Restricting this to
  // `[a-z0-9-]+:` reported the shadcn primitives, which are in fact correct.
  return new RegExp(String.raw`\bdark:(?:[^\s"']+:)*${property}-`).test(value);
}

/**
 * Escape hatch for surfaces that are meant to stay light in both themes —
 * the white tile the logo sits on, for instance. Put `dark-ok` in a comment
 * on the same line or the line above.
 */
function isSuppressed(lines, lineNo) {
  const here = lines[lineNo - 1] ?? "";
  const above = lines[lineNo - 2] ?? "";
  return /dark-ok/.test(here) || /dark-ok/.test(above);
}

/**
 * Surfaces that are dark in *both* themes, so a `dark:` counterpart is
 * meaningless there. The (auth) route group renders on a fixed #04080F
 * background (see app/(auth)/layout.tsx) and the MFA overlay paints its own
 * dark gradient — light values in those files are the correct choice, not an
 * omission. Flagging them buried the real findings.
 */
const ALWAYS_DARK = [
  path.join("app", "(auth)"),
  path.join("components", "shared", "mfa-unlock-overlay.tsx"),
  path.join("components", "shared", "welcome-overlay.tsx"),
  path.join("app", "change-password"),
  path.join("app", "reset-password"),
];

function isAlwaysDark(rel) {
  return ALWAYS_DARK.some((p) => rel.startsWith(p) || rel === p);
}

/**
 * Email bodies and generated PDFs, which are always light documents.
 *
 * These build HTML strings rather than render components — there is no `dark`
 * class on an email client's document, and Tailwind variants would not survive
 * inlining anyway. Their light values are the only correct choice.
 */
const ALWAYS_LIGHT = [
  path.join("lib", "email.ts"),
  path.join("lib", "pdf-generator.ts"),
  path.join("app", "api", "email"),
  path.join("app", "api", "reports", "[id]", "pdf"),
];

function isAlwaysLight(rel) {
  return ALWAYS_LIGHT.some((p) => rel.startsWith(p) || rel === p);
}

const findings = [];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    // `.ts` as well as `.tsx`: the shared class maps live in plain modules.
    // `lib/lead-pipeline.ts` holds STAGE_BADGE_CLASSES, which every lead stage
    // chip in the app renders from — the largest single gap in the theme, and
    // invisible to a scan restricted to components.
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Pull out every className value, including the multi-line and cn(...) forms
 * the codebase uses. Returns { value, line } pairs.
 */
function classAttributes(src) {
  const out = [];
  // className="..." | className={"..."} | className={cn("...", "...")} |
  // className={`...`}  — capture the whole attribute up to the balancing quote
  // or brace, then keep only the string literals inside it.
  const attrRe = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\}(?=\s|\/?>))/g;
  let m;
  while ((m = attrRe.exec(src)) !== null) {
    const raw = m[1] ?? m[2] ?? m[3] ?? "";
    // Inside a braced expression, only string literals carry classes.
    const literals = m[3]
      ? [...m[3].matchAll(/["'`]([^"'`]*)["'`]/g)].map((x) => x[1]).join(" ")
      : raw;
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ value: literals, line });
  }
  return out;
}

/**
 * Class lists that never appear in a `className=` attribute.
 *
 * The shadcn primitives declare their colours in a `cva()` variant map, and the
 * app keeps status/badge palettes in plain lookup objects. Both are ordinary
 * string literals, so scoping the scan to `className=` skipped them entirely —
 * which is how the Button's `outline`, `secondary` and `ghost` variants shipped
 * with no dark counterpart at all. The outline label measured 1.55:1.
 *
 * Heuristic: any string literal holding two or more Tailwind-shaped tokens,
 * at least one of which sets a colour. That over-matches a little (a stray
 * doc-comment example would qualify), which is the right way to be wrong here.
 */
const COLOUR_TOKEN = /\b(?:bg|text|border|divide|ring|from|via|to)-(?:\[#[0-9a-fA-F]{3,8}\]|[a-z]+-\d{2,3}|white|black)/;

function classLikeStrings(src) {
  const groups = [];
  const re = /(["'`])((?:[^"'`\\\n]|\\.){8,})\1/g;
  let m, prevEnd = -1;
  while ((m = re.exec(src)) !== null) {
    const value = m[2];
    const line = src.slice(0, m.index).split("\n").length;

    // The primitives write `cn("… bg-white …", "… dark:bg-slate-900 …")`, so a
    // literal is only half the element's class list. Anything separated from
    // the previous literal by nothing but a comma and whitespace belongs to the
    // same argument list and must be judged together — otherwise every
    // correctly-paired shadcn component reports as a gap.
    const gap = prevEnd >= 0 ? src.slice(prevEnd, m.index) : null;
    const contiguous = gap !== null && /^[\s,]*$/.test(gap);
    prevEnd = re.lastIndex;

    if (contiguous && groups.length) {
      groups[groups.length - 1].value += ` ${value}`;
      continue;
    }
    groups.push({ value, line });
  }

  return groups.filter(({ value }) => {
    if (!COLOUR_TOKEN.test(value)) return false;
    // Look like a class list rather than prose.
    const tokens = value.trim().split(/\s+/);
    if (tokens.length < 2) return false;
    if (/[.;?!]/.test(value)) return false;
    const utility = tokens.filter((t) => /^[a-z[]/.test(t) && /[-:[]/.test(t)).length;
    return utility / tokens.length >= 0.8;
  });
}

/** Hex colours inside inline style props or SVG paint attributes. */
function literalColours(src) {
  const out = [];
  const patterns = [
    // style={{ ... "#fff" ... }}
    { re: /style=\{\{[^}]*?(#[0-9a-fA-F]{3,8})[^}]*?\}\}/g, kind: "inline style" },
    // fill="#fff" / stroke="#fff"
    { re: /\b(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g, kind: "svg paint" },
    // recharts prop objects: tick={{ fill: "#94a3b8" }}
    // axisLine and tickLine were missing from this list, which is how a
    // near-white axis line survived the first pass on leads-trend-chart.
    // `cursor` was missing from this list, which is how three bar charts kept a
    // hardcoded near-white hover band (#f8fafc / #f1f5f9) on a dark card.
    { re: /\b(?:tick|tickLine|axisLine|cursor|contentStyle|itemStyle|labelStyle|wrapperStyle|dot|activeDot)=\{\{[^}]*?(#[0-9a-fA-F]{3,8})[^}]*?\}\}/g, kind: "chart style" },
  ];
  for (const { re, kind } of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const hex = m[1].toLowerCase();
      // Brand colours are intentional and legible on both themes; skip them to
      // keep the signal useful.
      // Brand and semantic series colours. These carry meaning and are legible
      // on both themes, so a `dark:` counterpart would change what the chart
      // says rather than fix a contrast problem.
      if ([
        "#1e3a5f", "#0ea5e9", "#0369a1", "#22c55e",
        "#f5a524", "#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6",
      ].includes(hex)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ hex, kind, line });
    }
  }
  return out;
}

const ROOTS = ["app", "components", "lib", "hooks"];

for (const file of ROOTS.flatMap((d) => walk(path.join(ROOT, d)))) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  if (isAlwaysDark(rel) || isAlwaysLight(rel)) continue;

  const lines = src.split("\n");

  // A `className="…"` literal matches both extractors; key on line+value so it
  // is only reported once.
  const seen = new Set();
  const candidates = [...classAttributes(src), ...classLikeStrings(src)]
    .filter(({ value, line }) => {
      const k = `${line}::${value}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  for (const { value, line } of candidates) {
    if (isSuppressed(lines, line)) continue;
    if (LIGHT_BG.test(value) && !hasDarkVariant(value, "bg")) {
      findings.push({ file: rel, line, type: "SURFACE", detail: value.match(LIGHT_BG)[0] });
    }
    if (DARK_TEXT.test(value) && !hasDarkVariant(value, "text")) {
      findings.push({ file: rel, line, type: "TEXT", detail: value.match(DARK_TEXT)[0] });
    }
    if (BRAND_TEXT.test(value) && !hasDarkVariant(value, "text")) {
      findings.push({ file: rel, line, type: "TEXT", detail: value.match(BRAND_TEXT)[0] });
    }
    if (LIGHT_BORDER.test(value) && !hasDarkVariant(value, "border")) {
      findings.push({ file: rel, line, type: "BORDER", detail: value.match(LIGHT_BORDER)[0] });
    }
    if (LIGHT_DIVIDE.test(value) && !hasDarkVariant(value, "divide")) {
      findings.push({ file: rel, line, type: "BORDER", detail: value.match(LIGHT_DIVIDE)[0] });
    }
  }

  for (const { hex, kind, line } of literalColours(src)) {
    if (isSuppressed(lines, line)) continue;
    findings.push({ file: rel, line, type: "LITERAL", detail: `${hex} (${kind})` });
  }
}

// ── Report ────────────────────────────────────────────────────────────────
const byType = findings.reduce((a, f) => { (a[f.type] ??= []).push(f); return a; }, {});
const byFile = findings.reduce((a, f) => { (a[f.file] ??= []).push(f); return a; }, {});

process.stdout.write(`\nDark-mode scan: ${findings.length} finding(s) across ${Object.keys(byFile).length} file(s)\n`);
process.stdout.write(`${"─".repeat(70)}\n`);
for (const t of ["TEXT", "SURFACE", "BORDER", "LITERAL"]) {
  process.stdout.write(`  ${t.padEnd(8)} ${String(byType[t]?.length ?? 0).padStart(4)}\n`);
}

process.stdout.write(`\nWorst files:\n`);
for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  const counts = list.reduce((a, f) => { a[f.type] = (a[f.type] ?? 0) + 1; return a; }, {});
  const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(" ");
  process.stdout.write(`  ${String(list.length).padStart(3)}  ${file.padEnd(64)} ${summary}\n`);
}

if (ONLY === "full") {
  process.stdout.write(`\nDetail:\n`);
  for (const [file, list] of Object.entries(byFile).sort((a, b) => b[1].length - a[1].length)) {
    process.stdout.write(`\n${file}\n`);
    for (const f of list.sort((a, b) => a.line - b.line)) {
      process.stdout.write(`  ${String(f.line).padStart(5)}  ${f.type.padEnd(8)} ${f.detail}\n`);
    }
  }
}

process.exit(findings.length > 0 ? 1 : 0);

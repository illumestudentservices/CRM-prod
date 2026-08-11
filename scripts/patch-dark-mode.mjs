#!/usr/bin/env node
/**
 * Adds the missing `dark:` counterpart next to each light-only colour utility.
 *
 * The pairings below are the ones already used consistently across the ~126
 * files that do handle dark mode, so this makes the stragglers match rather
 * than inventing a new palette:
 *
 *   bg-white        → dark:bg-slate-900     page/card surface
 *   bg-slate-50     → dark:bg-slate-900/40  subtle zebra / inset panel
 *   bg-slate-100    → dark:bg-slate-800     chip, badge, muted button
 *   text-slate-900  → dark:text-slate-100   primary text
 *   text-slate-800  → dark:text-slate-200
 *   text-slate-700  → dark:text-slate-300   secondary text
 *   border-slate-100/200 → dark:border-slate-800
 *
 * Only appends — never rewrites the light value — so light mode is unchanged
 * by construction. Skips any attribute that already has a dark counterpart for
 * that property, and honours the `dark-ok` suppression comment.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const PAIRS = [
  [/\bbg-white\b(?![/\d])/g, "bg-white dark:bg-slate-900", "bg"],
  [/\bbg-slate-50\b(?![/\d])/g, "bg-slate-50 dark:bg-slate-900/40", "bg"],
  [/\bbg-slate-100\b(?![/\d])/g, "bg-slate-100 dark:bg-slate-800", "bg"],
  [/\bbg-slate-200\b(?![/\d])/g, "bg-slate-200 dark:bg-slate-700", "bg"],
  [/\bbg-gray-50\b(?![/\d])/g, "bg-gray-50 dark:bg-slate-900/40", "bg"],
  [/\bbg-gray-100\b(?![/\d])/g, "bg-gray-100 dark:bg-slate-800", "bg"],
  [/\btext-slate-900\b(?![/\d])/g, "text-slate-900 dark:text-slate-100", "text"],
  [/\btext-slate-800\b(?![/\d])/g, "text-slate-800 dark:text-slate-200", "text"],
  [/\btext-slate-700\b(?![/\d])/g, "text-slate-700 dark:text-slate-300", "text"],
  [/\btext-gray-900\b(?![/\d])/g, "text-gray-900 dark:text-slate-100", "text"],
  [/\btext-gray-800\b(?![/\d])/g, "text-gray-800 dark:text-slate-200", "text"],
  [/\btext-gray-700\b(?![/\d])/g, "text-gray-700 dark:text-slate-300", "text"],
  [/\bborder-slate-100\b(?![/\d])/g, "border-slate-100 dark:border-slate-800", "border"],
  [/\bborder-slate-200\b(?![/\d])/g, "border-slate-200 dark:border-slate-800", "border"],
  [/\bborder-slate-300\b(?![/\d])/g, "border-slate-300 dark:border-slate-700", "border"],
  [/\bborder-gray-200\b(?![/\d])/g, "border-gray-200 dark:border-slate-800", "border"],
  [/\bdivide-slate-100\b(?![/\d])/g, "divide-slate-100 dark:divide-slate-800", "divide"],
  [/\bdivide-slate-200\b(?![/\d])/g, "divide-slate-200 dark:divide-slate-800", "divide"],
];

const ALWAYS_DARK = [
  path.join("app", "(auth)"),
  path.join("components", "shared", "mfa-unlock-overlay.tsx"),
  path.join("components", "shared", "welcome-overlay.tsx"),
  path.join("app", "change-password"),
  path.join("app", "reset-password"),
];

/**
 * A dark counterpart may sit behind arbitrary modifiers —
 * `dark:hover:bg-…`, `dark:[&_tr]:border-…`, `dark:data-[state=on]:bg-…`.
 * The first version of this only allowed `[a-z0-9-]+:` between `dark:` and the
 * property, so it didn't recognise the bracketed forms and appended a second,
 * redundant variant to elements that were already correct.
 */
function hasDarkVariant(value, property) {
  return new RegExp(String.raw`\bdark:(?:[^\s"']+:)*${property}-`).test(value);
}

/**
 * True when the matched utility carries a modifier prefix (`hover:`,
 * `data-[…]:`, `[&_tr]:`). Those must not be paired with a bare `dark:` —
 * doing so applies the dark colour unconditionally instead of only in the
 * modified state, which silently broke the Switch's checked colour and made a
 * hover-only text colour permanent.
 */
function isModified(value, index) {
  const before = value.slice(0, index);
  return /[:\]]$/.test(before.trimEnd()) || /[a-z0-9\])]:$/.test(before);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(e.name)) out.push(full);
  }
  return out;
}

let filesChanged = 0, total = 0;

for (const file of walk(path.join(ROOT, "app")).concat(walk(path.join(ROOT, "components")))) {
  const rel = path.relative(ROOT, file);
  if (ALWAYS_DARK.some((p) => rel.startsWith(p))) continue;

  const src = fs.readFileSync(file, "utf8");
  const lines = src.split("\n");
  let changed = 0;

  // Operate on whole className attributes so the "already has a dark variant
  // for this property" test is scoped to the same element. Doing it per-token
  // would double up on elements that pair the two across a cn() boundary.
  const out = src.replace(
    /className\s*=\s*(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|\/?>))/g,
    (whole, dq, braced, offset) => {
      const lineNo = src.slice(0, offset).split("\n").length;
      if (/dark-ok/.test(lines[lineNo - 1] ?? "") || /dark-ok/.test(lines[lineNo - 2] ?? "")) {
        return whole;
      }
      let next = whole;
      for (const [re, replacement, property] of PAIRS) {
        // Re-read each pass: an earlier pair may have added the variant.
        if (hasDarkVariant(next, property)) continue;
        if (!re.test(next)) { re.lastIndex = 0; continue; }
        re.lastIndex = 0;
        // Replace only the first occurrence — the appended `dark:` then makes
        // hasDarkVariant true, which is the correct outcome for the element.
        next = next.replace(re, (match, offset) => {
          // Leave modifier-prefixed utilities alone; pairing them needs the
          // same modifier on the dark side, which is a judgement call per
          // element rather than a mechanical append.
          if (isModified(next, offset)) return match;
          changed++;
          return replacement;
        });
      }
      return next;
    }
  );

  if (out !== src) {
    fs.writeFileSync(file, out);
    filesChanged++;
    total += changed;
    console.log(`${String(changed).padStart(3)}  ${rel}`);
  }
}

console.log(`\n${total} utilit(ies) paired across ${filesChanged} file(s)`);

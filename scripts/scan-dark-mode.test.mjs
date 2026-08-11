#!/usr/bin/env node
/**
 * Self-test for the dark-mode scanner's class extraction.
 *
 * The scanner is only useful if a clean run means something. Twice now it has
 * reported zero while real gaps were on screen:
 *
 *   1. it read only `className=` attributes, so the shadcn `cva()` variant maps
 *      and `lib/lead-pipeline.ts`'s stage palette were never looked at;
 *   2. it joined the two branches of a ternary, so a `dark:` in one branch
 *      vouched for the other — `x ? "bg-white dark:bg-slate-900" : "bg-slate-50"`
 *      passed while the else-branch had no dark value at all. That shipped the
 *      permission matrix as a white table on a dark page.
 *
 * Both are false negatives, which are the expensive kind: they read as
 * "nothing to fix". These cases pin the behaviour so a future tweak to the
 * regexes can't silently reintroduce them.
 *
 * Run: node scripts/scan-dark-mode.test.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCANNER = path.join(HERE, "scan-dark-mode.mjs");

// The scanner is a script, not a module: importing it would walk the tree. Strip
// the imports and the driver loop, then re-export the pieces under test.
const parts =
  // `path` is used by the ALWAYS_DARK / ALWAYS_LIGHT tables at module scope.
  `import path from "node:path";\nimport fs from "node:fs";\n` +
  fs
    .readFileSync(SCANNER, "utf8")
    .replace(/^#!.*$/m, "")
    .replace(/^import .*$/gm, "")
    .replace(/^const ROOTS[\s\S]*$/m, "") +
  "\nexport { classAttributes, classLikeStrings, LIGHT_BG, DARK_TEXT, hasDarkVariant };\n";

const tmp = path.join(HERE, ".scan-parts.tmp.mjs");
fs.writeFileSync(tmp, parts);

let mod;
try {
  mod = await import(`file://${tmp.split(path.sep).join("/")}`);
} finally {
  fs.unlinkSync(tmp);
}

const { classAttributes, classLikeStrings, LIGHT_BG, DARK_TEXT, hasDarkVariant } = mod;

/** Mirrors the predicate the scanner applies to each candidate. */
function reports(src) {
  const candidates = [...classAttributes(src), ...classLikeStrings(src)];
  return candidates.some(
    ({ value }) =>
      (LIGHT_BG.test(value) && !hasDarkVariant(value, "bg")) ||
      (DARK_TEXT.test(value) && !hasDarkVariant(value, "text"))
  );
}

const CASES = [
  ["plain attribute, unpaired", `<div className="bg-white p-2" />`, true],
  ["plain attribute, paired", `<div className="bg-white dark:bg-slate-900 p-2" />`, false],

  // Regression 2: the shape that shipped the white permission matrix.
  [
    "ternary, else-branch unpaired",
    `<td className={cn("py-2.5 px-4", i % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50")} />`,
    true,
  ],
  [
    "ternary, both branches paired",
    `<td className={cn("p-2", x ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-800")} />`,
    false,
  ],

  // The primitives split light and dark across adjacent cn() arguments. Judging
  // those separately reported every correct component as a gap.
  [
    "cn() split across adjacent literals",
    `<div className={cn("bg-white text-slate-900", "dark:bg-slate-900 dark:text-slate-100")} />`,
    false,
  ],

  // Regression 1: colours declared outside any className attribute.
  [
    "cva variant map, unpaired",
    `const v = cva("base", { variants: { variant: { secondary: "bg-slate-100 text-slate-700" } } });`,
    true,
  ],
  [
    "cva variant map, paired",
    `const v = cva("base", { variants: { variant: { secondary: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" } } });`,
    false,
  ],
  [
    "status palette in a plain object",
    `export const BADGE = { NEW: "bg-slate-100 text-slate-700 border-slate-200" };`,
    true,
  ],

  // Translucent overlays sit on brand gradients and are correct in both themes.
  ["translucent overlay is not a gap", `<div className="bg-white/5 p-2" />`, false],

  // A dark counterpart may carry further modifiers.
  [
    "dark variant behind a modifier",
    `<div className="bg-white dark:data-[state=on]:bg-slate-900" />`,
    false,
  ],
];

let failed = 0;
for (const [name, src, expected] of CASES) {
  const got = reports(src);
  const ok = got === expected;
  if (!ok) failed++;
  process.stdout.write(
    `${ok ? "  ok  " : "FAIL  "}${name.padEnd(38)} expected ${expected ? "report" : "clean "}, got ${got ? "report" : "clean "}\n`
  );
}

process.stdout.write(`\n${CASES.length - failed}/${CASES.length} passed\n`);
process.exit(failed ? 1 : 0);

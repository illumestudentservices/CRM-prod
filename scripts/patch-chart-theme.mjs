#!/usr/bin/env node
/**
 * Rewires every recharts usage onto useChartTheme().
 *
 * Only the *chrome* colours are replaced — grid, axis ticks, tooltip surface.
 * Series colours (the brand blue/green/amber used for bars and lines) are left
 * alone: they carry meaning, they're legible on both themes, and swapping them
 * would change what the chart says.
 *
 * Data-carrying `fill=` / `stroke=` on Bar, Line, Area and Cell are therefore
 * untouched; only CartesianGrid's stroke is themed.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "app/(dashboard)/reports/[id]/_components/report-detail-client.tsx",
  "app/(dashboard)/analytics/_components/executive-dashboard.tsx",
  "app/(dashboard)/hr/_components/hr-dashboard-stats.tsx",
  "app/(dashboard)/analytics/_components/regional-dashboard.tsx",
  "app/(dashboard)/analytics/_components/icr-dashboard.tsx",
  "app/(dashboard)/analytics/_components/leads-trend-chart.tsx",
  "app/(dashboard)/institutions/[id]/_components/enrollment-chart.tsx",
];

let patched = 0;
for (const rel of FILES) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) { console.log(`SKIP (missing) ${rel}`); continue; }
  let src = fs.readFileSync(full, "utf8");
  const before = src;
  const notes = [];

  // 1. CartesianGrid stroke → themed grid.
  src = src.replace(
    /(<CartesianGrid[^>]*?)stroke="#[0-9a-fA-F]{3,8}"/g,
    (_m, head) => { notes.push("grid"); return `${head}stroke={chart.grid}`; }
  );

  // 2. Axis tick objects → themed tick style. Preserve an explicit fontSize.
  src = src.replace(
    /tick=\{\{\s*fontSize:\s*(\d+)\s*,\s*fill:\s*"#[0-9a-fA-F]{3,8}"\s*\}\}/g,
    (_m, size) => {
      notes.push("tick");
      return size === "11"
        ? `tick={chart.tickStyle}`
        : `tick={{ ...chart.tickStyle, fontSize: ${size} }}`;
    }
  );
  // fill-first ordering
  src = src.replace(
    /tick=\{\{\s*fill:\s*"#[0-9a-fA-F]{3,8}"\s*,\s*fontSize:\s*(\d+)\s*\}\}/g,
    (_m, size) => {
      notes.push("tick");
      return size === "11"
        ? `tick={chart.tickStyle}`
        : `tick={{ ...chart.tickStyle, fontSize: ${size} }}`;
    }
  );

  // 3. Tooltip surface → themed. The old objects specified a border and radius
  //    but no background, which is exactly why they rendered white on dark.
  src = src.replace(
    /contentStyle=\{\{[^}]*\}\}/g,
    () => { notes.push("tooltip"); return `contentStyle={chart.tooltipContentStyle}`; }
  );

  // 4. Axis line colours, where set explicitly.
  src = src.replace(
    /(<(?:XAxis|YAxis)[^>]*?)stroke="#[0-9a-fA-F]{3,8}"/g,
    (_m, head) => { notes.push("axis"); return `${head}stroke={chart.axis}` }
  );

  if (src === before) { console.log(`SKIP (no chrome found) ${rel}`); continue; }

  // 5. Import the hook. Matches multi-line import blocks too — matching only
  //    single-line `^import ...;$` missed files whose imports are all braced
  //    across several lines, and crashed on the empty match list.
  if (!src.includes("use-chart-theme")) {
    const imports = [...src.matchAll(/^import\s[\s\S]*?from\s+["'][^"']+["'];$/gm)];
    if (imports.length === 0) {
      console.log(`WARN no import block found, skipping import for ${rel}`);
    } else {
      const last = imports[imports.length - 1];
      const at = last.index + last[0].length;
      src = src.slice(0, at) +
        `\nimport { useChartTheme } from "@/hooks/use-chart-theme";` +
        src.slice(at);
    }
  }

  // 6. Call it in every component that renders chart chrome. A file can hold
  //    several chart components, so insert into each function whose body
  //    references `chart.` but doesn't yet declare it.
  const fnRe = /(?:export\s+)?function\s+([A-Z]\w*)\s*\([^)]*\)\s*\{|const\s+([A-Z]\w*)\s*[:=][^=]*?=>\s*\{/g;
  const bodies = [];
  let m;
  while ((m = fnRe.exec(src)) !== null) {
    bodies.push({ name: m[1] ?? m[2], end: m.index + m[0].length });
  }
  // Walk backwards so earlier insert offsets stay valid.
  for (let i = bodies.length - 1; i >= 0; i--) {
    const start = bodies[i].end;
    const nextStart = i + 1 < bodies.length ? bodies[i + 1].end : src.length;
    const body = src.slice(start, nextStart);
    if (!body.includes("chart.")) continue;
    if (/const\s+chart\s*=\s*useChartTheme\(\)/.test(body)) continue;
    src = src.slice(0, start) + `\n  const chart = useChartTheme();` + src.slice(start);
  }

  fs.writeFileSync(full, src);
  const summary = [...new Set(notes)].join(", ");
  console.log(`OK   ${rel}  (${notes.length} replacement(s): ${summary})`);
  patched++;
}
console.log(`\n${patched} file(s) patched`);

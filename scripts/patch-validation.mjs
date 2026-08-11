#!/usr/bin/env node
/**
 * Applies the two mechanical halves of the validation fix to the
 * hand-rolled POST routes:
 *
 *   1. `await req.json()`  →  `await readJsonBody(req)`   (malformed JSON → 400)
 *   2. the generic catch    →  `handleApiError(...)`       (ApiError → its status)
 *
 * Enum/scalar assertions are added by hand per route, because each one needs
 * the right Prisma enum imported. Idempotent.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "app/api/risks/route.ts",
  "app/api/compliance/route.ts",
  "app/api/institutions/route.ts",
  "app/api/stakeholders/schools/route.ts",
  "app/api/stakeholders/counsellors/route.ts",
  "app/api/stakeholders/agents/route.ts",
  "app/api/markets/route.ts",
  "app/api/travel/route.ts",
  "app/api/institutions/[id]/kpis/route.ts",
  "app/api/institutions/[id]/engagement/route.ts",
  "app/api/institutions/[id]/contacts/route.ts",
  "app/api/institutions/[id]/contracts/route.ts",
  "app/api/institutions/[id]/deliverables/route.ts",
  "app/api/institutions/[id]/documents/route.ts",
  "app/api/institutions/[id]/knowledge/route.ts",
  "app/api/events/[id]/expenses/route.ts",
  "app/api/hr/performance-reviews/route.ts",
  "app/api/hr/succession-plans/route.ts",
  "app/api/hr/employees/[id]/kpis/route.ts",
  "app/api/knowledge/proposals/route.ts",
  "app/api/markets/[id]/knowledge/route.ts",
  "app/api/settings/regions/route.ts",
];

let patched = 0, skipped = 0;
for (const rel of FILES) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) { console.log(`SKIP (missing)  ${rel}`); skipped++; continue; }
  let src = fs.readFileSync(full, "utf8");
  const before = src;

  // 1. safe JSON read
  src = src.replace(/const body = await req\.json\(\);/g, "const body = await readJsonBody(req);");

  // 2. generic catch → handleApiError, preserving the log tag
  src = src.replace(
    /\}\s*catch\s*\((\w+)\)\s*\{\s*console\.error\((\"\[[^\]]+\][^\"]*\")[^)]*\);\s*return NextResponse\.json\(\s*\{\s*error:\s*"Internal server error"\s*\}\s*,\s*\{\s*status:\s*500\s*\}\s*\);\s*\}/g,
    (_m, errVar, tag) => `} catch (${errVar}) {\n    return handleApiError(${errVar}, ${tag});\n  }`
  );

  // 3. import line
  if (!src.includes("@/lib/api-validation")) {
    const imports = [...src.matchAll(/^import .*;$/gm)];
    if (imports.length) {
      const last = imports[imports.length - 1];
      const at = last.index + last[0].length;
      src = src.slice(0, at) +
        `\nimport { readJsonBody, handleApiError } from "@/lib/api-validation";` +
        src.slice(at);
    }
  }

  if (src === before) { console.log(`SKIP (no change) ${rel}`); skipped++; continue; }
  fs.writeFileSync(full, src);
  console.log(`OK              ${rel}`);
  patched++;
}
console.log(`\n${patched} patched, ${skipped} skipped`);

#!/usr/bin/env node
/**
 * Threads the institution scope through every canAccessLead call site.
 *
 * canAccessLead now takes a 5th argument — the institution ids the caller is
 * assigned to — and defaults it to [] so it fails closed. Call sites that
 * don't pass it would therefore start denying INSTITUTION_CLIENT entirely,
 * which is safe but wrong; this adds the lookup.
 */
import fs from "node:fs";
import path from "node:path";

const FILES = [
  "app/api/leads/[id]/activities/route.ts",
  "app/api/leads/[id]/applications/route.ts",
  "app/api/leads/[id]/checklist/route.ts",
  "app/api/leads/[id]/close/route.ts",
  "app/api/leads/[id]/stage/route.ts",
];

let n = 0;
for (const rel of FILES) {
  const full = path.join(process.cwd(), rel);
  if (!fs.existsSync(full)) { console.log(`SKIP ${rel}`); continue; }
  let src = fs.readFileSync(full, "utf8");
  const before = src;

  // Import the helper alongside canAccessLead.
  src = src.replace(
    /import \{([^}]*?)canAccessLead([^}]*?)\} from "@\/lib\/lead-access";/,
    (m, a, b) => {
      if (m.includes("institutionIdsForUser")) return m;
      return `import {${a}canAccessLead, institutionIdsForUser${b}} from "@/lib/lead-access";`;
    }
  );

  // Pass the scope. The call is always inside an async handler that already
  // has `userId` and `role` in scope.
  src = src.replace(
    /canAccessLead\(lead, userId, regionId, role as Role\)/g,
    `canAccessLead(lead, userId, regionId, role as Role, await institutionIdsForUser(userId, role as Role))`
  );

  if (src === before) { console.log(`SKIP (no change) ${rel}`); continue; }
  fs.writeFileSync(full, src);
  console.log(`OK   ${rel}`);
  n++;
}
console.log(`\n${n} patched`);

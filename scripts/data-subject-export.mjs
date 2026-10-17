/**
 * Produce a GDPR data-subject export (Art. 15 / 20) for one person, as a file.
 *
 *   node --import tsx scripts/data-subject-export.mjs lead <leadId> [out.json]
 *   node --import tsx scripts/data-subject-export.mjs employee <employeeId> [out.json]
 *
 * Writes a complete, portable JSON export. Intended for HR / the privacy
 * contact to fulfil a Data Subject Access Request. Running it is itself a
 * disclosure — do so only for a genuine request.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";

const [, , type, id, outArg] = process.argv;

if (!["lead", "employee"].includes(type) || !id) {
  console.error("usage: data-subject-export.mjs lead|employee <id> [out.json]");
  process.exit(2);
}

const { exportDataSubject } = await import("@/lib/data-subject-export");
const { db } = await import("@/lib/db");

const subjectType = type === "lead" ? "LEAD" : "EMPLOYEE";
const data = await exportDataSubject(subjectType, id);

if (!data) {
  console.error(`No ${type} found with id ${id}`);
  await db.$disconnect();
  process.exit(1);
}

const out = outArg || `dsar-${type}-${id}-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(out, JSON.stringify(data, null, 2), "utf8");

const relCounts = Object.entries(data.related)
  .map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : 0}`)
  .join(", ");
console.log(`Wrote ${out}`);
console.log(`  subject: ${subjectType} ${id}`);
console.log(`  related records: ${relCounts}`);
console.log(`  attachments: ${data.attachments.length}`);
console.log(`  processing-history entries: ${data.processingHistory.length}`);

await db.$disconnect();

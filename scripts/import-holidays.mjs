/**
 * Load the public holiday calendar from the HR system's export.
 *
 *   node --import tsx scripts/import-holidays.mjs <holidays.json> [--commit]
 *
 * Dry run by default. Idempotent: a holiday already on the same date for the
 * same region is left alone, so a re-run adds only what is new.
 *
 * ★ MULTI-DAY HOLIDAYS BECOME ONE ROW PER DAY, AND THEY HAVE TO.
 *
 * The export gives a From and a To — Tet runs 14 to 22 February, Eid Al Fitr
 * 20 to 22 March. A Holiday row holds a single date, and
 * `calcWorkingDays` in app/api/hr/leave/route.ts deducts holidays by matching
 * EXACT dates against the range somebody books. Storing only the first day of
 * Tet would charge a Vietnamese colleague eight days of annual leave for a
 * week the office is shut.
 *
 * ★ AND ONE ROW PER REGION.
 *
 * Ten rows carry two locations — all Egyptian holidays, tagged East Africa
 * and Middle East, because Egypt sits in both in their setup. A Holiday row
 * points at one region, so each becomes two.
 *
 * ★ "REST OF THE WORLD" IS NOT GLOBAL.
 *
 * One row is tagged "East Africa;Rest Of The World": Revolution Day (Egypt).
 * It is an Egyptian national holiday that happens to carry a stray location
 * tag, and reading it as global would close the whole company on 23 July. The
 * tag is dropped; the row is still created for Africa.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";

const { db } = await import("@/lib/db");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
if (!file) {
  console.error("usage: import-holidays.mjs <holidays.json> [--commit]");
  process.exit(2);
}

// Export location -> CRM region. East and West Africa both roll up: the CRM
// has one Africa region and splitting it is an HR decision, not a data one.
const REGION_BY_LOCATION = {
  "southeast asia (sea)": "Southeast Asia",
  "southeast asia": "Southeast Asia",
  "south asia (sa)": "South Asia",
  "south asia": "South Asia",
  "middle east": "Middle East",
  "latin america": "Latin America",
  "china": "China",
  "east africa": "Africa",
  "west africa": "Africa",
  "africa": "Africa",
  "north america": "North America",
  "europe": "Europe",
};
const DROPPED_LOCATIONS = new Set(["rest of the world"]);

const rows = JSON.parse(readFileSync(file, "utf8"));
console.log(`${rows.length} holiday row(s) in the export`);
console.log(COMMIT ? "MODE: COMMIT\n" : "MODE: dry run — nothing will be written\n");

const actor = await db.user.findFirst({
  where: { email: "it@illumestudentservices.ca", deletedAt: null }, select: { id: true },
});
if (!actor) { console.error("acting user not found"); process.exit(1); }

const regions = await db.region.findMany({ select: { id: true, name: true } });
const regionId = new Map(regions.map((r) => [r.name.toLowerCase(), r.id]));

const existing = await db.holiday.findMany({ select: { name: true, date: true, regionId: true } });
const key = (n, d, r) => `${n.trim().toLowerCase()}|${d}|${r ?? "global"}`;
const have = new Set(existing.map((h) => key(h.name, h.date.toISOString().slice(0, 10), h.regionId)));

const planned = [];
const unmapped = new Map();
let dropped = 0;

for (const h of rows) {
  const days = [];
  const from = new Date(`${h.from}T00:00:00Z`);
  const to = new Date(`${h.to}T00:00:00Z`);
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }

  for (const loc of h.locations) {
    const l = loc.trim().toLowerCase();
    if (DROPPED_LOCATIONS.has(l)) { dropped++; continue; }
    const regionName = REGION_BY_LOCATION[l];
    if (!regionName) { unmapped.set(loc, (unmapped.get(loc) ?? 0) + 1); continue; }
    const rid = regionId.get(regionName.toLowerCase());
    if (!rid) { unmapped.set(`${loc} (no CRM region "${regionName}")`, 1); continue; }

    for (const day of days) {
      if (have.has(key(h.name, day, rid))) continue;
      planned.push({ name: h.name.trim(), date: day, regionId: rid, regionName, days: days.length });
      have.add(key(h.name, day, rid));
    }
  }
}

const byRegion = {};
for (const p of planned) byRegion[p.regionName] = (byRegion[p.regionName] ?? 0) + 1;

console.log(`${planned.length} holiday row(s) to create\n`);
console.log("by region:");
for (const [r, n] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${r}`);
}
const withoutAny = regions.filter((r) => !byRegion[r.name]).map((r) => r.name);
if (withoutAny.length) console.log(`\n   no holidays at all for: ${withoutAny.join(", ")}`);
if (dropped) console.log(`   "Rest Of The World" tags dropped: ${dropped}`);
if (unmapped.size) {
  console.log("\n   LOCATIONS NOT RECOGNISED — nothing created for these:");
  for (const [l, n] of unmapped) console.log(`      ${l} (${n})`);
}

const expanded = planned.filter((p) => p.days > 1);
console.log(`\n   rows coming from multi-day holidays: ${expanded.length}`);

if (!COMMIT) {
  console.log("\nfirst 6:");
  for (const p of planned.slice(0, 6)) console.log(`   ${p.date}  ${p.regionName.padEnd(15)} ${p.name}`);
  console.log("\ndry run — nothing written. Re-run with --commit.");
  await db.$disconnect();
  process.exit(0);
}

const created = await db.holiday.createMany({
  data: planned.map((p) => ({
    name: p.name,
    date: new Date(`${p.date}T00:00:00Z`),
    regionId: p.regionId,
    isGlobal: false,
    createdById: actor.id,
  })),
});
console.log(`\ncreated ${created.count} holiday row(s)`);

await db.auditLog.create({
  data: {
    userId: actor.id, action: "CREATE", entity: "Holiday", entityId: "bulk-import-2026",
    changes: {
      source: "Holiday_01-Jan-2026_31-Dec-2026.xlsx",
      sourceRows: rows.length, created: created.count, byRegion,
      note: "Multi-day holidays expanded to one row per day; multi-location rows duplicated per region.",
    },
  },
}).catch(() => {});

const total = await db.holiday.count();
console.log(`holidays in the system now: ${total}`);
await db.$disconnect();

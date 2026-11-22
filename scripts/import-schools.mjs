/**
 * General school importer — load a cleaned JSON dataset and upsert each row as a
 * RecruitmentPartner (type=SCHOOL). Idempotent on normalised name+city+country
 * (keeps same-named schools in different cities distinct; strips the "(City)"
 * suffix so re-runs match). Dry run by default.
 *
 *   TEST:  npx tsx --env-file=.env.local scripts/import-schools.mjs --file=scripts/data/africa-schools.json [--commit]
 *   PROD:  cd /var/www/illume-crm && sudo -u illume \
 *            node --import tsx --env-file=.env scripts/import-schools.mjs --file=scripts/data/africa-schools.json --commit
 *
 * Region map matches the agent importers (import-africa-agents): African
 * countries -> Africa; Gulf + Levant + Turkey -> Middle East.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const FILE = (args.find((a) => a.startsWith("--file=")) || "").slice("--file=".length);
if (!FILE) { console.error("Usage: scripts/import-schools.mjs --file=<json> [--commit]"); process.exit(1); }

const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const deSuffix = (name, city) => {
  const c = clean(city);
  if (!c) return clean(name);
  return clean(name).replace(new RegExp("\\s*\\(" + esc(c) + "\\)\\s*$", "i"), "").trim();
};

// country (lowercase, trimmed) -> CRM region name. Mirrors import-africa-agents.
const REGION = {
  kenya: "Africa", uganda: "Africa", zimbabwe: "Africa", tanzania: "Africa", ethiopia: "Africa",
  rwanda: "Africa", gabon: "Africa", ghana: "Africa", nigeria: "Africa", cameroon: "Africa",
  morocco: "Africa", egypt: "Africa", tunisia: "Africa", algeria: "Africa", "south africa": "Africa",
  zambia: "Africa", madagascar: "Africa", mauritius: "Africa", gambia: "Africa",
  uae: "Middle East", oman: "Middle East", qatar: "Middle East", bahrain: "Middle East",
  kuwait: "Middle East", "saudi arabia": "Middle East", jordan: "Middle East", lebanon: "Middle East",
  turkey: "Middle East",
};
const regionOf = (country) => REGION[clean(country).toLowerCase()];

function notesFor(r) {
  const p = [];
  if (r.department) p.push(`Role: ${r.department}`);
  if (r.curriculum) p.push(`Curriculum: ${r.curriculum}`);
  if (r.other) p.push(`Other contacts: ${r.other}`);
  if (r.notes) p.push(r.notes);
  return p.join(" | ") || null;
}

async function main() {
  const raw = JSON.parse(readFileSync(FILE, "utf8"));
  // Defensive within-file dedup on name+city+country (keep first).
  const seen = new Set();
  const rows = [];
  for (const r of raw) {
    const k = `${norm(r.name)}::${norm(r.city)}::${norm(r.country)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const regions = await db.region.findMany({ select: { id: true, name: true } });
    const regionId = new Map(regions.map((r) => [r.name, r.id]));

    const missing = new Set();
    for (const r of rows) {
      const rn = regionOf(r.country);
      if (!rn) missing.add(`country "${r.country}" unmapped`);
      else if (!regionId.has(rn)) missing.add(`region "${rn}" missing`);
    }
    if (missing.size) { console.error("STOP:", [...missing].join("; ")); process.exit(1); }

    const author = await db.user.findFirst({
      where: { role: "SUPER_ADMIN", deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    if (!author) { console.error("STOP: no SUPER_ADMIN to attribute the import to."); process.exit(1); }

    const key = (name, city, country) => `${norm(name)}::${norm(city)}::${norm(country)}`;
    const present = await db.recruitmentPartner.findMany({
      where: { type: "SCHOOL", deletedAt: null },
      select: { name: true, city: true, country: true },
    });
    // Location tag is the city when known, else the country — strip whichever
    // was used so re-runs match (otherwise a renamed row looks "missing").
    const presentKeys = new Set(present.map((p) => key(deSuffix(p.name, clean(p.city) || p.country), p.city, p.country)));

    const toCreate = rows.filter((r) => !presentKeys.has(key(r.name, r.city, r.country)));
    const already = rows.length - toCreate.length;
    const byRegion = {};
    for (const r of toCreate) byRegion[regionOf(r.country)] = (byRegion[regionOf(r.country)] ?? 0) + 1;

    console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${FILE} — attributed to ${author.email}`);
    console.log(`  rows (deduped)    ${rows.length}`);
    console.log(`  already present   ${already}`);
    console.log(`  to create         ${toCreate.length}`);
    console.log(`  by region         ${Object.entries(byRegion).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);

    if (!COMMIT) { console.log("\nDry run — nothing written. Re-run with --commit to apply.\n"); return; }

    let made = 0;
    for (const r of toCreate) {
      await db.recruitmentPartner.create({
        data: {
          // Tag every school with its location: city if known, else country.
          name: `${r.name} (${clean(r.city) || r.country})`,
          type: "SCHOOL",
          country: r.country,
          city: r.city || null,
          contactPerson: r.contact || null,
          email: r.email || null,
          phone: r.phone || null,
          notes: notesFor(r),
          regionId: regionId.get(regionOf(r.country)) ?? null,
          isActive: true,
          createdById: author.id,
        },
      });
      made++;
    }
    console.log(`\nCREATED ${made} schools.`);
  } finally {
    await db.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });

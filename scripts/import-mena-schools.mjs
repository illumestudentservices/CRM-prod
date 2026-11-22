/**
 * Import the MENA high-school list as RecruitmentPartner rows (type=SCHOOL).
 * Source: scripts/data/mena-schools.json (converted from "MENA HS List .xlsx").
 *
 * Idempotent: keyed on normalised name + city + country, so same-named schools
 * in different cities (e.g. Delhi Private School in Sharjah and Dubai) stay
 * distinct, and re-running creates nothing new. Dry run by default.
 *
 *   TEST:  npx tsx --env-file=.env.local scripts/import-mena-schools.mjs [--commit]
 *   PROD:  cd /var/www/illume-crm && sudo -u illume \
 *            node --import tsx --env-file=.env scripts/import-mena-schools.mjs --commit
 *
 * Region: Gulf states → Middle East; Egypt → Africa (matches how the agent
 * importers already map those countries).
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const COMMIT = process.argv.includes("--commit");
const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

const REGION = { uae: "Middle East", oman: "Middle East", qatar: "Middle East", egypt: "Africa" };

function notesFor(r) {
  const parts = [];
  if (r.curriculum) parts.push(`Curriculum: ${r.curriculum}`);
  if (r.other) parts.push(`Other contacts: ${r.other}`);
  if (r.notes) parts.push(r.notes);
  return parts.join(" | ") || null;
}

async function main() {
  const rows = JSON.parse(readFileSync("scripts/data/mena-schools.json", "utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const regions = await db.region.findMany({ select: { id: true, name: true } });
    const regionId = new Map(regions.map((r) => [r.name, r.id]));

    // Every country must map to an existing region, or stop — never create a
    // region-less school nobody notices.
    const missing = new Set();
    for (const r of rows) {
      const rn = REGION[norm(r.country)];
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
    const presentKeys = new Set(present.map((p) => key(p.name, p.city, p.country)));

    const toCreate = rows.filter((r) => !presentKeys.has(key(r.name, r.city, r.country)));
    const already = rows.length - toCreate.length;
    const byCountry = {};
    for (const r of toCreate) byCountry[r.country] = (byCountry[r.country] ?? 0) + 1;

    console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — attributed to ${author.email}`);
    console.log(`  schools in file   ${rows.length}`);
    console.log(`  already present   ${already}`);
    console.log(`  to create         ${toCreate.length}`);
    console.log(`  by country        ${Object.entries(byCountry).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);

    if (!COMMIT) { console.log("\nDry run — nothing written. Re-run with --commit to apply.\n"); return; }

    let made = 0;
    for (const r of toCreate) {
      const regionName = REGION[norm(r.country)];
      await db.recruitmentPartner.create({
        data: {
          name: r.name,
          type: "SCHOOL",
          country: r.country,
          city: r.city || null,
          contactPerson: r.contact || null,
          email: r.email || null,
          phone: r.phone || null,
          notes: notesFor(r),
          regionId: regionId.get(regionName) ?? null,
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

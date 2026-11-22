/**
 * Append the city to each imported MENA school name, the way agents carry their
 * country — "Delhi Private School (Sharjah)". Scoped to the 78 from
 * scripts/data/mena-schools.json (matched on name+city+country), so pre-existing
 * schools are untouched. Idempotent: a name that already ends with its city is
 * left alone. Dry run by default.
 *
 *   TEST:  npx tsx --env-file=.env.local scripts/rename-school-city.mjs [--commit]
 *   PROD:  cd /var/www/illume-crm && sudo -u illume \
 *            node --import tsx --env-file=.env scripts/rename-school-city.mjs --commit
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const COMMIT = process.argv.includes("--commit");
const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const deSuffix = (name, city) => {
  const c = clean(city);
  if (!c) return clean(name);
  return clean(name).replace(new RegExp("\\s*\\(" + esc(c) + "\\)\\s*$", "i"), "").trim();
};

async function main() {
  const data = JSON.parse(readFileSync("scripts/data/mena-schools.json", "utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const schools = await db.recruitmentPartner.findMany({
      where: { type: "SCHOOL", deletedAt: null },
      select: { id: true, name: true, city: true, country: true },
    });
    // Key on the de-suffixed name so re-runs still find already-renamed rows.
    const byKey = new Map();
    for (const p of schools) {
      byKey.set(`${norm(deSuffix(p.name, p.city))}::${norm(p.city)}::${norm(p.country)}`, p);
    }

    const plan = [];
    for (const r of data) {
      const p = byKey.get(`${norm(r.name)}::${norm(r.city)}::${norm(r.country)}`);
      if (!p || !clean(r.city)) continue;
      const desired = `${r.name} (${r.city})`;
      if (p.name !== desired) plan.push({ id: p.id, from: p.name, to: desired });
    }

    console.log(`${COMMIT ? "COMMIT" : "DRY RUN"}`);
    console.log(`  schools in file   ${data.length}`);
    console.log(`  to rename         ${plan.length}`);
    plan.slice(0, 5).forEach((x) => console.log(`    "${x.from}" -> "${x.to}"`));
    if (plan.length > 5) console.log(`    … and ${plan.length - 5} more`);

    if (!COMMIT) { console.log("\nDry run — nothing written. Re-run with --commit.\n"); return; }

    let done = 0;
    for (const x of plan) {
      await db.recruitmentPartner.update({ where: { id: x.id }, data: { name: x.to } });
      done++;
    }
    console.log(`\nRENAMED ${done} schools.`);
  } finally {
    await db.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });

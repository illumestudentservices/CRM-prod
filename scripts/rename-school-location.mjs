/**
 * Tag every imported school name with its location — "(City)" when a city is
 * known, else "(Country)" — matching the agent naming convention. Scoped to the
 * records in --file (matched on name+city+country), idempotent (a name already
 * ending with its location is left alone). Dry run by default.
 *
 *   TEST:  npx tsx --env-file=.env.local scripts/rename-school-location.mjs --file=scripts/data/africa-schools.json [--commit]
 *   PROD:  cd /var/www/illume-crm && sudo -u illume \
 *            node --import tsx --env-file=.env scripts/rename-school-location.mjs --file=scripts/data/africa-schools.json --commit
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const FILE = (args.find((a) => a.startsWith("--file=")) || "").slice("--file=".length);
if (!FILE) { console.error("Usage: scripts/rename-school-location.mjs --file=<json> [--commit]"); process.exit(1); }

const clean = (s) => (s == null ? "" : String(s).replace(/\s+/g, " ").trim());
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const loc = (r) => clean(r.city) || clean(r.country);
const deSuffix = (name, suffix) => {
  const s = clean(suffix);
  if (!s) return clean(name);
  return clean(name).replace(new RegExp("\\s*\\(" + esc(s) + "\\)\\s*$", "i"), "").trim();
};

async function main() {
  const data = JSON.parse(readFileSync(FILE, "utf8"));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const schools = await db.recruitmentPartner.findMany({
      where: { type: "SCHOOL", deletedAt: null },
      select: { id: true, name: true, city: true, country: true },
    });
    const byKey = new Map();
    for (const p of schools) {
      const suffix = clean(p.city) || p.country; // whichever tag it would carry
      byKey.set(`${norm(deSuffix(p.name, suffix))}::${norm(p.city)}::${norm(p.country)}`, p);
    }

    const plan = [];
    for (const r of data) {
      const p = byKey.get(`${norm(r.name)}::${norm(r.city)}::${norm(r.country)}`);
      const l = loc(r);
      if (!p || !l) continue;
      const desired = `${r.name} (${l})`;
      if (p.name !== desired) plan.push({ id: p.id, from: p.name, to: desired });
    }

    console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — ${FILE}`);
    console.log(`  rows in file   ${data.length}`);
    console.log(`  to rename      ${plan.length}`);
    plan.slice(0, 5).forEach((x) => console.log(`    "${x.from}" -> "${x.to}"`));
    if (plan.length > 5) console.log(`    … and ${plan.length - 5} more`);

    if (!COMMIT) { console.log("\nDry run — nothing written. Re-run with --commit.\n"); return; }

    let done = 0;
    for (const x of plan) { await db.recruitmentPartner.update({ where: { id: x.id }, data: { name: x.to } }); done++; }
    console.log(`\nRENAMED ${done} schools.`);
  } finally {
    await db.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
  }
}
main().catch((e) => { console.error("FAILED:", e?.message ?? e); process.exit(1); });

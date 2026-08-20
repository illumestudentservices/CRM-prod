/**
 * Bulk-import the client list.
 *
 *   node --import tsx --env-file=.env.local scripts/import-clients.mjs <file.xlsx> --dry-run
 *   node --import tsx --env-file=.env.local scripts/import-clients.mjs <file.xlsx> --commit
 *
 * DRY RUN IS THE DEFAULT. `--commit` is the only thing that writes, and it
 * prints the same table first so the two runs can be compared.
 *
 * EXPECTED COLUMNS (header row 1, matched case-insensitively):
 *
 *   Client Name   required
 *   Country       required — Institution.country is NOT NULL and cannot be guessed
 *   Type          required — one of University / College / Institute / Other
 *   Africa China India LATAM MENA SEA   TRUE/FALSE region flags
 *
 * REGION MAPPING. The sheet's vocabulary is not the CRM's, so it is translated
 * explicitly rather than by fuzzy match — a near-miss here would file a client
 * under the wrong region and nobody would notice:
 *
 *   Africa → Africa          India → South Asia      MENA  → Middle East
 *   SEA    → Southeast Asia  China → East Asia       LATAM → Latin America
 *
 * East Asia and Latin America are created by migration 033; the rest predate it.
 *
 * IDEMPOTENT. Clients are matched on name (case-insensitive, trimmed). Running
 * twice updates rather than duplicating, and region rows are reconciled — added
 * where newly ticked, removed where un-ticked — so the sheet stays the source of
 * truth. `regionId` is set to the first ticked region as the primary, because
 * the dashboard geo filter and analytics read that single column; the full set
 * lives in institution_regions.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");

if (!file) {
  console.error("usage: import-clients.mjs <file.xlsx> [--commit]");
  process.exit(2);
}

/** Sheet column → CRM region name. Deliberately explicit, never fuzzy. */
const REGION_MAP = {
  africa: "Africa",
  china: "East Asia",
  india: "South Asia",
  latam: "Latin America",
  mena: "Middle East",
  sea: "Southeast Asia",
};

const VALID_TYPES = ["University", "College", "Institute", "Other"];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const truthy = (v) =>
  v === true || ["true", "yes", "y", "1", "x"].includes(String(v ?? "").trim().toLowerCase());

/**
 * Reads the workbook via Python's openpyxl rather than an npm xlsx package.
 *
 * The registry `xlsx` package is stale and has carried prototype-pollution and
 * ReDoS advisories; pulling it in permanently for a one-off import is a poor
 * trade. openpyxl is already installed here and is what read this same file
 * during the review.
 */
function readSheet(path) {
  const py = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
out = []
for r in rows[1:]:
    d = {hdr[i]: r[i] for i in range(len(hdr)) if hdr[i]}
    out.append(d)
print(json.dumps(out, default=str))
`;
  const raw = execFileSync("python", ["-c", py, path], {
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw).map((raw2) => {
    const raw_ = raw2;
    // Header names vary in case and spacing between exports; normalise once.
    const g = (want) => {
      const k = Object.keys(raw_).find(
        (x) => x.trim().toLowerCase() === want.toLowerCase()
      );
      return k ? raw_[k] : undefined;
    };
    const name = String(g("Client Name") ?? "").trim();
    const regions = Object.entries(REGION_MAP)
      .filter(([col]) => truthy(g(col)))
      .map(([, crmName]) => crmName);
    return {
      name,
      country: String(g("Country") ?? "").trim(),
      type: String(g("Type") ?? "").trim(),
      regions,
    };
  }).filter((r) => r.name);
}

async function main() {
  const rows = readSheet(file);
  console.log(`read ${rows.length} clients from ${file}\n`);

  // ── Validate before touching anything ───────────────────────────────────
  const problems = [];
  for (const r of rows) {
    if (!r.country) problems.push(`${r.name}: no Country (the column is required and cannot be guessed)`);
    if (!r.type) problems.push(`${r.name}: no Type`);
    else if (!VALID_TYPES.includes(r.type)) {
      problems.push(`${r.name}: Type "${r.type}" is not one of ${VALID_TYPES.join(" / ")}`);
    }
    if (r.regions.length === 0) problems.push(`${r.name}: no region ticked — will import with none`);
  }

  const regionRows = await db.region.findMany({ select: { id: true, name: true } });
  const regionByName = new Map(regionRows.map((x) => [x.name, x.id]));
  for (const want of new Set(rows.flatMap((r) => r.regions))) {
    if (!regionByName.has(want)) problems.push(`region "${want}" does not exist — run migration 033 first`);
  }

  const blocking = problems.filter((p) => !p.includes("no region ticked"));
  if (problems.length) {
    console.log("── issues ─────────────────────────────────────────────");
    for (const p of problems) console.log(`  ${blocking.includes(p) ? "BLOCKING" : "warn    "}  ${p}`);
    console.log();
  }
  if (blocking.length) {
    console.log(`REFUSING TO IMPORT: ${blocking.length} blocking issue(s). Nothing was written.`);
    return 1;
  }

  // ── Plan ────────────────────────────────────────────────────────────────
  const existing = await db.institution.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, regionId: true, regions: { select: { regionId: true } } },
  });
  const byName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e]));

  const author = await db.user.findFirst({
    where: { role: "SUPER_ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!author) { console.log("no SUPER_ADMIN to attribute the import to"); return 1; }

  let created = 0, updated = 0;
  console.log("── plan ───────────────────────────────────────────────");
  for (const r of rows) {
    const hit = byName.get(r.name.toLowerCase());
    console.log(
      `  ${hit ? "update" : "create"}  ${r.name.slice(0, 46).padEnd(48)} ` +
      `${r.country.padEnd(14)} ${r.type.padEnd(11)} ${r.regions.join(", ") || "(no region)"}`
    );
    if (!COMMIT) { hit ? updated++ : created++; continue; }

    const regionIds = r.regions.map((n) => regionByName.get(n));
    // The primary is the first ticked region: the dashboard geo filter and
    // analytics read institutions.regionId, not the join table.
    const primary = regionIds[0] ?? null;

    const inst = hit
      ? await db.institution.update({
          where: { id: hit.id },
          data: { country: r.country, type: r.type, regionId: primary },
          select: { id: true },
        })
      : await db.institution.create({
          data: {
            name: r.name, country: r.country, type: r.type,
            regionId: primary, accountStatus: "ACTIVE", createdById: author.id,
          },
          select: { id: true },
        });
    hit ? updated++ : created++;

    // Reconcile rather than append, so an un-ticked region is actually removed
    // and the sheet stays the source of truth.
    await db.institutionRegion.deleteMany({
      where: { institutionId: inst.id, regionId: { notIn: regionIds.length ? regionIds : ["__none__"] } },
    });
    for (const rid of regionIds) {
      await db.institutionRegion.upsert({
        where: { institutionId_regionId: { institutionId: inst.id, regionId: rid } },
        create: { institutionId: inst.id, regionId: rid },
        update: {},
      });
    }
  }

  console.log();
  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Would create ${created}, update ${updated}.`);
    console.log("Re-run with --commit to apply.");
    return 0;
  }

  const total = await db.institution.count({ where: { deletedAt: null } });
  const links = await db.institutionRegion.count();
  console.log(`COMMITTED — created ${created}, updated ${updated}.`);
  console.log(`institutions now ${total}, region links ${links}.`);
  return 0;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error("FAILED:", e.message); }
finally { await db.$disconnect(); await pool.end(); }
process.exit(code);

/**
 * Imports the "Keyano Agents - Southeast Asia" workbook into Recruitment
 * Partners (type AGENT). A single sheet with its own shape — Agent Name /
 * Country / Region / Contact Person / Email / Phone Number / Agreement Status /
 * Tier — so it gets its own importer rather than a new entry in the multi-sheet
 * import-africa-agents.mjs.
 *
 *   node scripts/import-keyano-sea-agents.mjs <file.xlsx> --parse-only   # no DB, prints the plan
 *   node scripts/import-keyano-sea-agents.mjs <file.xlsx> --dump-json    # xlsx -> json (prod has no openpyxl)
 *   node --env-file=.env scripts/import-keyano-sea-agents.mjs <file.json>            # dry run vs the DB
 *   node --env-file=.env scripts/import-keyano-sea-agents.mjs <file.json> --commit   # writes
 *
 * Mirrors the other importers: new agents are created with the BARE name; run
 * backfill-partner-country-in-name.mjs afterwards to add the "(Country)" suffix.
 * Dedup is by name+country with the suffix stripped, so a re-run (or an agent
 * already imported under another list) is matched, not duplicated.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
const DUMP = flags.includes("--dump-json");
const PARSE_ONLY = flags.includes("--parse-only");

if (!file) {
  console.error("usage: import-keyano-sea-agents.mjs <file.xlsx|file.json> [--parse-only|--dump-json|--commit]");
  process.exit(2);
}

const SOURCE = "the Keyano Agents — Southeast Asia list";

// The Region column holds "SEA"; map it to the Illume region. Everything on this
// list is Southeast Asia, but the lookup keeps it honest if a stray value appears.
const REGION_FROM_COL = { sea: "Southeast Asia", "southeast asia": "Southeast Asia" };
const DEFAULT_REGION = "Southeast Asia";

const EMAIL_G = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const known = (v) => clean(v) || null;
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function readWorkbook(path) {
  if (path.toLowerCase().endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const py = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = {}
for ws in wb.worksheets:
    rows = [[("" if c is None else str(c).strip()) for c in r] for r in ws.iter_rows(values_only=True)]
    rows = [r for r in rows if any(r)]
    if not rows: continue
    out[ws.title] = {"header": rows[0], "rows": rows[1:]}
print(json.dumps(out, ensure_ascii=False))
`;
  const raw = execFileSync("python", ["-c", py, path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  return JSON.parse(raw);
}

/** Index of the column whose header equals `want` (case-insensitive, trimmed). */
const colExact = (header, want) => header.findIndex((h) => clean(h).toLowerCase() === want.toLowerCase());

/** Every valid email found anywhere in the given cells — pulled OUT of messy
 *  cells (stray leading glyphs, " / " and newline separators, two people). */
function emailsFrom(cells) {
  const out = [];
  for (const cell of cells) {
    if (!cell) continue;
    for (const e of String(cell).match(EMAIL_G) ?? []) {
      if (!out.some((x) => x.toLowerCase() === e.toLowerCase())) out.push(e);
    }
  }
  return out;
}

function parse(book) {
  // One sheet, whatever it is named ("Sheet1"). Take the first sheet that has
  // an "Agent Name" header so a renamed tab still works.
  const sheets = Object.entries(book);
  const picked = sheets.find(([, d]) => colExact(d.header, "Agent Name") >= 0) ?? sheets[0];
  if (!picked) return { rows: [], problems: [{ kind: "NO_SHEET", name: "", detail: "workbook has no sheets" }] };
  const [sheet, { header, rows: raw }] = picked;

  const iName = colExact(header, "Agent Name");
  const iCountry = colExact(header, "Country");
  const iRegion = colExact(header, "Region");
  const iContact = colExact(header, "Contact Person");
  const iEmail = colExact(header, "Email");
  const iPhone = colExact(header, "Phone Number");
  const iAgreement = colExact(header, "Agreement Status");
  const iTier = colExact(header, "Tier");

  const problems = [];
  if (iName < 0) { problems.push({ kind: "NO_NAME_COL", name: "", detail: `"Agent Name" column not found in ${sheet}` }); return { rows: [], problems, sheet }; }

  const rows = [];
  for (const r of raw) {
    const at = (i) => (i >= 0 && i < r.length ? clean(r[i]) : "");
    const name = at(iName);
    if (!name) continue;

    // Keep the country label as given (used for the "(Country)" name suffix the
    // backfill adds). Blank → "Global", matching the other importers.
    let country = at(iCountry) || "Global";

    const regionRaw = at(iRegion);
    const regionName = REGION_FROM_COL[regionRaw.toLowerCase()] ?? DEFAULT_REGION;

    const emails = emailsFrom([at(iEmail)]);
    if (!emails.length) problems.push({ kind: "NO_EMAIL", name, detail: "no usable email" });

    const contactPerson = known(at(iContact));
    const agreement = known(at(iAgreement));
    const tier = known(at(iTier));

    const notes = [
      `Imported from ${SOURCE}.`,
      agreement && `Agreement status: ${agreement}`,
      tier && `Tier: ${tier}`,
    ].filter(Boolean).join("\n");

    rows.push({
      sheet, name,
      country, regionName,
      contactPerson: contactPerson ?? (emails[0] ?? null),
      email: emails[0] ?? null,
      phone: known(at(iPhone)),
      agreementStatus: agreement,
      notes,
      // Second email onward becomes a PartnerContact. No reliable second name in
      // the cell, so the email stands as the label (same as the other importers).
      extraContacts: emails.slice(1).map((email) => ({ fullName: email, email })),
    });
  }
  return { rows, problems, sheet };
}

function dedupe(rows) {
  const byKey = new Map();
  const merged = [];
  for (const row of rows) {
    const key = `${norm(row.name)}::${norm(row.country)}`;
    const seen = byKey.get(key);
    if (!seen) { byKey.set(key, row); continue; }
    merged.push({ name: row.name, country: row.country });
    for (const c of [{ email: row.email }, ...row.extraContacts]) {
      if (!c.email) continue;
      const already = seen.email?.toLowerCase() === c.email.toLowerCase() || seen.extraContacts.some((x) => x.email.toLowerCase() === c.email.toLowerCase());
      if (!already) seen.extraContacts.push({ fullName: c.email, email: c.email });
    }
  }
  return { rows: [...byKey.values()], merged };
}

const deSuffix = (name, country) => {
  const c = (country ?? "").trim();
  if (!c) return name;
  return name.replace(new RegExp("\\s*\\(" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\)\\s*$", "i"), "").trim();
};

async function main() {
  if (DUMP) {
    const out = file.replace(/\.xlsx$/i, "") + ".json";
    writeFileSync(out, JSON.stringify(readWorkbook(file)), "utf8");
    console.log(`Wrote ${out}`);
    return;
  }

  const { rows: parsed, problems, sheet } = parse(readWorkbook(file));
  const { rows, merged } = dedupe(parsed);

  console.log(`SHEET: ${sheet}`);
  if (merged.length) { console.log(`MERGED within file (${merged.length})`); for (const m of merged) console.log(`  ${m.name} (${m.country})`); console.log(); }
  if (problems.length) {
    const byKind = {};
    for (const p of problems) (byKind[p.kind] ??= []).push(p);
    console.log(`FLAGGED (${problems.length})`);
    for (const [k, list] of Object.entries(byKind)) {
      console.log(`  ${k}: ${list.length}`);
      for (const p of list) console.log(`     ${p.name} — ${p.detail}`);
    }
    console.log();
  }

  console.log(`PARSED: ${parsed.length} rows, ${rows.length} after merge`);
  console.log(`  by region: ${Object.entries(rows.reduce((a, r) => ((a[r.regionName] = (a[r.regionName] ?? 0) + 1), a), {})).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  by country: ${Object.entries(rows.reduce((a, r) => ((a[r.country] = (a[r.country] ?? 0) + 1), a), {})).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  contact rows: ${rows.reduce((n, r) => n + r.extraContacts.length, 0)}\n`);
  for (const r of rows) {
    console.log(`  • ${r.name} [${r.country}] — ${r.contactPerson ?? "—"} · ${r.email ?? "no email"}${r.extraContacts.length ? ` (+${r.extraContacts.length} contact)` : ""}${r.phone ? ` · ${r.phone}` : ""}`);
  }
  console.log();

  if (PARSE_ONLY) { console.log("Parse-only — no DB, nothing written."); return; }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const [{ d: database, u: dbuser }] = await db.$queryRawUnsafe("SELECT current_database() AS d, current_user AS u");
    console.log(`${COMMIT ? "COMMIT" : "DRY RUN"} — database ${database} as ${dbuser}\n`);

    const existing = await db.region.findMany({ select: { id: true, name: true } });
    const regionId = new Map(existing.map((r) => [r.name, r.id]));
    const missingRegions = [...new Set(rows.map((r) => r.regionName).filter(Boolean))].filter((n) => !regionId.has(n));
    if (missingRegions.length) { console.error(`STOP: these regions do not exist: ${missingRegions.join(", ")}`); process.exit(1); }

    const author = await db.user.findFirst({ where: { role: "SUPER_ADMIN", deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
    if (!author) { console.error("STOP: no SUPER_ADMIN to attribute to."); process.exit(1); }

    const present = await db.recruitmentPartner.findMany({ where: { type: "AGENT", deletedAt: null }, select: { id: true, name: true, country: true } });
    const presentKey = new Map(present.map((p) => [`${norm(deSuffix(p.name, p.country))}::${norm(p.country)}`, p.id]));

    const toCreate = rows.filter((r) => !presentKey.has(`${norm(r.name)}::${norm(r.country)}`));
    const already = rows.length - toCreate.length;

    console.log(`PLAN — attributed to ${author.email}`);
    console.log(`  after merge      ${rows.length}`);
    console.log(`  already present  ${already}`);
    console.log(`  to create        ${toCreate.length}`);
    console.log(`  contacts         ${toCreate.reduce((n, r) => n + r.extraContacts.length, 0)}\n`);
    if (already) {
      console.log("  already present:");
      for (const r of rows.filter((r) => presentKey.has(`${norm(r.name)}::${norm(r.country)}`))) console.log(`     ${r.name} [${r.country}]`);
      console.log();
    }

    if (!COMMIT) { console.log("Dry run — nothing written. Re-run with --commit.\n"); return; }

    let made = 0, contacts = 0;
    for (const r of toCreate) {
      await db.$transaction(async (tx) => {
        const partner = await tx.recruitmentPartner.create({
          data: { name: r.name, type: "AGENT", country: r.country, contactPerson: r.contactPerson, email: r.email, phone: r.phone, agreementStatus: r.agreementStatus, notes: r.notes, regionId: regionId.get(r.regionName) ?? null, isActive: true, createdById: author.id },
          select: { id: true },
        });
        if (r.extraContacts.length) {
          await tx.partnerContact.createMany({ data: r.extraContacts.map((c) => ({ partnerId: partner.id, fullName: c.fullName, email: c.email, isPrimary: false, isActive: true })) });
          contacts += r.extraContacts.length;
        }
      });
      made += 1;
    }
    console.log(`WROTE ${made} agents and ${contacts} contact rows.`);
    console.log(`  AGENT partners now ${await db.recruitmentPartner.count({ where: { type: "AGENT", deletedAt: null } })}\n`);
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main();

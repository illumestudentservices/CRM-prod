/**
 * Imports the "Africa Agent & School Database" workbook into Recruitment
 * Partners (type AGENT). Sibling of import-agents.mjs, which handles the
 * differently-shaped "Compiled agent database" — this file's sheets use
 * First/Last-name columns, an "Agent Name" sheet, and two sheets (Pakistan, ME)
 * that cram every contact detail into one free-text cell, so each sheet is
 * mapped explicitly here rather than by generic header-sniffing.
 *
 *   node scripts/import-africa-agents.mjs <file.xlsx> --parse-only   # no DB, prints the plan
 *   node scripts/import-africa-agents.mjs <file.xlsx> --dump-json    # xlsx -> json (prod has no openpyxl)
 *   node --env-file=.env scripts/import-africa-agents.mjs <file.json>            # dry run vs the DB
 *   node --env-file=.env scripts/import-africa-agents.mjs <file.json> --commit   # writes
 *
 * The HIGH SCHOOL sheet is skipped on purpose (agents only). New agents are
 * created with the bare name; run backfill-partner-country-in-name.mjs afterwards
 * to add the "(Country)" suffix, exactly as the compiled import did.
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
  console.error("usage: import-africa-agents.mjs <file.xlsx|file.json> [--parse-only|--dump-json|--commit]");
  process.exit(2);
}

// Sheets to import, with each column's role. "blob" columns are free text that
// hold several people's emails/phones mashed together — we pull the emails out
// and keep the raw text in notes. A sheet absent here (High school) is skipped.
const AFRICA = "the Africa Agent & School Database";
const SEA = "the SEA agent database";
const CHINA = "the China agent list";
const SHEETS = {
  // ── Africa Agent & School Database ──
  "Africa AGENT Database": { source: AFRICA, name: "Consultancy", dept: "Department", first: "First name", last: "Last name", email: ["Email"], phone: "Contact Number", country: "Country", city: "City", vip: "VIP" },
  "North Africa and Levant Region": { source: AFRICA, name: "Consultancy", dept: "Department", first: "First name", last: "Last name", email: ["Email"], phone: "Phone", country: "Country", city: "City", vip: "VIP" },
  "Pakistan": { source: AFRICA, name: "Agent Name", email: ["Email IDS", "Contact"], blob: ["Contact"], fixedCountry: "Pakistan", vip: "VIP´s" },
  "ME": { source: AFRICA, name: "Consultancy", email: ["Contact details"], blob: ["Contact details"], address: "Address", country: "Country", city: "City", vip: "VIP" },
  // ── SEA agent database ──
  "SEA": { source: SEA, name: "Consultancy", contact: "Contact Name", email: ["E-mail Id"], country: "Country", city: "City" },
  // No agency column — every row is an IDP office contact, keyed by its country.
  "IDP SEA": { source: SEA, fixedName: "IDP", first: "First Name", last: "Last name", dept: "Tittle", email: ["Email"], phone: "Phone", country: "Region" },
  "Thai Agent": { source: SEA, name: "Agent", contact: "Contact", dept: "Position", email: ["Email"], fixedCountry: "Thailand" },
  // ── China agent list ──
  "Agent List China": { source: CHINA, name: "COMPANY (agency/school)", dept: "TYPE", contact: "Contact Name", email: ["Email"], phone: "Phone", country: "COUNTRY", city: "City" },
};

const COUNTRY_FIX = {
  morroco: "Morocco",
  ksa: "Saudi Arabia",
  "saudi arabia ": "Saudi Arabia",
  nairobi: "Kenya",       // a city used in the Country column
  dubai: "UAE",
  "u.a.e": "UAE",
  "u.a.e.": "UAE",
  // IDP SEA "Region" column holds office codes, not countries.
  "manila - php": "Philippines",
  "cebu-php": "Philippines",
  "hcm1- vn": "Vietnam",
  "hn1-vn": "Vietnam",
  "dn - vn": "Vietnam",
  "dn-vn": "Vietnam",
  "da nang and nha trang/vn": "Vietnam",
  "phnompenh- cambodia": "Cambodia",
  "jakarta - indo": "Indonesia",
  indo: "Indonesia",
};

const REGION = {
  // Africa (sub-Saharan + North Africa)
  nigeria: "Africa", kenya: "Africa", uganda: "Africa", ghana: "Africa", zimbabwe: "Africa",
  cameroon: "Africa", rwanda: "Africa", "south africa": "Africa", tanzania: "Africa", zambia: "Africa",
  ethiopia: "Africa", madagascar: "Africa", mauritius: "Africa", gambia: "Africa", gabon: "Africa",
  "dr congo": "Africa", namibia: "Africa",
  egypt: "Africa", morocco: "Africa", tunisia: "Africa", algeria: "Africa",
  // Middle East (Gulf + Levant + Turkey — user decision 2026-11-03)
  uae: "Middle East", "saudi arabia": "Middle East", jordan: "Middle East", lebanon: "Middle East",
  bahrain: "Middle East", qatar: "Middle East", kuwait: "Middle East", oman: "Middle East",
  turkey: "Middle East",
  // South Asia
  pakistan: "South Asia", india: "South Asia", bangladesh: "South Asia", "sri lanka": "South Asia", nepal: "South Asia",
  // Southeast Asia
  philippines: "Southeast Asia", thailand: "Southeast Asia", vietnam: "Southeast Asia", indonesia: "Southeast Asia",
  malaysia: "Southeast Asia", cambodia: "Southeast Asia", myanmar: "Southeast Asia", laos: "Southeast Asia",
  singapore: "Southeast Asia", brunei: "Southeast Asia", "timor-leste": "Southeast Asia",
  // China
  china: "China", taiwan: "China", "hong kong": "China",
  // North America (a few SEA-sheet agencies list a Canada office)
  canada: "North America", jamaica: "North America",
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
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
function colExact(header, want) {
  if (!want) return -1;
  return header.findIndex((h) => clean(h).toLowerCase() === want.toLowerCase());
}

/** Every valid email found anywhere in the given cells. */
function emailsFrom(cells) {
  const out = [];
  for (const cell of cells) {
    if (!cell) continue;
    for (const piece of String(cell).split(/[;,\s]+/)) {
      const tok = piece.trim().replace(/[.,;]+$/, "");
      if (EMAIL_RE.test(tok) && !out.some((e) => e.toLowerCase() === tok.toLowerCase())) out.push(tok);
    }
  }
  return out;
}

function parse(book) {
  const rows = [];
  const problems = [];

  for (const [sheet, map] of Object.entries(SHEETS)) {
    const sheetData = book[sheet];
    // The SHEETS map spans several workbooks; a sheet not in THIS file is simply
    // not ours to process here, not a problem.
    if (!sheetData) continue;
    const { header, rows: raw } = sheetData;
    const iName = map.name ? colExact(header, map.name) : -1;
    const iContact = map.contact ? colExact(header, map.contact) : -1;
    const iCountry = map.country ? colExact(header, map.country) : -1;
    const iCity = map.city ? colExact(header, map.city) : -1;
    const iFirst = map.first ? colExact(header, map.first) : -1;
    const iLast = map.last ? colExact(header, map.last) : -1;
    const iDept = map.dept ? colExact(header, map.dept) : -1;
    const iPhone = map.phone ? colExact(header, map.phone) : -1;
    const iAddress = map.address ? colExact(header, map.address) : -1;
    const iVip = map.vip ? colExact(header, map.vip) : -1;
    const iEmails = (map.email ?? []).map((h) => colExact(header, h)).filter((j) => j >= 0);
    const iBlob = (map.blob ?? []).map((h) => colExact(header, h)).filter((j) => j >= 0);

    if (iName < 0 && !map.fixedName) { problems.push({ kind: "NO_NAME_COL", sheet, name: "", detail: `name column "${map.name}" not found` }); continue; }

    for (const r of raw) {
      const at = (i) => (i >= 0 && i < r.length ? clean(r[i]) : "");
      const name = at(iName) || map.fixedName || "";
      if (!name) continue;

      let country = at(iCountry) || map.fixedCountry || "";
      const fix = COUNTRY_FIX[country.toLowerCase()];
      const fixes = [];
      if (fix) { fixes.push(`country "${country}" recorded as ${fix}`); country = fix; }

      // When the region can't be determined — blank country, or a country that
      // maps to no Illume region (e.g. Korea, "Global") — keep the agent anyway,
      // tagged "(Global)" in the name with no region, per the user's rule. The
      // original country (if any) is preserved in the notes.
      let regionName = country ? REGION[country.toLowerCase()] : null;
      let global = false;
      const originalCountry = country;
      if (!country || !regionName) {
        global = true;
        regionName = null;
        problems.push({ kind: "FILED_AS_GLOBAL", sheet, name, detail: country ? `country "${country}" has no region` : "country blank" });
        country = "Global"; // required field; backfill then suffixes the name "(Global)"
      }

      const emails = emailsFrom([...iEmails.map((j) => at(j)), ...iBlob.map((j) => at(j))]);
      if (!emails.length) problems.push({ kind: "NO_EMAIL", sheet, name, detail: "no usable email" });

      const personName = ([at(iFirst), at(iLast)].filter(Boolean).join(" ").trim() || at(iContact)) || null;

      const notes = [
        `Imported from ${map.source ?? "the agent database"} (sheet: ${sheet}).`,
        iDept >= 0 && at(iDept) && `Department/role: ${at(iDept)}`,
        iAddress >= 0 && at(iAddress) && `Address: ${at(iAddress)}`,
        iVip >= 0 && at(iVip) && `VIP: ${at(iVip)}`,
        iBlob.length && iBlob.some((j) => at(j)) && `Raw contact details from sheet: ${iBlob.map((j) => at(j)).filter(Boolean).join(" | ")}`,
        global && `Region not determined — filed as Global${originalCountry ? ` (original country: ${originalCountry})` : ""}.`,
        fixes.length && `Corrected on import: ${fixes.join("; ")}.`,
      ].filter(Boolean).join("\n");

      rows.push({
        sheet,
        name,
        country, regionName,
        city: known(at(iCity)),
        contactPerson: personName ?? (emails[0] ?? null),
        email: emails[0] ?? null,
        phone: known(at(iPhone))?.replace(/\n/g, " / ") ?? null,
        notes, fixes,
        extraContacts: emails.slice(1).map((email, i) => ({ fullName: (i === 0 && personName) ? null : email, email })).map((c) => ({ fullName: c.fullName ?? c.email, email: c.email })),
      });
    }
  }
  return { rows, problems };
}

function dedupe(rows) {
  const byKey = new Map();
  const merged = [];
  for (const row of rows) {
    const key = `${norm(row.name)}::${norm(row.country)}`;
    const seen = byKey.get(key);
    if (!seen) { byKey.set(key, row); continue; }
    merged.push({ name: row.name, country: row.country, sheets: [seen.sheet, row.sheet] });
    for (const c of [{ fullName: row.contactPerson ?? row.email, email: row.email }, ...row.extraContacts]) {
      if (!c.email) continue;
      const already = seen.email?.toLowerCase() === c.email.toLowerCase() || seen.extraContacts.some((x) => x.email.toLowerCase() === c.email.toLowerCase());
      if (!already) seen.extraContacts.push(c);
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

  const { rows: parsed, problems } = parse(readWorkbook(file));
  const { rows, merged } = dedupe(parsed);

  const corrected = rows.filter((r) => r.fixes.length);
  if (corrected.length) { console.log(`CORRECTIONS (${corrected.length})`); for (const r of corrected) console.log(`  ${r.name} — ${r.fixes.join("; ")}`); console.log(); }
  if (merged.length) { console.log(`MERGED within file (${merged.length})`); for (const m of merged) console.log(`  ${m.name} (${m.country})`); console.log(); }
  if (problems.length) {
    const byKind = {};
    for (const p of problems) (byKind[p.kind] ??= []).push(p);
    console.log(`FLAGGED (${problems.length})`);
    for (const [k, list] of Object.entries(byKind)) {
      console.log(`  ${k}: ${list.length}`);
      for (const p of list.slice(0, 8)) console.log(`     ${p.sheet} · ${p.name} — ${p.detail}`);
      if (list.length > 8) console.log(`     ... and ${list.length - 8} more`);
    }
    console.log();
  }

  const byRegionAll = {};
  for (const r of rows) byRegionAll[r.regionName] = (byRegionAll[r.regionName] ?? 0) + 1;
  console.log(`PARSED: ${parsed.length} rows, ${rows.length} after merge`);
  console.log(`  by region: ${Object.entries(byRegionAll).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`  contact rows: ${rows.reduce((n, r) => n + r.extraContacts.length, 0)}\n`);

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
    const byRegion = {};
    for (const r of toCreate) byRegion[r.regionName] = (byRegion[r.regionName] ?? 0) + 1;

    console.log(`PLAN — attributed to ${author.email}`);
    console.log(`  after merge      ${rows.length}`);
    console.log(`  already present  ${already}`);
    console.log(`  to create        ${toCreate.length}`);
    console.log(`  contacts         ${toCreate.reduce((n, r) => n + r.extraContacts.length, 0)}`);
    console.log(`  by region        ${Object.entries(byRegion).map(([k, v]) => `${k}=${v}`).join(", ")}\n`);

    if (!COMMIT) { console.log("Dry run — nothing written. Re-run with --commit.\n"); return; }

    let made = 0, contacts = 0;
    for (const r of toCreate) {
      await db.$transaction(async (tx) => {
        const partner = await tx.recruitmentPartner.create({
          data: { name: r.name, type: "AGENT", country: r.country, city: r.city, contactPerson: r.contactPerson, email: r.email, phone: r.phone, notes: r.notes, regionId: regionId.get(r.regionName) ?? null, isActive: true, createdById: author.id },
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

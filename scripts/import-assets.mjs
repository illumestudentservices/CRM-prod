/**
 * Imports the Global IT Equipment Inventory into the asset register.
 *
 *   node --env-file=.env.local scripts/import-assets.mjs <file.xlsx>
 *   node --env-file=.env.local scripts/import-assets.mjs <file.xlsx> --commit
 *
 * DRY RUN IS THE DEFAULT. `--commit` is the only thing that writes, and it
 * prints the same plan first so the two runs can be compared line for line.
 *
 * ── HOW ROWS ARE MATCHED ────────────────────────────────────────────────────
 *
 * On serial number where there is one — that is what a serial is for — and
 * otherwise on the combination of custodian, type, brand, model and country.
 * Eighteen of the 84 devices have no usable serial (blank, "Unknown", "NA"),
 * and without a composite key a re-run would insert every one of them a second
 * time. The composite is not perfect: two identical unserialised phones held by
 * the same person would collapse into one record. That is reported when it
 * happens rather than silently deduped.
 *
 * ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────
 *
 * It creates NO AssetAssignment rows, even for the custodians who already have
 * staff records. An assignment says "issued to this person, from this date", and
 * `assignedAt` would default to the moment of the import — asserting that all 84
 * devices were handed out on one afternoon, in an audit trail, which is simply
 * untrue. `custodianName` carries who has the device without inventing a date.
 * The script reports which custodians do have staff records so those can be
 * linked from the Assets tab, one click each, with a real date.
 *
 * It does not invent staff records either. The register names 52 people; the CRM
 * has 16 employees.
 *
 * ── VOCABULARY ──────────────────────────────────────────────────────────────
 *
 * Every mapping below is explicit. Nothing is fuzzy-matched: a near miss here
 * files a laptop under the wrong region or calls a working phone damaged, and
 * nobody would notice. Anything unrecognised stops the import and is named.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
/**
 * The workbook ships with two worked examples in rows 2 and 3 — "John Smith" in
 * UAE with a Dell Latitude, and "Spare Stock" in India with a monitor. They are
 * the only two rows carrying an Asset ID, both are dated 23-Jul-2026, and
 * "John Smith" is not an employee. They are skipped unless this is passed.
 */
const INCLUDE_EXAMPLES = flags.includes("--include-examples");

if (!file) {
  console.error("usage: import-assets.mjs <file.xlsx|file.json> [--commit] [--include-examples]");
  process.exit(2);
}

/** Sheet region → CRM region name. */
const REGION_MAP = {
  "africa": "Africa",
  "south asia": "South Asia",
  "southeast asia": "Southeast Asia",
  "mena": "Middle East",
  // The CRM's China region was called East Asia until migration 034 renamed it,
  // and the register uses East Asia, Greater China and China interchangeably for
  // the same three staff. All three land on the one region.
  "china": "China",
  "east asia": "China",
  "greater china": "China",
};

/** Sheet equipment type → the CRM's list. "Phone" and "iPad" are what people typed. */
const TYPE_MAP = {
  "laptop": "LAPTOP",
  "desktop": "DESKTOP",
  "monitor": "MONITOR",
  "mobile phone": "MOBILE_PHONE",
  "phone": "MOBILE_PHONE",
  "tablet": "TABLET",
  "ipad": "TABLET",
  "docking station": "DOCKING_STATION",
  "printer": "PRINTER",
  "headset": "HEADSET",
  "other": "OTHER",
};

/**
 * Sheet status → the CRM's list.
 *
 * "Not working" becomes REPAIR because that is what the register's own
 * Reference Lists mean by Repair, and those rows also carry a condition saying
 * the same thing. "Stolen" and "Temporary" are kept as themselves — see the
 * note in lib/assets.ts for why neither is folded into Lost or In Use.
 */
const STATUS_MAP = {
  "in use": "IN_USE",
  "spare": "SPARE",
  "temporary": "TEMPORARY",
  "repair": "REPAIR",
  "not working": "REPAIR",
  "lost": "LOST",
  "stolen": "STOLEN",
  "retired": "RETIRED",
};

/**
 * Sheet condition → the CRM's list. `null` means "recorded, but not a condition"
 * and lands as no condition rather than a guess.
 *
 * "Spare" appears in the Condition column on one row whose status is already
 * In Use — somebody put the status in the wrong column. It maps to nothing and
 * is reported.
 */
const CONDITION_MAP = {
  "excellent": "EXCELLENT",
  "good": "GOOD",
  "fair": "FAIR",
  "poor": "POOR",
  "bad": "POOR",
  "damaged": "DAMAGED",
  "faulty": "DAMAGED",
  "not working": "DAMAGED",
  "broken and cannot start": "DAMAGED",
  "unknown": null,
  "spare": null,
};

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/** Values that mean "we do not know", across every column in this sheet. */
const UNKNOWN = new Set(["", "-", "na", "n/a", "nil", "none", "unknown", "don't know", "dont know"]);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Trimmed text, with newlines and doubled spaces flattened. One serial has a leading \n. */
const clean = (v) =>
  String(v ?? "").replace(/[\r\n]+/g, " ").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();

/** Trimmed text, or null when the cell means "unknown". */
const known = (v) => {
  const s = clean(v);
  return UNKNOWN.has(s.toLowerCase()) ? null : s;
};

/**
 * Reads the workbook through Python's openpyxl rather than an npm xlsx package,
 * for the reason given in import-clients.mjs: the registry `xlsx` package is
 * stale and has carried prototype-pollution and ReDoS advisories.
 *
 * PYTHONIOENCODING is forced because on Windows the default stdout codepage
 * turns any non-Latin-1 character into a replacement character, and this sheet
 * has typographic apostrophes in the comments.
 */
function readSheet(path) {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const py = `
import json, sys, warnings, openpyxl
warnings.filterwarnings("ignore")
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb["Asset Register"] if "Asset Register" in wb.sheetnames else wb.worksheets[0]
rows = list(ws.iter_rows(values_only=True))
hdr = [("" if c is None else str(c).strip()) for c in rows[0]]
out = []
for r in rows[1:]:
    d = {hdr[i]: r[i] for i in range(len(hdr)) if hdr[i]}
    # A row is real if ANY cell has content. Trailing formatted-but-empty rows
    # are common in these templates and must not become blank assets.
    if any(str(v).strip() for v in d.values() if v is not None):
        out.append(d)
print(json.dumps(out, default=str, ensure_ascii=False))
`;
  const raw = execFileSync("python", ["-c", py, path], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(raw);
}

/**
 * Purchase year + month → a date and how much of it to believe.
 *
 * "October (or Nov)" is a real entry: the month is taken and the doubt is kept
 * in the notes rather than thrown away or averaged into nothing.
 */
function parsePurchase(yearRaw, monthRaw) {
  const y = known(yearRaw);
  const year = y && /^\d{4}$/.test(y) ? Number(y) : null;
  if (!year) return { purchasedAt: null, purchasePrecision: null, note: null };

  const m = known(monthRaw);
  if (!m) return { purchasedAt: new Date(Date.UTC(year, 0, 1)), purchasePrecision: "YEAR", note: null };

  // Take the first month word; "October (or Nov)" and "October" both resolve.
  const first = m.toLowerCase().match(/[a-z]+/)?.[0];
  const month = first ? MONTHS[first] : undefined;
  if (!month) {
    return {
      purchasedAt: new Date(Date.UTC(year, 0, 1)),
      purchasePrecision: "YEAR",
      note: `Purchase month recorded as "${m}".`,
    };
  }
  const ambiguous = /\bor\b/i.test(m);
  return {
    purchasedAt: new Date(Date.UTC(year, month - 1, 1)),
    purchasePrecision: "MONTH",
    note: ambiguous ? `Purchase month recorded as "${m}".` : null,
  };
}

/**
 * The register's Date Verified, in four different formats: an Excel datetime,
 * "23-Jul-2026", "Aug 3rd 2026", and blank. Parsed explicitly rather than handed
 * to `new Date()`, which reads "23-Jul-2026" as Invalid Date on some engines and
 * silently accepts nonsense on others.
 */
function parseVerified(raw) {
  const s = known(raw);
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                        // 2026-07-28 00:00:00
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  m = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/);                  // 23-Jul-2026
  if (m && MONTHS[m[2].toLowerCase()]) {
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()] - 1, +m[1]));
  }

  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})$/); // Aug 3rd 2026
  if (m && MONTHS[m[1].toLowerCase()]) {
    return new Date(Date.UTC(+m[3], MONTHS[m[1].toLowerCase()] - 1, +m[2]));
  }
  return undefined; // distinct from null: unparseable, worth reporting
}

function normalise(records) {
  return records.map((raw, i) => {
    const g = (want) => {
      const k = Object.keys(raw).find((x) => clean(x).toLowerCase() === want.toLowerCase());
      return k ? raw[k] : undefined;
    };
    const row = i + 2; // sheet row, header is row 1

    const brand = known(g("Brand"));
    const model = known(g("Model"));
    const typeRaw = clean(g("Equipment Type"));
    const type = TYPE_MAP[typeRaw.toLowerCase()] ?? null;

    const statusRaw = clean(g("Current Status"));
    const status = STATUS_MAP[statusRaw.toLowerCase()] ?? null;

    const conditionRaw = clean(g("Condition"));
    const conditionKnown = conditionRaw.toLowerCase() in CONDITION_MAP;
    const condition = conditionKnown ? CONDITION_MAP[conditionRaw.toLowerCase()] : undefined;

    const regionRaw = clean(g("Region"));
    const regionName = REGION_MAP[regionRaw.toLowerCase()] ?? null;

    const purchase = parsePurchase(g("Purchase Year"), g("Purchase Month"));
    const verifiedAt = parseVerified(g("Date Verified"));

    const comments = known(g("Comments"));
    // The purchase-month doubt is appended rather than dropped, because
    // "October (or Nov)" is information and `purchasePrecision: MONTH` alone
    // would present it as certain.
    const notes = [comments, purchase.note].filter(Boolean).join(" ") || null;

    return {
      row,
      assetTag: known(g("Asset ID")),
      regionRaw, regionName,
      country: known(g("Country")),
      custodianName: known(g("Employee")),
      custodianPosition: known(g("Position")),
      typeRaw, type,
      brand, model,
      // A device name is not in the register, so it is built from brand and
      // model — "HP EliteBook 1040 G10" — which is how these are referred to in
      // conversation. One row has neither and falls back to the equipment type
      // AS THE PERSON WROTE IT ("Laptop"), not the CRM's internal token, which
      // would have put a shouted "LAPTOP" in the middle of the list.
      name: [brand, model].filter(Boolean).join(" ") || typeRaw || "Device",
      serialNumber: known(g("Serial Number")),
      statusRaw, status,
      conditionRaw, condition,
      accessories: known(g("Accessories")),
      verifiedBy: known(g("Verified By")),
      verifiedAtRaw: clean(g("Date Verified")),
      verifiedAt,
      notes,
      ...purchase,
      purchaseYearRaw: clean(g("Purchase Year")),
    };
  });
}

/** Identity for a row with no usable serial. */
const compositeKey = (r) =>
  [r.custodianName, r.type, r.brand, r.model, r.country]
    .map((x) => (x ?? "").toLowerCase()).join("|");

async function main() {
  const rows = normalise(readSheet(file));
  console.log(`read ${rows.length} rows from ${file}\n`);

  const examples = rows.filter((r) => r.assetTag);
  let live = rows;
  if (!INCLUDE_EXAMPLES && examples.length) {
    live = rows.filter((r) => !r.assetTag);
    console.log(`skipping ${examples.length} template example row(s) — pass --include-examples to keep them:`);
    for (const e of examples) {
      console.log(`    row ${e.row}: ${e.assetTag}  ${e.custodianName}  ${e.name}`);
    }
    console.log();
  }

  // ── Validate before touching anything ─────────────────────────────────────
  const blocking = [];
  const warnings = [];

  for (const r of live) {
    if (!r.type) blocking.push(`row ${r.row}: Equipment Type "${r.typeRaw}" is not on the reference list`);
    if (!r.status) blocking.push(`row ${r.row}: Current Status "${r.statusRaw}" is not on the reference list`);
    if (r.regionRaw && !r.regionName) blocking.push(`row ${r.row}: Region "${r.regionRaw}" does not map to a CRM region`);
    if (r.condition === undefined) {
      blocking.push(`row ${r.row}: Condition "${r.conditionRaw}" is not on the reference list`);
    }
    if (r.verifiedAt === undefined) {
      blocking.push(`row ${r.row}: Date Verified "${r.verifiedAtRaw}" could not be read as a date`);
    }
    if (!r.custodianName) warnings.push(`row ${r.row}: no Employee named — imported with no custodian`);
    if (!r.serialNumber) warnings.push(`row ${r.row}: no serial (${r.custodianName} · ${r.name}) — matched on custodian+model instead`);
    if (r.conditionRaw && r.condition === null) {
      warnings.push(`row ${r.row}: Condition "${r.conditionRaw}" is not a condition — left blank (status is "${r.statusRaw}")`);
    }
    if (!r.purchasedAt) warnings.push(`row ${r.row}: purchase date unknown (year "${r.purchaseYearRaw}")`);
  }

  // Duplicates within the sheet itself.
  const bySerial = new Map();
  const byComposite = new Map();
  for (const r of live) {
    if (r.serialNumber) {
      const k = r.serialNumber.toLowerCase();
      if (bySerial.has(k)) blocking.push(`rows ${bySerial.get(k)} and ${r.row} share serial ${r.serialNumber}`);
      else bySerial.set(k, r.row);
    } else {
      const k = compositeKey(r);
      if (byComposite.has(k)) {
        blocking.push(
          `rows ${byComposite.get(k)} and ${r.row} are indistinguishable without a serial ` +
          `(${r.custodianName} · ${r.name} · ${r.country}) — give one of them a serial or an asset tag`
        );
      } else byComposite.set(k, r.row);
    }
  }

  const regionRows = await db.region.findMany({ select: { id: true, name: true } });
  const regionByName = new Map(regionRows.map((r) => [r.name, r.id]));
  for (const want of new Set(live.map((r) => r.regionName).filter(Boolean))) {
    if (!regionByName.has(want)) blocking.push(`CRM has no region named "${want}"`);
  }

  if (blocking.length) {
    console.log("── BLOCKING ───────────────────────────────────────────────────");
    for (const b of blocking) console.log(`  ${b}`);
    console.log(`\nREFUSING TO IMPORT: ${blocking.length} blocking issue(s). Nothing was written.`);
    return 1;
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  const existing = await db.iTAsset.findMany({
    select: {
      id: true, name: true, serialNumber: true, type: true, brand: true,
      model: true, country: true, custodianName: true,
    },
  });
  const existingBySerial = new Map(
    existing.filter((e) => e.serialNumber).map((e) => [e.serialNumber.toLowerCase(), e])
  );
  const existingByComposite = new Map(existing.map((e) => [compositeKey(e), e]));

  let created = 0, updated = 0;
  console.log("── plan ───────────────────────────────────────────────────────");
  for (const r of live) {
    const hit = r.serialNumber
      ? existingBySerial.get(r.serialNumber.toLowerCase())
      : existingByComposite.get(compositeKey(r));

    console.log(
      `  ${hit ? "update" : "create"}  ` +
      `${(r.custodianName ?? "—").slice(0, 20).padEnd(21)} ` +
      `${r.name.slice(0, 34).padEnd(35)} ` +
      `${r.type.padEnd(14)} ${r.status.padEnd(10)} ` +
      `${(r.condition ?? "—").padEnd(10)} ${(r.regionName ?? "—").padEnd(15)} ` +
      `${r.serialNumber ?? "(no serial)"}`
    );

    if (hit) updated++; else created++;
    if (!COMMIT) continue;

    const data = {
      name: r.name,
      type: r.type,
      status: r.status,
      condition: r.condition,
      serialNumber: r.serialNumber,
      assetTag: r.assetTag,
      brand: r.brand,
      model: r.model,
      regionId: r.regionName ? regionByName.get(r.regionName) : null,
      country: r.country,
      custodianName: r.custodianName,
      custodianPosition: r.custodianPosition,
      accessories: r.accessories,
      verifiedBy: r.verifiedBy,
      verifiedAt: r.verifiedAt,
      purchasedAt: r.purchasedAt,
      purchasePrecision: r.purchasePrecision,
      notes: r.notes,
    };

    if (hit) await db.iTAsset.update({ where: { id: hit.id }, data });
    else await db.iTAsset.create({ data });
  }

  // ── Who could be linked to a real staff record ────────────────────────────
  const custodians = [...new Set(live.map((r) => r.custodianName).filter(Boolean))];
  const employees = await db.employee.findMany({
    select: { employeeId: true, jobTitle: true, user: { select: { name: true, deletedAt: true } } },
  });
  const linkable = custodians.filter((c) =>
    employees.some((e) => !e.user.deletedAt && (e.user.name ?? "").toLowerCase() === c.toLowerCase())
  );

  console.log("\n── custodians ─────────────────────────────────────────────────");
  console.log(`  ${custodians.length} named on the register, ${linkable.length} already have a staff record.`);
  if (linkable.length) {
    console.log(`  Linkable now via Assign on the Assets tab: ${linkable.join(", ")}`);
  }
  console.log("  No assignments were created: AssetAssignment records a start date, and");
  console.log("  defaulting it to the import would claim every device was handed out today.");

  if (warnings.length) {
    console.log("\n── warnings ───────────────────────────────────────────────────");
    for (const w of warnings) console.log(`  ${w}`);
  }

  console.log();
  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Would create ${created} and update ${updated}.`);
    console.log("Re-run with --commit to apply.");
    return 0;
  }

  const total = await db.iTAsset.count();
  const byStatus = await db.iTAsset.groupBy({ by: ["status"], _count: true });
  const byType = await db.iTAsset.groupBy({ by: ["type"], _count: true });
  console.log(`COMMITTED — created ${created}, updated ${updated}. Register now holds ${total}.`);
  console.log(`  status: ${byStatus.map((s) => `${s.status}=${s._count}`).join("  ")}`);
  console.log(`  type:   ${byType.map((t) => `${t.type}=${t._count}`).join("  ")}`);
  console.log(`  with a serial: ${await db.iTAsset.count({ where: { NOT: { serialNumber: null } } })}`);
  console.log(`  with a region: ${await db.iTAsset.count({ where: { NOT: { regionId: null } } })}`);
  return 0;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error("FAILED:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally { await db.$disconnect(); await pool.end(); }
process.exit(code);

/**
 * Imports the regional agent database into Recruitment Partners.
 *
 *   node --env-file=.env scripts/import-agents.mjs <file.xlsx>
 *   node --env-file=.env scripts/import-agents.mjs <file.xlsx> --commit
 *
 * DRY RUN IS THE DEFAULT. `--commit` is the only thing that writes, and it
 * prints the same plan first so the two runs can be compared line for line.
 *
 * ── WHAT IT CREATES ─────────────────────────────────────────────────────────
 *
 * One RecruitmentPartner (`sources`, type AGENT) per agency, plus one
 * PartnerContact for every email address beyond the first. 246 agencies carry
 * 354 addresses between them: 82 rows list two or more, and collapsing those
 * into a single `email` column would both lose working addresses and break the
 * partner edit form, which validates that column as one address.
 *
 * ── HOW ROWS ARE MATCHED ────────────────────────────────────────────────────
 *
 * On normalised name + country. Name alone is wrong: IDP appears on the Africa,
 * Sri Lanka and Nepal sheets, Adventus on Middle East and Sri Lanka, and Glinks,
 * Fortune and RIEC twice each. Those are different country offices with
 * different contacts, not duplicates, and merging them would discard a real
 * office. Re-running plans zero creates.
 *
 * ── VOCABULARY ──────────────────────────────────────────────────────────────
 *
 * Every correction below is explicit and listed in the report. Nothing is
 * fuzzy-matched and nothing is inferred at runtime: a near miss here files a
 * Kenyan agency under the wrong region, or invents an email address for a real
 * business, and nobody would notice.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");
/**
 * Writes the parsed workbook to <file>.json and stops. The production server
 * has python3 but not openpyxl, and installing a package on it to read a
 * spreadsheet once is the wrong trade — the workbook is converted here and the
 * JSON is what travels. `.json` input is then accepted below, so production
 * runs the identical script over identical data.
 */
const DUMP = flags.includes("--dump-json");

if (!file) {
  console.error("usage: import-agents.mjs <file.xlsx|file.json> [--commit] [--dump-json]");
  process.exit(2);
}

/**
 * Sheets with no Country column state it in the tab name instead. The Middle
 * East sheet DOES have one and its first row says Sri Lanka, so the column wins
 * wherever it is present — the tab is only a fallback.
 */
const SHEET_COUNTRY = {
  India: "India",
  Pakistan: "Pakistan",
  Bangladesh: "Bangladesh",
  Sri_Lanka: "Sri Lanka",
  Nepal: "Nepal",
  Canada_based_agents: "Canada",
};

/**
 * Country values that are typos, cities, or two countries in one cell. Each is
 * reported as a correction so the sheet can be fixed at source.
 *
 * "Dubai" appears in the COUNTRY column of four New_Agents rows whose CITY
 * column reads Sharjah, Deira and Abu Dhabi — it is plainly being used to mean
 * the UAE, not the emirate.
 *
 * The two dual-country cells keep the country of the office actually named in
 * the row; the second country is preserved in the notes rather than dropped.
 */
const COUNTRY_FIX = {
  cameron: "Cameroon",
  dubai: "UAE",
  congo: "DR Congo",
  "canada/nigeria": "Canada",
  "pakistan/australia": "Pakistan",
};

/**
 * Two rows leave Country blank. Keyed by normalised agency name so this cannot
 * misfire on a different row that happens to be blank later.
 *
 * International Education Link: city is Johannesburg and the address is
 * christine@int-edulinks.co.za — a South African city and a South African
 * domain agree, so this is evidence, not a guess.
 *
 * MKL is deliberately absent. Its phone is +383 (Kosovo) and the contact name
 * points the same way, but that is an inference about a real business and it is
 * left for a human. The row is reported and skipped, not invented.
 */
const COUNTRY_BLANK_FIX = {
  internationaleducationlink: {
    country: "South Africa",
    why: "city Johannesburg + .co.za email domain",
  },
};

/**
 * Country → CRM region. Anything not listed stops the import and is named,
 * rather than quietly creating a region-less agent nobody notices.
 *
 * North America is created by this script if it does not exist: the CRM shipped
 * with no such region and the sheet carries five Canadian and four Jamaican
 * agencies.
 */
const REGION = {
  // South Asia
  india: "South Asia",
  pakistan: "South Asia",
  bangladesh: "South Asia",
  "sri lanka": "South Asia",
  nepal: "South Asia",
  bhutan: "South Asia",
  // Africa
  kenya: "Africa",
  ethiopia: "Africa",
  nigeria: "Africa",
  ghana: "Africa",
  uganda: "Africa",
  tanzania: "Africa",
  rwanda: "Africa",
  zambia: "Africa",
  zimbabwe: "Africa",
  mauritius: "Africa",
  madagascar: "Africa",
  namibia: "Africa",
  cameroon: "Africa",
  "south africa": "Africa",
  "dr congo": "Africa",
  // Middle East
  uae: "Middle East",
  bahrain: "Middle East",
  // Europe
  norway: "Europe",
  azerbaijan: "Europe",
  // North America — created on demand, see above.
  canada: "North America",
  jamaica: "North America",
};

/**
 * Five cells contain two addresses typed with no separator between them, so the
 * first one's TLD runs straight into the second one's local part. They are
 * repaired from this table rather than by a regex, because a regex that splits
 * on a TLD boundary would also split a legitimate address containing ".com" in
 * the middle, and there are only five.
 *
 * A sixth bad address, countrymanager@explorecareers.co.k, is NOT repaired. The
 * TLD is truncated and ".co.ke" is only the likeliest completion — that row's
 * other address is valid and is used instead, with the broken one recorded in
 * the notes.
 */
const EMAIL_REPAIR = {
  "info@bnoverseas.comkamalbhumbla1@gmail.com": ["info@bnoverseas.com", "kamalbhumbla1@gmail.com"],
  "rupesh@competitivecareers.ininfo@competitivecareers.in": [
    "rupesh@competitivecareers.in",
    "info@competitivecareers.in",
  ],
  "study@megamindonline.comcanada8@megamindonline.comganesh@megamindonline.com": [
    "Study@megamindonline.com",
    "canada8@megamindonline.com",
    "ganesh@megamindonline.com",
  ],
  "viec.bangladesh@vieceducation.comsharif.rahman@gmail.com": [
    "viec.bangladesh@vieceducation.com",
    "sharif.rahman@gmail.com",
  ],
  "mimikusari@me.comardonbejtullahu98@gmail.com": ["mimikusari@me.com", "ardonbejtullahu98@gmail.com"],
};

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const known = (v) => clean(v) || null;
const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Reads the workbook. Python owns the xlsx, same as import-assets.mjs. A path
 * ending .json is taken as an already-converted workbook and used as-is.
 */
function readWorkbook(path) {
  if (path.toLowerCase().endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const py = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
NAMEH = ("consultancy", "agency name", "name of the agency")
out = {}
for ws in wb.worksheets:
    rows = [[("" if c is None else str(c).strip()) for c in r] for r in ws.iter_rows(values_only=True)]
    rows = [r for r in rows if any(r)]
    # Header row varies by sheet: banner rows and blank spacers sit above it,
    # and three sheets are indented by a column. Find it by content.
    hi = next((i for i, r in enumerate(rows[:6])
               if any(any(h in c.lower() for h in NAMEH) for c in r)), None)
    if hi is None:
        continue
    out[ws.title] = {"header": rows[hi], "rows": rows[hi + 1:]}
print(json.dumps(out, ensure_ascii=False))
`;
  const raw = execFileSync("python", ["-c", py, path], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return JSON.parse(raw);
}

/** Column index whose header matches any of `wants` (substring, case-insensitive). */
function col(header, ...wants) {
  return header.findIndex((h) => wants.some((w) => clean(h).toLowerCase().includes(w)));
}

/**
 * Pulls every address out of a cell. Splits on ; , and any whitespace, repairs
 * the five known run-together cells, drops anything still unparseable and
 * reports it. De-duplicates case-insensitively — several rows list the same
 * address in two columns.
 *
 * Whitespace has to be a separator, not just ";" and ",": a good number of
 * cells stack addresses on separate lines, and by the time a cell reaches here
 * those newlines have been collapsed to spaces. An address never contains
 * whitespace, so splitting on it cannot break a valid one.
 */
function emailsFrom(cells) {
  const out = [];
  const broken = [];
  for (const cell of cells) {
    if (!cell) continue;
    for (const piece of String(cell).split(/[;,\s]+/)) {
      const tok = piece.trim().replace(/[.,;]+$/, "");
      if (!tok) continue;
      const repaired = EMAIL_REPAIR[tok.toLowerCase()];
      for (const addr of repaired ?? [tok]) {
        if (EMAIL_RE.test(addr)) {
          if (!out.some((e) => e.toLowerCase() === addr.toLowerCase())) out.push(addr);
        } else {
          broken.push(addr);
        }
      }
    }
  }
  return { emails: out, broken };
}

/** Contact names, in sheet order. Several cells list two or three people. */
function namesFrom(cell) {
  if (!cell) return [];
  return String(cell)
    .split(/[;\n]+/)
    .map((s) => clean(s))
    .filter(Boolean);
}

function parse(book) {
  const rows = [];
  const problems = [];

  for (const [sheet, { header, rows: raw }] of Object.entries(book)) {
    const iName = col(header, "consultancy", "agency name", "name of the agency");
    const iCountry = col(header, "country");
    const iCity = col(header, "city");
    const iState = col(header, "state");
    const iContact = col(header, "contact name", "director name", "contact person");
    const iPhone = col(header, "contact no", "phone");
    // Emails can sit in more than one column: the Canada sheet has an India
    // mailbox and a Canada mailbox side by side.
    const iEmails = header.map((h, j) => (clean(h).toLowerCase().includes("mail") ? j : -1)).filter((j) => j >= 0);
    const iCanadaOffice = col(header, "canada office");
    const iIndiaOffice = col(header, "india office");

    // The New_Agents sheet has an unlabelled city column between name and
    // country. Picked up positionally only on that sheet, and only when the
    // header cell really is blank, so a later relabelling cannot silently
    // misread it.
    const iCityFallback =
      sheet === "New_Agents" && iCity < 0 && iName >= 0 && clean(header[iName + 1]) === "" ? iName + 1 : -1;

    for (const r of raw) {
      const at = (i) => (i >= 0 && i < r.length ? clean(r[i]) : "");
      const name = at(iName);
      if (!name) continue; // trailing formatted-but-empty rows

      const countryRaw = at(iCountry) || SHEET_COUNTRY[sheet] || "";
      const cityRaw = at(iCity) || at(iCityFallback);
      const { emails, broken } = emailsFrom(iEmails.map((j) => at(j)));
      const names = namesFrom(at(iContact));

      const fixes = [];
      let country = countryRaw;
      const fixed = COUNTRY_FIX[countryRaw.toLowerCase()];
      if (fixed) {
        fixes.push(`country "${countryRaw}" recorded as ${fixed}`);
        country = fixed;
      }
      if (!country) {
        const blankFix = COUNTRY_BLANK_FIX[norm(name)];
        if (blankFix) {
          fixes.push(`country was blank, recorded as ${blankFix.country} (${blankFix.why})`);
          country = blankFix.country;
        }
      }

      if (!country) {
        problems.push({ kind: "NO_COUNTRY", sheet, name, detail: "country blank and not inferable" });
        continue;
      }
      const regionName = REGION[country.toLowerCase()];
      if (!regionName) {
        problems.push({ kind: "NO_REGION", sheet, name, detail: `country "${country}" maps to no region` });
        continue;
      }
      if (!emails.length) problems.push({ kind: "NO_EMAIL", sheet, name, detail: "no usable email address" });
      for (const b of broken) {
        problems.push({ kind: "BAD_EMAIL", sheet, name, detail: b });
      }

      // Provenance and everything the partner columns have no home for. An
      // agency's second country, its offices, and an unusable address are all
      // real information; the alternative to notes is deleting them.
      const notes = [
        `Imported from the agent database (sheet: ${sheet}).`,
        at(iState) && `State/Province: ${at(iState)}`,
        iCanadaOffice >= 0 && at(iCanadaOffice) && `Canada office: ${at(iCanadaOffice).replace(/\n/g, ", ")}`,
        iIndiaOffice >= 0 && at(iIndiaOffice) && `India office: ${at(iIndiaOffice).replace(/\n/g, ", ")}`,
        countryRaw.toLowerCase() === "canada/nigeria" && "Also operates from Nigeria (Lagos office).",
        countryRaw.toLowerCase() === "pakistan/australia" && "Also operates from Australia.",
        names.length > 1 && `Contacts listed: ${names.join(", ")}.`,
        broken.length && `Unusable address in the source sheet, left uncorrected: ${broken.join(", ")}.`,
        fixes.length && `Corrected on import: ${fixes.join("; ")}.`,
      ]
        .filter(Boolean)
        .join("\n");

      rows.push({
        sheet,
        name,
        country,
        regionName,
        city: known(cityRaw),
        contactPerson: names[0] ?? null,
        email: emails[0] ?? null,
        phone: known(at(iPhone))?.replace(/\n/g, " / ") ?? null,
        notes,
        fixes,
        // Every address after the first becomes its own contact row.
        extraContacts: emails.slice(1).map((email, i) => ({
          // The only honest fullName: the person the sheet lists at that
          // position, or — where it lists none — the address itself, which is
          // the sole identifier we actually have. Nothing is invented.
          fullName: names[i + 1] ?? email,
          email,
        })),
      });
    }
  }
  return { rows, problems };
}

/** Collapses the six cross-sheet repeats that are genuinely the same office. */
function dedupe(rows) {
  const byKey = new Map();
  const merged = [];
  for (const row of rows) {
    const key = `${norm(row.name)}::${norm(row.country)}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, row);
      continue;
    }
    merged.push({ name: row.name, country: row.country, sheets: [seen.sheet, row.sheet] });
    // Keep the first row's identity and absorb any address the second adds.
    for (const c of [{ fullName: row.contactPerson ?? row.email, email: row.email }, ...row.extraContacts]) {
      if (!c.email) continue;
      const already =
        seen.email?.toLowerCase() === c.email.toLowerCase() ||
        seen.extraContacts.some((x) => x.email.toLowerCase() === c.email.toLowerCase());
      if (!already) seen.extraContacts.push(c);
    }
    seen.notes += `\nAlso listed on the ${row.sheet} sheet.`;
  }
  return { rows: [...byKey.values()], merged };
}

async function main() {
  if (DUMP) {
    const out = file.replace(/\.xlsx$/i, "") + ".json";
    writeFileSync(out, JSON.stringify(readWorkbook(file)), "utf8");
    console.log(`Wrote ${out}`);
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [{ d: database, u: dbuser }] = await db.$queryRawUnsafe(
      "SELECT current_database() AS d, current_user AS u"
    );
    console.log(`\n${COMMIT ? "COMMIT" : "DRY RUN"} — database ${database} as ${dbuser}\n`);

    const { rows: parsed, problems } = parse(readWorkbook(file));
    const { rows, merged } = dedupe(parsed);

    // ── Report what the sheet needed doing to it ──────────────────────────
    const corrected = rows.filter((r) => r.fixes.length);
    if (corrected.length) {
      console.log(`CORRECTIONS APPLIED (${corrected.length})`);
      for (const r of corrected) console.log(`  ${r.name} — ${r.fixes.join("; ")}`);
      console.log();
    }
    if (merged.length) {
      console.log(`MERGED, same agency and country on two sheets (${merged.length})`);
      for (const m of merged) console.log(`  ${m.name} (${m.country}) — ${m.sheets.join(" + ")}`);
      console.log();
    }
    if (problems.length) {
      console.log(`FLAGGED (${problems.length})`);
      for (const p of problems) console.log(`  [${p.kind}] ${p.sheet} · ${p.name} — ${p.detail}`);
      console.log();
    }

    // ── Regions ───────────────────────────────────────────────────────────
    const wanted = [...new Set(rows.map((r) => r.regionName))];
    const existing = await db.region.findMany({ select: { id: true, name: true } });
    const regionId = new Map(existing.map((r) => [r.name, r.id]));
    const missing = wanted.filter((n) => !regionId.has(n));

    for (const name of missing) {
      if (name !== "North America") {
        console.error(`STOP: region "${name}" does not exist and this script only creates North America.`);
        process.exit(1);
      }
      console.log(`REGION TO CREATE: ${name} (code NA)`);
      if (COMMIT) {
        const created = await db.region.create({
          data: { name, code: "NA", description: "Canada, Jamaica" },
          select: { id: true },
        });
        regionId.set(name, created.id);
      }
    }

    // ── Plan ──────────────────────────────────────────────────────────────
    const author = await db.user.findFirst({
      where: { role: "SUPER_ADMIN", deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true },
    });
    if (!author) {
      console.error("STOP: no SUPER_ADMIN to attribute the import to.");
      process.exit(1);
    }

    const present = await db.recruitmentPartner.findMany({
      where: { type: "AGENT", deletedAt: null },
      select: { id: true, name: true, country: true },
    });
    const presentKey = new Map(present.map((p) => [`${norm(p.name)}::${norm(p.country)}`, p.id]));

    const toCreate = rows.filter((r) => !presentKey.has(`${norm(r.name)}::${norm(r.country)}`));
    const already = rows.length - toCreate.length;

    const byRegion = {};
    for (const r of toCreate) byRegion[r.regionName] = (byRegion[r.regionName] ?? 0) + 1;

    console.log(`PLAN — attributed to ${author.email}`);
    console.log(`  agencies parsed        ${parsed.length}`);
    console.log(`  after merge            ${rows.length}`);
    console.log(`  already present        ${already}`);
    console.log(`  to create              ${toCreate.length}`);
    console.log(`  contact rows to create ${toCreate.reduce((n, r) => n + r.extraContacts.length, 0)}`);
    console.log(`  by region              ${Object.entries(byRegion).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log();

    if (!COMMIT) {
      console.log("Dry run — nothing written. Re-run with --commit to apply.\n");
      return;
    }

    let made = 0;
    let contacts = 0;
    for (const r of toCreate) {
      // One transaction per agency: a failure leaves that agency absent rather
      // than half-imported, and the next run picks it up.
      await db.$transaction(async (tx) => {
        const partner = await tx.recruitmentPartner.create({
          data: {
            name: r.name,
            type: "AGENT",
            country: r.country,
            city: r.city,
            contactPerson: r.contactPerson,
            email: r.email,
            phone: r.phone,
            notes: r.notes,
            regionId: regionId.get(r.regionName) ?? null,
            isActive: true,
            createdById: author.id,
          },
          select: { id: true },
        });
        if (r.extraContacts.length) {
          await tx.partnerContact.createMany({
            data: r.extraContacts.map((c) => ({
              partnerId: partner.id,
              fullName: c.fullName,
              email: c.email,
              isPrimary: false,
              isActive: true,
            })),
          });
          contacts += r.extraContacts.length;
        }
      });
      made += 1;
    }

    console.log(`WROTE ${made} agents and ${contacts} contact rows.`);
    console.log(`  sources now          ${await db.recruitmentPartner.count({ where: { deletedAt: null } })}`);
    console.log(`  partner_contacts now ${await db.partnerContact.count()}\n`);
  } finally {
    await db.$disconnect();
    await pool.end();
  }
}

main();

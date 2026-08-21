/**
 * Enriches the clients already in the CRM from the client list spreadsheet.
 *
 *   node --import tsx --env-file=.env.local scripts/enrich-clients.mjs <file.xlsx>
 *   node --import tsx --env-file=.env.local scripts/enrich-clients.mjs <file.xlsx> --commit
 *
 * DRY RUN IS THE DEFAULT. `--commit` is the only thing that writes, and it
 * prints the same plan first so the two runs can be compared line for line.
 *
 * This is the companion to import-clients.mjs, not a replacement. That script
 * owns which clients exist and which regions they are worked in; this one only
 * fills in columns on clients that are already there. It will not create a
 * client and it will not touch regions — if the sheet and the CRM disagree
 * about either, it says so and leaves it for import-clients.mjs, because two
 * scripts writing the same column is how the two quietly diverge.
 *
 * ── WHAT THE SHEET COLUMNS BECOME ──────────────────────────────────────────
 *
 * Client HPI → Institution.accountHealth. The CRM already has this concept as
 *   the Account Health traffic-light, so it is the same field under a different
 *   name rather than something new:
 *
 *     Happy → GREEN     Concerned → AMBER     Alarmed → RED     blank → GREY
 *
 *   Spec §11 requires that AMBER and RED carry an AccountIntervention giving
 *   the reason, the corrective action, an owner and a review date — the app's
 *   own PATCH /api/institutions/[id]/health refuses the change without one. So
 *   this script writes the intervention too. Writing the rating alone would
 *   produce rows the application itself would have rejected.
 *
 *   Where the sheet has a note it becomes the reason verbatim. Where it does
 *   not, the reason says plainly that the rating was imported and the reason is
 *   not yet recorded, so nobody mistakes a placeholder for a finding. The
 *   corrective action is always "confirm with the account owner" for the same
 *   reason: the sheet does not record one, and inventing one would be worse
 *   than admitting it is missing.
 *
 * Contract Expiry Date → Institution.renewalDate, which is what the renewal
 *   pill on the client card and the detail header read.
 *
 *   NOT turned into Contract rows, deliberately. Contract.startDate is
 *   required and the sheet has no start date, no value and no title, so every
 *   contract created from this data would be three fabricated fields wrapped
 *   around one real one. The "Renewal Due" stat card counts Contract.endDate
 *   and so stays at zero until real contracts are entered; that is an honest
 *   zero rather than a number built out of guesses.
 *
 * Contract Time Remaining → nothing. It is the expiry date minus today, and
 *   the card already computes it. Storing it would freeze a number that starts
 *   going stale the moment it is written — the sheet's own copy is already
 *   wrong for two rows.
 *
 * Notes → Institution.notes, only where the sheet has one. An existing note is
 *   never blanked by a blank cell.
 *
 * Client Relations → an InstitutionUser row per named person with accountRole
 *   CLIENT_RELATIONS, which is the enum member that already exists for exactly
 *   this, plus Institution.accountManagerId set to the first named person so
 *   the Account Manager filter and the card have something to show.
 *
 * Website → Institution.website, and logoUrl → the matching file in
 *   public/logos. Both come from scripts/client-web.json; see the note at the
 *   top of that file for how the addresses were checked.
 *
 * ── IDEMPOTENT ─────────────────────────────────────────────────────────────
 * Running twice makes no second change. Interventions are only created when the
 * client has no unresolved one at that health, so a re-run does not stack
 * duplicates on the accounts that are already in trouble.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO_DIR = join(HERE, "..", "public", "logos");
const WEB_CATALOGUE = join(HERE, "client-web.json");

const [, , file, ...flags] = process.argv;
const COMMIT = flags.includes("--commit");

if (!file) {
  console.error("usage: enrich-clients.mjs <file.xlsx|file.json> [--commit]");
  process.exit(2);
}

/** How long an imported AMBER/RED rating may sit before somebody must look at it. */
const REVIEW_WINDOW_DAYS = 30;

/** Sheet vocabulary → the CRM's traffic-light. Explicit, never fuzzy. */
const HEALTH_MAP = {
  happy: "GREEN",
  concerned: "AMBER",
  alarmed: "RED",
};

/**
 * Sheet shorthand → the account's email address.
 *
 * Matched on email rather than name because two of these people share a first
 * name: the directory has both an Andrew Dawkins and an Andrew Lan, and a
 * fuzzy match on "Andrew" would hand ten universities to the wrong person
 * silently. The sheet spells that one out in full, and this table keeps it
 * that way.
 *
 * "RMs" in "Mike H. & RMs" is not a person and is deliberately absent; the
 * script reports it as unresolved rather than guessing which managers were
 * meant.
 */
const PEOPLE = {
  "ashley-jane": "ashley-jane@illumestudentservices.ca",
  duarte: "duarte@illumestudentservices.ca",
  nancy: "nancy@illumestudentservices.ca",
  jamshid: "jamshid@illumestudentservices.ca",
  "mike h.": "mike@illumestudentservices.ca",
  annie: "annie@illumestudentservices.ca",
  "andrew dawkins": "andrew@illumestudentservices.ca",
  shivang: "shivang@illumestudentservices.ca",
};

/** Region column → CRM region name. Kept in step with import-clients.mjs. */
const REGION_MAP = {
  africa: "Africa",
  china: "China",
  "india": "South Asia",
  latam: "Latin America",
  mena: "Middle East",
  sea: "Southeast Asia",
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

/**
 * Name as a comparison key. Non-breaking spaces and doubled spaces are both
 * present in this sheet — "Toronto Metropolitan University " and
 * "St.  Francis Xavier University" — and a plain trim matches neither.
 */
const key = (s) =>
  String(s ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Must match slugify() in fetch-client-logos.mjs. */
const slugify = (name) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const truthy = (v) =>
  v === true || ["true", "yes", "y", "1", "x"].includes(String(v ?? "").trim().toLowerCase());

/**
 * Reads the workbook through Python's openpyxl rather than an npm xlsx
 * package, for the reason given in import-clients.mjs: the registry `xlsx`
 * package is stale and has carried prototype-pollution and ReDoS advisories,
 * and openpyxl is already what reads this file everywhere else here.
 *
 * PYTHONIOENCODING is forced because this sheet contains a typographic
 * apostrophe and a non-breaking space, and on Windows the default stdout
 * codepage turns both into replacement characters — which would then be
 * written into a client's notes.
 */
function readSheet(path) {
  if (path.endsWith(".json")) return JSON.parse(readFileSync(path, "utf8"));
  const py = `
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
ws = wb.worksheets[0]
rows = [r for r in ws.iter_rows(values_only=True)]
# The header is not on row 1: the sheet puts a merged "Regions Represented"
# banner above it. Find the row that actually names the client column.
hi = next(i for i, r in enumerate(rows)
          if any(str(c).strip().lower() == "client name" for c in r if c is not None))
hdr = [("" if c is None else str(c).strip()) for c in rows[hi]]
out = []
for r in rows[hi + 1:]:
    d = {hdr[i]: r[i] for i in range(len(hdr)) if hdr[i]}
    if str(d.get("Client Name") or "").strip():
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

function normalise(records) {
  return records.map((raw) => {
    const g = (want) => {
      const k = Object.keys(raw).find((x) => key(x) === key(want));
      return k ? raw[k] : undefined;
    };
    const name = String(g("Client Name") ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

    const hpiRaw = String(g("Client HPI") ?? "").trim();
    const health = hpiRaw ? (HEALTH_MAP[hpiRaw.toLowerCase()] ?? null) : "GREY";

    // openpyxl hands back "2028-07-31 00:00:00" for a date cell via
    // default=str. Anything that is not a real date — the sheet also carries
    // the literal word "Expired" in the neighbouring column — parses to NaN and
    // is dropped rather than written as an invalid date.
    const expiryRaw = String(g("Contract Expiry Date") ?? "").trim();
    const expiry = expiryRaw ? new Date(expiryRaw.replace(" ", "T") + "Z") : null;

    const relationsRaw = String(g("Client Relations") ?? "").trim();
    const relations = relationsRaw
      .split(/\s*[/&]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);

    return {
      name,
      hpiRaw,
      health,
      healthUnknown: !!hpiRaw && !HEALTH_MAP[hpiRaw.toLowerCase()],
      expiry: expiry && !Number.isNaN(expiry.getTime()) ? expiry : null,
      expiryRaw,
      notes: String(g("Notes") ?? "").trim() || null,
      relationsRaw,
      relations,
      regions: Object.entries(REGION_MAP)
        .filter(([col]) => truthy(g(col)))
        .map(([, crm]) => crm),
    };
  }).filter((r) => r.name);
}

/** Website + local logo path for a client, or nulls if the catalogue lacks it. */
function webFor(name, catalogue) {
  const hit = catalogue.find((c) => key(c.name) === key(name));
  if (!hit) return { website: null, logoUrl: null };
  const slug = slugify(hit.name);
  const logo = existsSync(join(LOGO_DIR, `${slug}.png`)) ? `/logos/${slug}.png` : null;
  return { website: hit.website, logoUrl: logo };
}

async function main() {
  const rows = normalise(readSheet(file));
  const { clients: catalogue } = JSON.parse(readFileSync(WEB_CATALOGUE, "utf8"));
  console.log(`read ${rows.length} rows from ${file}`);
  console.log(`${readdirSync(LOGO_DIR).filter((f) => f.endsWith(".png")).length} logos in public/logos\n`);

  const existing = await db.institution.findMany({
    where: { deletedAt: null },
    select: {
      id: true, name: true, website: true, logoUrl: true, notes: true,
      accountHealth: true, renewalDate: true, accountManagerId: true,
      regions: { select: { region: { select: { name: true } } } },
      users: { select: { userId: true, accountRole: true } },
    },
  });
  const byName = new Map(existing.map((e) => [key(e.name), e]));

  const users = await db.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, name: true },
  });
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  const author = await db.user.findFirst({
    where: { role: "SUPER_ADMIN", deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (!author) { console.log("no SUPER_ADMIN to attribute the import to"); return 1; }

  const reviewDate = new Date(Date.now() + REVIEW_WINDOW_DAYS * 86_400_000);
  const warnings = [];
  const notInCrm = [];
  let touched = 0, interventions = 0, relationRows = 0;

  console.log("── plan ───────────────────────────────────────────────────────");
  for (const r of rows) {
    const inst = byName.get(key(r.name));
    if (!inst) {
      notInCrm.push(r);
      continue;
    }

    const { website, logoUrl } = webFor(r.name, catalogue);
    if (!website) warnings.push(`${r.name}: no website in client-web.json`);
    if (!logoUrl) warnings.push(`${r.name}: no logo in public/logos`);
    if (r.healthUnknown) warnings.push(`${r.name}: Client HPI "${r.hpiRaw}" is not Happy/Concerned/Alarmed — health left unchanged`);
    if (r.expiryRaw && !r.expiry) warnings.push(`${r.name}: Contract Expiry Date "${r.expiryRaw}" is not a date — renewal left unchanged`);

    // Regions are import-clients.mjs's job. Report disagreement, never write it.
    const crmRegions = inst.regions.map((x) => x.region.name).sort();
    const sheetRegions = [...r.regions].sort();
    if (crmRegions.join("|") !== sheetRegions.join("|")) {
      warnings.push(
        `${r.name}: regions differ — CRM [${crmRegions.join(", ") || "none"}] vs sheet ` +
        `[${sheetRegions.join(", ") || "none"}]. Run import-clients.mjs; this script does not touch regions.`
      );
    }

    // Client Relations → people.
    const people = [];
    for (const label of r.relations) {
      const email = PEOPLE[label.toLowerCase()];
      const u = email ? userByEmail.get(email) : null;
      if (u) people.push(u);
      else warnings.push(`${r.name}: Client Relations "${label}" does not resolve to a user — skipped`);
    }

    const data = {};
    if (website && inst.website !== website) data.website = website;
    if (logoUrl && inst.logoUrl !== logoUrl) data.logoUrl = logoUrl;
    if (r.notes && inst.notes !== r.notes) data.notes = r.notes;
    if (r.health && inst.accountHealth !== r.health) data.accountHealth = r.health;
    if (r.expiry && inst.renewalDate?.getTime() !== r.expiry.getTime()) {
      data.renewalDate = r.expiry;
    }
    if (people[0] && inst.accountManagerId !== people[0].id) data.accountManagerId = people[0].id;

    const newRelations = people.filter(
      (p) => !inst.users.some((iu) => iu.userId === p.id && iu.accountRole === "CLIENT_RELATIONS")
    );

    // Spec §11: AMBER and RED must carry an intervention. Only create one when
    // nothing unresolved is already on file, so a re-run does not stack them.
    const needsIntervention =
      (r.health === "AMBER" || r.health === "RED") &&
      (await db.accountIntervention.count({
        where: { institutionId: inst.id, health: r.health, resolvedAt: null },
      })) === 0;

    const changes = [
      ...Object.keys(data).map((k) => (k === "accountHealth" ? `health→${r.health}` : k)),
      ...newRelations.map((p) => `+relations:${p.name}`),
      ...(needsIntervention ? ["+intervention"] : []),
    ];
    if (!changes.length) continue;

    touched++;
    if (needsIntervention) interventions++;
    relationRows += newRelations.length;
    console.log(`  ${r.name.slice(0, 50).padEnd(52)} ${changes.join(", ")}`);

    if (!COMMIT) continue;

    await db.$transaction(async (tx) => {
      if (Object.keys(data).length) {
        await tx.institution.update({ where: { id: inst.id }, data });
      }
      for (const p of newRelations) {
        await tx.institutionUser.upsert({
          where: { institutionId_userId: { institutionId: inst.id, userId: p.id } },
          create: {
            institutionId: inst.id, userId: p.id,
            accountRole: "CLIENT_RELATIONS", assignmentStatus: "ACTIVE",
            notes: `Client Relations owner per the client list ("${r.relationsRaw}").`,
          },
          update: { accountRole: "CLIENT_RELATIONS", assignmentStatus: "ACTIVE" },
        });
      }
      if (needsIntervention) {
        await tx.accountIntervention.create({
          data: {
            institutionId: inst.id,
            health: r.health,
            reason: r.notes
              ? `Client list HPI: ${r.hpiRaw.trim()}. ${r.notes}`
              : `Client list HPI: ${r.hpiRaw.trim()}. No reason recorded on the client list — needs confirming with the account owner.`,
            correctiveAction:
              "Imported from the client list. Confirm the reason with the account owner and replace this with the agreed corrective action.",
            actionOwnerId: people[0]?.id ?? author.id,
            reviewDate,
            createdById: author.id,
          },
        });
      }
    });
  }

  if (notInCrm.length) {
    console.log("\n── on the sheet, not in the CRM ───────────────────────────────");
    for (const r of notInCrm) {
      console.log(
        `  ${r.name.slice(0, 46).padEnd(48)} HPI ${(r.hpiRaw || "—").padEnd(11)} ` +
        `regions ${r.regions.join(", ") || "(none ticked)"}`
      );
    }
    console.log("  These were left out of the original import and are not created here:");
    console.log("  adding a client is import-clients.mjs's job, and a client with no region");
    console.log("  is invisible to every regional view once created.");
  }

  if (warnings.length) {
    console.log("\n── warnings ───────────────────────────────────────────────────");
    for (const w of [...new Set(warnings)]) console.log(`  ${w}`);
  }

  console.log();
  if (!COMMIT) {
    console.log(`DRY RUN — nothing written. Would update ${touched} clients, ` +
      `create ${interventions} interventions and ${relationRows} client-relations assignments.`);
    console.log("Re-run with --commit to apply.");
    return 0;
  }

  const health = await db.institution.groupBy({
    by: ["accountHealth"], where: { deletedAt: null }, _count: true,
  });
  console.log(`COMMITTED — updated ${touched} clients, ${interventions} interventions, ${relationRows} assignments.`);
  console.log(`health now: ${health.map((h) => `${h.accountHealth}=${h._count}`).join("  ")}`);
  console.log(`with a website: ${await db.institution.count({ where: { deletedAt: null, NOT: { website: null } } })}`);
  console.log(`with a logo:    ${await db.institution.count({ where: { deletedAt: null, NOT: { logoUrl: null } } })}`);
  return 0;
}

let code = 1;
try { code = await main(); }
catch (e) { console.error("FAILED:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally { await db.$disconnect(); await pool.end(); }
process.exit(code);

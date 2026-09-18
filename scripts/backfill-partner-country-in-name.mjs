/**
 * Puts the country into recruitment partner names: "Admission Overseas (India)".
 *
 *   node --import tsx --env-file=.env scripts/backfill-partner-country-in-name.mjs
 *   node --import tsx --env-file=.env scripts/backfill-partner-country-in-name.mjs --apply
 *
 * WITHOUT --apply IT WRITES NOTHING. The default is a dry run that prints what
 * it would do and stops, because this edits the name of every partner record in
 * the database and there is no undo short of restoring a backup.
 *
 * ── HOW IT DECIDES A NAME ALREADY HAS THE COUNTRY ───────────────────────────
 *
 * Not by substring. A substring test gets both halves wrong:
 *
 *   "Access Education DRC"        country DR Congo  → "DRC" is not the literal
 *                                 string "DR Congo", so a substring test would
 *                                 append it and produce "...DRC (DR Congo)".
 *   "Allway Canada Immigration"   country India     → contains a country word
 *                                 that is NOT this partner's country, so a
 *                                 loose test would wrongly skip it.
 *
 * Instead every 1-to-3 word phrase in the name is put through
 * resolveCountryCode() and compared against the partner's own country code. So
 * "DRC", "Sri Lanka" and "UAE" are recognised, and "Canada" in an Indian
 * agent's name is correctly ignored.
 *
 * Two-word... one-word phrases of two letters are skipped on purpose:
 * resolveCountryCode passes any two-letter string through as a code, so the
 * "AJ" in "AJ Immigration" would otherwise be read as a country.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 * - Dry run by default; --apply is the only thing that writes.
 * - Prints which database it is connected to by ASKING it, never by parsing
 *   DATABASE_URL — that is how a password once ended up in command output.
 * - Idempotent: a second run finds nothing to do, because the suffix it adds is
 *   itself recognised by the same detector.
 * - Every rename writes an audit row, so a bulk edit of live records is not
 *   invisible afterwards.
 * - Deleted partners are left alone.
 */

// Dynamic import, not a static one: under tsx a static `import` of a .ts
// module from a .mjs file fails with "does not provide an export named ...".
const { resolveCountryCode } = await import("../lib/country.ts");
const { db } = await import("../lib/db.ts");

const APPLY = process.argv.includes("--apply");

/** True when `name` already states `country`, by any of three tests. */
function nameAlreadyStatesCountry(name, country) {
  const c = country.trim();
  const lower = name.toLowerCase();

  // 1. The exact suffix this script adds.
  //
  // THIS IS WHAT MAKES IT IDEMPOTENT, and it is not redundant with the
  // resolver below: one partner has its country recorded as "Global", which is
  // not a country at all. resolveCountryCode returns null for it, so without
  // this check a second --apply would produce
  // "YouTube Study Abroad Channel (Global) (Global)".
  if (lower.includes(`(${c.toLowerCase()})`)) return true;

  // 2. The country named literally, on a word boundary. "Indiana Travel" must
  //    not count as already stating India.
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(name)) return true;

  // 3. Any 1–3 word phrase that resolves to the same country, which is what
  //    catches "DRC" for DR Congo and "UAE" for United Arab Emirates.
  const target = resolveCountryCode(c);
  if (!target) return false;

  const words = name.split(/[^A-Za-z]+/).filter(Boolean);
  for (let size = 3; size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const phrase = words.slice(i, i + size).join(" ");
      // A bare two-letter word is passed through as an ISO code by the
      // resolver, so "AJ Immigration" would look like country "AJ".
      if (phrase.replace(/\s/g, "").length < 3) continue;
      if (resolveCountryCode(phrase) === target) return true;
    }
  }
  return false;
}

const [{ db: dbName, usr }] = await db.$queryRaw`
  SELECT current_database() AS db, current_user AS usr
`;
console.log(`connected to: ${dbName} as ${usr}`);
console.log(APPLY ? "MODE: APPLY — this will write\n" : "MODE: dry run — nothing will be written\n");

const partners = await db.recruitmentPartner.findMany({
  where: { deletedAt: null },
  select: { id: true, name: true, country: true },
  orderBy: { name: "asc" },
});

const planned = [];
const skipped = [];
const noCountry = [];

for (const p of partners) {
  if (!p.country || !p.country.trim()) {
    noCountry.push(p);
    continue;
  }
  if (nameAlreadyStatesCountry(p.name, p.country)) {
    skipped.push(p);
    continue;
  }
  planned.push({ ...p, next: `${p.name.trim()} (${p.country.trim()})` });
}

console.log(`partners (not deleted) : ${partners.length}`);
console.log(`already state country  : ${skipped.length}`);
console.log(`no country recorded    : ${noCountry.length}`);
console.log(`would be renamed       : ${planned.length}\n`);

if (skipped.length) {
  console.log("Left alone because the name already says it:");
  for (const p of skipped.slice(0, 15)) console.log(`  ${p.name}   [${p.country}]`);
  if (skipped.length > 15) console.log(`  ... and ${skipped.length - 15} more`);
  console.log();
}
if (noCountry.length) {
  console.log("Left alone because no country is recorded:");
  for (const p of noCountry.slice(0, 10)) console.log(`  ${p.name}`);
  console.log();
}

console.log("Renames (first 20):");
for (const p of planned.slice(0, 20)) console.log(`  ${p.name}\n    → ${p.next}`);
if (planned.length > 20) console.log(`  ... and ${planned.length - 20} more`);

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write these changes.");
  await db.$disconnect();
  process.exit(0);
}

// The author recorded against the rename. Falls back to null rather than
// inventing an actor — the AuditLog userId is nullable for exactly this reason.
const actor = await db.user.findFirst({
  where: { role: "SUPER_ADMIN", deletedAt: null },
  select: { id: true },
  orderBy: { createdAt: "asc" },
});

let done = 0;
for (const p of planned) {
  await db.$transaction([
    db.recruitmentPartner.update({ where: { id: p.id }, data: { name: p.next } }),
    db.auditLog.create({
      data: {
        userId: actor?.id ?? null,
        action: "UPDATE",
        entity: "RecruitmentPartner",
        entityId: p.id,
        changes: {
          reason: "Bulk backfill: country added to partner name",
          name: { from: p.name, to: p.next },
        },
      },
    }),
  ]);
  done++;
}

console.log(`\nrenamed: ${done}`);

// Prove it converged rather than assuming: re-read and re-run the detector.
const after = await db.recruitmentPartner.findMany({
  where: { deletedAt: null },
  select: { name: true, country: true },
});
const remaining = after.filter(
  (p) => p.country?.trim() && !nameAlreadyStatesCountry(p.name, p.country)
).length;
console.log(`still missing a country after the run: ${remaining} (expected 0)`);

await db.$disconnect();
process.exit(remaining === 0 ? 0 : 1);

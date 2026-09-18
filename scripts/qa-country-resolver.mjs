/**
 * Pins the behaviour of lib/country.ts.
 *
 * The three lookup tables in that file used to be hand-written. They are now
 * derived from lib/countries.ts, the ISO 3166-1 list that also fills the
 * Nationality and Country of Residence dropdowns. This script proves the swap
 * changed no answers: it replays every input recorded from the previous
 * implementation — every key of the old demonym / name / alpha-3 maps, the
 * nationalities and residence values present in the live data, and a set of
 * edge cases — and fails on any differing result.
 *
 * It also asserts the forward-looking property that motivated the change: every
 * option offered in either dropdown must resolve, so the list can never contain
 * a country the resolver has never heard of.
 *
 * Needs no server and no database. Run with tsx, since it imports TypeScript:
 *   node --import tsx scripts/qa-country-resolver.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, "fixtures", "country-resolver-baseline.json");

const { resolveCountryCode, countryFlag } = await import("../lib/country.ts");
const { COUNTRIES, COUNTRY_NAME_OPTIONS, NATIONALITY_OPTIONS, ALIASES } =
  await import("../lib/countries.ts");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

let pass = 0;
const failures = [];
const check = (name, cond, detail) => {
  if (cond) pass++;
  else failures.push(detail ? `${name} — ${detail}` : name);
};

// ── 1. Nothing the old implementation resolved may have changed ──────────────
for (const [input, expected] of Object.entries(baseline)) {
  const code = resolveCountryCode(input);
  check(
    `resolve(${JSON.stringify(input)})`,
    code === expected.code,
    `was ${JSON.stringify(expected.code)}, now ${JSON.stringify(code)}`
  );
  const flag = countryFlag(input);
  check(
    `flag(${JSON.stringify(input)})`,
    flag === expected.flag,
    `was ${JSON.stringify(expected.flag)}, now ${JSON.stringify(flag)}`
  );
}
const baselineCount = Object.keys(baseline).length;

// ── 2. Every dropdown option must resolve to the country it names ────────────
// This is the property the rewrite exists to guarantee. A name in the list that
// the resolver cannot place would render a student with no flag.
for (const c of COUNTRIES) {
  check(
    `name resolves: ${c.name}`,
    resolveCountryCode(c.name) === c.code,
    `expected ${c.code}, got ${resolveCountryCode(c.name)}`
  );
  check(
    `alpha-3 resolves: ${c.code3}`,
    resolveCountryCode(c.code3) === c.code,
    `expected ${c.code}, got ${resolveCountryCode(c.code3)}`
  );
}

// Demonyms are checked as "resolves to something", not to a specific code:
// "Congolese" and "Dominican" each legitimately name two countries.
for (const o of NATIONALITY_OPTIONS) {
  check(`nationality resolves: ${o.value}`, resolveCountryCode(o.value) !== null);
  check(`nationality has a flag: ${o.value}`, countryFlag(o.value) !== "");
}
for (const o of COUNTRY_NAME_OPTIONS) {
  check(`country has a flag: ${o.value}`, countryFlag(o.value) !== "");
}

// ── 3. Aliases must all still point somewhere real ───────────────────────────
for (const [alias, code] of Object.entries(ALIASES)) {
  check(
    `alias ${alias} → ${code}`,
    resolveCountryCode(alias) === code,
    `got ${resolveCountryCode(alias)}`
  );
}

// ── 4. Unknown input must stay unknown, so no student gets a wrong flag ──────
for (const junk of ["Atlantis", "Narnia", "", "   ", "!!!", "12345"]) {
  check(`rejects ${JSON.stringify(junk)}`, resolveCountryCode(junk) === null);
}

const total = pass + failures.length;
console.log(`baseline inputs replayed: ${baselineCount}`);
console.log(`countries in list:        ${COUNTRIES.length}`);
console.log(`nationality options:      ${NATIONALITY_OPTIONS.length}`);
console.log(`country options:          ${COUNTRY_NAME_OPTIONS.length}`);
console.log(`\n${pass}/${total} checks passed`);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:`);
  for (const f of failures.slice(0, 40)) console.log("  " + f);
  if (failures.length > 40) console.log(`  ... and ${failures.length - 40} more`);
  process.exit(1);
}
console.log("\nResolver behaviour is unchanged and every dropdown option resolves.");

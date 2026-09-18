/**
 * Country → ISO 3166-1 alpha-2 → flag emoji.
 *
 * Flags were once produced by a local ~30-entry demonym map inside
 * students/_components/lead-card.tsx, described in its own comment as "common
 * ones". Ten of the twenty-two nationalities actually present in the data —
 * Turkish, Iranian, Japanese, Spanish, Omani, Senegalese, Qatari, Saudi Arabian,
 * Korean and "UAE National" — were absent, so those leads simply had no flag.
 * activity-log-view.tsx carried a second, different implementation that accepted
 * only two-letter codes. Both now call this module.
 *
 * The two fields hold different shapes, which is why one lookup table cannot work:
 *   Lead.nationality        → a demonym: "Indian", "Saudi Arabian", "UAE National"
 *   Lead.countryOfResidence → a country name: "India", "Saudi Arabia", "UAE"
 * and ISO codes appear too ("IND", "IN") when rows are created via the API.
 *
 * resolveCountryCode() accepts any of those. Unknown input returns null and
 * countryFlag() then renders nothing, which is the correct outcome — a wrong flag
 * against a student's name is worse than no flag.
 *
 * WHERE THE DATA COMES FROM
 * -------------------------
 * The three lookup tables below used to be hand-written here and covered about
 * 130 countries. They are now DERIVED from `lib/countries.ts`, which carries all
 * 249 ISO 3166-1 entries and is also what fills the Nationality and Country of
 * Residence dropdowns on the lead form.
 *
 * That direction matters. Two hand-maintained `Record<string, string>` tables
 * that must agree is a bug this codebase has already paid for three times, and
 * TypeScript cannot catch it because both sides accept any key. Deriving means a
 * country added to the list gets its dropdown entry, its flag and its resolver
 * entry in one edit, and a country in the dropdown can never be one the resolver
 * has never heard of.
 *
 * `scripts/qa-country-resolver.mjs` pins the behaviour: it replays 517 inputs
 * recorded from the previous hand-written implementation and fails on any
 * changed answer.
 */

import { ALIASES, COUNTRIES, normaliseCountryKey } from "./countries";

/**
 * Country name → ISO alpha-2, including the shorthands and former names the data
 * actually uses ("UK", "Holland", "Burma"), which arrive via ALIASES.
 *
 * Aliases are applied last so a deliberate override always beats a derived
 * entry rather than depending on table order.
 */
const NAME_TO_ISO2: Record<string, string> = {
  ...Object.fromEntries(COUNTRIES.map((c) => [normaliseCountryKey(c.name), c.code])),
  ...ALIASES,
};

/**
 * Demonym → ISO alpha-2.
 *
 * Built by assignment rather than a fresh object so that the LAST entry wins for
 * the two demonyms shared by two countries: "Dominican" resolves to the Dominican
 * Republic rather than Dominica, and "Congolese" to the larger DR Congo. Both are
 * genuinely ambiguous; these are the readings the previous implementation used
 * and the ones the data means in practice.
 */
const DEMONYM_TO_ISO2: Record<string, string> = {};
for (const c of COUNTRIES) {
  if (c.demonym) DEMONYM_TO_ISO2[normaliseCountryKey(c.demonym)] = c.code;
}
Object.assign(DEMONYM_TO_ISO2, ALIASES);

/** ISO alpha-3 → alpha-2, for the codes the API stores ("IND"). */
const ISO3_TO_ISO2: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code3, c.code])
);

/**
 * Resolve a demonym, country name, alpha-3 or alpha-2 value to an ISO alpha-2
 * code. Returns null when it cannot be determined.
 */
export function resolveCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  const k = normaliseCountryKey(raw);
  if (!k) return null;

  // Alpha-2 first: shortest and unambiguous. Guarded by the name table above so
  // "US"/"UK" resolve as names rather than being taken literally.
  if (k.length === 2 && !NAME_TO_ISO2[k]) return k.toUpperCase();
  if (NAME_TO_ISO2[k]) return NAME_TO_ISO2[k];
  if (DEMONYM_TO_ISO2[k]) return DEMONYM_TO_ISO2[k];
  if (k.length === 3 && ISO3_TO_ISO2[k.toUpperCase()]) return ISO3_TO_ISO2[k.toUpperCase()];

  // "UAE National", "Saudi Arabian Citizen" — try dropping trailing qualifiers.
  for (const suffix of ["national", "citizen", "nationality"]) {
    if (k.endsWith(suffix)) {
      const base = k.slice(0, -suffix.length);
      if (DEMONYM_TO_ISO2[base]) return DEMONYM_TO_ISO2[base];
      if (NAME_TO_ISO2[base]) return NAME_TO_ISO2[base];
    }
  }
  return null;
}

/**
 * Flag emoji for a demonym, country name or ISO code. Empty string when unknown —
 * rendering nothing is correct, since the wrong flag beside a student's name is
 * worse than none.
 */
export function countryFlag(input: string | null | undefined): string {
  const code = resolveCountryCode(input);
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(
    ...code.split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

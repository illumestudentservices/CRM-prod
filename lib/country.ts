/**
 * Country → ISO 3166-1 alpha-2 → flag emoji.
 *
 * Flags were previously produced by a local map of ~30 demonyms inside
 * students/_components/lead-card.tsx, described in its own comment as "common
 * ones". Ten of the twenty-two nationalities actually present in the data —
 * Turkish, Iranian, Japanese, Spanish, Omani, Senegalese, Qatari, Saudi Arabian,
 * Korean and "UAE National" — were absent, so those leads simply had no flag.
 * activity-log-view.tsx carried a second, different implementation that accepted
 * only two-letter codes.
 *
 * The two fields hold different shapes, which is why one lookup table cannot work:
 *   Lead.nationality        → a demonym: "Indian", "Saudi Arabian", "UAE National"
 *   Lead.countryOfResidence → a country name: "India", "Saudi Arabia", "UAE"
 * and ISO codes appear too ("IND", "IN") when rows are created via the API.
 *
 * resolveCountryCode() accepts any of those. Unknown input returns null and
 * countryFlag() then renders nothing, which is the correct outcome — a wrong flag
 * against a student's name is worse than no flag.
 */

/** Demonym → ISO alpha-2. Keys are matched case- and separator-insensitively. */
const DEMONYM_TO_ISO2: Record<string, string> = {
  // ── Africa ──
  nigerian: "NG", ghanaian: "GH", kenyan: "KE", southafrican: "ZA", egyptian: "EG",
  moroccan: "MA", tanzanian: "TZ", ugandan: "UG", ethiopian: "ET", zimbabwean: "ZW",
  zambian: "ZM", senegalese: "SN", ivorian: "CI", cameroonian: "CM", rwandan: "RW",
  botswanan: "BW", namibian: "NA", malawian: "MW", mauritian: "MU", tunisian: "TN",
  algerian: "DZ", sudanese: "SD", somali: "SO", angolan: "AO", mozambican: "MZ",
  // ── South & Central Asia ──
  indian: "IN", pakistani: "PK", bangladeshi: "BD", srilankan: "LK", nepali: "NP",
  nepalese: "NP", bhutanese: "BT", maldivian: "MV", afghan: "AF", uzbek: "UZ",
  uzbekistani: "UZ", kazakh: "KZ", kazakhstani: "KZ", kyrgyz: "KG", tajik: "TJ",
  turkmen: "TM", mongolian: "MN",
  // ── East & Southeast Asia ──
  chinese: "CN", japanese: "JP", korean: "KR", southkorean: "KR", northkorean: "KP",
  taiwanese: "TW", hongkonger: "HK", malaysian: "MY", indonesian: "ID",
  vietnamese: "VN", filipino: "PH", filipina: "PH", thai: "TH", singaporean: "SG",
  burmese: "MM", myanmarese: "MM", cambodian: "KH", laotian: "LA", bruneian: "BN",
  // ── Middle East ──
  emirati: "AE", uaenational: "AE", saudi: "SA", saudiarabian: "SA", qatari: "QA",
  kuwaiti: "KW", bahraini: "BH", omani: "OM", jordanian: "JO", lebanese: "LB",
  syrian: "SY", iraqi: "IQ", iranian: "IR", israeli: "IL", palestinian: "PS",
  yemeni: "YE", turkish: "TR",
  // ── Europe ──
  british: "GB", english: "GB", scottish: "GB", welsh: "GB", irish: "IE",
  french: "FR", german: "DE", spanish: "ES", italian: "IT", portuguese: "PT",
  dutch: "NL", belgian: "BE", swiss: "CH", austrian: "AT", swedish: "SE",
  norwegian: "NO", danish: "DK", finnish: "FI", polish: "PL", czech: "CZ",
  slovak: "SK", hungarian: "HU", romanian: "RO", bulgarian: "BG", greek: "GR",
  croatian: "HR", serbian: "RS", ukrainian: "UA", russian: "RU", albanian: "AL",
  cypriot: "CY", maltese: "MT", icelandic: "IS", lithuanian: "LT", latvian: "LV",
  estonian: "EE", slovenian: "SI", bosnian: "BA", georgian: "GE", armenian: "AM",
  azerbaijani: "AZ", belarusian: "BY", moldovan: "MD",
  // ── Americas ──
  american: "US", canadian: "CA", mexican: "MX", brazilian: "BR", colombian: "CO",
  argentine: "AR", argentinian: "AR", chilean: "CL", peruvian: "PE",
  venezuelan: "VE", ecuadorian: "EC", bolivian: "BO", uruguayan: "UY",
  paraguayan: "PY", jamaican: "JM", trinidadian: "TT", cuban: "CU",
  dominican: "DO", haitian: "HT", panamanian: "PA", costarican: "CR",
  guatemalan: "GT", honduran: "HN", salvadoran: "SV", nicaraguan: "NI",
  // ── Oceania ──
  australian: "AU", newzealander: "NZ", kiwi: "NZ", fijian: "FJ",
  papuanewguinean: "PG",
};

/** Country name → ISO alpha-2, including the short forms the data actually uses. */
const NAME_TO_ISO2: Record<string, string> = {
  nigeria: "NG", ghana: "GH", kenya: "KE", southafrica: "ZA", egypt: "EG",
  morocco: "MA", tanzania: "TZ", uganda: "UG", ethiopia: "ET", zimbabwe: "ZW",
  zambia: "ZM", senegal: "SN", cotedivoire: "CI", ivorycoast: "CI",
  cameroon: "CM", rwanda: "RW", botswana: "BW", namibia: "NA", malawi: "MW",
  mauritius: "MU", tunisia: "TN", algeria: "DZ", sudan: "SD", somalia: "SO",
  angola: "AO", mozambique: "MZ",
  india: "IN", pakistan: "PK", bangladesh: "BD", srilanka: "LK", nepal: "NP",
  bhutan: "BT", maldives: "MV", afghanistan: "AF", uzbekistan: "UZ",
  kazakhstan: "KZ", kyrgyzstan: "KG", tajikistan: "TJ", turkmenistan: "TM",
  mongolia: "MN",
  china: "CN", japan: "JP", southkorea: "KR", korea: "KR",
  republicofkorea: "KR", northkorea: "KP", taiwan: "TW", hongkong: "HK",
  macau: "MO", malaysia: "MY", indonesia: "ID", vietnam: "VN",
  philippines: "PH", thailand: "TH", singapore: "SG", myanmar: "MM",
  burma: "MM", cambodia: "KH", laos: "LA", brunei: "BN",
  uae: "AE", unitedarabemirates: "AE", saudiarabia: "SA", ksa: "SA",
  qatar: "QA", kuwait: "KW", bahrain: "BH", oman: "OM", jordan: "JO",
  lebanon: "LB", syria: "SY", iraq: "IQ", iran: "IR", israel: "IL",
  palestine: "PS", yemen: "YE", turkey: "TR", turkiye: "TR",
  unitedkingdom: "GB", uk: "GB", greatbritain: "GB", england: "GB",
  scotland: "GB", wales: "GB", ireland: "IE", france: "FR", germany: "DE",
  spain: "ES", italy: "IT", portugal: "PT", netherlands: "NL",
  thenetherlands: "NL", holland: "NL", belgium: "BE", switzerland: "CH",
  austria: "AT", sweden: "SE", norway: "NO", denmark: "DK", finland: "FI",
  poland: "PL", czechia: "CZ", czechrepublic: "CZ", slovakia: "SK",
  hungary: "HU", romania: "RO", bulgaria: "BG", greece: "GR", croatia: "HR",
  serbia: "RS", ukraine: "UA", russia: "RU", albania: "AL", cyprus: "CY",
  malta: "MT", iceland: "IS", lithuania: "LT", latvia: "LV", estonia: "EE",
  slovenia: "SI", bosniaandherzegovina: "BA", georgia: "GE", armenia: "AM",
  azerbaijan: "AZ", belarus: "BY", moldova: "MD",
  unitedstates: "US", usa: "US", us: "US", unitedstatesofamerica: "US",
  canada: "CA", mexico: "MX", brazil: "BR", colombia: "CO", argentina: "AR",
  chile: "CL", peru: "PE", venezuela: "VE", ecuador: "EC", bolivia: "BO",
  uruguay: "UY", paraguay: "PY", jamaica: "JM", trinidadandtobago: "TT",
  cuba: "CU", dominicanrepublic: "DO", haiti: "HT", panama: "PA",
  costarica: "CR", guatemala: "GT", honduras: "HN", elsalvador: "SV",
  nicaragua: "NI",
  australia: "AU", newzealand: "NZ", fiji: "FJ", papuanewguinea: "PG",
};

/** ISO alpha-3 → alpha-2, for the codes the API stores ("IND"). */
const ISO3_TO_ISO2: Record<string, string> = {
  NGA: "NG", GHA: "GH", KEN: "KE", ZAF: "ZA", EGY: "EG", MAR: "MA", TZA: "TZ",
  UGA: "UG", ETH: "ET", ZWE: "ZW", ZMB: "ZM", SEN: "SN", CIV: "CI", CMR: "CM",
  RWA: "RW", BWA: "BW", NAM: "NA", MWI: "MW", MUS: "MU", TUN: "TN", DZA: "DZ",
  SDN: "SD", SOM: "SO", AGO: "AO", MOZ: "MZ",
  IND: "IN", PAK: "PK", BGD: "BD", LKA: "LK", NPL: "NP", BTN: "BT", MDV: "MV",
  AFG: "AF", UZB: "UZ", KAZ: "KZ", KGZ: "KG", TJK: "TJ", TKM: "TM", MNG: "MN",
  CHN: "CN", JPN: "JP", KOR: "KR", PRK: "KP", TWN: "TW", HKG: "HK", MAC: "MO",
  MYS: "MY", IDN: "ID", VNM: "VN", PHL: "PH", THA: "TH", SGP: "SG", MMR: "MM",
  KHM: "KH", LAO: "LA", BRN: "BN",
  ARE: "AE", SAU: "SA", QAT: "QA", KWT: "KW", BHR: "BH", OMN: "OM", JOR: "JO",
  LBN: "LB", SYR: "SY", IRQ: "IQ", IRN: "IR", ISR: "IL", PSE: "PS", YEM: "YE",
  TUR: "TR",
  GBR: "GB", IRL: "IE", FRA: "FR", DEU: "DE", ESP: "ES", ITA: "IT", PRT: "PT",
  NLD: "NL", BEL: "BE", CHE: "CH", AUT: "AT", SWE: "SE", NOR: "NO", DNK: "DK",
  FIN: "FI", POL: "PL", CZE: "CZ", SVK: "SK", HUN: "HU", ROU: "RO", BGR: "BG",
  GRC: "GR", HRV: "HR", SRB: "RS", UKR: "UA", RUS: "RU", ALB: "AL", CYP: "CY",
  MLT: "MT", ISL: "IS", LTU: "LT", LVA: "LV", EST: "EE", SVN: "SI", BIH: "BA",
  GEO: "GE", ARM: "AM", AZE: "AZ", BLR: "BY", MDA: "MD",
  USA: "US", CAN: "CA", MEX: "MX", BRA: "BR", COL: "CO", ARG: "AR", CHL: "CL",
  PER: "PE", VEN: "VE", ECU: "EC", BOL: "BO", URY: "UY", PRY: "PY", JAM: "JM",
  TTO: "TT", CUB: "CU", DOM: "DO", HTI: "HT", PAN: "PA", CRI: "CR", GTM: "GT",
  HND: "HN", SLV: "SV", NIC: "NI",
  AUS: "AU", NZL: "NZ", FJI: "FJ", PNG: "PG",
};

/** Strip case, spaces, hyphens and underscores so "South_Africa" == "south africa". */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Resolve a demonym, country name, alpha-3 or alpha-2 value to an ISO alpha-2
 * code. Returns null when it cannot be determined.
 */
export function resolveCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  const k = norm(raw);
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

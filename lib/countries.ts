/**
 * The ISO 3166-1 country list — the single source of truth for every country
 * name, nationality and code in the app.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `lib/country.ts` used to carry three separate hand-written maps (demonym →
 * code, name → code, alpha-3 → code). They covered about 130 countries, which
 * was enough to resolve a flag but not enough to *offer* a list: the Nationality
 * and Country of Residence boxes on the lead form were free text, so the same
 * country arrived as "UAE", "U.A.E.", "United Arab Emirates" and "UAE National".
 *
 * Adding a fourth list for the dropdowns would have repeated a mistake this
 * codebase has already paid for three times (NAV_RESOURCE_MAP vs NAV_PERMISSIONS,
 * the permissions UI vs PERMISSION_MATRIX, and the flag map vs the real data):
 * two `Record<string, string>` tables that must agree, which TypeScript cannot
 * check. So the direction is inverted — this table is authored once and
 * `lib/country.ts` derives its lookups from it. A country added here gets a
 * flag, a dropdown entry and a resolver entry in the same edit.
 *
 * WHAT IS IN IT
 * -------------
 * All 249 officially assigned ISO 3166-1 alpha-2 codes, each with its alpha-3
 * code, its English short name and its demonym.
 *
 * `demonym` is null for the eight entries with no population and therefore no
 * nationality (Antarctica, Bouvet Island, British Indian Ocean Territory, French
 * Southern Territories, Heard Island and McDonald Islands, South Georgia, the
 * United States Minor Outlying Islands, and Svalbard and Jan Mayen — whose
 * residents are Norwegian). Those eight are offered as a country of residence
 * but NOT as a nationality, because a nationality that does not exist should not
 * be in the list.
 *
 * Names follow the ISO English short name, with two deliberate departures for
 * the people using the form: the entries are sorted and searched by the name a
 * recruiter would type. `ALIASES` below carries the shorthands ("UK", "USA",
 * "Holland") so search and resolution still find them.
 */

/** One country: ISO alpha-2, ISO alpha-3, English short name, demonym. */
export type Country = {
  /** ISO 3166-1 alpha-2, uppercase. The stable key — flags derive from it. */
  code: string;
  /** ISO 3166-1 alpha-3, uppercase. Rows created via the API store this shape. */
  code3: string;
  /** English short name, e.g. "Nigeria". Stored in Lead.countryOfResidence. */
  name: string;
  /** Demonym, e.g. "Nigerian". Stored in Lead.nationality. Null = uninhabited. */
  demonym: string | null;
};

/**
 * All 249 officially assigned ISO 3166-1 entries, alphabetical by name.
 *
 * Written as [alpha2, alpha3, name, demonym] tuples rather than three separate
 * maps so that every fact about one country sits on one line — a mismatched code
 * is visible when reading, instead of hiding across three tables.
 */
const RAW: ReadonlyArray<readonly [string, string, string, string | null]> = [
  ["AF", "AFG", "Afghanistan", "Afghan"],
  ["AX", "ALA", "Åland Islands", "Åland Islander"],
  ["AL", "ALB", "Albania", "Albanian"],
  ["DZ", "DZA", "Algeria", "Algerian"],
  ["AS", "ASM", "American Samoa", "American Samoan"],
  ["AD", "AND", "Andorra", "Andorran"],
  ["AO", "AGO", "Angola", "Angolan"],
  ["AI", "AIA", "Anguilla", "Anguillan"],
  ["AQ", "ATA", "Antarctica", null],
  ["AG", "ATG", "Antigua and Barbuda", "Antiguan or Barbudan"],
  ["AR", "ARG", "Argentina", "Argentine"],
  ["AM", "ARM", "Armenia", "Armenian"],
  ["AW", "ABW", "Aruba", "Aruban"],
  ["AU", "AUS", "Australia", "Australian"],
  ["AT", "AUT", "Austria", "Austrian"],
  ["AZ", "AZE", "Azerbaijan", "Azerbaijani"],
  ["BS", "BHS", "Bahamas", "Bahamian"],
  ["BH", "BHR", "Bahrain", "Bahraini"],
  ["BD", "BGD", "Bangladesh", "Bangladeshi"],
  ["BB", "BRB", "Barbados", "Barbadian"],
  ["BY", "BLR", "Belarus", "Belarusian"],
  ["BE", "BEL", "Belgium", "Belgian"],
  ["BZ", "BLZ", "Belize", "Belizean"],
  ["BJ", "BEN", "Benin", "Beninese"],
  ["BM", "BMU", "Bermuda", "Bermudian"],
  ["BT", "BTN", "Bhutan", "Bhutanese"],
  ["BO", "BOL", "Bolivia", "Bolivian"],
  ["BQ", "BES", "Bonaire, Sint Eustatius and Saba", "Bonairean"],
  ["BA", "BIH", "Bosnia and Herzegovina", "Bosnian"],
  ["BW", "BWA", "Botswana", "Motswana"],
  ["BV", "BVT", "Bouvet Island", null],
  ["BR", "BRA", "Brazil", "Brazilian"],
  ["IO", "IOT", "British Indian Ocean Territory", null],
  ["BN", "BRN", "Brunei Darussalam", "Bruneian"],
  ["BG", "BGR", "Bulgaria", "Bulgarian"],
  ["BF", "BFA", "Burkina Faso", "Burkinabè"],
  ["BI", "BDI", "Burundi", "Burundian"],
  ["CV", "CPV", "Cabo Verde", "Cabo Verdean"],
  ["KH", "KHM", "Cambodia", "Cambodian"],
  ["CM", "CMR", "Cameroon", "Cameroonian"],
  ["CA", "CAN", "Canada", "Canadian"],
  ["KY", "CYM", "Cayman Islands", "Caymanian"],
  ["CF", "CAF", "Central African Republic", "Central African"],
  ["TD", "TCD", "Chad", "Chadian"],
  ["CL", "CHL", "Chile", "Chilean"],
  ["CN", "CHN", "China", "Chinese"],
  ["CX", "CXR", "Christmas Island", "Christmas Islander"],
  ["CC", "CCK", "Cocos (Keeling) Islands", "Cocos Islander"],
  ["CO", "COL", "Colombia", "Colombian"],
  ["KM", "COM", "Comoros", "Comorian"],
  ["CG", "COG", "Congo", "Congolese"],
  ["CD", "COD", "Congo, Democratic Republic of the", "Congolese"],
  ["CK", "COK", "Cook Islands", "Cook Islander"],
  ["CR", "CRI", "Costa Rica", "Costa Rican"],
  ["CI", "CIV", "Côte d'Ivoire", "Ivorian"],
  ["HR", "HRV", "Croatia", "Croatian"],
  ["CU", "CUB", "Cuba", "Cuban"],
  ["CW", "CUW", "Curaçao", "Curaçaoan"],
  ["CY", "CYP", "Cyprus", "Cypriot"],
  ["CZ", "CZE", "Czechia", "Czech"],
  ["DK", "DNK", "Denmark", "Danish"],
  ["DJ", "DJI", "Djibouti", "Djiboutian"],
  ["DM", "DMA", "Dominica", "Dominican"],
  ["DO", "DOM", "Dominican Republic", "Dominican"],
  ["EC", "ECU", "Ecuador", "Ecuadorian"],
  ["EG", "EGY", "Egypt", "Egyptian"],
  ["SV", "SLV", "El Salvador", "Salvadoran"],
  ["GQ", "GNQ", "Equatorial Guinea", "Equatorial Guinean"],
  ["ER", "ERI", "Eritrea", "Eritrean"],
  ["EE", "EST", "Estonia", "Estonian"],
  ["SZ", "SWZ", "Eswatini", "Swazi"],
  ["ET", "ETH", "Ethiopia", "Ethiopian"],
  ["FK", "FLK", "Falkland Islands", "Falkland Islander"],
  ["FO", "FRO", "Faroe Islands", "Faroese"],
  ["FJ", "FJI", "Fiji", "Fijian"],
  ["FI", "FIN", "Finland", "Finnish"],
  ["FR", "FRA", "France", "French"],
  ["GF", "GUF", "French Guiana", "French Guianese"],
  ["PF", "PYF", "French Polynesia", "French Polynesian"],
  ["TF", "ATF", "French Southern Territories", null],
  ["GA", "GAB", "Gabon", "Gabonese"],
  ["GM", "GMB", "Gambia", "Gambian"],
  ["GE", "GEO", "Georgia", "Georgian"],
  ["DE", "DEU", "Germany", "German"],
  ["GH", "GHA", "Ghana", "Ghanaian"],
  ["GI", "GIB", "Gibraltar", "Gibraltarian"],
  ["GR", "GRC", "Greece", "Greek"],
  ["GL", "GRL", "Greenland", "Greenlandic"],
  ["GD", "GRD", "Grenada", "Grenadian"],
  ["GP", "GLP", "Guadeloupe", "Guadeloupean"],
  ["GU", "GUM", "Guam", "Guamanian"],
  ["GT", "GTM", "Guatemala", "Guatemalan"],
  ["GG", "GGY", "Guernsey", "Guernseyman"],
  ["GN", "GIN", "Guinea", "Guinean"],
  ["GW", "GNB", "Guinea-Bissau", "Bissau-Guinean"],
  ["GY", "GUY", "Guyana", "Guyanese"],
  ["HT", "HTI", "Haiti", "Haitian"],
  ["HM", "HMD", "Heard Island and McDonald Islands", null],
  ["VA", "VAT", "Holy See", "Vatican"],
  ["HN", "HND", "Honduras", "Honduran"],
  ["HK", "HKG", "Hong Kong", "Hong Konger"],
  ["HU", "HUN", "Hungary", "Hungarian"],
  ["IS", "ISL", "Iceland", "Icelandic"],
  ["IN", "IND", "India", "Indian"],
  ["ID", "IDN", "Indonesia", "Indonesian"],
  ["IR", "IRN", "Iran", "Iranian"],
  ["IQ", "IRQ", "Iraq", "Iraqi"],
  ["IE", "IRL", "Ireland", "Irish"],
  ["IM", "IMN", "Isle of Man", "Manx"],
  ["IL", "ISR", "Israel", "Israeli"],
  ["IT", "ITA", "Italy", "Italian"],
  ["JM", "JAM", "Jamaica", "Jamaican"],
  ["JP", "JPN", "Japan", "Japanese"],
  ["JE", "JEY", "Jersey", "Jerseyman"],
  ["JO", "JOR", "Jordan", "Jordanian"],
  ["KZ", "KAZ", "Kazakhstan", "Kazakhstani"],
  ["KE", "KEN", "Kenya", "Kenyan"],
  ["KI", "KIR", "Kiribati", "I-Kiribati"],
  ["KP", "PRK", "Korea, Democratic People's Republic of", "North Korean"],
  ["KR", "KOR", "Korea, Republic of", "South Korean"],
  ["KW", "KWT", "Kuwait", "Kuwaiti"],
  ["KG", "KGZ", "Kyrgyzstan", "Kyrgyzstani"],
  ["LA", "LAO", "Lao People's Democratic Republic", "Lao"],
  ["LV", "LVA", "Latvia", "Latvian"],
  ["LB", "LBN", "Lebanon", "Lebanese"],
  ["LS", "LSO", "Lesotho", "Mosotho"],
  ["LR", "LBR", "Liberia", "Liberian"],
  ["LY", "LBY", "Libya", "Libyan"],
  ["LI", "LIE", "Liechtenstein", "Liechtensteiner"],
  ["LT", "LTU", "Lithuania", "Lithuanian"],
  ["LU", "LUX", "Luxembourg", "Luxembourgish"],
  ["MO", "MAC", "Macao", "Macanese"],
  ["MG", "MDG", "Madagascar", "Malagasy"],
  ["MW", "MWI", "Malawi", "Malawian"],
  ["MY", "MYS", "Malaysia", "Malaysian"],
  ["MV", "MDV", "Maldives", "Maldivian"],
  ["ML", "MLI", "Mali", "Malian"],
  ["MT", "MLT", "Malta", "Maltese"],
  ["MH", "MHL", "Marshall Islands", "Marshallese"],
  ["MQ", "MTQ", "Martinique", "Martinican"],
  ["MR", "MRT", "Mauritania", "Mauritanian"],
  ["MU", "MUS", "Mauritius", "Mauritian"],
  ["YT", "MYT", "Mayotte", "Mahoran"],
  ["MX", "MEX", "Mexico", "Mexican"],
  ["FM", "FSM", "Micronesia", "Micronesian"],
  ["MD", "MDA", "Moldova", "Moldovan"],
  ["MC", "MCO", "Monaco", "Monégasque"],
  ["MN", "MNG", "Mongolia", "Mongolian"],
  ["ME", "MNE", "Montenegro", "Montenegrin"],
  ["MS", "MSR", "Montserrat", "Montserratian"],
  ["MA", "MAR", "Morocco", "Moroccan"],
  ["MZ", "MOZ", "Mozambique", "Mozambican"],
  ["MM", "MMR", "Myanmar", "Burmese"],
  ["NA", "NAM", "Namibia", "Namibian"],
  ["NR", "NRU", "Nauru", "Nauruan"],
  ["NP", "NPL", "Nepal", "Nepali"],
  ["NL", "NLD", "Netherlands", "Dutch"],
  ["NC", "NCL", "New Caledonia", "New Caledonian"],
  ["NZ", "NZL", "New Zealand", "New Zealander"],
  ["NI", "NIC", "Nicaragua", "Nicaraguan"],
  ["NE", "NER", "Niger", "Nigerien"],
  ["NG", "NGA", "Nigeria", "Nigerian"],
  ["NU", "NIU", "Niue", "Niuean"],
  ["NF", "NFK", "Norfolk Island", "Norfolk Islander"],
  ["MK", "MKD", "North Macedonia", "Macedonian"],
  ["MP", "MNP", "Northern Mariana Islands", "Northern Mariana Islander"],
  ["NO", "NOR", "Norway", "Norwegian"],
  ["OM", "OMN", "Oman", "Omani"],
  ["PK", "PAK", "Pakistan", "Pakistani"],
  ["PW", "PLW", "Palau", "Palauan"],
  ["PS", "PSE", "Palestine, State of", "Palestinian"],
  ["PA", "PAN", "Panama", "Panamanian"],
  ["PG", "PNG", "Papua New Guinea", "Papua New Guinean"],
  ["PY", "PRY", "Paraguay", "Paraguayan"],
  ["PE", "PER", "Peru", "Peruvian"],
  ["PH", "PHL", "Philippines", "Filipino"],
  ["PN", "PCN", "Pitcairn", "Pitcairn Islander"],
  ["PL", "POL", "Poland", "Polish"],
  ["PT", "PRT", "Portugal", "Portuguese"],
  ["PR", "PRI", "Puerto Rico", "Puerto Rican"],
  ["QA", "QAT", "Qatar", "Qatari"],
  ["RE", "REU", "Réunion", "Réunionese"],
  ["RO", "ROU", "Romania", "Romanian"],
  ["RU", "RUS", "Russian Federation", "Russian"],
  ["RW", "RWA", "Rwanda", "Rwandan"],
  ["BL", "BLM", "Saint Barthélemy", "Saint Barthélemy Islander"],
  ["SH", "SHN", "Saint Helena, Ascension and Tristan da Cunha", "Saint Helenian"],
  ["KN", "KNA", "Saint Kitts and Nevis", "Kittitian or Nevisian"],
  ["LC", "LCA", "Saint Lucia", "Saint Lucian"],
  ["MF", "MAF", "Saint Martin (French part)", "Saint-Martinoise"],
  ["PM", "SPM", "Saint Pierre and Miquelon", "Saint-Pierrais"],
  ["VC", "VCT", "Saint Vincent and the Grenadines", "Vincentian"],
  ["WS", "WSM", "Samoa", "Samoan"],
  ["SM", "SMR", "San Marino", "Sammarinese"],
  ["ST", "STP", "Sao Tome and Principe", "São Toméan"],
  ["SA", "SAU", "Saudi Arabia", "Saudi Arabian"],
  ["SN", "SEN", "Senegal", "Senegalese"],
  ["RS", "SRB", "Serbia", "Serbian"],
  ["SC", "SYC", "Seychelles", "Seychellois"],
  ["SL", "SLE", "Sierra Leone", "Sierra Leonean"],
  ["SG", "SGP", "Singapore", "Singaporean"],
  ["SX", "SXM", "Sint Maarten (Dutch part)", "Sint Maartener"],
  ["SK", "SVK", "Slovakia", "Slovak"],
  ["SI", "SVN", "Slovenia", "Slovenian"],
  ["SB", "SLB", "Solomon Islands", "Solomon Islander"],
  ["SO", "SOM", "Somalia", "Somali"],
  ["ZA", "ZAF", "South Africa", "South African"],
  ["GS", "SGS", "South Georgia and the South Sandwich Islands", null],
  ["SS", "SSD", "South Sudan", "South Sudanese"],
  ["ES", "ESP", "Spain", "Spanish"],
  ["LK", "LKA", "Sri Lanka", "Sri Lankan"],
  ["SD", "SDN", "Sudan", "Sudanese"],
  ["SR", "SUR", "Suriname", "Surinamese"],
  ["SJ", "SJM", "Svalbard and Jan Mayen", null],
  ["SE", "SWE", "Sweden", "Swedish"],
  ["CH", "CHE", "Switzerland", "Swiss"],
  ["SY", "SYR", "Syrian Arab Republic", "Syrian"],
  ["TW", "TWN", "Taiwan", "Taiwanese"],
  ["TJ", "TJK", "Tajikistan", "Tajikistani"],
  ["TZ", "TZA", "Tanzania", "Tanzanian"],
  ["TH", "THA", "Thailand", "Thai"],
  ["TL", "TLS", "Timor-Leste", "Timorese"],
  ["TG", "TGO", "Togo", "Togolese"],
  ["TK", "TKL", "Tokelau", "Tokelauan"],
  ["TO", "TON", "Tonga", "Tongan"],
  ["TT", "TTO", "Trinidad and Tobago", "Trinidadian or Tobagonian"],
  ["TN", "TUN", "Tunisia", "Tunisian"],
  ["TR", "TUR", "Türkiye", "Turkish"],
  ["TM", "TKM", "Turkmenistan", "Turkmen"],
  ["TC", "TCA", "Turks and Caicos Islands", "Turks and Caicos Islander"],
  ["TV", "TUV", "Tuvalu", "Tuvaluan"],
  ["UG", "UGA", "Uganda", "Ugandan"],
  ["UA", "UKR", "Ukraine", "Ukrainian"],
  ["AE", "ARE", "United Arab Emirates", "Emirati"],
  ["GB", "GBR", "United Kingdom", "British"],
  ["US", "USA", "United States", "American"],
  ["UM", "UMI", "United States Minor Outlying Islands", null],
  ["UY", "URY", "Uruguay", "Uruguayan"],
  ["UZ", "UZB", "Uzbekistan", "Uzbekistani"],
  ["VU", "VUT", "Vanuatu", "Ni-Vanuatu"],
  ["VE", "VEN", "Venezuela", "Venezuelan"],
  ["VN", "VNM", "Viet Nam", "Vietnamese"],
  ["VG", "VGB", "Virgin Islands (British)", "British Virgin Islander"],
  ["VI", "VIR", "Virgin Islands (U.S.)", "U.S. Virgin Islander"],
  ["WF", "WLF", "Wallis and Futuna", "Wallisian"],
  ["EH", "ESH", "Western Sahara", "Sahrawi"],
  ["YE", "YEM", "Yemen", "Yemeni"],
  ["ZM", "ZMB", "Zambia", "Zambian"],
  ["ZW", "ZWE", "Zimbabwe", "Zimbabwean"],
];

/** Every country, alphabetical by name. */
export const COUNTRIES: readonly Country[] = RAW.map(
  ([code, code3, name, demonym]) => ({ code, code3, name, demonym })
);

/**
 * Extra spellings that must resolve to a country but are NOT offered in the
 * dropdowns, either because they are informal ("Holland"), because they are a
 * former name ("Burma"), or because they are a shorthand the existing data
 * already contains ("UAE", "UAE National").
 *
 * Every key that `lib/country.ts` accepted before this file existed is present
 * here or is derivable from COUNTRIES above; `scripts/qa-country-resolver.mjs`
 * asserts that, so removing one fails the check rather than silently dropping a
 * flag from a student record.
 *
 * Keys are matched after normalisation (lowercase, letters only), so the
 * punctuation and spacing written here is only for readability.
 */
export const ALIASES: Readonly<Record<string, string>> = {
  // Shorthands and informal names in use in the existing lead data.
  uae: "AE",
  uaenational: "AE",
  emirates: "AE",
  uk: "GB",
  greatbritain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  northernireland: "GB",
  english: "GB",
  scottish: "GB",
  welsh: "GB",
  usa: "US",
  us: "US",
  unitedstatesofamerica: "US",
  america: "US",
  holland: "NL",
  thenetherlands: "NL",
  ksa: "SA",
  saudi: "SA",
  burma: "MM",
  myanmarese: "MM",
  ivorycoast: "CI",
  czechrepublic: "CZ",
  swaziland: "SZ",
  capeverde: "CV",
  eastimor: "TL",
  easttimor: "TL",
  macedonia: "MK",
  macau: "MO", // ISO spells it "Macao"; the data uses "Macau".
  vatican: "VA",
  vaticancity: "VA",
  // Country names that differ from the ISO short name used above.
  korea: "KR",
  southkorea: "KR",
  republicofkorea: "KR",
  northkorea: "KP",
  democraticpeoplesrepublicofkorea: "KP",
  russia: "RU",
  turkey: "TR",
  syria: "SY",
  laos: "LA",
  palestine: "PS",
  brunei: "BN",
  drcongo: "CD",
  democraticrepublicofthecongo: "CD",
  republicofthecongo: "CG",
  // Alternative demonyms.
  korean: "KR", // Ambiguous in principle; the data means South Korea, as it did before.
  laotian: "LA", // The list carries the official "Lao".
  trinidadian: "TT", // Short for the official "Trinidadian or Tobagonian".
  nepalese: "NP",
  filipina: "PH",
  argentinian: "AR",
  kazakh: "KZ",
  uzbek: "UZ",
  kyrgyz: "KG",
  tajik: "TJ",
  botswanan: "BW",
  basotho: "LS",
  kiwi: "NZ",
  hongkonger: "HK",
  costarican: "CR",
  srilankan: "LK",
  southafrican: "ZA",
  newzealander: "NZ",
  papuanewguinean: "PG",
  equatorialguinean: "GQ",
  centralafrican: "CF",
  bissauguinean: "GW",
  timorese: "TL",
  sahrawi: "EH",
};

/**
 * Strip case, spaces, punctuation and accents so "Côte d'Ivoire" == "cotedivoire".
 *
 * NFD splits an accented letter into a plain letter plus a combining mark, and
 * the final `[^a-z]` then drops the mark along with the spaces and apostrophes —
 * so no separate diacritic pass is needed, and this file carries no raw
 * combining characters that an editor or a codemod could mangle.
 */
export function normaliseCountryKey(s: string): string {
  return s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/**
 * Country names for the "Country of Residence" dropdown — all 249, including the
 * uninhabited territories, because someone can hold a posting on one.
 */
export const COUNTRY_NAME_OPTIONS: readonly { value: string; label: string }[] =
  COUNTRIES.map((c) => ({ value: c.name, label: c.name }));

/**
 * Nationalities for the "Nationality" dropdown — 239 entries: the 241 countries
 * that have a demonym, deduplicated down by the two words that cover two ISO
 * entries each ("Congolese" for both Congos, "Dominican" for Dominica and the
 * Dominican Republic). Showing the same word twice in a list someone is scanning
 * is worse than showing it once.
 */
export const NATIONALITY_OPTIONS: readonly { value: string; label: string }[] =
  Array.from(
    new Map(
      COUNTRIES.filter((c) => c.demonym !== null).map((c) => [
        c.demonym as string,
        { value: c.demonym as string, label: c.demonym as string },
      ])
    ).values()
  ).sort((a, b) => a.label.localeCompare(b.label));

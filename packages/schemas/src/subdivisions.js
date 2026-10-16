/**
 * The states, provinces and territories the catalogue names, by code.
 *
 * A venue stores its state or province as the second half of its ISO 3166-2
 * code (`TX` of `US-TX`, `ON` of `CA-ON`), because that is what an address
 * carries and what every bundled listing file uses. A visitor choosing where
 * to look reads names, not codes, so the listing's State/Province filter
 * labels each code from this table: "Texas", "Ontario".
 *
 * One table for the API, which puts the name on each facet, and for the web,
 * which labels its fallback facets the same way. Nothing here imports anything,
 * so the browser bundle can take it whole.
 *
 * A code the table does not know (a venue somebody typed "Tex." into, or a
 * country this table has no entry for) is shown as the code itself: a raw
 * code is honest, a guessed name is not.
 *
 * @module @desi-event/schemas/subdivisions
 */

/**
 * The fifty states, the District of Columbia and the five inhabited
 * territories, by ISO 3166-2:US subdivision code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const US_STATES = Object.freeze({
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
})

/**
 * The ten provinces and three territories, by ISO 3166-2:CA subdivision code.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CANADIAN_PROVINCES = Object.freeze({
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
})

/**
 * Each country's subdivisions, and what the country is called above them in a
 * grouped list.
 *
 * @type {Readonly<Record<string, {name: string, subdivisions: Readonly<Record<string, string>>}>>}
 */
export const SUBDIVISIONS_BY_COUNTRY = Object.freeze({
  US: Object.freeze({ name: 'United States', subdivisions: US_STATES }),
  CA: Object.freeze({ name: 'Canada', subdivisions: CANADIAN_PROVINCES }),
})

/**
 * Normalise a stored region to the code the table is keyed by.
 *
 * @param {unknown} region A venue's `region`, as stored.
 * @returns {string} Trimmed and upper-cased, or an empty string.
 */
export function normaliseRegionCode(region) {
  return typeof region === 'string' ? region.trim().toUpperCase() : ''
}

/**
 * The name of a state, province or territory, or its code when it is not one
 * the table knows.
 *
 * @param {string} country ISO 3166-1 alpha-2 country, e.g. `US`.
 * @param {string} region The subdivision code, e.g. `TX`; case and surrounding space are ignored.
 * @returns {string} `Texas` for (`US`, `TX`); the code itself, upper-cased, when unknown.
 */
export function subdivisionName(country, region) {
  const code = normaliseRegionCode(region)
  const table = SUBDIVISIONS_BY_COUNTRY[typeof country === 'string' ? country.toUpperCase() : '']

  return table?.subdivisions[code] ?? code
}

/**
 * What a country is called above its states or provinces in a grouped list.
 *
 * @param {string} country ISO 3166-1 alpha-2 country, e.g. `CA`.
 * @returns {string} `Canada` for `CA`; the code itself when the table has no entry.
 */
export function subdivisionCountryName(country) {
  const code = typeof country === 'string' ? country.toUpperCase() : ''

  return SUBDIVISIONS_BY_COUNTRY[code]?.name ?? code
}

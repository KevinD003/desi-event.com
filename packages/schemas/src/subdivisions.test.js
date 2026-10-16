import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  CANADIAN_PROVINCES,
  SUBDIVISIONS_BY_COUNTRY,
  US_STATES,
  isFilterableRegion,
  normaliseRegionCode,
  subdivisionCountryName,
  subdivisionName,
  venueRegionCode,
} from './subdivisions.js'
import * as barrel from './index.js'

describe('the state and province table', () => {
  it('has every state, DC and the five inhabited territories', () => {
    expect(Object.keys(US_STATES)).toHaveLength(56)
    expect(US_STATES.TX).toBe('Texas')
    expect(US_STATES.DC).toBe('District of Columbia')
    expect(US_STATES.PR).toBe('Puerto Rico')
  })

  it('has the ten provinces and three territories', () => {
    expect(Object.keys(CANADIAN_PROVINCES)).toHaveLength(13)
    expect(CANADIAN_PROVINCES.ON).toBe('Ontario')
    expect(CANADIAN_PROVINCES.QC).toBe('Quebec')
    expect(CANADIAN_PROVINCES.YT).toBe('Yukon')
  })

  it('keys every entry by a two-letter ISO 3166-2 subdivision code', () => {
    for (const { subdivisions } of Object.values(SUBDIVISIONS_BY_COUNTRY)) {
      for (const code of Object.keys(subdivisions)) expect(code).toMatch(/^[A-Z]{2}$/u)
    }
  })

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(US_STATES)).toBe(true)
    expect(Object.isFrozen(CANADIAN_PROVINCES)).toBe(true)
    expect(Object.isFrozen(SUBDIVISIONS_BY_COUNTRY)).toBe(true)
  })

  it('is in the package barrel and has its own subpath', async () => {
    expect(barrel.subdivisionName).toBe(subdivisionName)

    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(manifest.exports['./subdivisions']).toBe('./src/subdivisions.js')
  })
})

describe('subdivisionName', () => {
  it('names a state or province by country and code, in any case', () => {
    expect(subdivisionName('US', 'TX')).toBe('Texas')
    expect(subdivisionName('us', ' tx ')).toBe('Texas')
    expect(subdivisionName('CA', 'BC')).toBe('British Columbia')
  })

  it('reads a code within its own country only', () => {
    // CA is California in the US and the country code of Canada; ON is only Canadian.
    expect(subdivisionName('US', 'CA')).toBe('California')
    expect(subdivisionName('US', 'ON')).toBe('ON')
    expect(subdivisionName('CA', 'TX')).toBe('TX')
  })

  it('shows an unknown code as the code, never a guess', () => {
    expect(subdivisionName('IN', 'MH')).toBe('MH')
    expect(subdivisionName('US', 'Tex.')).toBe('TEX.')
    expect(subdivisionName(undefined, undefined)).toBe('')
  })
})

describe('normaliseRegionCode and subdivisionCountryName', () => {
  it('trims and capitalises a stored region', () => {
    expect(normaliseRegionCode('  on ')).toBe('ON')
    expect(normaliseRegionCode(null)).toBe('')
  })

  it('names the two countries the table covers and echoes any other', () => {
    expect(subdivisionCountryName('US')).toBe('United States')
    expect(subdivisionCountryName('ca')).toBe('Canada')
    expect(subdivisionCountryName('IN')).toBe('IN')
  })
})

describe('venueRegionCode: a venue region as stored (ADR 0020)', () => {
  it('stores a typed state or province name as its code, whatever its case, spacing or accents', () => {
    expect(venueRegionCode('Texas')).toBe('TX')
    expect(venueRegionCode('  new   JERSEY ')).toBe('NJ')
    expect(venueRegionCode('Ontario')).toBe('ON')
    expect(venueRegionCode('Québec')).toBe('QC')
    expect(venueRegionCode('District of Columbia')).toBe('DC')
  })

  it('capitalises a typed code and trims it', () => {
    expect(venueRegionCode(' tx ')).toBe('TX')
    expect(venueRegionCode('on')).toBe('ON')
    expect(venueRegionCode('MH')).toBe('MH')
  })

  it('keeps any other text as typed, trimmed, and leaves a non-string for the schema to refuse', () => {
    expect(venueRegionCode(' Maharashtra ')).toBe('Maharashtra')
    expect(venueRegionCode('Tex.')).toBe('Tex.')
    expect(venueRegionCode(42)).toBe(42)
  })

  it('maps every name in the table back to its own code', () => {
    for (const { subdivisions } of Object.values(SUBDIVISIONS_BY_COUNTRY)) {
      for (const [code, name] of Object.entries(subdivisions)) {
        expect(venueRegionCode(name), name).toBe(code)
        expect(venueRegionCode(name.toUpperCase()), name).toBe(code)
      }
    }
  })
})

describe('isFilterableRegion', () => {
  it('accepts a capitalised country with a short capitalised code', () => {
    expect(isFilterableRegion('US', 'TX')).toBe(true)
    expect(isFilterableRegion('CA', 'ON')).toBe(true)
    expect(isFilterableRegion('IN', 'MH')).toBe(true)
  })

  it('refuses what the State/Province filter could not read back', () => {
    expect(isFilterableRegion('US', 'TEXAS')).toBe(false)
    expect(isFilterableRegion('US', 'NEW JERSEY')).toBe(false)
    expect(isFilterableRegion('us', 'TX')).toBe(false)
    expect(isFilterableRegion('US', 'tx')).toBe(false)
    expect(isFilterableRegion('US', '')).toBe(false)
    expect(isFilterableRegion(null, 'TX')).toBe(false)
  })
})

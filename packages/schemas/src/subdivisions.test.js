import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import {
  CANADIAN_PROVINCES,
  SUBDIVISIONS_BY_COUNTRY,
  US_STATES,
  normaliseRegionCode,
  subdivisionCountryName,
  subdivisionName,
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

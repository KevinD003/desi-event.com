import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PAGE,
  DEFAULT_PER_PAGE,
  MAX_CENTS,
  MAX_PER_PAGE,
  bpsSchema,
  centsSchema,
  countrySchema,
  cuidSchema,
  currencySchema,
  emailSchema,
  isoDateTimeSchema,
  latitudeSchema,
  localeSchema,
  longitudeSchema,
  nonEmptyStringSchema,
  orderReferenceSchema,
  pageSchema,
  paginationQuerySchema,
  passwordSchema,
  perPageSchema,
  phoneSchema,
  promoCodeStringSchema,
  quantitySchema,
  queryDateTimeSchema,
  signedCentsSchema,
  slugSchema,
  ticketCodeSchema,
  timestampSchema,
  timezoneSchema,
  toSkipTake,
  urlSchema,
} from './primitives.js'

const CUID = 'ckl1a2b3c4d5e6f7g8h9i0jk'

describe('cuidSchema', () => {
  it('accepts a Prisma cuid, trimming surrounding whitespace', () => {
    expect(cuidSchema.parse(`  ${CUID} `)).toBe(CUID)
  })

  it('rejects the wrong shape', () => {
    for (const bad of ['', 'short', '1abcdefgh', 'CKL1A2B3C4D5E6F7G8H9I0JK', 'has space here']) {
      expect(cuidSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('rejects non-strings', () => {
    expect(cuidSchema.safeParse(42).success).toBe(false)
    expect(cuidSchema.safeParse(null).success).toBe(false)
  })
})

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Priya.Sharma@Example.COM ')).toBe('priya.sharma@example.com')
  })

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'nope', 'a@', '@b.com', 'a b@c.com']) {
      expect(emailSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('slugSchema', () => {
  it('accepts hyphenated lower-case words and normalises case', () => {
    expect(slugSchema.parse('Navratri-2026-Ahmedabad')).toBe('navratri-2026-ahmedabad')
  })

  it('rejects underscores, spaces, and leading or doubled hyphens', () => {
    for (const bad of ['navratri_2026', 'navratri 2026', '-navratri', 'navratri--2026', '']) {
      expect(slugSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('currencySchema', () => {
  it('upper-cases a three-letter code', () => {
    expect(currencySchema.parse('inr')).toBe('INR')
    expect(currencySchema.parse(' usd ')).toBe('USD')
  })

  it('rejects codes of the wrong length or with digits', () => {
    for (const bad of ['IN', 'INRR', 'IN1', '']) {
      expect(currencySchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('money primitives', () => {
  it('accepts non-negative integers up to the cap', () => {
    expect(centsSchema.parse(0)).toBe(0)
    expect(centsSchema.parse(149900)).toBe(149900)
    expect(centsSchema.parse(MAX_CENTS)).toBe(MAX_CENTS)
  })

  it('rejects negatives, floats and over-cap values', () => {
    expect(centsSchema.safeParse(-1).success).toBe(false)
    expect(centsSchema.safeParse(10.5).success).toBe(false)
    expect(centsSchema.safeParse(MAX_CENTS + 1).success).toBe(false)
    expect(centsSchema.safeParse('100').success).toBe(false)
  })

  it('allows negatives only on the signed variant', () => {
    expect(signedCentsSchema.parse(-500)).toBe(-500)
    expect(signedCentsSchema.safeParse(-MAX_CENTS - 1).success).toBe(false)
  })

  it('bounds basis points at 100%', () => {
    expect(bpsSchema.parse(10_000)).toBe(10_000)
    expect(bpsSchema.safeParse(10_001).success).toBe(false)
    expect(bpsSchema.safeParse(-1).success).toBe(false)
  })
})

describe('isoDateTimeSchema', () => {
  it('accepts UTC and explicit offsets', () => {
    expect(isoDateTimeSchema.parse('2026-10-01T18:30:00Z')).toBe('2026-10-01T18:30:00Z')
    expect(isoDateTimeSchema.parse('2026-10-01T18:30:00+05:30')).toBe('2026-10-01T18:30:00+05:30')
  })

  it('rejects a value with no zone information', () => {
    expect(isoDateTimeSchema.safeParse('2026-10-01T18:30:00').success).toBe(false)
    expect(isoDateTimeSchema.safeParse('2026-10-01').success).toBe(false)
  })
})

describe('timestampSchema', () => {
  it('normalises a Date to a UTC ISO string', () => {
    expect(timestampSchema.parse(new Date('2026-10-01T18:30:00Z'))).toBe('2026-10-01T18:30:00.000Z')
  })

  it('reads a bare date as midnight UTC', () => {
    expect(timestampSchema.parse('2026-10-01')).toBe('2026-10-01T00:00:00.000Z')
  })

  it('reads an offsetless datetime as UTC, with or without seconds', () => {
    expect(timestampSchema.parse('2026-10-01T18:30:00')).toBe('2026-10-01T18:30:00Z')
    expect(timestampSchema.parse('2026-10-01T18:30')).toBe('2026-10-01T18:30:00Z')
  })

  it('passes a zoned string through untouched', () => {
    expect(timestampSchema.parse('2026-10-01T18:30:00+05:30')).toBe('2026-10-01T18:30:00+05:30')
  })

  it('rejects an invalid Date', () => {
    expect(timestampSchema.safeParse(new Date('nonsense')).success).toBe(false)
  })

  it('rejects a calendar-impossible date', () => {
    expect(timestampSchema.safeParse('2026-02-29').success).toBe(false)
    expect(timestampSchema.safeParse('2024-02-29').success).toBe(true)
  })

  it('rejects other types', () => {
    expect(timestampSchema.safeParse(1_760_000_000_000).success).toBe(false)
    expect(timestampSchema.safeParse(null).success).toBe(false)
  })

  it('is what query date filters use', () => {
    expect(queryDateTimeSchema.parse('2026-01-15')).toBe('2026-01-15T00:00:00.000Z')
  })
})

describe('timezoneSchema', () => {
  it('accepts IANA zones the runtime knows', () => {
    expect(timezoneSchema.parse('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(timezoneSchema.parse(' UTC ')).toBe('UTC')
  })

  it('rejects invented zones', () => {
    expect(timezoneSchema.safeParse('Mars/Phobos').success).toBe(false)
    expect(timezoneSchema.safeParse('Asia/Atlantis').success).toBe(false)
    expect(timezoneSchema.safeParse('not a zone').success).toBe(false)
    expect(timezoneSchema.safeParse('').success).toBe(false)
  })
})

describe('urlSchema', () => {
  it('accepts http and https', () => {
    expect(urlSchema.parse('https://desi-event.com/x')).toBe('https://desi-event.com/x')
  })

  it('rejects other protocols and junk', () => {
    expect(urlSchema.safeParse('ftp://example.com').success).toBe(false)
    expect(urlSchema.safeParse('javascript:alert(1)').success).toBe(false)
    expect(urlSchema.safeParse('example.com').success).toBe(false)
  })
})

describe('text primitives', () => {
  it('trims and requires content', () => {
    expect(nonEmptyStringSchema.parse('  Garba Night  ')).toBe('Garba Night')
    expect(nonEmptyStringSchema.safeParse('   ').success).toBe(false)
  })

  it('bounds password length', () => {
    expect(passwordSchema.safeParse('sevench').success).toBe(false)
    expect(passwordSchema.parse('eightchr')).toBe('eightchr')
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false)
  })
})

describe('code primitives', () => {
  it('upper-cases ticket, promo and order codes', () => {
    expect(ticketCodeSchema.parse('de-abc123')).toBe('DE-ABC123')
    expect(promoCodeStringSchema.parse(' save10 ')).toBe('SAVE10')
    expect(orderReferenceSchema.parse('de-8f3k2q')).toBe('DE-8F3K2Q')
  })

  it('rejects codes with punctuation or the wrong length', () => {
    expect(ticketCodeSchema.safeParse('short').success).toBe(false)
    expect(promoCodeStringSchema.safeParse('a!').success).toBe(false)
    expect(orderReferenceSchema.safeParse('DE 8F3K').success).toBe(false)
  })
})

describe('misc primitives', () => {
  it('bounds quantities to a sane per-line maximum', () => {
    expect(quantitySchema.parse(1)).toBe(1)
    expect(quantitySchema.safeParse(0).success).toBe(false)
    expect(quantitySchema.safeParse(51).success).toBe(false)
  })

  it('validates coordinates', () => {
    expect(latitudeSchema.parse(23.0225)).toBeCloseTo(23.0225)
    expect(latitudeSchema.safeParse(91).success).toBe(false)
    expect(longitudeSchema.parse(72.5714)).toBeCloseTo(72.5714)
    expect(longitudeSchema.safeParse(-181).success).toBe(false)
  })

  it('validates locales and countries', () => {
    expect(localeSchema.parse('en-IN')).toBe('en-IN')
    expect(localeSchema.parse('hi')).toBe('hi')
    expect(localeSchema.safeParse('english').success).toBe(false)
    expect(countrySchema.parse('in')).toBe('IN')
    expect(countrySchema.safeParse('IND').success).toBe(false)
  })

  it('validates phone numbers loosely', () => {
    expect(phoneSchema.parse(' +91 98250 12345 ')).toBe('+91 98250 12345')
    expect(phoneSchema.safeParse('123').success).toBe(false)
    expect(phoneSchema.safeParse('not-a-phone').success).toBe(false)
  })
})

describe('paginationQuerySchema', () => {
  it('applies defaults when the query is empty', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      perPage: DEFAULT_PER_PAGE,
    })
  })

  it('coerces the strings a URL carries', () => {
    expect(paginationQuerySchema.parse({ page: '4', perPage: '25' })).toEqual({
      page: 4,
      perPage: 25,
    })
  })

  it('caps the page size', () => {
    expect(perPageSchema.parse(MAX_PER_PAGE)).toBe(MAX_PER_PAGE)
    const result = paginationQuerySchema.safeParse({ perPage: String(MAX_PER_PAGE + 1) })
    expect(result.success).toBe(false)
    expect(result.error.issues[0].path).toEqual(['perPage'])
  })

  it('rejects zero, negative, fractional and unparsable pages', () => {
    for (const bad of ['0', '-3', '1.5', 'abc', '']) {
      expect(pageSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('toSkipTake', () => {
  it('converts a page/perPage pair to Prisma offset arguments', () => {
    expect(toSkipTake({ page: 1, perPage: 20 })).toEqual({ skip: 0, take: 20 })
    expect(toSkipTake({ page: 3, perPage: 25 })).toEqual({ skip: 50, take: 25 })
  })

  it('falls back to the defaults', () => {
    expect(toSkipTake()).toEqual({ skip: 0, take: DEFAULT_PER_PAGE })
    expect(toSkipTake({ page: 2 })).toEqual({ skip: DEFAULT_PER_PAGE, take: DEFAULT_PER_PAGE })
  })
})

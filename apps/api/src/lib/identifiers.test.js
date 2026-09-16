import { describe, expect, it } from 'vitest'

import { orderReferenceSchema, slugSchema, ticketCodeSchema } from '@desi-event/schemas'

import {
  CODE_ALPHABET,
  disambiguateSlug,
  generateOrderReference,
  generateTicketCode,
  slugify,
} from './identifiers.js'

describe('generated codes', () => {
  it('produces order references and ticket codes the schemas accept', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(orderReferenceSchema.safeParse(generateOrderReference()).success).toBe(true)
      expect(ticketCodeSchema.safeParse(generateTicketCode()).success).toBe(true)
    }
  })

  it('omits the characters people mis-transcribe at a box office', () => {
    for (const character of ['0', 'O', '1', 'I']) {
      expect(CODE_ALPHABET).not.toContain(character)
    }
  })

  it('does not collide across a realistic print run', () => {
    const codes = new Set(Array.from({ length: 5_000 }, generateTicketCode))
    expect(codes.size).toBe(5_000)
  })

  it('distinguishes a ticket code from an order reference', () => {
    expect(generateTicketCode().startsWith('DET-')).toBe(true)
    expect(generateOrderReference().startsWith('DE-')).toBe(true)
  })
})

describe('slugify', () => {
  it('folds diacritics rather than dropping the letters', () => {
    expect(slugify('Café Night')).toBe('cafe-night')
    expect(slugify('Diwali Melā 2027')).toBe('diwali-mela-2027')
  })

  it('collapses punctuation and trims stray hyphens', () => {
    expect(slugify('  Garba!! Night --- 2027  ')).toBe('garba-night-2027')
    expect(slugify('A/B: the "sequel"')).toBe('a-b-the-sequel')
  })

  it('stays within the slug length limit without a trailing hyphen', () => {
    const slug = slugify(`${'long word '.repeat(40)}end`)

    expect(slug.length).toBeLessThanOrEqual(140)
    expect(slug.endsWith('-')).toBe(false)
    expect(slugSchema.safeParse(slug).success).toBe(true)
  })

  it('throws rather than returning an empty slug', () => {
    expect(() => slugify('！！！')).toThrow(/slug/i)
    expect(() => slugify('   ')).toThrow(/slug/i)
  })
})

describe('disambiguateSlug', () => {
  it('appends a suffix and keeps the result a valid slug', () => {
    const base = slugify('Navratri Garba Night')
    const disambiguated = disambiguateSlug(base)

    expect(disambiguated).not.toBe(base)
    expect(disambiguated.startsWith(`${base}-`)).toBe(true)
    expect(slugSchema.safeParse(disambiguated).success).toBe(true)
  })

  it('stays within the length limit even for a maximal slug', () => {
    const long = 'a'.repeat(140)
    expect(disambiguateSlug(long).length).toBeLessThanOrEqual(140)
  })
})

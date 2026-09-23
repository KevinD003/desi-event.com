/**
 * The stand-ins for an address, and the checks behind them.
 *
 * What is being proved is what the stand-ins do not carry: the local part's
 * length, its first or last character, an alias or a plus-suffix, and whether
 * two addresses at one domain are the same.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  HIDDEN_EMAIL,
  MASKED_LOCAL_PART,
  addressFree,
  addressStandInSchema,
  containsAddress,
  domainOnlyAddress,
  domainOnlyAddressSchema,
  withoutAddresses,
} from './addresses.js'

/** Local parts of every length that matters, with aliases and suffixes. */
const LOCAL_PARTS = [
  'p',
  'pa',
  'pri',
  'priya',
  'priya.sharma',
  'priya.sharma+tickets',
  'p+x',
  'zz-top_99',
  'a'.repeat(64),
]

describe('domainOnlyAddress', () => {
  it('reduces every local part to the same four bullets', () => {
    const shown = LOCAL_PARTS.map((local) => domainOnlyAddress(`${local}@example.com`))

    expect(new Set(shown)).toEqual(new Set(['••••@example.com']))
  })

  it('carries nothing of the local part: no length, no first or last character, no suffix', () => {
    for (const local of LOCAL_PARTS) {
      const shown = domainOnlyAddress(`${local}@example.com`)
      const [masked] = shown.split('@')

      expect(masked, local).toBe(MASKED_LOCAL_PART)
      expect(shown.length, local).toBe('••••@example.com'.length)
      expect(shown, local).not.toContain('+')
      expect(shown, local).not.toContain('*')
    }
  })

  it('cannot tell two different people at one domain apart, and so says nothing about whether they are one', () => {
    expect(domainOnlyAddress('asha@dhol.example')).toBe(domainOnlyAddress('ravi@dhol.example'))
    expect(domainOnlyAddress('asha@dhol.example')).toBe(domainOnlyAddress('asha@dhol.example'))
  })

  it('lower-cases the domain, so its case gives nothing away either', () => {
    expect(domainOnlyAddress('Priya@Example.COM')).toBe('••••@example.com')
  })

  it.each([null, undefined, '', 'no-at-sign', '@example.com', 'priya@', 'priya@localhost', 42])(
    'gives up on %s rather than invent a domain',
    (value) => {
      expect(domainOnlyAddress(value)).toBeNull()
    },
  )
})

describe('domainOnlyAddressSchema', () => {
  it.each(['••••@example.com', '••••@mail.rangoli.example'])('accepts %s', (value) => {
    expect(domainOnlyAddressSchema.parse(value)).toBe(value)
  })

  it.each([
    'priya@example.com',
    'p**********a@example.com',
    '**@example.com',
    '(none)',
    '•••@example.com',
    '•••••@example.com',
    '••••a@example.com',
    'a••••@example.com',
    '••••@',
    '••••@localhost',
    '••••@exa mple.com',
    '••••@a@example.com',
    HIDDEN_EMAIL,
  ])('refuses %s', (value) => {
    expect(domainOnlyAddressSchema.safeParse(value).success).toBe(false)
  })
})

describe('addressStandInSchema', () => {
  it('accepts the domain stand-in and the words for no address, and nothing else', () => {
    expect(addressStandInSchema.parse('••••@example.com')).toBe('••••@example.com')
    expect(addressStandInSchema.parse(HIDDEN_EMAIL)).toBe('Hidden email')
    expect(addressStandInSchema.safeParse('priya@example.com').success).toBe(false)
    expect(addressStandInSchema.safeParse('p****a@example.com').success).toBe(false)
    expect(addressStandInSchema.safeParse('hidden email').success).toBe(false)
  })
})

describe('containsAddress and withoutAddresses', () => {
  it.each([
    ['priya@example.com', true],
    ['Meera (meera.k+team@rangoli.example)', true],
    ['550 5.1.1 <someone@mail.example.co.uk>: Recipient address rejected', true],
    ['Meera', false],
    ['@handle', false],
    ['priya@localhost', false],
    ['', false],
  ])('finds an address in %s: %s', (text, found) => {
    expect(containsAddress(text)).toBe(found)
  })

  it('replaces every address in running text and leaves the rest alone', () => {
    expect(withoutAddresses('Write to priya@example.com or ravi+x@dhol.example.')).toBe(
      'Write to Hidden email or Hidden email',
    )
    expect(withoutAddresses('550 <someone@mail.example.co.uk>: rejected')).toBe(
      '550 <Hidden email>: rejected',
    )
    expect(withoutAddresses('Meera')).toBe('Meera')
  })

  it('passes anything that is not text straight through', () => {
    expect(withoutAddresses(null)).toBeNull()
    expect(withoutAddresses(undefined)).toBeUndefined()
  })

  it('is safe to call repeatedly: a global pattern that kept its position would miss every other call', () => {
    for (let round = 0; round < 5; round += 1) {
      expect(containsAddress('priya@example.com')).toBe(true)
    }
  })
})

describe('addressFree', () => {
  it('refuses text with an address in it, and accepts the words that replace one', () => {
    const name = addressFree(z.string())

    expect(name.safeParse('Meera <meera@rangoli.example>').success).toBe(false)
    expect(name.parse('Meera')).toBe('Meera')
    expect(name.parse(`Meera (${HIDDEN_EMAIL})`)).toBe('Meera (Hidden email)')
  })
})

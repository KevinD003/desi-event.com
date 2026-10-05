/**
 * The escaping that keeps a typed value from becoming a LIKE pattern.
 *
 * The database half — that PostgreSQL then matches character for character —
 * is proven in `tests/event-search-integration.test.js`, against the real
 * listing and venue routes. This is the pure half.
 *
 * @module @desi-event/api/lib/like-pattern.test
 */

import { describe, expect, it } from 'vitest'

import { equalsIgnoringCase, likeLiteral } from './like-pattern.js'
import { likeLiteral as reExported } from './website-redirect.js'

describe('likeLiteral', () => {
  it('escapes both wildcards and the escape character itself', () => {
    expect(likeLiteral('a_b%c\\d')).toBe('a\\_b\\%c\\\\d')
    expect(likeLiteral('100%')).toBe('100\\%')
    expect(likeLiteral('%_%')).toBe('\\%\\_\\%')
  })

  it('leaves ordinary text alone, so a plain search is unchanged', () => {
    expect(likeLiteral('garba-night 2026')).toBe('garba-night 2026')
    expect(likeLiteral('São Paulo')).toBe('São Paulo')
    expect(likeLiteral('')).toBe('')
  })

  it('is the one definition the website-link list also uses', () => {
    expect(reExported).toBe(likeLiteral)
  })
})

describe('equalsIgnoringCase', () => {
  it('asks for a case-insensitive match on the escaped value', () => {
    expect(equalsIgnoringCase('Snake_town')).toEqual({
      equals: 'Snake\\_town',
      mode: 'insensitive',
    })
    expect(equalsIgnoringCase('Houston')).toEqual({ equals: 'Houston', mode: 'insensitive' })
  })
})

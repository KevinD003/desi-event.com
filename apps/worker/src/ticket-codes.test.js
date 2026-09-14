import { describe, it, expect } from 'vitest'
import { ticketCodeSchema } from '@desi-event/schemas'

import {
  CODE_ALPHABET,
  TICKET_CODE_LENGTH,
  TICKET_CODE_PREFIX,
  generateTicketCode,
  generateTicketCodes,
} from './ticket-codes.js'

describe('generateTicketCode', () => {
  it('produces a code the shared ticketCodeSchema accepts', () => {
    for (let index = 0; index < 50; index += 1) {
      expect(ticketCodeSchema.safeParse(generateTicketCode()).success).toBe(true)
    }
  })

  it('uses only unambiguous characters', () => {
    const code = generateTicketCode()
    const body = code.slice(TICKET_CODE_PREFIX.length)

    expect(code.startsWith(TICKET_CODE_PREFIX)).toBe(true)
    expect(body).toHaveLength(TICKET_CODE_LENGTH)
    for (const character of body) expect(CODE_ALPHABET).toContain(character)
  })

  it('omits the characters people mistype: 0, O, 1, I', () => {
    for (const character of '01OI') expect(CODE_ALPHABET).not.toContain(character)
  })

  it('draws every character from the injected randomness source', () => {
    /** @type {number[]} */
    const bounds = []
    const code = generateTicketCode({
      random: (bound) => {
        bounds.push(bound)
        return 0
      },
    })

    expect(bounds).toHaveLength(TICKET_CODE_LENGTH)
    expect(bounds.every((bound) => bound === CODE_ALPHABET.length)).toBe(true)
    expect(code).toBe(`${TICKET_CODE_PREFIX}${CODE_ALPHABET[0].repeat(TICKET_CODE_LENGTH)}`)
  })

  it('does not repeat itself across a large batch', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateTicketCode()))
    expect(codes.size).toBe(2000)
  })
})

describe('generateTicketCodes', () => {
  it('returns the requested number of distinct codes', () => {
    const codes = generateTicketCodes(25)

    expect(codes).toHaveLength(25)
    expect(new Set(codes).size).toBe(25)
  })

  it('returns an empty array for zero', () => {
    expect(generateTicketCodes(0)).toEqual([])
  })

  it.each([-1, 1.5, '3', null])('rejects %s as a count', (count) => {
    expect(() => generateTicketCodes(count)).toThrow(RangeError)
  })

  it('gives up rather than looping forever on a degenerate randomness source', () => {
    // A source that always returns the same index can only ever produce one
    // distinct code, so asking for two must fail loudly instead of hanging.
    expect(() => generateTicketCodes(2, { random: () => 0 })).toThrow(/degenerate/)
  })
})

/**
 * The shapes a door tells apart before it sends anything: a ticket's pass, a
 * group pass, a printed group code, and anything else.
 */

import { describe, expect, it } from 'vitest'

import { looksLikeGroupCode, looksLikeGroupPass, looksLikePass } from './pass-shape.js'

const TICKET_PASS = 'a'.repeat(43)
const GROUP_PASS = `G1.${'Q'.repeat(43)}`

describe('the pass shapes', () => {
  it('tells a group pass from a ticket pass, and never matches both', () => {
    expect(looksLikeGroupPass(GROUP_PASS)).toBe(true)
    expect(looksLikePass(GROUP_PASS)).toBe(false)
    expect(looksLikePass(TICKET_PASS)).toBe(true)
    expect(looksLikeGroupPass(TICKET_PASS)).toBe(false)
    // The `.` is what keeps them apart: a ticket pass cannot contain one.
    expect(looksLikePass(`G1.${'a'.repeat(20)}`)).toBe(false)
  })

  it('refuses a group pass of the wrong length or alphabet', () => {
    expect(looksLikeGroupPass(`G1.${'Q'.repeat(42)}`)).toBe(false)
    expect(looksLikeGroupPass(`G1.${'Q'.repeat(44)}`)).toBe(false)
    expect(looksLikeGroupPass(`G2.${'Q'.repeat(43)}`)).toBe(false)
    expect(looksLikeGroupPass(`G1.${'+'.repeat(43)}`)).toBe(false)
    expect(looksLikeGroupPass(null)).toBe(false)
  })

  it('recognises a printed group code however it was typed', () => {
    expect(looksLikeGroupCode('DEG-ABCDEFGH2345')).toBe(true)
    expect(looksLikeGroupCode('  deg-abcdefgh2345 ')).toBe(true)
  })

  it('does not take a ticket code, a misread character or a short code for a group code', () => {
    expect(looksLikeGroupCode('DET-ABCDEFGH234567')).toBe(false)
    // O, I, 0 and 1 are not in the alphabet.
    expect(looksLikeGroupCode('DEG-ABCDEFGH234O')).toBe(false)
    expect(looksLikeGroupCode('DEG-ABCDEFGH2341')).toBe(false)
    expect(looksLikeGroupCode('DEG-ABCDEF')).toBe(false)
    expect(looksLikeGroupCode(undefined)).toBe(false)
  })
})

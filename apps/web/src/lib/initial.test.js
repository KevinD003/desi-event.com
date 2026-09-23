import { describe, expect, it } from 'vitest'

import { initialOf } from './initial.js'

describe('initialOf', () => {
  it('is the first letter of the name, upper-cased', () => {
    expect(initialOf('Mirrorwork Events')).toBe('M')
    expect(initialOf('  priya ')).toBe('P')
  })

  it('keeps a whole character rather than half of a surrogate pair', () => {
    expect(initialOf('𝓜eera')).toBe('𝓜')
  })

  it('is empty for a blank or missing name', () => {
    expect(initialOf('')).toBe('')
    expect(initialOf('   ')).toBe('')
    expect(initialOf(null)).toBe('')
    expect(initialOf(undefined)).toBe('')
  })
})

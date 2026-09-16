import { describe, it, expect } from 'vitest'
import { cn } from './cn.js'

describe('cn', () => {
  it('joins strings with a single space', () => {
    expect(cn('rounded-lg', 'px-4')).toBe('rounded-lg px-4')
  })

  it('drops falsy values so conditional classes stay readable at call sites', () => {
    const isHidden = false

    expect(cn('px-4', isHidden && 'hidden', null, undefined, '', 0)).toBe('px-4')
  })

  it('supports object and array syntax', () => {
    expect(cn({ 'text-rose-700': true, 'text-slate-700': false }, ['ring-1', 'ring-inset'])).toBe(
      'text-rose-700 ring-1 ring-inset',
    )
  })

  it('keeps caller classes last, so a consumer override wins the cascade tie', () => {
    expect(cn('px-4 py-2', 'px-8')).toBe('px-4 py-2 px-8')
  })

  it('returns an empty string when nothing is truthy', () => {
    expect(cn(undefined, null, false)).toBe('')
  })
})

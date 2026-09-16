import { describe, expect, it } from 'vitest'

import {
  LOGIN_OUTCOMES,
  THROTTLE,
  THROTTLED_MESSAGE,
  checkLoginThrottle,
  windowStart,
} from './throttle.js'

const NOW = new Date('2026-09-15T12:00:00.000Z')

describe('checkLoginThrottle', () => {
  it('allows an attempt with no recent failures', () => {
    expect(checkLoginThrottle({})).toEqual({ allowed: true, scope: null, retryAfterSeconds: 0 })
  })

  it('allows an attempt one below the per-email threshold', () => {
    expect(checkLoginThrottle({ emailFailures: THROTTLE.perEmail.max - 1 }).allowed).toBe(true)
  })

  it('refuses at the per-email threshold', () => {
    const result = checkLoginThrottle({ emailFailures: THROTTLE.perEmail.max })

    expect(result.allowed).toBe(false)
    expect(result.scope).toBe('email')
  })

  it('refuses well past the threshold, rather than wrapping', () => {
    expect(checkLoginThrottle({ emailFailures: 10_000 }).allowed).toBe(false)
  })

  it('counts down the lockout from the last failure', () => {
    const result = checkLoginThrottle({
      emailFailures: THROTTLE.perEmail.max,
      lastEmailFailureAt: new Date(NOW.getTime() - 60_000),
      now: NOW,
    })

    expect(result.retryAfterSeconds).toBe(THROTTLE.perEmail.lockoutMs / 1000 - 60)
  })

  it('never returns a zero retry hint while refusing, which would invite an immediate retry', () => {
    const elapsed = new Date(NOW.getTime() - THROTTLE.perEmail.lockoutMs * 2)
    const result = checkLoginThrottle({
      emailFailures: THROTTLE.perEmail.max,
      lastEmailFailureAt: elapsed,
      now: NOW,
    })

    expect(result.allowed).toBe(false)
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('handles a missing last-failure timestamp', () => {
    const result = checkLoginThrottle({ emailFailures: THROTTLE.perEmail.max })

    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('refuses at the per-IP threshold even when no single account is close', () => {
    // The spray: one or two guesses at each of a thousand addresses never trips
    // a per-account counter, which is why there are two counters.
    const result = checkLoginThrottle({ emailFailures: 0, ipFailures: THROTTLE.perIp.max })

    expect(result).toMatchObject({ allowed: false, scope: 'ip' })
  })

  it('allows an attempt one below the per-IP threshold', () => {
    expect(checkLoginThrottle({ ipFailures: THROTTLE.perIp.max - 1 }).allowed).toBe(true)
  })

  it('reports the email scope first when both are tripped', () => {
    const result = checkLoginThrottle({
      emailFailures: THROTTLE.perEmail.max,
      ipFailures: THROTTLE.perIp.max,
    })

    expect(result.scope).toBe('email')
  })

  it('accepts an overriding policy', () => {
    const strict = { perEmail: { max: 1, windowMs: 1000, lockoutMs: 1000 }, perIp: THROTTLE.perIp }

    expect(checkLoginThrottle({ emailFailures: 1 }, strict).allowed).toBe(false)
    expect(checkLoginThrottle({ emailFailures: 0 }, strict).allowed).toBe(true)
  })
})

describe('the thresholds', () => {
  it('are far enough apart that a shared address is not treated as one account', () => {
    // An office or a mobile carrier NAT puts many legitimate people behind one
    // address. A per-IP threshold anywhere near the per-account one would lock
    // all of them out when one person forgets their password.
    expect(THROTTLE.perIp.max).toBeGreaterThan(THROTTLE.perEmail.max * 5)
  })

  it('give a person more guesses than typos and fewer than a dictionary', () => {
    expect(THROTTLE.perEmail.max).toBeGreaterThanOrEqual(3)
    expect(THROTTLE.perEmail.max).toBeLessThanOrEqual(10)
  })

  it('lapse on their own, so nobody can lock somebody else out permanently', () => {
    for (const scope of Object.values(THROTTLE)) {
      expect(scope.lockoutMs).toBeGreaterThan(0)
      expect(scope.lockoutMs).toBeLessThanOrEqual(60 * 60 * 1000)
      expect(scope.windowMs).toBeGreaterThan(0)
    }
  })
})

describe('windowStart', () => {
  it('is the window length before now', () => {
    expect(windowStart(60_000, NOW).toISOString()).toBe('2026-09-15T11:59:00.000Z')
  })
})

describe('what a throttled caller is told', () => {
  it('names neither the account nor the remaining budget', () => {
    // "Too many attempts for this address" would confirm the address exists. A
    // remaining-attempts count would tell an attacker exactly when to rotate
    // their source address.
    expect(THROTTLED_MESSAGE).not.toMatch(/\d/)
    expect(THROTTLED_MESSAGE.toLowerCase()).not.toContain('account')
    expect(THROTTLED_MESSAGE.toLowerCase()).not.toContain('exist')
  })

  it('tells them what to do instead', () => {
    expect(THROTTLED_MESSAGE.toLowerCase()).toContain('reset')
  })
})

describe('LOGIN_OUTCOMES', () => {
  it('enumerates every outcome the sign-in path can record', () => {
    expect(Object.values(LOGIN_OUTCOMES).sort()).toEqual([
      'bad_password',
      'mfa_failed',
      'mfa_required',
      'success',
      'suspended',
      'throttled',
      'unknown_email',
      'unverified',
    ])
  })

  it('is coarse enough that a row cannot carry a credential', () => {
    for (const outcome of Object.values(LOGIN_OUTCOMES)) {
      expect(outcome).toMatch(/^[a-z_]{1,32}$/)
    }
  })
})

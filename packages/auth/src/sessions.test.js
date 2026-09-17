import { describe, expect, it } from 'vitest'

import {
  PRIVILEGED_ORG_ROLES,
  PRIVILEGED_PLATFORM_ROLES,
  REVOCATION_REASONS,
  SESSION_LIFETIMES,
  STEP_UP_POLICIES,
  STEP_UP_POLICY_NAMES,
  STEP_UP_WINDOW_MS,
  revokesSiblings,
  sessionPolicyFor,
  sessionUsable,
  shouldRotate,
  stepUpSatisfied,
  stepUpWindowFor,
} from './sessions.js'

const NOW = new Date('2026-09-15T12:00:00.000Z')

/**
 * A moment relative to `NOW`.
 *
 * @param {number} ms Milliseconds from now; negative is in the past.
 * @returns {Date} The moment.
 */
const at = (ms) => new Date(NOW.getTime() + ms)

/**
 * A session row.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} A `Session`-shaped row.
 */
const session = (overrides = {}) => ({
  createdAt: at(-60_000),
  lastSeenAt: at(-1000),
  expiresAt: at(60 * 60 * 1000),
  revokedAt: null,
  rotatedAt: null,
  mfaSatisfiedAt: null,
  ...overrides,
})

describe('sessionPolicyFor', () => {
  it('gives an attendee the long lifetime and no MFA requirement', () => {
    const policy = sessionPolicyFor({ role: 'ATTENDEE', memberships: [] })

    expect(policy).toEqual({
      privileged: false,
      lifetimes: SESSION_LIFETIMES.attendee,
      mfaRequired: false,
    })
  })

  it.each([...PRIVILEGED_PLATFORM_ROLES])('treats the platform role %s as privileged', (role) => {
    expect(sessionPolicyFor({ role, memberships: [] })).toMatchObject({
      privileged: true,
      lifetimes: SESSION_LIFETIMES.privileged,
      mfaRequired: true,
    })
  })

  it.each(['ATTENDEE', 'ORGANIZER'])(
    'does not treat the platform role %s as privileged',
    (role) => {
      // ORGANIZER is a platform role that by itself grants nothing — authority
      // comes from a membership. Treating it as privileged would put every
      // organiser's session on a one-hour idle timeout for no gain.
      expect(sessionPolicyFor({ role, memberships: [] }).privileged).toBe(false)
    },
  )

  it.each([...PRIVILEGED_ORG_ROLES])('treats the organisation role %s as privileged', (role) => {
    const policy = sessionPolicyFor({
      role: 'ATTENDEE',
      memberships: [{ organizationId: 'o', role }],
    })

    expect(policy).toMatchObject({ privileged: true, mfaRequired: true })
  })

  it.each(['SCANNER', 'STAFF', 'VIEWER'])(
    'does not shorten a %s session, which lives on a phone at a door',
    (role) => {
      const policy = sessionPolicyFor({
        role: 'ATTENDEE',
        memberships: [{ organizationId: 'o', role }],
      })

      expect(policy).toMatchObject({ privileged: false, mfaRequired: false })
    },
  )

  it('is privileged when any one membership is, not only the first', () => {
    const policy = sessionPolicyFor({
      role: 'ATTENDEE',
      memberships: [
        { organizationId: 'a', role: 'VIEWER' },
        { organizationId: 'b', role: 'FINANCE' },
      ],
    })

    expect(policy.privileged).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an actor with no memberships field', { role: 'ATTENDEE' }],
    ['an actor with no role', { memberships: [] }],
  ])('treats %s as unprivileged rather than throwing', (_label, actor) => {
    expect(sessionPolicyFor(actor).privileged).toBe(false)
  })

  it('gives a privileged session a much shorter life than an attendee session', () => {
    expect(SESSION_LIFETIMES.privileged.absoluteMs).toBeLessThan(
      SESSION_LIFETIMES.attendee.absoluteMs,
    )
    expect(SESSION_LIFETIMES.privileged.idleMs).toBeLessThan(SESSION_LIFETIMES.attendee.idleMs)
  })

  it('never lets a session idle longer than it lives', () => {
    for (const lifetimes of Object.values(SESSION_LIFETIMES)) {
      expect(lifetimes.idleMs).toBeLessThanOrEqual(lifetimes.absoluteMs)
      expect(lifetimes.rotateAfterMs).toBeLessThanOrEqual(lifetimes.absoluteMs)
    }
  })
})

describe('sessionUsable', () => {
  it('accepts a live session', () => {
    expect(sessionUsable(session(), { now: NOW })).toEqual({ valid: true, reason: null })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('refuses %s', (_label, value) => {
    expect(sessionUsable(value, { now: NOW })).toEqual({ valid: false, reason: 'unknown' })
  })

  it('refuses a revoked session', () => {
    expect(sessionUsable(session({ revokedAt: at(-1000) }), { now: NOW })).toEqual({
      valid: false,
      reason: 'revoked',
    })
  })

  it('refuses an expired session', () => {
    expect(sessionUsable(session({ expiresAt: at(-1) }), { now: NOW })).toEqual({
      valid: false,
      reason: 'expired',
    })
  })

  it('refuses a session expiring exactly now', () => {
    expect(sessionUsable(session({ expiresAt: NOW }), { now: NOW })).toMatchObject({
      reason: 'expired',
    })
  })

  it('reports revocation before expiry, so an administrative action is what gets logged', () => {
    const both = session({ revokedAt: at(-1000), expiresAt: at(-1000) })

    expect(sessionUsable(both, { now: NOW }).reason).toBe('revoked')
  })

  it('refuses a session idle longer than its policy allows', () => {
    const idle = session({ lastSeenAt: at(-2 * 60 * 60 * 1000) })

    expect(sessionUsable(idle, { now: NOW, lifetimes: SESSION_LIFETIMES.privileged })).toEqual({
      valid: false,
      reason: 'idle',
    })
  })

  it('accepts the same session under the attendee policy', () => {
    // The same row, two policies: this is what makes the idle timeout a property
    // of who the session belongs to rather than of the row.
    const idle = session({ lastSeenAt: at(-2 * 60 * 60 * 1000) })

    expect(sessionUsable(idle, { now: NOW, lifetimes: SESSION_LIFETIMES.attendee })).toMatchObject({
      valid: true,
    })
  })

  it('does not apply an idle timeout when no policy is supplied', () => {
    const idle = session({ lastSeenAt: at(-365 * 24 * 60 * 60 * 1000) })

    expect(sessionUsable(idle, { now: NOW })).toMatchObject({ valid: true })
  })

  it.each([
    ['a string', '2026-09-15T13:00:00.000Z'],
    ['a number', 1_789_000_000_000],
    ['null', null],
  ])('refuses a session whose expiry is %s rather than a Date', (_label, expiresAt) => {
    expect(sessionUsable(session({ expiresAt }), { now: NOW })).toEqual({
      valid: false,
      reason: 'malformed',
    })
  })
})

describe('shouldRotate', () => {
  it('is true once the secret is older than the rotation interval', () => {
    const old = session({ createdAt: at(-2 * 60 * 60 * 1000) })

    expect(shouldRotate(old, { now: NOW, lifetimes: SESSION_LIFETIMES.privileged })).toBe(true)
  })

  it('is false for a freshly created session', () => {
    expect(shouldRotate(session(), { now: NOW, lifetimes: SESSION_LIFETIMES.privileged })).toBe(
      false,
    )
  })

  it('measures from the last rotation, not from creation', () => {
    // Otherwise every request after the first interval would rotate, which
    // churns the cookie and loses a race with a concurrent request.
    const rotated = session({ createdAt: at(-10 * 60 * 60 * 1000), rotatedAt: at(-60_000) })

    expect(shouldRotate(rotated, { now: NOW, lifetimes: SESSION_LIFETIMES.privileged })).toBe(false)
  })

  it('is false when no policy is supplied', () => {
    expect(shouldRotate(session(), { now: NOW })).toBe(false)
  })

  it('is true when the row carries no usable timestamp at all', () => {
    expect(
      shouldRotate({ createdAt: null }, { now: NOW, lifetimes: SESSION_LIFETIMES.attendee }),
    ).toBe(true)
  })

  it('is true exactly at the interval, not one millisecond later', () => {
    const exact = session({
      createdAt: at(-SESSION_LIFETIMES.privileged.rotateAfterMs),
      rotatedAt: null,
    })

    expect(shouldRotate(exact, { now: NOW, lifetimes: SESSION_LIFETIMES.privileged })).toBe(true)
  })
})

describe('stepUpSatisfied', () => {
  it('is false for a session that has never stepped up', () => {
    expect(stepUpSatisfied(session(), { now: NOW })).toBe(false)
  })

  it('is true within the window', () => {
    const stepped = session({ mfaSatisfiedAt: at(-STEP_UP_WINDOW_MS + 1000) })

    expect(stepUpSatisfied(stepped, { now: NOW })).toBe(true)
  })

  it('is false once the window has passed', () => {
    const stale = session({ mfaSatisfiedAt: at(-STEP_UP_WINDOW_MS - 1) })

    expect(stepUpSatisfied(stale, { now: NOW })).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a session with a string timestamp', session({ mfaSatisfiedAt: '2026-09-15T11:59:00Z' })],
  ])('is false for %s', (_label, value) => {
    expect(stepUpSatisfied(value, { now: NOW })).toBe(false)
  })

  it('lasts long enough to approve a batch and short enough to lapse at a desk', () => {
    expect(STEP_UP_WINDOW_MS).toBeGreaterThanOrEqual(5 * 60 * 1000)
    expect(STEP_UP_WINDOW_MS).toBeLessThanOrEqual(30 * 60 * 1000)
  })
})

describe('revokesSiblings', () => {
  it.each([
    'SIGNED_OUT_EVERYWHERE',
    'PASSWORD_CHANGED',
    'PASSWORD_RESET',
    'MFA_CHANGED',
    'ACCOUNT_SUSPENDED',
  ])('ends every other session after %s', (reason) => {
    // The three that are easy to forget are the ones that matter: a session
    // established with the old password must stop working when the password
    // changes, or changing it because somebody else knows it accomplishes
    // nothing.
    expect(revokesSiblings(REVOCATION_REASONS[reason])).toBe(true)
  })

  it.each(['SIGNED_OUT', 'ROTATED', 'DEVICE_REVOKED', 'ADMINISTRATIVE'])(
    'leaves other sessions alone after %s',
    (reason) => {
      expect(revokesSiblings(REVOCATION_REASONS[reason])).toBe(false)
    },
  )

  it('is false for a reason it has never heard of', () => {
    expect(revokesSiblings('something-else')).toBe(false)
    expect(revokesSiblings(undefined)).toBe(false)
  })

  it('names every reason it uses, so a typo cannot silently mean "no"', () => {
    for (const reason of Object.values(REVOCATION_REASONS)) {
      expect(typeof reason).toBe('string')
      expect(reason).toMatch(/^[a-z_]+$/)
    }
  })
})

describe('step-up policies', () => {
  // Finding NF-11. One fixed window meant reading a revenue figure and removing
  // somebody's second factor were treated as equally recent.

  it('gives a tighter window to changing credentials than to reading finance', () => {
    expect(STEP_UP_POLICIES.CREDENTIAL).toBeLessThan(STEP_UP_POLICIES.FINANCE_ACTION)
    expect(STEP_UP_POLICIES.FINANCE_ACTION).toBeLessThan(STEP_UP_POLICIES.FINANCE_VIEW)
  })

  it('matches the windows the security review asked for', () => {
    expect(STEP_UP_POLICIES.FINANCE_VIEW).toBe(15 * 60 * 1000)
    expect(STEP_UP_POLICIES.FINANCE_ACTION).toBe(5 * 60 * 1000)
    expect(STEP_UP_POLICIES.PAYOUT).toBe(5 * 60 * 1000)
    expect(STEP_UP_POLICIES.CREDENTIAL).toBe(2 * 60 * 1000)
    expect(STEP_UP_POLICIES.SECURITY_ROLE).toBe(2 * 60 * 1000)
    expect(STEP_UP_POLICIES.PRIVACY_ERASURE).toBe(2 * 60 * 1000)
  })

  it('gives an irreversible redaction no wider a window than any reversible action', () => {
    // The scale is the argument: nothing else in this table destroys something
    // that cannot be restored, so nothing else may be gated more tightly.
    for (const name of STEP_UP_POLICY_NAMES) {
      expect(
        STEP_UP_POLICIES.PRIVACY_ERASURE,
        `${name} has a tighter window than PRIVACY_ERASURE`,
      ).toBeLessThanOrEqual(STEP_UP_POLICIES[name])
    }
  })

  it('names a privacy erasure policy rather than reusing a credential one', () => {
    // Reusing CREDENTIAL would put the same name on two different controls, and
    // a control whose name misdescribes what it protects is a control nobody
    // can reason about. The windows are equal; the policies are not.
    expect(STEP_UP_POLICY_NAMES).toContain('PRIVACY_ERASURE')
    expect(stepUpWindowFor('PRIVACY_ERASURE')).toBe(2 * 60 * 1000)
  })

  it('refuses a step-up that was fresh enough for a payout but not for a redaction', () => {
    const now = new Date('2026-03-01T12:00:00Z')
    const session = { mfaSatisfiedAt: new Date(now.getTime() - 3 * 60 * 1000) }

    expect(stepUpSatisfied(session, { now, windowMs: stepUpWindowFor('PAYOUT') })).toBe(true)
    expect(stepUpSatisfied(session, { now, windowMs: stepUpWindowFor('PRIVACY_ERASURE') })).toBe(
      false,
    )
  })

  it('throws on an unknown policy rather than falling back to a default', () => {
    // A typo that silently became fifteen minutes would be a control that
    // stopped working without saying so.
    expect(() => stepUpWindowFor('FINANCE_VEIW')).toThrow(/No step-up policy/)
    expect(() => stepUpWindowFor(undefined)).toThrow(/No step-up policy/)
  })

  it('resolves each named policy to its window', () => {
    for (const name of STEP_UP_POLICY_NAMES) {
      expect(stepUpWindowFor(name)).toBe(STEP_UP_POLICIES[name])
    }
  })

  it('accepts a factor presented inside the window and refuses one outside it', () => {
    const now = new Date('2026-03-01T12:00:00Z')
    const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000)
    const session = { mfaSatisfiedAt: threeMinutesAgo }

    // Three minutes is fine for a refund, and too old for removing a factor.
    expect(stepUpSatisfied(session, { now, windowMs: stepUpWindowFor('FINANCE_ACTION') })).toBe(
      true,
    )
    expect(stepUpSatisfied(session, { now, windowMs: stepUpWindowFor('CREDENTIAL') })).toBe(false)
  })
})

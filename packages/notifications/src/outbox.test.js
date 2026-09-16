/**
 * The outbox state machine, on its own.
 *
 * @module @desi-event/notifications/outbox.test
 */

import { describe, expect, it } from 'vitest'

import {
  BASE_RETRY_DELAY_MS,
  CLAIMABLE_STATES,
  FAILURE_CATEGORIES,
  MAX_RETRY_DELAY_MS,
  OUTBOX_STATES,
  OUTBOX_TRANSITIONS,
  TERMINAL_STATES,
  afterFailure,
  canTransition,
  claimableWhere,
  dedupeKeyFor,
  leaseHasLapsed,
  retryDelayMs,
} from './outbox.js'

const NOW = new Date('2026-09-16T12:00:00.000Z')

describe('the transition table', () => {
  it('names every state it can reach', () => {
    for (const [from, targets] of Object.entries(OUTBOX_TRANSITIONS)) {
      expect(Object.values(OUTBOX_STATES), `${from} is not a state`).toContain(from)

      for (const to of targets) {
        expect(Object.values(OUTBOX_STATES), `${from} → ${to} is not a state`).toContain(to)
      }
    }
  })

  it('covers every state, so none is unreachable by omission', () => {
    for (const state of Object.values(OUTBOX_STATES)) {
      expect(OUTBOX_TRANSITIONS, `${state} has no row`).toHaveProperty(state)
    }
  })

  it('lets a queued message be claimed, cancelled or suppressed and nothing else', () => {
    expect([...OUTBOX_TRANSITIONS.QUEUED].sort()).toEqual(['CANCELLED', 'CLAIMED', 'SUPPRESSED'])
  })

  it('lets a lapsed claim go back to the queue rather than to a failure', () => {
    // A worker that stopped answering has not established that the send did
    // not happen. Calling that a failure is how a message is lost.
    expect(canTransition(OUTBOX_STATES.CLAIMED, OUTBOX_STATES.QUEUED)).toBe(true)
  })

  it('refuses to bring a sent message back to life', () => {
    for (const state of Object.values(OUTBOX_STATES)) {
      expect(canTransition(OUTBOX_STATES.SENT, state), `SENT → ${state}`).toBe(false)
    }
  })

  it('lets an operator requeue a dead letter once the cause is fixed', () => {
    expect(canTransition(OUTBOX_STATES.DEAD_LETTER, OUTBOX_STATES.QUEUED)).toBe(true)
    expect(canTransition(OUTBOX_STATES.DEAD_LETTER, OUTBOX_STATES.SENT)).toBe(false)
  })

  it('refuses an unknown state rather than allowing it', () => {
    expect(canTransition('INVENTED', OUTBOX_STATES.SENT)).toBe(false)
  })

  it('agrees with itself about which states are terminal', () => {
    for (const state of TERMINAL_STATES) {
      expect(OUTBOX_TRANSITIONS[state], `${state} claims to be terminal`).toEqual([])
    }
  })
})

describe('the dedupe key', () => {
  const parts = {
    businessEvent: 'event.cancelled:evt_123',
    recipient: 'Priya@Example.com',
    channel: 'EMAIL',
    templateVersion: 1,
  }

  it('is the same for the same message', () => {
    expect(dedupeKeyFor(parts)).toBe(dedupeKeyFor({ ...parts }))
  })

  it('folds the recipient’s case, because an address is not case-sensitive', () => {
    expect(dedupeKeyFor(parts)).toBe(dedupeKeyFor({ ...parts, recipient: 'priya@example.com' }))
  })

  it('separates two recipients of the same announcement', () => {
    expect(dedupeKeyFor(parts)).not.toBe(dedupeKeyFor({ ...parts, recipient: 'raj@example.com' }))
  })

  it('separates two channels, because an email and an SMS are two deliveries', () => {
    expect(dedupeKeyFor(parts)).not.toBe(dedupeKeyFor({ ...parts, channel: 'SMS' }))
  })

  it('separates two business events', () => {
    expect(dedupeKeyFor(parts)).not.toBe(
      dedupeKeyFor({ ...parts, businessEvent: 'event.postponed:evt_123' }),
    )
  })

  it('separates a template version bump, which is how a rewrite is re-sent', () => {
    expect(dedupeKeyFor(parts)).not.toBe(dedupeKeyFor({ ...parts, templateVersion: 2 }))
  })

  it('stays readable, so a support question can be answered in a database client', () => {
    expect(dedupeKeyFor(parts)).toBe('event.cancelled:evt_123|EMAIL|priya@example.com|v1')
  })

  it('refuses a missing part rather than collapsing two messages into one', () => {
    expect(() => dedupeKeyFor({ ...parts, recipient: '' })).toThrow(/needs a recipient/)
    expect(() => dedupeKeyFor({ ...parts, businessEvent: '   ' })).toThrow(/needs a businessEvent/)
    expect(() => dedupeKeyFor({ ...parts, channel: null })).toThrow(/needs a channel/)
  })

  it('refuses a template version that is not a positive integer', () => {
    expect(() => dedupeKeyFor({ ...parts, templateVersion: 0 })).toThrow(/positive integer/)
  })
})

describe('the retry delay', () => {
  /** No jitter, so the shape is visible. */
  const steady = { jitter: 0, random: () => 0.5 }

  it('doubles with each attempt', () => {
    expect(retryDelayMs(1, steady)).toBe(BASE_RETRY_DELAY_MS)
    expect(retryDelayMs(2, steady)).toBe(BASE_RETRY_DELAY_MS * 2)
    expect(retryDelayMs(3, steady)).toBe(BASE_RETRY_DELAY_MS * 4)
  })

  it('stops doubling at the ceiling', () => {
    expect(retryDelayMs(40, steady)).toBe(MAX_RETRY_DELAY_MS)
  })

  it('caps before the jitter, so the ceiling is a real ceiling', () => {
    // With the cap applied after the jitter, a positive draw at the top of the
    // range would schedule a retry beyond the documented maximum.
    const highest = retryDelayMs(40, { jitter: 0.2, random: () => 1 })

    expect(highest).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS * 1.2)
    expect(retryDelayMs(40, { jitter: 0, random: () => 1 })).toBe(MAX_RETRY_DELAY_MS)
  })

  it('spreads a provider outage rather than scheduling one thundering herd', () => {
    const early = retryDelayMs(1, { random: () => 0 })
    const late = retryDelayMs(1, { random: () => 1 })

    expect(early).toBeLessThan(late)
    expect(late - early).toBeGreaterThan(BASE_RETRY_DELAY_MS * 0.3)
  })

  it('never returns zero, which would be a hot loop', () => {
    expect(retryDelayMs(1, { jitter: 1, random: () => 0 })).toBeGreaterThan(0)
    expect(retryDelayMs(0, steady)).toBeGreaterThan(0)
    expect(retryDelayMs(-5, steady)).toBeGreaterThan(0)
  })
})

describe('what happens after a failed attempt', () => {
  it('dead-letters a permanent failure immediately', () => {
    // A bounced address does not become deliverable by being tried four more
    // times; burning the attempts only delays the moment somebody sees it.
    const result = afterFailure({
      attempts: 1,
      maxAttempts: 5,
      category: FAILURE_CATEGORIES.PERMANENT,
      now: NOW,
    })

    expect(result.status).toBe(OUTBOX_STATES.DEAD_LETTER)
    expect(result.scheduledFor).toBeNull()
    expect(result.failureCategory).toBe(FAILURE_CATEGORIES.PERMANENT)
  })

  it('schedules a retry for a transient failure with attempts left', () => {
    const result = afterFailure({
      attempts: 1,
      maxAttempts: 5,
      category: FAILURE_CATEGORIES.TRANSIENT,
      now: NOW,
      retry: { jitter: 0, random: () => 0.5 },
    })

    expect(result.status).toBe(OUTBOX_STATES.RETRY_SCHEDULED)
    expect(result.scheduledFor.getTime()).toBe(NOW.getTime() + BASE_RETRY_DELAY_MS)
  })

  it('dead-letters a transient failure once the attempts are spent', () => {
    const result = afterFailure({
      attempts: 5,
      maxAttempts: 5,
      category: FAILURE_CATEGORIES.TRANSIENT,
      now: NOW,
    })

    expect(result.status).toBe(OUTBOX_STATES.DEAD_LETTER)
    expect(result.scheduledFor).toBeNull()
  })

  it('treats an unclassified failure as transient rather than giving up', () => {
    // The safer default: a message retried once too often is a nuisance, and a
    // message dropped because nobody classified the error is a lost promise.
    const result = afterFailure({ attempts: 1, maxAttempts: 5, category: undefined, now: NOW })

    expect(result.status).toBe(OUTBOX_STATES.RETRY_SCHEDULED)
    expect(result.failureCategory).toBe(FAILURE_CATEGORIES.TRANSIENT)
  })

  it('only ever writes one of the two categories', () => {
    const result = afterFailure({ attempts: 1, maxAttempts: 5, category: 'MAYBE', now: NOW })

    expect(Object.values(FAILURE_CATEGORIES)).toContain(result.failureCategory)
  })
})

describe('a lease', () => {
  it('has not lapsed while it is still in the future', () => {
    const row = {
      status: OUTBOX_STATES.CLAIMED,
      leaseExpiresAt: new Date(NOW.getTime() + 10_000),
    }

    expect(leaseHasLapsed(row, NOW)).toBe(false)
  })

  it('has lapsed the instant it expires', () => {
    const row = { status: OUTBOX_STATES.CLAIMED, leaseExpiresAt: NOW }

    expect(leaseHasLapsed(row, NOW)).toBe(true)
  })

  it('counts a claim with no lease as lapsed, because nothing is holding it', () => {
    expect(leaseHasLapsed({ status: OUTBOX_STATES.CLAIMED, leaseExpiresAt: null }, NOW)).toBe(true)
  })

  it('says nothing about a row nobody claimed', () => {
    expect(leaseHasLapsed({ status: OUTBOX_STATES.QUEUED }, NOW)).toBe(false)
    expect(leaseHasLapsed(null, NOW)).toBe(false)
  })
})

describe('the claimable condition', () => {
  it('matches due queued and retry-scheduled rows', () => {
    const where = claimableWhere(NOW)

    expect(where.OR[0].status.in).toEqual([...CLAIMABLE_STATES])
    expect(where.OR[0].scheduledFor).toEqual({ lte: NOW })
  })

  it('matches a claim whose lease lapsed', () => {
    const where = claimableWhere(NOW)

    expect(where.OR[1]).toEqual({
      status: OUTBOX_STATES.CLAIMED,
      leaseExpiresAt: { lte: NOW },
    })
  })

  it('does not offer a terminal row to a worker', () => {
    const where = claimableWhere(NOW)
    const offered = new Set([...where.OR[0].status.in, where.OR[1].status])

    for (const terminal of TERMINAL_STATES) {
      expect(offered.has(terminal), `${terminal} is claimable`).toBe(false)
    }
  })
})

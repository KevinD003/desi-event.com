/**
 * The privacy vocabulary has to be total, safe, and honest about refusals.
 *
 * Three properties, each of which would be a real defect if it broke:
 *
 *   - **Total.** The server owns these vocabularies and may extend one before
 *     the browser is redeployed. A lookup that returned `undefined` would render
 *     an empty cell where an operator expects a state; a lookup that threw would
 *     blank the page. Every unknown code must come back as readable text.
 *   - **Safe.** Nothing here may emit a value that was or will be redacted. The
 *     labels describe categories, counts and codes — never contents.
 *   - **Honest.** The refusals a 403 and a 409 collapse together are genuinely
 *     different, and an operator who cannot tell a lapsed step-up from a missing
 *     capability will retry the one that can never succeed.
 *
 * @module lib/privacy-vocabulary.test
 */

import { describe, expect, it } from 'vitest'

import {
  PRIVACY_DATA_CATEGORIES,
  PRIVACY_HOLD_DECISIONS,
  PRIVACY_HOLD_KINDS,
  PRIVACY_HOLD_STATES,
  PRIVACY_REQUEST_REASONS,
  PRIVACY_REQUEST_STATES,
  PRIVACY_AUDIT_RESULTS,
} from '@desi-event/schemas'

import {
  HOLD_KINDS,
  HOLD_RELEASE_REASONS,
  REQUEST_CANCEL_REASONS,
  REQUEST_REASONS,
  auditActionLabel,
  auditResultLabel,
  categoryLabel,
  describeRefusal,
  holdDecisionLabel,
  holdKindLabel,
  holdStateLabel,
  isAwaitingConfirmation,
  isCancellable,
  isTerminalRequestState,
  outcomeLabel,
  requestReasonLabel,
  requestStateDescription,
  requestStateLabel,
  scopeStatusLabel,
} from './privacy-vocabulary.js'

/** The scope statuses the wire schema allows. */
const SCOPE_STATUSES = ['REDACTED', 'NOTHING_TO_DO', 'ALREADY_REDACTED', 'OUT_OF_SCOPE', 'DEFERRED']

describe('every server vocabulary has a label', () => {
  // Driven off the schema exports rather than a copy, so that adding an enum
  // member server-side fails here rather than rendering a blank cell in
  // production. A hand-maintained list would agree with itself forever.
  it.each([
    ['request state', PRIVACY_REQUEST_STATES, requestStateLabel],
    ['request reason', PRIVACY_REQUEST_REASONS, requestReasonLabel],
    ['hold decision', PRIVACY_HOLD_DECISIONS, holdDecisionLabel],
    ['hold kind', PRIVACY_HOLD_KINDS, holdKindLabel],
    ['hold state', PRIVACY_HOLD_STATES, holdStateLabel],
    ['data category', PRIVACY_DATA_CATEGORIES, categoryLabel],
    ['audit result', PRIVACY_AUDIT_RESULTS, auditResultLabel],
    ['scope status', SCOPE_STATUSES, scopeStatusLabel],
  ])('covers every %s', (_name, members, lookup) => {
    for (const member of members) {
      const text = lookup(member)

      expect(text).toBeTypeOf('string')
      expect(text.length).toBeGreaterThan(0)
      // A label that is just the raw code back means the curated table missed it.
      expect(text).not.toBe(member)
    }
  })

  it('describes every request state', () => {
    for (const state of PRIVACY_REQUEST_STATES) {
      expect(requestStateDescription(state)).not.toBe('This state has no description yet.')
    }
  })
})

describe('an unknown code degrades rather than breaking', () => {
  it.each([
    requestStateLabel,
    requestReasonLabel,
    holdDecisionLabel,
    holdKindLabel,
    holdStateLabel,
    categoryLabel,
    auditResultLabel,
    scopeStatusLabel,
  ])('renders a code the browser has never seen', (lookup) => {
    expect(lookup('SOME_FUTURE_MEMBER')).toBe('Some future member')
  })

  it.each([null, undefined, '', 42, {}])('survives %s', (value) => {
    expect(() => requestStateLabel(value)).not.toThrow()
    expect(requestStateLabel(value)).toBeTypeOf('string')
  })

  it('returns null for an absent outcome rather than inventing one', () => {
    // A request that has not finished has no outcome, and "Unknown" would read
    // as though something had gone wrong.
    expect(outcomeLabel(null)).toBeNull()
    expect(outcomeLabel(undefined)).toBeNull()
    expect(outcomeLabel('REDACTED')).toBe('Redacted')
  })

  it('strips the privacy prefix from an audit action', () => {
    expect(auditActionLabel('privacy.redaction_completed')).toBe('Redaction completed')
    expect(auditActionLabel('privacy.hold_placed')).toBe('Hold placed')
  })
})

describe('refusals are distinguished, not collapsed', () => {
  it('separates a lapsed step-up from a missing capability, though both are 403', () => {
    const stepUp = describeRefusal({ status: 403, code: 'STEP_UP_REQUIRED' })
    const forbidden = describeRefusal({ status: 403, code: 'FORBIDDEN' })

    expect(stepUp.title).not.toBe(forbidden.title)
    // The difference that matters operationally: one is worth retrying.
    expect(stepUp.recoverable).toBe(true)
    expect(forbidden.recoverable).toBe(false)
  })

  it.each([
    ['REFUSED_LEGAL_HOLD', false],
    ['REFUSED_FRAUD_HOLD', false],
    ['REFUSED_OPEN_PROCESS', false],
    ['ALREADY_IN_FLIGHT', false],
    ['CONFIRMATION_LAPSED', true],
  ])('separates 409 code %s', (code, recoverable) => {
    const refusal = describeRefusal({ status: 409, code })

    expect(refusal.recoverable).toBe(recoverable)
    expect(refusal.title).not.toBe('The state moved')
  })

  it('says a hold refusal changed nothing, because that is the question an operator has', () => {
    const refusal = describeRefusal({ status: 409, code: 'REFUSED_LEGAL_HOLD' })

    expect(refusal.detail).toMatch(/nothing was changed/iu)
  })

  it('gives a 404 the same words whether or not the thing exists', () => {
    // The API deliberately does not distinguish absent from not-yours; a UI that
    // did would rebuild the enumeration oracle the API refuses to be.
    const refusal = describeRefusal({ status: 404, code: 'NOT_FOUND' })

    expect(refusal.detail).toMatch(/deliberately the same/iu)
  })

  it('falls back without throwing on an error carrying nothing', () => {
    for (const value of [null, undefined, {}, new Error('boom')]) {
      expect(() => describeRefusal(value)).not.toThrow()
      expect(describeRefusal(value).title).toBeTypeOf('string')
    }
  })

  it('never leaks a server message into the refusal text', () => {
    // `callApi` puts the server's message on `error.message`. If that ever
    // reached the screen it could carry whatever the server chose to say, which
    // on this surface is exactly the wrong thing to render verbatim.
    const refusal = describeRefusal({
      status: 500,
      code: null,
      message: 'subject buyer@example.test could not be redacted',
    })

    expect(JSON.stringify(refusal)).not.toMatch(/buyer@example\.test/u)
  })
})

describe('what a screen is allowed to offer', () => {
  it.each([
    ['REQUESTED', false],
    ['QUEUED', false],
    ['PROCESSING', false],
    ['COMPLETED', true],
    ['HELD', true],
    ['FAILED_SAFE', true],
    ['CANCELLED', true],
  ])('knows %s is terminal: %s', (state, terminal) => {
    expect(isTerminalRequestState(state)).toBe(terminal)
  })

  it('offers cancellation only before execution begins', () => {
    expect(isCancellable('REQUESTED')).toBe(true)
    expect(isCancellable('QUEUED')).toBe(true)
    // Once it is running or finished, withdrawing is not a thing that exists.
    for (const state of ['PROCESSING', 'COMPLETED', 'HELD', 'FAILED_SAFE', 'CANCELLED']) {
      expect(isCancellable(state)).toBe(false)
    }
  })

  it('asks for confirmation only in REQUESTED', () => {
    expect(isAwaitingConfirmation('REQUESTED')).toBe(true)
    for (const state of PRIVACY_REQUEST_STATES.filter((s) => s !== 'REQUESTED')) {
      expect(isAwaitingConfirmation(state)).toBe(false)
    }
  })
})

describe('the select vocabularies match what the API accepts', () => {
  // These drive <select> options. An option the API rejects is a form that can
  // only fail, and the failure would arrive as a 400 the operator cannot act on.
  it('offers exactly the four release reasons', () => {
    expect(HOLD_RELEASE_REASONS.map((option) => option.value)).toEqual([
      'MATTER_CLOSED',
      'COUNSEL_INSTRUCTION',
      'INVESTIGATION_CLOSED',
      'PLACED_IN_ERROR',
    ])
  })

  it('offers exactly the three cancellation reasons', () => {
    expect(REQUEST_CANCEL_REASONS.map((option) => option.value)).toEqual([
      'NO_LONGER_REQUIRED',
      'RAISED_IN_ERROR',
      'SUPERSEDED',
    ])
  })

  it('offers every hold kind the schema allows', () => {
    expect(HOLD_KINDS.map((option) => option.value)).toEqual([...PRIVACY_HOLD_KINDS])
  })

  it('offers every request reason the schema allows', () => {
    expect(REQUEST_REASONS.map((option) => option.value)).toEqual([...PRIVACY_REQUEST_REASONS])
  })

  it('gives every option a label that is not its own code', () => {
    for (const option of [
      ...HOLD_RELEASE_REASONS,
      ...REQUEST_CANCEL_REASONS,
      ...HOLD_KINDS,
      ...REQUEST_REASONS,
    ]) {
      expect(option.label).toBeTypeOf('string')
      expect(option.label).not.toBe(option.value)
    }
  })
})

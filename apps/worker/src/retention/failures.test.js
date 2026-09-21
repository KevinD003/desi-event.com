/**
 * The failure path must not destroy its own diagnosis.
 *
 * Every test here is about the same class of bug: code that runs only when
 * something has already gone wrong, and which therefore gets exercised for the
 * first time during an incident. The specific hazard this module exists for is
 * the tempting one-liner
 *
 * ```js
 * catch (error) { error.retentionFailureCode = '…'; throw error }
 * ```
 *
 * which raises a `TypeError` in strict mode against a frozen object, a string
 * or `null` — and the `TypeError` then replaces the real failure, so the row an
 * operator reads says `UNEXPECTED` for a cause the code had already worked out.
 *
 * @module worker/retention/failures.test
 */

import { describe, expect, it } from 'vitest'

import { RETENTION_FAILURE_CODES } from '@desi-event/schemas'

import { RetentionStepError, failureCodeFor, inStep } from './failures.js'

describe('inStep', () => {
  it('returns what the step returned when nothing goes wrong', async () => {
    const answer = await inStep(RETENTION_FAILURE_CODES.CANDIDATE_COUNT_FAILED, 'counting', () =>
      Promise.resolve(7),
    )

    expect(answer).toBe(7)
  })

  it('wraps a failure with the code for that step, and keeps the cause', async () => {
    const underneath = new Error('connection terminated')

    await expect(
      inStep(RETENTION_FAILURE_CODES.CANDIDATE_COUNT_FAILED, 'counting candidates', () => {
        throw underneath
      }),
    ).rejects.toMatchObject({
      failureCode: 'CANDIDATE_COUNT_FAILED',
      cause: underneath,
    })
  })

  it('never writes to the thing it caught', async () => {
    // The whole reason this module exists. A frozen error is not exotic — it is
    // what a driver that reuses a singleton error would hand you.
    const frozen = Object.freeze(new Error('frozen'))

    await expect(
      inStep(RETENTION_FAILURE_CODES.HOLD_COUNT_FAILED, 'counting holds', () => {
        throw frozen
      }),
    ).rejects.toBeInstanceOf(RetentionStepError)

    expect(Object.hasOwn(frozen, 'failureCode')).toBe(false)
    expect(Object.hasOwn(frozen, 'retentionFailureCode')).toBe(false)
  })

  it('survives a thrown value that is not an object at all', async () => {
    for (const thrown of ['a string', null, undefined, 42]) {
      await expect(
        inStep(RETENTION_FAILURE_CODES.UNEXPECTED, 'something', () => {
          throw thrown
        }),
      ).rejects.toBeInstanceOf(RetentionStepError)
    }
  })

  it('leaves an inner step to speak for itself', async () => {
    // The inner step knows what it was doing better than its caller does, so a
    // step error passes through rather than being relabelled by whatever
    // happens to wrap it.
    const inner = new RetentionStepError('counting candidates', {
      failureCode: RETENTION_FAILURE_CODES.CANDIDATE_COUNT_FAILED,
    })

    await expect(
      inStep(RETENTION_FAILURE_CODES.HOLD_COUNT_FAILED, 'the outer step', () => {
        throw inner
      }),
    ).rejects.toBe(inner)
  })
})

describe('failureCodeFor', () => {
  it('reads the code off one of ours', () => {
    const error = new RetentionStepError('counting', {
      failureCode: RETENTION_FAILURE_CODES.EVIDENCE_WRITE_FAILED,
    })

    expect(failureCodeFor(error)).toBe('EVIDENCE_WRITE_FAILED')
  })

  it('answers UNEXPECTED for anything else, rather than nothing', () => {
    // Total by construction. A failure with no code would be a failure with no
    // row, and an empty table is the answer this surface cannot afford.
    for (const value of [new Error('plain'), 'a string', null, undefined, {}, 0]) {
      expect(failureCodeFor(value)).toBe('UNEXPECTED')
    }
  })

  it('answers UNEXPECTED for a code that is not in the vocabulary', () => {
    // A closed vocabulary that accepted anything set on a field would not be
    // closed. `failureCode` reaches a screen.
    const error = new RetentionStepError('counting', { failureCode: 'MADE_UP' })

    expect(failureCodeFor(error)).toBe('UNEXPECTED')
  })
})

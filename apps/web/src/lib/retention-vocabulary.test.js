/**
 * The retention vocabulary has to keep three readings apart and label every
 * number.
 *
 * The failure this suite is written against is a specific one: an operator
 * looking at an empty table and concluding the worker is broken, when in fact
 * the system declined to run exactly as configured. "Nothing has ever run",
 * "it ran and declined" and "it ran and counted" have to be three different
 * sentences, and the module must cover every state the schema can produce —
 * a state added server-side and missing here would render as a blank cell where
 * an operator expects an outcome.
 *
 * @module lib/retention-vocabulary.test
 */

import { describe, expect, it } from 'vitest'

import { RETENTION_CLASS_PROPOSALS, RETENTION_SWEEP_STATES } from '@desi-event/schemas'

import {
  CLASS_DESCRIPTIONS,
  RETENTION_APPROVAL,
  SWEEP_STATES,
  isDeclined,
  retentionClassDescription,
  retentionClassLabel,
  summariseSweeps,
  sweepStateDescription,
  sweepStateLabel,
} from './retention-vocabulary.js'

/**
 * A sweep row.
 *
 * @param {object} [overrides] Fields to override.
 * @returns {object} The row.
 */
function sweep(overrides = {}) {
  return {
    id: 'sweep-1',
    retentionClass: 'login_attempt',
    mode: 'DRY_RUN',
    state: 'COMPLETED',
    examinedCount: 4,
    heldCount: 0,
    affectedCount: 0,
    approval: RETENTION_APPROVAL,
    ...overrides,
  }
}

describe('the state vocabulary is total', () => {
  it.each([...RETENTION_SWEEP_STATES])('covers %s, which the schema can produce', (state) => {
    // Driven off the schema's own enum rather than a list copied here, so a
    // state added server-side fails this test rather than rendering as a blank
    // cell in front of an operator.
    expect(SWEEP_STATES[state]).toBeDefined()
    expect(SWEEP_STATES[state].label).toBeTruthy()
    expect(SWEEP_STATES[state].description).toBeTruthy()
  })

  it('renders an unknown state readably rather than throwing or blanking', () => {
    expect(sweepStateLabel('INVENTED_LATER')).toBe('Invented later')
    // A blank rather than a guess: pretending to know what an unrecognised
    // state meant is worse than saying nothing about it.
    expect(sweepStateDescription('INVENTED_LATER')).toBe('')
  })

  it('handles a missing state without crashing the row', () => {
    expect(sweepStateLabel(undefined)).toBe('Unknown')
    expect(sweepStateLabel('')).toBe('Unknown')
  })
})

describe('every evaluated class can be explained', () => {
  it.each(RETENTION_CLASS_PROPOSALS.map((entry) => entry.retentionClass))(
    '%s has a description',
    (retentionClass) => {
      expect(CLASS_DESCRIPTIONS[retentionClass]).toBeTruthy()
      expect(retentionClassDescription(retentionClass)).toBeTruthy()
    },
  )

  it('names an unknown class rather than dropping the row', () => {
    expect(retentionClassLabel('some_new_class')).toBe('Some new class')
    expect(retentionClassDescription('some_new_class')).toBe('')
  })
})

describe('no wording describes a deletion, because none happens', () => {
  it('never says deleted, removed, purged or erased', () => {
    const text = JSON.stringify([SWEEP_STATES, CLASS_DESCRIPTIONS])

    expect(text).not.toMatch(/\bdeleted\b/iu)
    expect(text).not.toMatch(/\bpurged\b/iu)
    expect(text).not.toMatch(/\berased\b/iu)
  })

  it('never claims a duration is approved or enforced', () => {
    const text = JSON.stringify([SWEEP_STATES, CLASS_DESCRIPTIONS])

    expect(text).not.toMatch(/\bapproved\b/iu)
    expect(text).not.toMatch(/\benforced\b/iu)
  })

  it('carries the approval status the schema defines, not a copy of it', () => {
    expect(RETENTION_APPROVAL).toMatch(/PROPOSED/u)
    expect(RETENTION_APPROVAL).toMatch(/REQUIRES LEGAL\/PRIVACY REVIEW/u)
  })
})

describe('the three readings of an empty-looking table', () => {
  it('says nothing has run when there are no rows', () => {
    const reading = summariseSweeps([])

    expect(reading.kind).toBe('NONE_RECORDED')
    expect(reading.sentence).toMatch(/nothing has run here/iu)
    // The distinction that matters: this is not "ran and found nothing".
    expect(reading.sentence).toMatch(/not the same as/iu)
  })

  it('says it declined when every row declined', () => {
    const reading = summariseSweeps([
      sweep({ state: 'SKIPPED_DISABLED', examinedCount: 0 }),
      sweep({ state: 'SKIPPED_DISABLED', examinedCount: 0, retentionClass: 'session' }),
    ])

    expect(reading.kind).toBe('ALL_DECLINED')
    expect(reading.sentence).toMatch(/not activated/iu)
  })

  it('does not call it declined when one row actually counted', () => {
    // A mixed page is a counted page. Reporting "everything declined" because
    // most rows did would understate what was examined.
    const reading = summariseSweeps([sweep({ state: 'SKIPPED_DISABLED' }), sweep()])

    expect(reading.kind).toBe('COUNTED')
    expect(reading.sentence).toMatch(/nothing was deleted/iu)
  })

  it('survives a non-array, which a failed fetch produces', () => {
    for (const value of [null, undefined, 'nope', {}]) {
      expect(summariseSweeps(value).kind).toBe('NONE_RECORDED')
    }
  })
})

describe('isDeclined', () => {
  it('is true only for SKIPPED_DISABLED', () => {
    expect(isDeclined(sweep({ state: 'SKIPPED_DISABLED' }))).toBe(true)
    for (const state of RETENTION_SWEEP_STATES.filter((entry) => entry !== 'SKIPPED_DISABLED')) {
      expect(isDeclined(sweep({ state }))).toBe(false)
    }
  })

  it('is false for nothing at all', () => {
    expect(isDeclined(null)).toBe(false)
    expect(isDeclined(undefined)).toBe(false)
  })
})

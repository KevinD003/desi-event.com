/**
 * The id has one job and one trap.
 *
 * The job: the same rehearsal, delivered twice, writes one row. The trap: two
 * *different* facts about the same instant must not collapse into one row, and
 * the obvious implementation collapses them.
 *
 * @module worker/retention/run-key.test
 */

import { describe, expect, it } from 'vitest'

import { cuidSchema } from '@desi-event/schemas'

import { SWEEP_ROW_KINDS, sweepRowId } from './run-key.js'

/** The instant these tests count back from. */
const NOW = new Date('2026-09-18T00:00:00.000Z')

describe('what makes a redelivery write nothing new', () => {
  it('is the same id for the same instant, class and kind', () => {
    const once = sweepRowId({
      runInstant: NOW,
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.RESULT,
    })
    const again = sweepRowId({
      runInstant: new Date(NOW.getTime()),
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.RESULT,
    })

    expect(again).toBe(once)
  })

  it('changes with the instant, so yesterday is not today', () => {
    const today = sweepRowId({
      runInstant: NOW,
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.RESULT,
    })
    const yesterday = sweepRowId({
      runInstant: new Date('2026-09-17T00:00:00.000Z'),
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.RESULT,
    })

    expect(yesterday).not.toBe(today)
  })

  it('changes with the class, so four classes are four rows', () => {
    const ids = ['login_attempt', 'session', 'session_metadata', 'notification_recipient'].map(
      (retentionClass) =>
        sweepRowId({ runInstant: NOW, retentionClass, kind: SWEEP_ROW_KINDS.RESULT }),
    )

    expect(new Set(ids).size).toBe(4)
  })
})

describe('the trap: what must not collide', () => {
  it('gives a refusal and a count different ids at the same instant', () => {
    // The failure this prevents, in full. An operator rehearses against an
    // environment where enforcement is off and gets four SKIPPED_DISABLED
    // rows. The environment is activated and the same rehearsal re-enqueued
    // with the same `now`, deliberately, so the two can be compared at one
    // cut-off.
    //
    // Share the namespace and every insert conflicts, the run that actually
    // counted records nothing, and the table reports "we were told not to"
    // about a run that examined rows. `/retention` then reads ALL_DECLINED —
    // one of the three answers the whole surface exists to keep apart.
    const declined = sweepRowId({
      runInstant: NOW,
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.DECLINED,
    })
    const counted = sweepRowId({
      runInstant: NOW,
      retentionClass: 'session',
      kind: SWEEP_ROW_KINDS.RESULT,
    })

    expect(declined).not.toBe(counted)
  })

  it('gives a failure its own id too', () => {
    const ids = Object.values(SWEEP_ROW_KINDS).map((kind) =>
      sweepRowId({ runInstant: NOW, retentionClass: 'session', kind }),
    )

    expect(new Set(ids).size).toBe(Object.values(SWEEP_ROW_KINDS).length)
  })

  it('refuses a kind it does not know rather than hashing it anyway', () => {
    // A typo'd kind that hashed cleanly would share a namespace with nothing
    // and silently stop deduplicating, which is the quiet version of the bug
    // above.
    expect(() =>
      sweepRowId({ runInstant: NOW, retentionClass: 'session', kind: 'RESULTS' }),
    ).toThrow(/unknown sweep row kind/u)
  })
})

describe('the shape the API will validate', () => {
  it('is a cuid, for every class and kind', () => {
    // The API validates what it serves, and `cuidSchema` is `^[a-z][a-z0-9]{7,31}$`.
    // The leading `r` is what guarantees a letter first for every digest.
    for (const retentionClass of ['login_attempt', 'session', 'notification_recipient']) {
      for (const kind of Object.values(SWEEP_ROW_KINDS)) {
        const id = sweepRowId({ runInstant: NOW, retentionClass, kind })

        expect(cuidSchema.safeParse(id).success, `${retentionClass}/${kind} gave ${id}`).toBe(true)
      }
    }
  })

  it('is 32 characters, which is inside the 8-to-32 the schema allows', () => {
    const id = sweepRowId({ runInstant: NOW, retentionClass: 'session', kind: 'RESULT' })

    expect(id).toHaveLength(32)
    expect(id).toMatch(/^r[0-9a-f]{31}$/u)
  })
})

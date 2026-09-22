import { ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  LOOK_AGAIN,
  REFUSAL_SENTENCES,
  authorityLabel,
  confirmFailure,
  lookupFailure,
  refusalSentence,
  seatWords,
} from './door.js'

describe('the refusal vocabulary', () => {
  it('has a sentence for every code the API can send, and no others', () => {
    // The mirror of a closed list is only as good as this assertion.
    expect(Object.keys(REFUSAL_SENTENCES).sort()).toEqual([...ADMISSION_REFUSAL_REASONS].sort())
  })

  it('falls back to a refusal, never to admission, for a code it does not know', () => {
    expect(refusalSentence('SOMETHING_NEW')).toMatch(/cannot be admitted/iu)
  })

  it('offers a fresh lookup only where one fixes it', () => {
    expect(confirmFailure(409, 'PREVIEW_EXPIRED').lookAgain).toBe(true)
    expect(confirmFailure(409, 'REFUNDED').lookAgain).toBe(false)
    expect(LOOK_AGAIN.every((code) => code in REFUSAL_SENTENCES)).toBe(true)
  })
})

describe('what a steward is told', () => {
  it('says an unanswered confirmation may or may not have admitted, and that retrying is safe', () => {
    const told = confirmFailure(0)

    expect(told.uncertain).toBe(true)
    expect(told.sentence).toMatch(/may or may not/iu)
    expect(told.sentence).toMatch(/cannot be admitted twice/iu)
  })

  it('tells a 404 apart from nothing: it does not say which of the two it was', () => {
    expect(lookupFailure(404)).toMatch(/no ticket matches/iu)
    expect(lookupFailure(404)).not.toMatch(/another organi[sz]ation|not assigned to this/iu)
  })

  it('names the authority a door rests on', () => {
    expect(
      authorityLabel({
        authority: 'ORGANIZATION_ROLE',
        role: 'OWNER',
        organization: { name: 'Rangoli' },
      }),
    ).toBe('Every event of Rangoli (owner)')
    expect(authorityLabel({ authority: 'EVENT_SCOPE', role: 'SCANNER' })).toBe(
      'Assigned to this event (scanner)',
    )
  })

  it('puts a seat into words, and says nothing for general admission', () => {
    expect(seatWords({ section: 'Stalls', row: 'C', label: 'C12' })).toBe('Stalls, row C, seat C12')
    expect(seatWords(null)).toBeNull()
  })
})

import { ADMISSION_REFUSAL_REASONS } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  LOOK_AGAIN,
  REFUSAL_SENTENCES,
  authorityLabel,
  confirmFailure,
  doorEventLabel,
  groupLookupSentence,
  groupResultSentence,
  groupSessionName,
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

describe('the group door', () => {
  it('offers a fresh lookup when a group changed under the confirmation', () => {
    expect(LOOK_AGAIN).toContain('GROUP_CHANGED')
    expect(confirmFailure(409, 'GROUP_CHANGED')).toMatchObject({ lookAgain: true })
    expect(refusalSentence('GROUP_CHANGED')).toMatch(/look it up again before admitting anyone/iu)
  })

  it('names platform authority plainly', () => {
    expect(authorityLabel({ authority: 'PLATFORM_ROLE', role: 'SUPER_ADMIN' })).toBe(
      'Any event on the platform (platform administrator)',
    )
  })

  it('says what a group lookup found, in the singular and the plural', () => {
    expect(
      groupLookupSentence({ counts: { admissible: 3, alreadyIn: 0, refused: 0 }, handedOn: 0 }),
    ).toBe('3 tickets can be admitted.')
    expect(
      groupLookupSentence({ counts: { admissible: 1, alreadyIn: 2, refused: 1 }, handedOn: 1 }),
    ).toBe(
      '1 ticket can be admitted, 2 already in, 1 refused. 1 ticket from this order was handed to somebody else; they have their own pass.',
    )
    expect(
      groupLookupSentence({ counts: { admissible: 0, alreadyIn: 0, refused: 0 }, handedOn: 2 }),
    ).toBe(
      '0 tickets can be admitted. 2 tickets from this order were handed to other people; they have their own passes.',
    )
  })

  it('says what a group admission did', () => {
    expect(groupResultSentence({ admitted: 2, alreadyIn: 0 })).toBe('Admitted 2.')
    expect(groupResultSentence({ admitted: 1, alreadyIn: 1 })).toBe('Admitted 1. 1 was already in.')
    expect(groupResultSentence({ admitted: 0, alreadyIn: 3 })).toBe(
      'Admitted 0. 3 were already in.',
    )
  })

  it('names a group in the session list by the people on it, never as a ticket with no name', () => {
    expect(groupSessionName([{ attendeeName: 'Asha' }])).toBe('Asha')
    expect(
      groupSessionName([
        { attendeeName: 'Asha' },
        { attendeeName: 'Ravi' },
        { attendeeName: null },
      ]),
    ).toBe('Asha and 2 more')
    expect(groupSessionName([{ attendeeName: null }, { attendeeName: 'Ravi' }])).toBe(
      'Ravi and 1 more',
    )
    expect(groupSessionName([{ attendeeName: null }, { attendeeName: null }])).toBe('Group pass')
    expect(groupSessionName([])).toBe('Group pass')
  })

  it('names the organisation beside an event only when asked to', () => {
    const entry = {
      event: {
        title: 'Garba Night',
        startsAt: '2026-10-01T13:30:00.000Z',
        timezone: 'America/New_York',
      },
      organization: { name: 'Rangoli' },
    }

    expect(doorEventLabel(entry)).toMatch(/^Garba Night — Oct 1, 2026/u)
    expect(doorEventLabel(entry, { withOrganization: true })).toMatch(
      /^Garba Night — Rangoli — Oct 1, 2026/u,
    )
  })
})

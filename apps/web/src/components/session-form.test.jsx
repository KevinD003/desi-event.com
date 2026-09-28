import { describe, expect, it } from 'vitest'

import {
  diffSessionBody,
  materialSessionFields,
  sessionFormProblems,
  toSessionBody,
  toSessionForm,
} from './session-form.jsx'

/** A general-admission night as form values. */
const night = toSessionForm({
  timezone: 'America/New_York',
  startsAt: '2027-10-04T23:00:00.000Z',
  endsAt: '2027-10-05T03:00:00.000Z',
  doorsOpenAt: '2027-10-04T22:00:00.000Z',
  capacity: 200,
})

const now = new Date('2027-09-01T00:00:00.000Z')

describe('what the session form refuses before sending', () => {
  it('finds nothing wrong with a coherent night', () => {
    expect(sessionFormProblems(night, { now })).toEqual([])
  })

  it('mirrors the server: order of times, doors, sales window and a capacity', () => {
    const problems = sessionFormProblems(
      {
        ...night,
        doorsOpenAt: '2027-10-05T00:00:00.000Z',
        salesStartAt: '2027-10-02T00:00:00.000Z',
        salesEndAt: '2027-10-06T00:00:00.000Z',
        capacity: '0',
      },
      { now },
    )

    expect(problems.map((problem) => problem.field)).toEqual([
      'doorsOpenAt',
      'salesEndAt',
      'capacity',
    ])
  })

  it('wants a new night on a public event to be in the future', () => {
    expect(
      sessionFormProblems(night, { mode: 'live', isNew: true, now: new Date('2027-11-01') }),
    ).toEqual([
      {
        field: 'startsAt',
        message: 'A night added to a published event has to start in the future.',
      },
    ])
  })

  it('will not lower a capacity below what is sold and held', () => {
    expect(
      sessionFormProblems(
        { ...night, capacity: '100' },
        { mode: 'live', isNew: false, usage: { sold: 90, held: 20 }, now },
      ),
    ).toEqual([{ field: 'capacity', message: 'At least 110: 90 sold and 20 held.' }])
  })

  it('does not ask a seated night for a capacity: its map is its capacity', () => {
    expect(
      sessionFormProblems({ ...night, venueMapVersionId: 'v1', capacity: '' }, { now }),
    ).toEqual([])
    expect(toSessionBody({ ...night, venueMapVersionId: 'v1' }).capacity).toBeNull()
  })
})

describe('what an edit sends', () => {
  it('sends only the changed fields, and knows which of them move the night', () => {
    const patch = diffSessionBody(night, {
      ...night,
      startsAt: '2027-10-05T00:00:00.000Z',
      capacity: '250',
    })

    expect(patch).toEqual({ startsAt: '2027-10-05T00:00:00.000Z', capacity: 250 })
    expect(materialSessionFields(patch)).toEqual(['startsAt'])
    expect(diffSessionBody(night, { ...night })).toEqual({})
  })
})

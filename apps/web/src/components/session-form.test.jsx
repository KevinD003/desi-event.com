import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import {
  SessionForm,
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

describe('a night’s label', () => {
  it('starts blank for a new night and keeps a saved one', () => {
    expect(night.label).toBe('')
    expect(toSessionForm({ ...night, label: 'Night 2' }).label).toBe('Night 2')
  })

  it('is sent trimmed, and blank is sent as none so the date labels the night', () => {
    expect(toSessionBody({ ...night, label: '  Night 2 ' }).label).toBe('Night 2')
    expect(toSessionBody({ ...night, label: '   ' }).label).toBeNull()
  })

  it('is a change an edit sends, and does not move the night', () => {
    const patch = diffSessionBody(night, { ...night, label: 'Opening night' })

    expect(patch).toEqual({ label: 'Opening night' })
    expect(materialSessionFields(patch)).toEqual([])
    expect(diffSessionBody({ ...night, label: 'Night 1' }, { ...night, label: '' })).toEqual({
      label: null,
    })
  })
})

describe('an end time the listing did not give', () => {
  const ESTIMATE =
    "Not given by the listing (estimate for scheduling). The event page shows only the start until the night's real end time is set here."

  /**
   * The edit form for the night.
   *
   * @param {boolean} endEstimated Whether the end is the import's estimate.
   * @returns {void}
   */
  const editForm = (endEstimated) =>
    render(
      <SessionForm
        kind="edit"
        idPrefix="night"
        initial={night}
        mode="live"
        endEstimated={endEstimated}
        onSubmit={() => {}}
      />,
    )

  it('labels the end field as an estimate until the end is changed', () => {
    editForm(true)

    expect(screen.getByText(ESTIMATE)).toBeInTheDocument()

    const ends = document.getElementById('night-endsAt')

    fireEvent.change(ends, { target: { value: '2027-10-05T01:30' } })

    expect(screen.queryByText(ESTIMATE)).toBeNull()
  })

  it('does not label an end that was listed or set', () => {
    editForm(false)

    expect(screen.queryByText(ESTIMATE)).toBeNull()
  })
})

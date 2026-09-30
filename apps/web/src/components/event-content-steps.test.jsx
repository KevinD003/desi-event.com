import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ProgrammeStep } from './event-content-steps.jsx'

/** The editor's values for an event with one slot in its running order. */
const values = {
  timezone: 'America/Chicago',
  performers: [],
  runningOrder: [{ time: '19:30', title: 'Doors', note: '' }],
}

describe('the running order step', () => {
  it('says whose clock the times are on, and nothing about a format the box may not show', () => {
    render(<ProgrammeStep values={values} setField={vi.fn()} editable />)

    // The box is the browser's own time control, which shows 12- or 24-hour
    // as the reader's locale has it; the zone is what the organiser needs.
    expect(
      screen.getByText(
        'Local time at the event (America/Chicago). A run of several nights shows the same order each night.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/24-hour/u)).toBeNull()
  })
})

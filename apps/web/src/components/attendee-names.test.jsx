import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  ADDRESS_AS_NAME,
  ATTENDEE_NAME_MAX,
  AttendeeNames,
  attendeeNameProblem,
  attendeesFrom,
  hasNameProblems,
} from './attendee-names.jsx'

const SLOTS = [
  { key: 'a', label: 'Ticket 1 of 2 — General admission', ticketTypeId: 'ttgeneralxxxx' },
  { key: 'b', label: 'Ticket 2 of 2 — General admission', ticketTypeId: 'ttgeneralxxxx' },
  {
    key: 'c',
    label: 'Seat A1, row A, Stalls — Front stalls',
    ticketTypeId: 'ttfrontxxxxxx',
    eventSeatId: 'esa1xxxxxxxxx',
  },
]

/**
 * The boxes with their values held the way a checkout holds them.
 *
 * @param {object} props Component props.
 * @param {object} [props.rest] Props passed through.
 * @returns {JSX.Element} The boxes.
 */
function Harness(props) {
  const [values, setValues] = useState({})

  return (
    <AttendeeNames
      slots={SLOTS}
      values={values}
      onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
      {...props}
    />
  )
}

describe('a guest’s name', () => {
  it('is optional, and refused when it is an address, a line break or too long', () => {
    expect(attendeeNameProblem('')).toBeNull()
    expect(attendeeNameProblem('  Ravi Shah ')).toBeNull()
    expect(attendeeNameProblem('ravi@example.test')).toBe(ADDRESS_AS_NAME)
    expect(ADDRESS_AS_NAME).toBe('Type the guest’s name, not an email address.')
    expect(attendeeNameProblem('Ravi\nShah')).toBe('A name cannot contain line breaks or tabs.')
    expect(ATTENDEE_NAME_MAX).toBe(100)
    expect(attendeeNameProblem('x'.repeat(101))).toBe('Keep a name to 100 characters.')
    expect(hasNameProblems({ a: 'Ravi', b: 'ravi@example.test' })).toBe(true)
    expect(hasNameProblems({ a: 'Ravi', b: '' })).toBe(false)
  })

  it('counts only the boxes on screen when it is told which they are', () => {
    // A name typed for a ticket that is no longer in the order is not shown
    // and not sent, so it cannot be what stops the buyer paying.
    const typed = { a: 'Ravi', gone: 'ravi@example.test' }

    expect(hasNameProblems(typed)).toBe(true)
    expect(hasNameProblems(typed, SLOTS)).toBe(false)
    expect(hasNameProblems({ ...typed, b: 'meera@example.test' }, SLOTS)).toBe(true)
  })

  it('is sent trimmed, per ticket type and per seat, and blank boxes are left out', () => {
    expect(attendeesFrom(SLOTS, { a: '  Ravi Shah ', b: '   ', c: 'Meera Rao' })).toEqual([
      { ticketTypeId: 'ttgeneralxxxx', name: 'Ravi Shah' },
      { ticketTypeId: 'ttfrontxxxxxx', eventSeatId: 'esa1xxxxxxxxx', name: 'Meera Rao' },
    ])
    expect(attendeesFrom(SLOTS, {})).toEqual([])
  })
})

describe('the name boxes', () => {
  it('ask who is going, one labelled box per ticket, saying what a blank box means', () => {
    render(<Harness buyerName="Asha Patel" />)

    expect(screen.getByRole('group', { name: 'Who is going?' })).toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(3)
    expect(screen.getByLabelText('Seat A1, row A, Stalls — Front stalls')).toHaveAttribute(
      'maxLength',
      '100',
    )
    expect(
      screen.getByText(/Leave a box blank to put your own name, Asha Patel, on that ticket\./u),
    ).toBeInTheDocument()
  })

  it('say beside the box what is wrong, and tie the message to it', async () => {
    const user = userEvent.setup()

    render(<Harness />)

    const box = screen.getByLabelText('Ticket 1 of 2 — General admission')

    await user.type(box, 'ravi@example.test')

    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription(/Type the guest’s name, not an email address\./u)
  })

  it('render nothing when there is nothing to name', () => {
    const { container } = render(<AttendeeNames slots={[]} values={{}} onChange={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('cannot be edited while the order is being placed', () => {
    render(<Harness disabled />)

    for (const box of screen.getAllByRole('textbox')) expect(box).toBeDisabled()
  })
})

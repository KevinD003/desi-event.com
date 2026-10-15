import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { toggleSeat, flattenSeats } from '../lib/seat-map.js'
import { SeatPicker } from './seat-picker.jsx'

/** The paths that tell the glyphs apart. */
const GLYPH = Object.freeze({
  tick: 'm5 12.5 4.5 4.5L19 7.5',
  cross: 'm6 6 12 12M18 6 6 18',
  eyeOff: 'm4 4 16 16',
})

/**
 * A public seat of the map.
 *
 * @param {string} label The seat's label; its ids derive from it.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The seat.
 */
function seat(label, overrides = {}) {
  const key = label.toLowerCase()

  return {
    id: `es${key}xxxxxxxx`,
    seatId: `st${key}xxxxxxxx`,
    label,
    sectionId: 'scstallsxxxxx',
    rowId: null,
    priceZoneId: 'pzfrontxxxxxx',
    sortOrder: 0,
    available: true,
    accessible: false,
    companionOfSeatId: null,
    obstructedView: false,
    restricted: false,
    restrictionNote: null,
    priceCents: null,
    ticketTypeId: 'ttfrontxxxxxx',
    ...overrides,
  }
}

const A1 = seat('A1', { accessible: true })
const A2 = seat('A2', { companionOfSeatId: A1.seatId })
const A3 = seat('A3', { obstructedView: true })
const A4 = seat('A4', { available: false })
const B1 = seat('B1', { priceZoneId: 'pzbackxxxxxxx', ticketTypeId: 'ttbackxxxxxxx' })
const B2 = seat('B2', {
  priceZoneId: 'pzbackxxxxxxx',
  ticketTypeId: 'ttbackxxxxxxx',
  restricted: true,
  restrictionNote: 'Behind the sound desk; the stage is seen from the side.',
})
const C1 = seat('C1', {
  sectionId: 'scbalconyxxxx',
  priceZoneId: 'pzbackxxxxxxx',
  ticketTypeId: 'ttbackxxxxxxx',
  priceCents: 3_000,
})

/** A night's map: stalls in two rows over two zones, and a balcony. */
const MAP = Object.freeze({
  sessionId: 'snnightonexxx',
  eventId: 'evseatedxxxxx',
  label: 'Night 1',
  maxSeatsPerOrder: 10,
  zones: [
    { id: 'pzfrontxxxxxx', name: 'Front', sortOrder: 0 },
    { id: 'pzbackxxxxxxx', name: 'Back', sortOrder: 1 },
  ],
  tiers: [
    {
      id: 'ttfrontxxxxxx',
      name: 'Front stalls',
      priceCents: 4_500,
      currency: 'USD',
      priceZoneId: 'pzfrontxxxxxx',
      minPerOrder: 1,
      maxPerOrder: 10,
      onSale: true,
    },
    {
      id: 'ttbackxxxxxxx',
      name: 'Back stalls',
      priceCents: 2_500,
      currency: 'USD',
      priceZoneId: 'pzbackxxxxxxx',
      minPerOrder: 1,
      maxPerOrder: 10,
      onSale: true,
    },
  ],
  sections: [
    {
      id: 'scstallsxxxxx',
      name: 'Stalls',
      kind: 'SEATED',
      sortOrder: 0,
      rows: [
        { id: 'rwaxxxxxxxxxx', label: 'A', sortOrder: 0, seats: [A1, A2, A3, A4] },
        { id: 'rwbxxxxxxxxxx', label: 'B', sortOrder: 1, seats: [B1, B2] },
      ],
      seats: [],
    },
    {
      id: 'scbalconyxxxx',
      name: 'Balcony',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [{ id: 'rwcxxxxxxxxxx', label: 'C', sortOrder: 0, seats: [C1] }],
      seats: [],
    },
  ],
})

/**
 * The picker with a selection held the way the checkout holds it.
 *
 * @param {object} props Component props.
 * @param {object} props.map The map.
 * @param {Function} [props.spy] Told of every toggle.
 * @returns {JSX.Element} The picker.
 */
function Harness({ map, spy = () => {} }) {
  const [selected, setSelected] = useState([])
  const seats = flattenSeats(map)

  return (
    <SeatPicker
      map={map}
      selected={selected}
      onToggle={(seatId) => {
        spy(seatId)
        setSelected((current) => toggleSeat(current, seatId, seats).selected)
      }}
    />
  )
}

/**
 * The seat button whose accessible name starts with `Seat <label>,`.
 *
 * @param {string} label The seat's label.
 * @returns {HTMLElement} The button.
 */
function seatButton(label) {
  return screen.getByRole('button', { name: new RegExp(`^Seat ${label},`, 'u') })
}

/**
 * Whether a button draws a glyph.
 *
 * @param {HTMLElement} button The seat.
 * @param {string} d The glyph's path.
 * @returns {boolean} True when it does.
 */
function draws(button, d) {
  return [...button.querySelectorAll('path')].some((path) => path.getAttribute('d') === d)
}

describe('the seat grid', () => {
  it('draws one grid per section, each a region with rows, row headers and cells', () => {
    render(<Harness map={MAP} />)

    const stalls = screen.getByRole('region', { name: 'Stalls seats' })
    const grid = within(stalls).getByRole('grid', { name: 'Stalls' })

    expect(within(grid).getAllByRole('row')).toHaveLength(2)
    expect(within(grid).getByRole('rowheader', { name: 'Row A' })).toBeInTheDocument()
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(6)
    expect(screen.getByRole('grid', { name: 'Balcony' })).toBeInTheDocument()
    expect(
      screen.getByText('Seats are shown by section and row, not to scale.'),
    ).toBeInTheDocument()
  })

  it('gives each grid one Tab stop, and moves it with the arrows, Home, End and Page keys', async () => {
    const user = userEvent.setup()

    render(<Harness map={MAP} />)

    const stalls = screen.getByRole('grid', { name: 'Stalls' })
    const stops = within(stalls)
      .getAllByRole('button')
      .filter((button) => button.tabIndex === 0)

    expect(stops).toEqual([seatButton('A1')])

    // After the filters, the grid is the next Tab stop, landing on its one seat.
    await user.tab()
    await user.tab()
    await user.tab()
    expect(seatButton('A1')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(seatButton('A2')).toHaveFocus()
    expect(seatButton('A2').tabIndex).toBe(0)
    expect(seatButton('A1').tabIndex).toBe(-1)

    await user.keyboard('{End}')
    expect(seatButton('A4')).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(seatButton('B2')).toHaveFocus()

    await user.keyboard('{Home}')
    expect(seatButton('B1')).toHaveFocus()

    await user.keyboard('{PageUp}')
    expect(seatButton('A1')).toHaveFocus()

    await user.keyboard('{PageDown}')
    expect(seatButton('B1')).toHaveFocus()

    await user.keyboard('{ArrowUp}{ArrowLeft}')
    expect(seatButton('A1')).toHaveFocus()
  })

  it('names each seat with its row, section, zone, price and kind, and its state last', () => {
    render(<Harness map={MAP} />)

    expect(seatButton('A1')).toHaveAccessibleName(
      'Seat A1, row A, Stalls, Front zone, $45.00, wheelchair space, available',
    )
    expect(seatButton('A2')).toHaveAccessibleName(
      'Seat A2, row A, Stalls, Front zone, $45.00, companion seat, available',
    )
    expect(seatButton('A3')).toHaveAccessibleName(
      'Seat A3, row A, Stalls, Front zone, $45.00, obstructed view, available',
    )
    expect(seatButton('C1')).toHaveAccessibleName(
      'Seat C1, row C, Balcony, Back zone, $30.00, available',
    )
  })

  it('keeps a taken seat focusable and says so, and pressing it does nothing', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()

    render(<Harness map={MAP} spy={spy} />)

    const taken = seatButton('A4')

    expect(taken).toHaveAttribute('aria-disabled', 'true')
    expect(taken).not.toBeDisabled()
    expect(taken).toHaveAccessibleName(/, unavailable$/u)
    expect(draws(taken, GLYPH.cross)).toBe(true)

    await user.click(taken)

    expect(spy).not.toHaveBeenCalled()
    expect(taken).toHaveAttribute('aria-pressed', 'false')
  })

  it('presses a wheelchair space and its companion together, and lets both go together', async () => {
    const user = userEvent.setup()

    render(<Harness map={MAP} />)

    await user.click(seatButton('A1'))

    expect(seatButton('A1')).toHaveAttribute('aria-pressed', 'true')
    expect(seatButton('A2')).toHaveAttribute('aria-pressed', 'true')
    expect(seatButton('A1')).toHaveAccessibleName(/, selected$/u)

    await user.click(seatButton('A2'))

    expect(seatButton('A1')).toHaveAttribute('aria-pressed', 'false')
    expect(seatButton('A2')).toHaveAttribute('aria-pressed', 'false')
  })

  it('says every state with a shape as well as a colour, and a legend that names them', async () => {
    const user = userEvent.setup()

    render(<Harness map={MAP} />)

    await user.click(seatButton('B1'))

    expect(draws(seatButton('B1'), GLYPH.tick)).toBe(true)
    expect(draws(seatButton('A3'), GLYPH.eyeOff)).toBe(true)
    expect(seatButton('A1').querySelector('circle')).not.toBeNull()
    expect(within(seatButton('A2')).getByText('C')).toBeInTheDocument()

    for (const words of [
      'Available',
      'Your choice (tick)',
      'Not available (cross and hatching)',
      'Wheelchair space, sold with its companion seat',
      'Companion seat, sold with its wheelchair space',
      'Obstructed view',
    ]) {
      expect(screen.getByText(words)).toBeInTheDocument()
    }
  })

  it('ties a restricted seat to its note, which is also shown under the section', () => {
    render(<Harness map={MAP} />)

    const restricted = seatButton('B2')

    expect(restricted).toHaveAccessibleName(/restricted, available$/u)
    expect(restricted).toHaveAccessibleDescription(
      'Behind the sound desk; the stage is seen from the side.',
    )
    expect(screen.getByText('! Seat B2:')).toBeInTheDocument()
  })

  it('filters by zone and to wheelchair spaces, and says when nothing matches', async () => {
    const user = userEvent.setup()

    render(<Harness map={MAP} />)

    await user.selectOptions(screen.getByLabelText('Price zone'), 'Back')

    expect(screen.queryByRole('button', { name: /^Seat A1,/u })).toBeNull()
    expect(seatButton('B1')).toBeInTheDocument()
    expect(seatButton('C1')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Wheelchair spaces and companion seats only'))

    expect(screen.getByText('No seats match those filters.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Price zone'), 'Every zone')

    expect(seatButton('A1')).toBeInTheDocument()
    expect(seatButton('A2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Seat A3,/u })).toBeNull()
  })

  it('offers no zone filter when the map has one zone', () => {
    render(<Harness map={{ ...MAP, zones: [MAP.zones[0]] }} />)

    expect(screen.queryByLabelText('Price zone')).toBeNull()
  })

  it('does not choose while choosing is paused', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()

    render(<SeatPicker map={MAP} selected={[]} onToggle={onToggle} disabled />)

    await user.click(seatButton('B1'))

    expect(onToggle).not.toHaveBeenCalled()
  })
})

/**
 * The booking once placed (SPEC3 §12.1, SPEC3-XI §12.1): a card order reads
 * "Booked" with its total; a pay-at-the-venue booking says what is paid at the
 * door, what was paid online or that nothing was, and that unpaid tickets can
 * be cancelled, with the waived variant's clause.
 *
 * @module components/booked-order.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AT_THE_DOOR_SENTENCE, BookedOrder, unpaidCancellationSentence } from './booked-order.jsx'

/**
 * An order as the API returns it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The order.
 */
function order(overrides = {}) {
  return {
    reference: 'DE-7Q2K9',
    currency: 'USD',
    totalCents: 4331,
    discountCents: 0,
    paymentMethod: 'CARD',
    feeWaivedCents: 0,
    referralApplied: false,
    tickets: [{ id: 't1' }, { id: 't2' }],
    venuePayment: null,
    ...overrides,
  }
}

describe('BookedOrder', () => {
  it('reads a card order as booked, with its total and the simulated payment', () => {
    render(<BookedOrder order={order()} />)

    expect(screen.getByRole('heading', { name: 'Booked' })).toBeInTheDocument()
    expect(screen.getByText(/2 tickets · \$43\.31/u)).toBeInTheDocument()
    expect(screen.getByText(/The payment was simulated/u)).toBeInTheDocument()
    expect(screen.queryByText(AT_THE_DOOR_SENTENCE)).not.toBeInTheDocument()
  })

  it('reads a pay-at-the-venue booking as booked, never as paid', () => {
    render(
      <BookedOrder
        order={order({
          paymentMethod: 'AT_VENUE',
          totalCents: 331,
          venuePayment: { dueCents: 4000 },
        })}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Booked — pay at the door' })).toBeInTheDocument()
    expect(screen.getByText('Booked. Pay $40.00 at the door.')).toBeInTheDocument()
    expect(screen.getByText(/Paid online \(simulated\) \$3\.31/u)).toBeInTheDocument()
    expect(screen.getByText(AT_THE_DOOR_SENTENCE)).toBeInTheDocument()
    expect(
      screen.getByText(
        'Until you pay at the door, the organiser or Desi-Event can cancel unpaid tickets, and the booking fee is not refunded if they do.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Paid — simulated/u)).not.toBeInTheDocument()
  })

  it('says nothing was paid online when a referral code removed the fee', () => {
    render(
      <BookedOrder
        order={order({
          paymentMethod: 'AT_VENUE',
          totalCents: 0,
          referralApplied: true,
          feeWaivedCents: 331,
          venuePayment: null,
        })}
        venueDueCents={4000}
      />,
    )

    expect(screen.getByText('Booked. Pay $40.00 at the door.')).toBeInTheDocument()
    expect(screen.getByText(/Nothing paid online/u)).toBeInTheDocument()
    expect(screen.getByText(unpaidCancellationSentence(true))).toBeInTheDocument()
    expect(unpaidCancellationSentence(true)).toBe(
      'Until you pay at the door, the organiser or Desi-Event can cancel unpaid tickets, and nothing was paid online for them.',
    )
    expect(screen.queryByText(/no money moved/u)).not.toBeInTheDocument()
  })

  it('is a polite status labelled by its heading', () => {
    render(<BookedOrder order={order()} />)

    expect(screen.getByRole('status', { name: 'Booked' })).toBeInTheDocument()
  })
})

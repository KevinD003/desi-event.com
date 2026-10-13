/**
 * The organiser's read-only panel about the booking fee and paying at the
 * venue (SPEC3 §12.4): each wording of the fee, the switch as a word, who
 * changed what, and the link to "Payments at the venue" — which stays after
 * the switch is turned off while bookings made under it remain.
 *
 * @module components/payment-terms-summary.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  PaymentTermsSummary,
  changedSentence,
  feeSentence,
  venuePaymentSentence,
} from './payment-terms-summary.jsx'
import { venueStatusText } from '../lib/event-control.js'

const FEE = {
  source: 'EVENT',
  percentageBps: 300,
  flatCentsPerTicket: 149,
  currency: 'USD',
  sequence: 2,
  changedAt: '2026-10-09T10:00:00.000Z',
  changedByName: 'Meera Admin',
  reason: 'Partner rate agreed for this season.',
}

const SWITCH = {
  enabled: true,
  limit: 1200,
  offered: true,
  changedAt: '2026-10-10T09:00:00.000Z',
  changedByName: null,
  reason: 'The organiser takes cash at the door.',
  hasOrders: false,
  unpaidTickets: 0,
  paidAtDoorTickets: 0,
  paidAtDoorCents: 0,
}

/**
 * The panel's terms.
 *
 * @param {object} [fee] The fee.
 * @param {object} [venuePayment] The switch.
 * @returns {object} `paymentTerms`.
 */
function terms(fee = FEE, venuePayment = SWITCH) {
  return {
    fee,
    siteDefault: { currency: 'USD', percentageBps: 250, flatCentsPerTicket: 99 },
    venuePayment,
  }
}

describe('the fee, in words', () => {
  it('says the event’s own fee, the site default, and no fee at all', () => {
    expect(feeSentence(FEE)).toBe(
      'Booking fee on this event: 3.00% of the ticket price plus $1.49 per ticket. Set by the Desi-Event team.',
    )
    expect(
      feeSentence({ ...FEE, source: 'SITE_DEFAULT', percentageBps: 250, flatCentsPerTicket: 99 }),
    ).toBe(
      'Booking fee on this event: the site’s standard booking fee, 2.50% of the ticket price plus $0.99 per ticket. Set by the Desi-Event team.',
    )
    expect(feeSentence({ ...FEE, percentageBps: 0, flatCentsPerTicket: 0 })).toBe(
      'This event has no booking fee.',
    )
  })

  it('says the switch as a word, with its limit, and who decides', () => {
    expect(venuePaymentSentence(SWITCH)).toBe(
      'Pay at the venue: On — up to 1,200 tickets waiting to be paid at the door. Only the Desi-Event team can change this.',
    )
    expect(venuePaymentSentence({ ...SWITCH, enabled: false })).toBe(
      'Pay at the venue: Off. Only the Desi-Event team can change this.',
    )
  })

  it('words the switch exactly as the Desi-Event team’s panel does', () => {
    // One wording for one switch (lib/event-control.js `venueStatusText`):
    // the organiser and the team must never read it differently.
    for (const venuePayment of [
      SWITCH,
      { ...SWITCH, enabled: false },
      { ...SWITCH, limit: null },
    ]) {
      expect(venuePaymentSentence(venuePayment)).toBe(
        `Pay at the venue: ${venueStatusText(venuePayment)}. Only the Desi-Event team can change this.`,
      )
    }
    expect(venuePaymentSentence({ ...SWITCH, limit: null })).toBe(
      'Pay at the venue: On. Only the Desi-Event team can change this.',
    )
  })

  it('says who changed a setting, when and why, and nothing for one never changed', () => {
    expect(changedSentence(FEE)).toBe(
      'Changed by Meera Admin on Oct 9, 2026: “Partner rate agreed for this season.”',
    )
    expect(changedSentence(SWITCH)).toBe(
      'Changed by the Desi-Event team on Oct 10, 2026: “The organiser takes cash at the door.”',
    )
    expect(changedSentence({ changedAt: null })).toBeNull()
  })
})

describe('the dates, as the event keeps time', () => {
  // 02:30 UTC on 10 October is the evening of 9 October in Chicago.
  const LATE = { ...SWITCH, changedAt: '2026-10-10T02:30:00.000Z' }

  it('dates a change on the day it was in the event’s zone, not in UTC', () => {
    expect(changedSentence(LATE, 'America/Chicago')).toBe(
      'Changed by the Desi-Event team on Oct 9, 2026: “The organiser takes cash at the door.”',
    )
    expect(changedSentence(LATE, 'Asia/Kolkata')).toBe(
      'Changed by the Desi-Event team on Oct 10, 2026: “The organiser takes cash at the door.”',
    )
  })

  it('dates the panel’s changes in the zone it is given', () => {
    render(
      <PaymentTermsSummary
        eventId="evt1"
        paymentTerms={terms(FEE, LATE)}
        timeZone="America/Chicago"
      />,
    )

    expect(screen.getByRole('region', { name: 'Booking fee and payment' })).toHaveTextContent(
      'Changed by the Desi-Event team on Oct 9, 2026',
    )
  })
})

describe('the panel', () => {
  it('is read-only and labelled by its heading', () => {
    render(<PaymentTermsSummary eventId="evt1" paymentTerms={terms()} mayReadVenuePayments />)

    const panel = screen.getByRole('region', { name: 'Booking fee and payment' })

    expect(panel.querySelectorAll('input, button, select, textarea')).toHaveLength(0)
    expect(panel).toHaveTextContent('Changed by Meera Admin on Oct 9, 2026')
  })

  it('links finance to the payments at the venue while the switch is on', () => {
    render(<PaymentTermsSummary eventId="evt1" paymentTerms={terms()} mayReadVenuePayments />)

    expect(screen.getByRole('link', { name: 'Payments at the venue' })).toHaveAttribute(
      'href',
      '/organizer/events/evt1/venue-payments',
    )
  })

  it('keeps the link after a switch-off while bookings made under it remain', () => {
    render(
      <PaymentTermsSummary
        eventId="evt1"
        paymentTerms={terms(FEE, { ...SWITCH, enabled: false, hasOrders: true })}
        mayReadVenuePayments
      />,
    )

    expect(screen.getByRole('link', { name: 'Payments at the venue' })).toBeInTheDocument()
  })

  it('offers no link when the event never took such bookings, or to a reader without finance', () => {
    const { unmount } = render(
      <PaymentTermsSummary
        eventId="evt1"
        paymentTerms={terms(FEE, { ...SWITCH, enabled: false, hasOrders: false })}
        mayReadVenuePayments
      />,
    )

    expect(screen.queryByRole('link', { name: 'Payments at the venue' })).toBeNull()
    unmount()

    render(<PaymentTermsSummary eventId="evt1" paymentTerms={terms()} />)

    expect(screen.queryByRole('link', { name: 'Payments at the venue' })).toBeNull()
  })
})

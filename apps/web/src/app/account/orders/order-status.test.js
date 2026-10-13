/**
 * The words the account pages use for an order and its tickets.
 *
 * The properties worth pinning: every order status the schema declares has
 * words and the colour the task gave it, and a paid or refunded one says it
 * was simulated; the ticket words cover exactly the states the application can
 * reach and are the wallet's own, from the one table the wallet reads; a handed-back ticket is counted once; tickets are
 * linked only for the account they were issued to, and what opening one is for
 * follows its state; and a URL cannot page the list into a validation refusal.
 *
 * @module app/account/orders/order-status.test
 */

import { ORDER_STATUSES } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import { REACHABLE_STATUSES, TICKET_STATUS_WORDS } from '../../../lib/wallet.js'
import {
  ORDER_STATUS,
  TICKET_STATUS,
  currentTickets,
  handedAnyOn,
  instantText,
  openTicketHint,
  orderHref,
  orderStatusFor,
  orderStatusMeaning,
  orderTitle,
  ordersPageHref,
  readAsBuyer,
  paidAtVenue,
  venueTicketMeaning,
  owingPassedOnTickets,
  readPage,
  ticketCount,
  ticketHolder,
  ticketStatusMeaning,
} from './order-status.js'

describe('order status words', () => {
  it('has words for every status the schema declares, and no others', () => {
    expect(Object.keys(ORDER_STATUS).sort()).toEqual([...ORDER_STATUSES].sort())
  })

  it('says a paid or refunded order was simulated', () => {
    expect(orderStatusMeaning('PAID').label).toMatch(/simulated/i)
    expect(orderStatusMeaning('REFUNDED').label).toMatch(/simulated/i)
  })

  it.each([
    ['PAID', 'success'],
    ['PENDING', 'pending'],
    ['CANCELLED', 'neutral'],
    ['REFUNDED', 'info'],
    ['EXPIRED', 'neutral'],
  ])('colours %s as %s', (status, tone) => {
    expect(orderStatusMeaning(status).tone).toBe(tone)
  })

  it('keeps an unknown status’s own name, in a neutral colour', () => {
    expect(orderStatusMeaning('ON_HOLD')).toEqual({ label: 'ON_HOLD', tone: 'neutral' })
  })
})

describe('ticket status words', () => {
  it('covers exactly the states the application can put a ticket into', () => {
    expect(Object.keys(TICKET_STATUS).sort()).toEqual([...REACHABLE_STATUSES].sort())
  })

  it('reads a ticket as the wallet does', () => {
    expect(ticketStatusMeaning('VALID').label).toBe('Ready to use')
    expect(ticketStatusMeaning('TRANSFERRED').label).toBe('Handed on')
  })

  it('uses the wallet’s own words and colours, from the table the wallet reads', () => {
    expect(TICKET_STATUS).toBe(TICKET_STATUS_WORDS)
  })

  it('shows an unreachable state as its raw value rather than a sentence', () => {
    expect(ticketStatusMeaning('VOID').label).toBe('VOID')
  })
})

describe('counting tickets', () => {
  it('counts what was bought from the lines, not from the rows', () => {
    expect(ticketCount({ items: [{ quantity: 2 }, { quantity: 1 }] })).toBe(3)
  })

  it('drops the earlier row of a ticket handed out and handed back', () => {
    const order = {
      tickets: [
        { id: 'A', supersededByLaterTicket: true, purchaserHolding: 'TRANSFERRED_AWAY' },
        { id: 'C', supersededByLaterTicket: false, purchaserHolding: 'HELD' },
      ],
    }

    expect(currentTickets(order).map((ticket) => ticket.id)).toEqual(['C'])
    expect(handedAnyOn(order)).toBe(true)
  })

  it('does not call a held ticket handed on', () => {
    const order = {
      tickets: [{ id: 'A', supersededByLaterTicket: false, purchaserHolding: 'HELD' }],
    }

    expect(handedAnyOn(order)).toBe(false)
  })
})

describe('whose tickets they are', () => {
  const VIEWER = 'usr00000000000000000001'

  it('is this account’s when this account placed the order', () => {
    expect(ticketHolder({ userId: VIEWER }, VIEWER)).toBe('this-account')
  })

  it('is no account’s for an order placed without signing in', () => {
    expect(ticketHolder({ userId: null }, VIEWER)).toBe('guest')
  })

  it('is another account’s for an order that reached this one by its email address', () => {
    expect(ticketHolder({ userId: 'usr00000000000000000002' }, VIEWER)).toBe('other-account')
  })

  it('is not guessed when the signed-in account could not be read', () => {
    expect(ticketHolder({ userId: VIEWER }, null)).toBe('unknown')
  })
})

describe('what opening a ticket is for', () => {
  it('offers the pass and handing on while a ticket is ready to use', () => {
    expect(openTicketHint([{ status: 'REFUNDED' }, { status: 'VALID' }])).toMatch(
      /show its pass at the door.*hand it on/,
    )
  })

  it('no longer carves reserved seats out of handing on, because the seat goes with its ticket', () => {
    const hint = openTicketHint([{ status: 'VALID' }])

    expect(hint).toBe('Open a ticket to show its pass at the door or to hand it on.')
    expect(hint).not.toMatch(/reserved/)
  })

  it('offers the pass and withdrawing while a ticket is on offer', () => {
    const hint = openTicketHint([{ status: 'TRANSFER_PENDING' }])

    expect(hint).toMatch(/show its pass at the door/)
    expect(hint).toMatch(/withdraw the offer/)
    expect(hint).not.toMatch(/hand it on/)
  })

  it.each([['REFUNDED'], ['CHECKED_IN'], ['REVOKED'], ['TRANSFERRED'], ['VOID']])(
    'promises neither a pass nor a hand-over for a %s ticket',
    (status) => {
      const hint = openTicketHint([{ status }])

      expect(hint).not.toMatch(/pass|hand it on/)
      expect(hint).toBe('Open a ticket to see where it stands.')
    },
  )

  it('promises nothing at the door once the event is over', () => {
    expect(openTicketHint([{ status: 'VALID' }], { eventOver: true })).not.toMatch(/pass/)
  })
})

describe('whose read it was', () => {
  it('is the buyer’s when the payload carries the buyer’s address', () => {
    expect(readAsBuyer({ buyerEmail: 'asha@example.com' })).toBe(true)
  })

  it('is not the buyer’s when the address was withheld, as it is from an organiser', () => {
    expect(readAsBuyer({ buyerName: 'Asha' })).toBe(false)
  })
})

describe('titles and links', () => {
  it('uses the reference when the event is gone', () => {
    expect(orderTitle({ reference: 'DE-AAAA', event: null })).toBe('Order DE-AAAA')
  })

  it('encodes a reference into the order’s path', () => {
    expect(orderHref('DE-A/B')).toBe('/account/orders/DE-A%2FB')
  })

  it('links the first page without a query', () => {
    expect(ordersPageHref(1)).toBe('/account/orders')
    expect(ordersPageHref(2)).toBe('/account/orders?page=2')
  })
})

describe('readPage', () => {
  it('reads a whole page number', () => {
    expect(readPage({ page: '3' })).toBe(3)
  })

  it.each([[undefined], ['0'], ['-2'], ['2.5'], ['two'], ['']])(
    'reads %p as the first page',
    (value) => {
      expect(readPage({ page: value })).toBe(1)
    },
  )

  it('caps a page beyond what the API will serve', () => {
    expect(readPage({ page: '99999999' })).toBe(10_000)
  })

  it('takes the first of a repeated parameter', () => {
    expect(readPage({ page: ['2', '5'] })).toBe(2)
  })
})

describe('instantText', () => {
  it('shows an instant in the zone it is given, and names the zone', () => {
    const text = instantText('2026-10-10T13:30:00.000Z', 'Asia/Kolkata')

    expect(text).toMatch(/Oct 10, 2026/)
    expect(text).toMatch(/7:00\sPM/)
    expect(text).toMatch(/IST|GMT\+5:30/)
  })

  it('says nothing for an unreadable instant', () => {
    expect(instantText('not a date', 'Asia/Kolkata')).toBe('')
  })
})

describe('a booking paid at the venue (SPEC3 §12.7, SPEC3-XI §12.7)', () => {
  /**
   * A pay-at-the-venue order.
   *
   * @param {object} [venue] Fields of its `venuePayment` to change.
   * @param {object} [overrides] Fields of the order to change.
   * @returns {object} The order.
   */
  function atVenue(venue = {}, overrides = {}) {
    return {
      status: 'PAID',
      currency: 'USD',
      paymentMethod: 'AT_VENUE',
      venuePayment: {
        dueCents: 8_000,
        paidCents: 0,
        unpaidTickets: 2,
        unpaidCents: 8_000,
        paidTickets: 0,
        paidByOthersTickets: 0,
        paidByOthersCents: 0,
        passedOnUnpaidTickets: 0,
        passedOnUnpaidCents: 0,
        cancelledTickets: 0,
        cancelledCents: 0,
        feeKeptCents: 0,
        state: 'TO_PAY',
        ...venue,
      },
      ...overrides,
    }
  }

  it('reads each state of the door as SPEC3-XI writes it', () => {
    expect(orderStatusFor(atVenue())).toEqual({
      label: 'Booked — pay $80.00 at the door',
      tone: 'pending',
    })
    expect(orderStatusFor(atVenue({ state: 'PAID', unpaidCents: 0, paidCents: 8_000 }))).toEqual({
      label: 'Paid at the door',
      tone: 'success',
    })
    expect(orderStatusFor(atVenue({ state: 'PASSED_ON' }))).toEqual({
      label: 'Passed on — the new holder pays at the door',
      tone: 'info',
    })
    expect(orderStatusFor(atVenue({ state: 'CANCELLED' }))).toEqual({
      label: 'Cancelled — not paid at the door',
      tone: 'neutral',
    })
  })

  it('reads a booking that ended with nothing to pay as cancelled, never as paid or owing', () => {
    // Its event cancelled with the tickets still standing, or its only night
    // cancelled and the tickets withdrawn: the API says ENDED and owes 0.
    const ended = atVenue({ state: 'ENDED', unpaidTickets: 0, unpaidCents: 0 })

    expect(orderStatusFor(ended)).toEqual({ label: 'Cancelled — nothing to pay', tone: 'neutral' })
    expect(orderStatusFor(ended).label).not.toMatch(/Paid|pay \$/u)
  })

  it('says the booking fee was refunded, or partly when a share was kept', () => {
    expect(orderStatusFor(atVenue({}, { status: 'REFUNDED' }))).toEqual({
      label: 'Booking fee refunded — simulated',
      tone: 'info',
    })
    expect(orderStatusFor(atVenue({ feeKeptCents: 331 }, { status: 'REFUNDED' }))).toEqual({
      label: 'Booking fee partly refunded — simulated',
      tone: 'info',
    })
  })

  it('never reads a booking that still owes money as paid', () => {
    expect(orderStatusFor(atVenue()).label).not.toMatch(/^Paid/u)
  })

  it('leaves a card order’s words as they were', () => {
    const card = { status: 'PAID', paymentMethod: 'CARD', venuePayment: null }

    expect(paidAtVenue(card)).toBe(false)
    expect(orderStatusFor(card)).toEqual(orderStatusMeaning('PAID'))
    expect(orderStatusFor({ status: 'REFUNDED' })).toEqual(orderStatusMeaning('REFUNDED'))
  })

  it('keeps the plain words for a booking not yet paid online, or one with no door state', () => {
    expect(orderStatusFor(atVenue({}, { status: 'PENDING' }))).toEqual(
      orderStatusMeaning('PENDING'),
    )
    expect(orderStatusFor(atVenue({ state: 'NONE' }))).toEqual(orderStatusMeaning('PAID'))
  })
})

describe('a ticket of a booking paid at the venue', () => {
  /** A row's own door record: it never records what became of a ticket since it was passed on. */
  const UNPAID = {
    dueCents: 4_000,
    paid: false,
    currency: 'USD',
    cancelled: null,
    paidAtDoorByYou: false,
  }

  it('reads a cancelled one as not paid, and one passed on as owing what the API says its holder owes', () => {
    expect(
      venueTicketMeaning(
        {
          venuePayment: {
            ...UNPAID,
            cancelled: { at: '2026-10-10T12:00:00.000Z', by: 'ORGANISER' },
          },
        },
        'USD',
      ),
    ).toEqual({ label: 'Cancelled — not paid', tone: 'neutral' })

    // The amount is the API's, read from the ticket its holder has now, not
    // the buyer's row's own due.
    expect(
      venueTicketMeaning(
        {
          purchaserHolding: 'TRANSFERRED_AWAY',
          venuePayment: UNPAID,
          passedOn: { state: 'OWES', dueCents: 2_500 },
        },
        'USD',
      ),
    ).toEqual({ label: 'Passed on — its new holder pays $25.00 at the door', tone: 'info' })
  })

  it('says nothing of its own for a ticket that owes nothing, one the buyer holds, or one passed on that no longer owes', () => {
    expect(venueTicketMeaning({ venuePayment: null }, 'USD')).toBeNull()
    expect(venueTicketMeaning({ purchaserHolding: 'HELD', venuePayment: UNPAID }, 'USD')).toBeNull()

    for (const passedOn of [
      { state: 'PAID', dueCents: 0 },
      { state: 'CANCELLED', dueCents: 0 },
      { state: 'NOTHING_DUE', dueCents: 0 },
      { state: 'RETURNED', dueCents: 0 },
      null,
      undefined,
    ]) {
      expect(
        venueTicketMeaning(
          { purchaserHolding: 'TRANSFERRED_AWAY', venuePayment: UNPAID, passedOn },
          'USD',
        ),
      ).toBeNull()
    }
  })
})

describe('the tickets a booking paid at the venue passed on', () => {
  /**
   * The buyer's row for a ticket they passed on, as the API presents it: its
   * own `venuePayment` never records what became of the ticket since; its
   * `passedOn` says where the ticket stands with whoever holds it now.
   *
   * @param {string} id The row.
   * @param {object|null} passedOn Where the ticket stands now (`{state, dueCents}`).
   * @param {number} [dueCents] What the row owed at the door when it was passed on.
   * @returns {object} The row.
   */
  function passedOnRow(id, passedOn, dueCents = 4_000) {
    return {
      id,
      status: 'TRANSFERRED',
      purchaserHolding: 'TRANSFERRED_AWAY',
      supersededByLaterTicket: true,
      venuePayment: {
        dueCents,
        paid: false,
        currency: 'USD',
        cancelled: null,
        paidAtDoorByYou: false,
      },
      passedOn,
    }
  }

  const owes = (dueCents) => ({ state: 'OWES', dueCents })
  const settled = (state) => ({ state, dueCents: 0 })

  it('lists every row whose holder still owes, each with the amount the API says', () => {
    const rows = [passedOnRow('A', owes(4_000)), passedOnRow('B', owes(2_500), 2_500)]

    expect(owingPassedOnTickets({ tickets: rows })).toEqual(rows)
  })

  it('lists none once their new holders paid at the door, or the tickets were cancelled or owe nothing', () => {
    expect(
      owingPassedOnTickets({
        tickets: [
          passedOnRow('A', settled('PAID')),
          passedOnRow('B', settled('CANCELLED')),
          passedOnRow('C', settled('NOTHING_DUE')),
        ],
      }),
    ).toEqual([])
  })

  it('lists only the ones still owing, with their amounts, when some of them no longer owe', () => {
    const rows = [passedOnRow('A', owes(4_000)), passedOnRow('B', settled('PAID'))]
    const tickets = owingPassedOnTickets({ tickets: rows })

    expect(tickets).toEqual([rows[0]])
    expect(venueTicketMeaning(tickets[0], 'USD').label).toBe(
      'Passed on — its new holder pays $40.00 at the door',
    )
  })

  it('names the exact amount still owed when the rows owed different amounts and only some still owe', () => {
    // The mixed case: two tickets of different prices passed on, the dearer
    // one since paid at the door. The row that still owes says its own amount.
    const rows = [passedOnRow('A', settled('PAID'), 4_000), passedOnRow('B', owes(2_500), 2_500)]
    const tickets = owingPassedOnTickets({ tickets: rows })

    expect(tickets).toEqual([rows[1]])
    expect(venueTicketMeaning(tickets[0], 'USD')).toEqual({
      label: 'Passed on — its new holder pays $25.00 at the door',
      tone: 'info',
    })
  })

  it('lists none handed back to the buyer, whose own later row speaks for it', () => {
    expect(owingPassedOnTickets({ tickets: [passedOnRow('A', settled('RETURNED'))] })).toEqual([])
  })

  it('skips rows that are not passed on, or that the API did not say anything about', () => {
    const held = {
      ...passedOnRow('H', owes(4_000)),
      purchaserHolding: 'HELD',
      supersededByLaterTicket: false,
    }

    expect(
      owingPassedOnTickets({
        tickets: [held, passedOnRow('N', null), { ...passedOnRow('U', null), passedOn: undefined }],
      }),
    ).toEqual([])
    expect(owingPassedOnTickets({})).toEqual([])
  })
})

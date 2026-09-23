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
  orderStatusMeaning,
  orderTitle,
  ordersPageHref,
  readAsBuyer,
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

    expect(text).toMatch(/10 Oct,? 2026/)
    expect(text).toMatch(/7:00\spm/)
    expect(text).toMatch(/IST|GMT\+5:30/)
  })

  it('says nothing for an unreadable instant', () => {
    expect(instantText('not a date', 'Asia/Kolkata')).toBe('')
  })
})

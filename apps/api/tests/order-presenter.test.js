/**
 * What an order and a refund say about themselves, from the presenters alone
 * (SPEC3 §11.3, SPEC3-XI §12.7):
 *
 * - the order's event names the country and region of its venue, so the
 *   order page can name its tax ("Sales tax", "HST") instead of "Tax";
 * - each ticket the buyer passed on says where it stands now with whoever
 *   holds it, read from the ticket that replaced it, so the page never has
 *   to guess which passed-on row still owes, or how much;
 * - a refund of a pay-at-the-venue order names how it was paid and what was
 *   taken at the door, from `toRefund` itself.
 */

import { orderWithItemsSchema, refundSchema } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import { toOrder, toRefund } from '../src/lib/presenters.js'

/** The buyer's account. */
const BUYER = 'buyeraccount1'

/**
 * A ticket's id from its label in these tests: cuid-shaped, so the order
 * parses as the API answers it.
 *
 * @param {string} label One letter.
 * @returns {string} The id.
 */
const T = (label) => `ticket${label}0000000`

/** A cuid-shaped id, distinct per seed. */
const id = (seed) => `c${String(seed).padStart(24, '0')}`

/**
 * An event row as the order read includes it.
 *
 * @param {object|null} venue The venue, or null for an online event.
 * @returns {object} The row.
 */
function eventRow(venue) {
  return {
    id: id(1),
    organizationId: id(2),
    title: 'Garba Night',
    slug: 'garba-night',
    summary: 'Dance all night.',
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    startsAt: new Date('2026-11-01T00:30:00.000Z'),
    endsAt: new Date('2026-11-01T04:30:00.000Z'),
    timezone: 'America/Chicago',
    isOnline: venue === null,
    venue,
    organization: { name: 'Rangoli', slug: 'rangoli' },
    ticketTypes: [],
  }
}

/**
 * A ticket row on the order's one line.
 *
 * @param {string} label Its label: one letter.
 * @param {object} [fields] What differs.
 * @returns {object} The row.
 */
function ticket(label, fields = {}) {
  return {
    id: T(label),
    orderItemId: id(5),
    code: `DE-TICKET-${label.toUpperCase()}`,
    status: 'VALID',
    ownerUserId: BUYER,
    supersedesTicketId: null,
    venueDueCents: 4_000,
    venuePaymentId: null,
    venueCancellationId: null,
    venueCancellation: null,
    ...fields,
  }
}

/**
 * A PAID order with one line holding `tickets`.
 *
 * @param {object[]} tickets The line's tickets, everybody's.
 * @param {object} [fields] What differs.
 * @returns {object} The order row.
 */
function orderRow(tickets, fields = {}) {
  return {
    id: id(3),
    reference: 'DE-ABCDEFGH',
    eventId: id(1),
    userId: BUYER,
    status: 'PAID',
    currency: 'USD',
    paymentMethod: 'AT_VENUE',
    subtotalCents: 4_000 * tickets.length,
    discountCents: 0,
    feesCents: 600,
    taxCents: 0,
    totalCents: 600,
    buyerName: 'Priya Sharma',
    buyerEmail: 'priya@example.com',
    items: [
      {
        id: id(5),
        orderId: id(3),
        ticketTypeId: id(6),
        quantity: tickets.length,
        unitPriceCents: 4_000,
        subtotalCents: 4_000 * tickets.length,
        tickets,
      },
    ],
    event: eventRow({
      name: 'Expo Hall',
      slug: 'expo-hall',
      city: 'Irving',
      region: 'TX',
      country: 'US',
    }),
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    updatedAt: new Date('2026-10-01T10:00:00.000Z'),
    ...fields,
  }
}

/**
 * The presented order's ticket rows, by label.
 *
 * @param {object} presented What `toOrder` answered.
 * @returns {Record<string, object>} The rows.
 */
function rowsById(presented) {
  return Object.fromEntries(
    presented.tickets.map((row) => [row.id.slice('ticket'.length, 'ticket'.length + 1), row]),
  )
}

describe('the order’s event names the place its tax is named for', () => {
  it('carries the country and region of the event’s venue', () => {
    const presented = toOrder(orderRow([ticket('a')]))

    expect(presented.event).toMatchObject({ country: 'US', region: 'TX', city: 'Irving' })
    expect(orderWithItemsSchema.parse(presented).event).toMatchObject({
      country: 'US',
      region: 'TX',
    })
  })

  it('says null for both when the event has no venue, so the page keeps the generic word', () => {
    const presented = toOrder(orderRow([ticket('a')], { event: eventRow(null) }))

    expect(presented.event).toMatchObject({ country: null, region: null })
  })
})

describe('each ticket the buyer passed on says where it stands now', () => {
  it('owes, with the amount its holder pays, exactly row by row when the amounts differ', () => {
    // The mixed case the order alone could not tell apart: two passed on,
    // owing different amounts, one of them since paid at the door.
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED', venueDueCents: 4_000 }),
        ticket('b', { status: 'TRANSFERRED', venueDueCents: 2_500 }),
        ticket('c', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          venueDueCents: 4_000,
        }),
        ticket('d', {
          ownerUserId: 'someoneelse2',
          supersedesTicketId: T('b'),
          status: 'CHECKED_IN',
          venueDueCents: 2_500,
          venuePaymentId: 'vp_1',
        }),
      ]),
    )
    const rows = rowsById(presented)

    expect(Object.keys(rows).sort()).toEqual(['a', 'b'])
    expect(rows.a.passedOn).toEqual({ state: 'OWES', dueCents: 4_000 })
    expect(rows.b.passedOn).toEqual({ state: 'PAID', dueCents: 0 })
    expect(orderWithItemsSchema.parse(presented).tickets.map((row) => row.passedOn)).toEqual([
      { state: 'OWES', dueCents: 4_000 },
      { state: 'PAID', dueCents: 0 },
    ])
  })

  it('follows every hand-on to the ticket its holder has now', () => {
    // a (buyer) → b (x, handed on again) → c (y, still owing 3,000).
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED' }),
        ticket('b', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          status: 'TRANSFERRED',
        }),
        ticket('c', {
          ownerUserId: 'someoneelse2',
          supersedesTicketId: T('b'),
          venueDueCents: 3_000,
        }),
      ]),
    )

    expect(rowsById(presented).a.passedOn).toEqual({ state: 'OWES', dueCents: 3_000 })
  })

  it('says CANCELLED for one cancelled unpaid, and NOTHING_DUE for one withdrawn or refunded', () => {
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED' }),
        ticket('b', { status: 'TRANSFERRED' }),
        ticket('c', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          status: 'REVOKED',
          venueCancellationId: 'vc_1',
        }),
        ticket('d', {
          ownerUserId: 'someoneelse2',
          supersedesTicketId: T('b'),
          status: 'CANCELLED',
        }),
      ]),
      { reader: 'BUYER' },
    )
    const rows = rowsById(presented)

    expect(rows.a.passedOn).toEqual({ state: 'CANCELLED', dueCents: 0 })
    expect(rows.b.passedOn).toEqual({ state: 'NOTHING_DUE', dueCents: 0 })
  })

  it('says RETURNED once it came back to the buyer, whose later row speaks for it', () => {
    // a (buyer) → b (x) → c (buyer again, still owing): c is listed as the
    // buyer's own; a must not be counted as owed by somebody else too.
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED' }),
        ticket('b', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          status: 'TRANSFERRED',
        }),
        ticket('c', { supersedesTicketId: T('b') }),
      ]),
    )
    const rows = rowsById(presented)

    expect(rows.a.passedOn).toEqual({ state: 'RETURNED', dueCents: 0 })
    expect(rows.c.passedOn).toBeNull()
    expect(rows.c.purchaserHolding).toBe('HELD')
  })

  it('counts a row passed on twice by the buyer once: the earlier one came back first', () => {
    // a (buyer) → b (x) → c (buyer) → d (y, owing): only c names what y owes.
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED' }),
        ticket('b', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          status: 'TRANSFERRED',
        }),
        ticket('c', { supersedesTicketId: T('b'), status: 'TRANSFERRED' }),
        ticket('d', {
          ownerUserId: 'someoneelse2',
          supersedesTicketId: T('c'),
          venueDueCents: 4_000,
        }),
      ]),
    )
    const rows = rowsById(presented)

    expect(rows.a.passedOn).toEqual({ state: 'RETURNED', dueCents: 0 })
    expect(rows.c.passedOn).toEqual({ state: 'OWES', dueCents: 4_000 })
  })

  it('is null on the buyer’s own rows and on every ticket of a card order', () => {
    const own = toOrder(orderRow([ticket('a')]))

    expect(rowsById(own).a.passedOn).toBeNull()

    const card = toOrder(
      orderRow(
        [
          ticket('a', { status: 'TRANSFERRED', venueDueCents: 0 }),
          ticket('b', {
            ownerUserId: 'someoneelse1',
            supersedesTicketId: T('a'),
            venueDueCents: 0,
          }),
        ],
        { paymentMethod: 'CARD', totalCents: 8_600 },
      ),
    )

    expect(rowsById(card).a.passedOn).toBeNull()
  })

  it('never carries the holder’s ticket, code or name onto the buyer’s order', () => {
    const presented = toOrder(
      orderRow([
        ticket('a', { status: 'TRANSFERRED' }),
        ticket('b', {
          ownerUserId: 'someoneelse1',
          supersedesTicketId: T('a'),
          code: 'DE-THEIRS',
          attendeeName: 'Someone Else',
        }),
      ]),
    )
    const text = JSON.stringify(presented)

    expect(text).not.toContain('DE-THEIRS')
    expect(text).not.toContain('Someone Else')
    expect(text).not.toContain('someoneelse1')
  })
})

describe('a refund says how its order was paid, from toRefund itself', () => {
  const row = {
    id: id(10),
    orderId: id(3),
    paymentId: id(11),
    provider: 'in-memory-payments',
    amountCents: 600,
    currency: 'USD',
    reason: 'BOOKING_FEE',
    status: 'SUCCEEDED',
    ticketsRevoked: false,
    inventoryReturned: false,
    createdAt: new Date('2026-10-02T10:00:00.000Z'),
    updatedAt: new Date('2026-10-02T10:00:00.000Z'),
  }

  it('names a pay-at-the-venue order’s method and what was taken at the door', () => {
    const presented = toRefund(
      { ...row, order: { reference: 'DE-ABCDEFGH', paymentMethod: 'AT_VENUE', event: {} } },
      { paidAtDoorCents: 4_000 },
    )

    expect(presented).toMatchObject({ paymentMethod: 'AT_VENUE', paidAtDoorCents: 4_000 })
    expect(refundSchema.parse(presented)).toMatchObject({
      paymentMethod: 'AT_VENUE',
      paidAtDoorCents: 4_000,
    })
  })

  it('says 0 taken at the door when nothing was, and nothing of either for a card order', () => {
    expect(
      toRefund({ ...row, order: { reference: 'DE-ABCDEFGH', paymentMethod: 'AT_VENUE' } }),
    ).toMatchObject({ paymentMethod: 'AT_VENUE', paidAtDoorCents: 0 })

    const card = toRefund(
      { ...row, order: { reference: 'DE-ABCDEFGH', paymentMethod: 'CARD' } },
      { paidAtDoorCents: 4_000 },
    )

    expect(card).not.toHaveProperty('paymentMethod')
    expect(card).not.toHaveProperty('paidAtDoorCents')
  })
})

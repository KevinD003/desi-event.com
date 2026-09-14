/**
 * Consistency tests for the seed dataset.
 *
 * `buildSeedData` is pure, so the whole dataset can be checked without a
 * database. These assertions are the reason the seed can be trusted: if
 * `quantitySold` drifted away from the orders, or an order's totals stopped
 * adding up, availability and checkout in the rest of the platform would look
 * broken for reasons that have nothing to do with their own code.
 */

import { describe, expect, it } from 'vitest'

import {
  applyBps,
  buildSeedData,
  computeSeedOrderTotals,
  offset,
  startOfUtcDay,
} from '../scripts/seed.mjs'

const NOW = new Date('2026-09-14T11:22:33.456Z')
const data = buildSeedData(NOW)

describe('startOfUtcDay', () => {
  it('truncates to midnight UTC', () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe('2026-09-14T00:00:00.000Z')
  })

  it('does not shift the calendar day for an instant just before midnight', () => {
    expect(startOfUtcDay(new Date('2026-09-14T23:59:59.999Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    )
  })
})

describe('offset', () => {
  it('adds days, hours and minutes to the anchor', () => {
    const anchor = startOfUtcDay(NOW)
    expect(offset(anchor, 2, 13, 30).toISOString()).toBe('2026-09-16T13:30:00.000Z')
  })

  it('accepts negative days for past events', () => {
    const anchor = startOfUtcDay(NOW)
    expect(offset(anchor, -30).toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })
})

describe('applyBps', () => {
  it('computes an exact share when the arithmetic is exact', () => {
    expect(applyBps(10_000, 590)).toBe(590)
    expect(applyBps(100_000, 1800)).toBe(18_000)
  })

  it('rounds half-up to whole cents', () => {
    // 169 830 * 590 / 10 000 = 10 019.97
    expect(applyBps(169_830, 590)).toBe(10_020)
    // 50 * 100 / 10 000 = 0.5
    expect(applyBps(50, 100)).toBe(1)
  })

  it('always returns an integer', () => {
    for (const cents of [1, 7, 333, 99_999, 1_234_567]) {
      expect(Number.isInteger(applyBps(cents, 590))).toBe(true)
    }
  })
})

describe('computeSeedOrderTotals', () => {
  const lines = [{ ticketTypeKey: 'x', quantity: 2, unitPriceCents: 99900 }]

  it('adds fees and tax to an undiscounted subtotal', () => {
    const totals = computeSeedOrderTotals({ lines, taxBps: 1800 })

    expect(totals.subtotalCents).toBe(199_800)
    expect(totals.discountCents).toBe(0)
    // 199 800 * 590 bps = 11 788.2 -> 11 788, plus 99 flat per ticket.
    expect(totals.feesCents).toBe(11_788 + 198)
    expect(totals.taxCents).toBe(applyBps(199_800 + 11_986, 1800))
    expect(totals.totalCents).toBe(199_800 + 11_986 + totals.taxCents)
  })

  it('charges the platform fee on the discounted subtotal, not the face value', () => {
    const undiscounted = computeSeedOrderTotals({ lines, taxBps: 1800 })
    const discounted = computeSeedOrderTotals({
      lines,
      promo: { type: 'PERCENTAGE', value: 1500 },
      taxBps: 1800,
    })

    expect(discounted.discountCents).toBe(applyBps(199_800, 1500))
    expect(discounted.feesCents).toBeLessThan(undiscounted.feesCents)
  })

  it('never lets a fixed-amount discount exceed the subtotal', () => {
    const totals = computeSeedOrderTotals({
      lines: [{ ticketTypeKey: 'x', quantity: 1, unitPriceCents: 1500 }],
      promo: { type: 'FIXED_AMOUNT', value: 999_999 },
      taxBps: 1300,
    })

    expect(totals.discountCents).toBe(1500)
    expect(totals.totalCents).toBeGreaterThanOrEqual(0)
  })

  it('rejects an order with no lines', () => {
    expect(() => computeSeedOrderTotals({ lines: [], taxBps: 0 })).toThrow(/at least one line/)
  })
})

describe('buildSeedData shape', () => {
  it('produces the documented breadth of data', () => {
    expect(data.organizations).toHaveLength(2)
    expect(data.venues.length).toBeGreaterThanOrEqual(4)
    expect(data.venues.length).toBeLessThanOrEqual(6)
    expect(data.events.length).toBeGreaterThanOrEqual(8)
    expect(data.events.length).toBeLessThanOrEqual(12)
    expect(data.promoCodes.length).toBeGreaterThanOrEqual(3)
    expect(data.orders.length).toBeGreaterThanOrEqual(6)
  })

  it('gives every organisation an owner and staff on differing roles', () => {
    for (const org of data.organizations) {
      const roles = org.members.map((member) => member.role)
      expect(roles).toContain('OWNER')
      expect(roles.filter((role) => role === 'OWNER')).toHaveLength(1)
      expect(new Set(roles).size).toBe(roles.length)
      expect(roles.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('covers both payout currencies', () => {
    expect(data.organizations.map((org) => org.payoutCurrency).sort()).toEqual(['CAD', 'INR'])
  })

  it('never stores a plaintext password', () => {
    for (const user of data.users) {
      expect(user.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/)
      expect(user.passwordHash).not.toContain('DesiEvent')
    }
  })

  it('uses unique emails and includes attendees, organisers and an admin', () => {
    const emails = data.users.map((user) => user.email)
    expect(new Set(emails).size).toBe(emails.length)

    const roles = new Set(data.users.map((user) => user.role))
    expect(roles).toEqual(new Set(['ATTENDEE', 'ORGANIZER', 'ADMIN']))
  })

  it('gives every venue a full postal address', () => {
    for (const venue of data.venues) {
      expect(venue.addressLine1).toBeTruthy()
      expect(venue.city).toBeTruthy()
      expect(venue.region).toBeTruthy()
      expect(venue.postalCode).toBeTruthy()
      expect(['IN', 'CA']).toContain(venue.country)
      expect(venue.capacity).toBeGreaterThan(0)
    }
  })

  it('spreads venues across India and the diaspora', () => {
    const countries = new Set(data.venues.map((venue) => venue.country))
    expect(countries).toEqual(new Set(['IN', 'CA']))
  })
})

describe('seeded events', () => {
  it('uses unique slugs and stable, CUID-shaped ids', () => {
    const slugs = data.events.map((event) => event.slug)
    const ids = data.events.map((event) => event.id)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(new Set(ids).size).toBe(ids.length)

    // Seeded rows must be indistinguishable in shape from rows Prisma creates,
    // otherwise validation that accepts real ids can still reject seeded ones.
    // This is the same pattern `cuidSchema` enforces in @desi-event/schemas.
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]{7,31}$/)
  })

  it('mixes published and draft status', () => {
    const statuses = data.events.map((event) => event.status)
    expect(statuses).toContain('PUBLISHED')
    expect(statuses).toContain('DRAFT')
  })

  it('mixes past and future start times around the anchor', () => {
    const past = data.events.filter((event) => event.startsAt < NOW)
    const future = data.events.filter((event) => event.startsAt > NOW)
    expect(past.length).toBeGreaterThan(0)
    expect(future.length).toBeGreaterThan(0)
  })

  it('always ends after it starts', () => {
    for (const event of data.events) {
      expect(event.endsAt.getTime()).toBeGreaterThan(event.startsAt.getTime())
    }
  })

  it('spans several categories and varied language arrays', () => {
    const categories = new Set(data.events.map((event) => event.category))
    expect(categories.size).toBeGreaterThanOrEqual(6)

    const languages = new Set(data.events.flatMap((event) => event.languages))
    for (const language of ['Hindi', 'Gujarati', 'Tamil', 'Punjabi', 'English']) {
      expect(languages).toContain(language)
    }
  })

  it('pairs online events with a joining URL and no venue', () => {
    const online = data.events.filter((event) => event.isOnline)
    expect(online.length).toBeGreaterThan(0)

    for (const event of data.events) {
      if (event.isOnline) {
        expect(event.onlineUrl).toMatch(/^https:\/\//)
        expect(event.venueId).toBeNull()
      } else {
        expect(event.venueId).toBeTruthy()
        expect(event.onlineUrl).toBeNull()
      }
    }
  })

  it('sets publishedAt exactly on the published events', () => {
    for (const event of data.events) {
      if (event.status === 'PUBLISHED') {
        expect(event.publishedAt).toBeInstanceOf(Date)
        expect(event.publishedAt.getTime()).toBeLessThanOrEqual(NOW.getTime())
      } else {
        expect(event.publishedAt).toBeNull()
      }
    }
  })
})

describe('seeded ticket types', () => {
  it('gives every event between two and four ticket types', () => {
    for (const event of data.events) {
      const forEvent = data.ticketTypes.filter((type) => type.eventId === event.id)
      expect(forEvent.length).toBeGreaterThanOrEqual(2)
      expect(forEvent.length).toBeLessThanOrEqual(4)
    }
  })

  it('prices everything as positive integer cents in the event currency', () => {
    for (const type of data.ticketTypes) {
      expect(Number.isInteger(type.priceCents)).toBe(true)
      expect(type.priceCents).toBeGreaterThan(0)
      expect(['INR', 'CAD']).toContain(type.currency)
    }
  })

  it('uses both INR and CAD', () => {
    const currencies = new Set(data.ticketTypes.map((type) => type.currency))
    expect(currencies).toEqual(new Set(['INR', 'CAD']))
  })

  it('opens sales before it closes them', () => {
    for (const type of data.ticketTypes) {
      if (type.salesStartAt && type.salesEndAt) {
        expect(type.salesEndAt.getTime()).toBeGreaterThan(type.salesStartAt.getTime())
      }
    }
  })

  it('varies the sales windows within an event rather than copying one', () => {
    const windowsBySufi = data.ticketTypes
      .filter((type) => type.eventKey === 'sufi')
      .map((type) => `${type.salesStartAt?.toISOString()}|${type.salesEndAt?.toISOString()}`)
    expect(new Set(windowsBySufi).size).toBeGreaterThan(1)
  })

  it('keeps per-order limits sane', () => {
    for (const type of data.ticketTypes) {
      expect(type.minPerOrder).toBeGreaterThanOrEqual(1)
      expect(type.maxPerOrder).toBeGreaterThanOrEqual(type.minPerOrder)
    }
  })

  it('derives quantitySold from the paid orders and nothing else', () => {
    /** @type {Map<string, number>} */
    const expected = new Map(data.ticketTypes.map((type) => [type.id, 0]))

    for (const order of data.orders) {
      if (order.status !== 'PAID') continue
      for (const item of order.items) {
        expected.set(item.ticketTypeId, expected.get(item.ticketTypeId) + item.quantity)
      }
    }

    for (const type of data.ticketTypes) {
      expect(type.quantitySold).toBe(expected.get(type.id))
    }

    // A dataset where nothing sold would make this assertion vacuous.
    expect([...expected.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })

  it('never oversells an allocation', () => {
    for (const type of data.ticketTypes) {
      expect(type.quantitySold).toBeLessThanOrEqual(type.quantityTotal)
    }
  })

  it('marks a type SOLD_OUT only when it really is', () => {
    for (const type of data.ticketTypes) {
      if (type.status === 'SOLD_OUT') {
        expect(type.quantitySold).toBe(type.quantityTotal)
      }
      if (type.status === 'ON_SALE') {
        expect(type.quantitySold).toBeLessThan(type.quantityTotal)
      }
    }

    expect(data.ticketTypes.some((type) => type.status === 'SOLD_OUT')).toBe(true)
  })

  it('exercises more than one TicketTypeStatus', () => {
    const statuses = new Set(data.ticketTypes.map((type) => type.status))
    expect(statuses.size).toBeGreaterThanOrEqual(3)
  })
})

describe('seeded orders', () => {
  it('uses unique references and ticket codes', () => {
    const references = data.orders.map((order) => order.reference)
    expect(new Set(references).size).toBe(references.length)

    const codes = data.orders.flatMap((order) => order.tickets.map((ticket) => ticket.code))
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('covers every OrderStatus', () => {
    const statuses = new Set(data.orders.map((order) => order.status))
    expect(statuses).toEqual(new Set(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED']))
  })

  it('keeps every money column an integer that adds up', () => {
    for (const order of data.orders) {
      const itemSubtotal = order.items.reduce((sum, item) => sum + item.subtotalCents, 0)

      expect(order.subtotalCents).toBe(itemSubtotal)
      expect(order.totalCents).toBe(
        order.subtotalCents - order.discountCents + order.feesCents + order.taxCents,
      )
      expect(order.discountCents).toBeLessThanOrEqual(order.subtotalCents)

      for (const value of [
        order.subtotalCents,
        order.discountCents,
        order.feesCents,
        order.taxCents,
        order.totalCents,
      ]) {
        expect(Number.isInteger(value)).toBe(true)
        expect(value).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('computes each order item subtotal as quantity times unit price', () => {
    for (const order of data.orders) {
      for (const item of order.items) {
        expect(item.subtotalCents).toBe(item.quantity * item.unitPriceCents)
        expect(item.quantity).toBeGreaterThan(0)
      }
    }
  })

  it('buys only ticket types that belong to the order event', () => {
    const eventIdByTicketTypeId = new Map(data.ticketTypes.map((type) => [type.id, type.eventId]))

    for (const order of data.orders) {
      for (const item of order.items) {
        expect(eventIdByTicketTypeId.get(item.ticketTypeId)).toBe(order.eventId)
      }
    }
  })

  it('issues one ticket per seat on orders that have tickets', () => {
    for (const order of data.orders) {
      if (order.tickets.length === 0) continue
      const seats = order.items.reduce((sum, item) => sum + item.quantity, 0)
      expect(order.tickets).toHaveLength(seats)
    }
  })

  it('does not issue tickets for orders that never completed', () => {
    for (const order of data.orders) {
      if (order.status === 'PENDING' || order.status === 'EXPIRED') {
        expect(order.tickets).toHaveLength(0)
      }
    }
  })

  it('matches ticket status to order status', () => {
    const expectedByOrderStatus = {
      PAID: new Set(['VALID', 'CHECKED_IN']),
      CANCELLED: new Set(['VOID']),
      REFUNDED: new Set(['REFUNDED']),
    }

    for (const order of data.orders) {
      const allowed = expectedByOrderStatus[order.status]
      if (!allowed) continue
      for (const ticket of order.tickets) {
        expect(allowed).toContain(ticket.status)
      }
    }
  })

  it('stamps checkedInAt exactly on checked-in tickets', () => {
    const tickets = data.orders.flatMap((order) => order.tickets)
    expect(tickets.some((ticket) => ticket.status === 'CHECKED_IN')).toBe(true)

    for (const ticket of tickets) {
      if (ticket.status === 'CHECKED_IN') {
        expect(ticket.checkedInAt).toBeInstanceOf(Date)
      } else {
        expect(ticket.checkedInAt).toBeNull()
      }
    }
  })

  it('sets the lifecycle timestamps each status implies', () => {
    for (const order of data.orders) {
      if (order.status === 'PAID') {
        expect(order.paidAt).toBeInstanceOf(Date)
        expect(order.cancelledAt).toBeNull()
      }
      if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
        expect(order.cancelledAt).toBeInstanceOf(Date)
      }
      if (order.status === 'PENDING' || order.status === 'EXPIRED') {
        expect(order.expiresAt).toBeInstanceOf(Date)
        expect(order.paidAt).toBeNull()
      }
    }
  })

  it('leaves a PENDING order unexpired and an EXPIRED order expired', () => {
    const pending = data.orders.filter((order) => order.status === 'PENDING')
    const expired = data.orders.filter((order) => order.status === 'EXPIRED')

    expect(pending.length).toBeGreaterThan(0)
    expect(expired.length).toBeGreaterThan(0)

    for (const order of pending) expect(order.expiresAt.getTime()).toBeGreaterThan(NOW.getTime())
    for (const order of expired) expect(order.expiresAt.getTime()).toBeLessThan(NOW.getTime())
  })

  it('charges each payment the order total in the order currency', () => {
    for (const order of data.orders) {
      for (const payment of order.payments) {
        expect(payment.amountCents).toBe(order.totalCents)
        expect(payment.currency).toBe(order.currency)
      }
    }
  })

  it('uses unique provider references and covers every PaymentStatus', () => {
    const payments = data.orders.flatMap((order) => order.payments)
    const refs = payments.map((payment) => `${payment.provider}:${payment.providerRef}`)
    expect(new Set(refs).size).toBe(refs.length)

    const statuses = new Set(payments.map((payment) => payment.status))
    expect(statuses).toEqual(new Set(['INITIATED', 'SUCCEEDED', 'FAILED', 'REFUNDED']))
  })

  it('attaches a failureCode only to failed payments', () => {
    for (const payment of data.orders.flatMap((order) => order.payments)) {
      if (payment.status === 'FAILED') {
        expect(payment.failureCode).toBeTruthy()
      } else {
        expect(payment.failureCode).toBeNull()
      }
    }
  })
})

describe('seeded holds', () => {
  const holds = data.orders.filter((order) => order.hold).map((order) => order.hold)

  it('covers every HoldStatus', () => {
    const statuses = new Set(holds.map((hold) => hold.status))
    expect(statuses).toEqual(new Set(['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED']))
  })

  it('keeps an ACTIVE hold genuinely unexpired and an EXPIRED hold in the past', () => {
    for (const hold of holds) {
      if (hold.status === 'ACTIVE') {
        expect(hold.expiresAt.getTime()).toBeGreaterThan(NOW.getTime())
      }
      if (hold.status === 'EXPIRED') {
        expect(hold.expiresAt.getTime()).toBeLessThan(NOW.getTime())
      }
    }
  })

  it('holds a positive quantity', () => {
    for (const hold of holds) {
      expect(hold.quantity).toBeGreaterThan(0)
      expect(Number.isInteger(hold.quantity)).toBe(true)
    }
  })
})

describe('seeded promo codes', () => {
  it('includes both promo types', () => {
    const types = new Set(data.promoCodes.map((promo) => promo.type))
    expect(types).toEqual(new Set(['PERCENTAGE', 'FIXED_AMOUNT']))
  })

  it('keeps codes unique within an organisation', () => {
    const keys = data.promoCodes.map((promo) => `${promo.organizationId}:${promo.code}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('uses basis points for percentage codes and cents for fixed ones', () => {
    for (const promo of data.promoCodes) {
      expect(Number.isInteger(promo.value)).toBe(true)
      expect(promo.value).toBeGreaterThan(0)
      if (promo.type === 'PERCENTAGE') {
        expect(promo.value).toBeLessThanOrEqual(10_000)
      }
    }
  })

  it('derives redemptionCount from the orders that used the code', () => {
    const expected = new Map(data.promoCodes.map((promo) => [promo.id, 0]))

    for (const order of data.orders) {
      if (!order.promoCodeId) continue
      if (!['PAID', 'PENDING', 'REFUNDED'].includes(order.status)) continue
      expected.set(order.promoCodeId, expected.get(order.promoCodeId) + 1)
    }

    for (const promo of data.promoCodes) {
      expect(promo.redemptionCount).toBe(expected.get(promo.id))
      if (promo.maxRedemptions !== null) {
        expect(promo.redemptionCount).toBeLessThanOrEqual(promo.maxRedemptions)
      }
    }

    expect(data.promoCodes.some((promo) => promo.redemptionCount > 0)).toBe(true)
  })

  it('includes an inactive or lapsed code so filtering logic has something to reject', () => {
    const lapsed = data.promoCodes.filter(
      (promo) => !promo.active || (promo.endsAt && promo.endsAt < NOW),
    )
    expect(lapsed.length).toBeGreaterThan(0)
  })

  it('scopes event-specific codes to an event the organisation owns', () => {
    const orgIdByEventId = new Map(data.events.map((event) => [event.id, event.organizationId]))

    for (const promo of data.promoCodes) {
      if (!promo.eventId) continue
      expect(orgIdByEventId.get(promo.eventId)).toBe(promo.organizationId)
    }
  })
})

describe('determinism', () => {
  it('produces identical rows for the same instant, apart from password salts', () => {
    const again = buildSeedData(NOW)

    const strip = (seed) => ({
      ...seed,
      users: seed.users.map(({ passwordHash: _hash, ...rest }) => rest),
    })

    expect(JSON.stringify(strip(again))).toBe(JSON.stringify(strip(data)))
  })

  it('shifts every timestamp when the anchor day changes', () => {
    const tomorrow = buildSeedData(new Date(NOW.getTime() + 86_400_000))
    const before = data.events.find((event) => event.slug === 'mumbai-sufi-nights')
    const after = tomorrow.events.find((event) => event.slug === 'mumbai-sufi-nights')

    expect(after.startsAt.getTime() - before.startsAt.getTime()).toBe(86_400_000)
  })
})

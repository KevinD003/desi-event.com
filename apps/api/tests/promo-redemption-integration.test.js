/**
 * Promo codes against a real database: the redemption cap under concurrency,
 * the table's own CHECKs, and a delete racing a checkout.
 *
 * The stub serialises every write, so a race there proves nothing. Here twelve
 * checkouts really do run at once against a code with three uses left, and the
 * claim is exact: three orders get the discount, and the count stops at three.
 * The lock order (tiers, then nights, then the code) is what makes it hold
 * without deadlocking; the `promo_code_redemptions_within_cap` CHECK is the
 * backstop if a future path forgets the lock.
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/promo-redemption-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, reachable, when } = await connectTestDatabase('the promo redemption suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256')
    .update(`promo-redemption-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

let app
let world

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    // Payment ids carry the run: \`Payment.provider + providerRef\` is unique,
    // and other suites on this database mint ids from the same counter.
    providers: createInMemoryProviderRegistry({ payments: { idPrefix: `pipromo${RUN}` } }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Promo race ${RUN}`,
      slug: `promo-race-${RUN}`,
      contactEmail: `hello-${RUN}@promo-race.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `Promo Hall ${RUN}`,
      slug: `promo-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      organizationId: organization.id,
    },
  })
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 4 * 60 * 60 * 1000)
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Promo race ${RUN}`,
      slug: `promo-race-event-${RUN}`,
      summary: 'Seeded for the promo redemption suite.',
      description: 'Seeded for the promo redemption suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status: 'ON_SALE',
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      publishedAt: new Date(),
      salesOpenedAt: new Date(),
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const session = await prisma.eventSession.create({
    data: {
      id: id('session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      capacity: 500,
    },
  })
  const tier = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: `General ${RUN}`,
      priceCents: 4000,
      currency: 'USD',
      quantityTotal: 400,
      maxPerOrder: 10,
      status: 'ON_SALE',
      eventSessionId: session.id,
    },
  })
  const owner = await prisma.user.create({
    data: {
      id: id('owner'),
      email: `owner-${RUN}@promo-race.example`,
      displayName: 'Owner',
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      id: id('factor'),
      userId: owner.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })
  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  const memberships = await prisma.membership.findMany({ where: { userId: owner.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: owner.id, role: owner.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'promo-redemption-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  world = { organization, event, tier, owner, headers: { authorization: `Bearer ${secret}` } }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * A promo code for the suite's organisation.
 *
 * @param {object} [overrides] Columns to set.
 * @returns {Promise<object>} The row.
 */
function promo(overrides = {}) {
  return prisma.promoCode.create({
    data: {
      id: id('promo'),
      organizationId: world.organization.id,
      eventId: world.event.id,
      code: `RACE${sequence}${RUN}`.toUpperCase().slice(0, 32),
      type: 'PERCENTAGE',
      value: 2000,
      ...overrides,
    },
  })
}

/**
 * Place a guest order for one ticket.
 *
 * @param {object} [body] Extra order fields.
 * @returns {Promise<object>} The inject result.
 */
function order(body = {}) {
  sequence += 1

  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: world.event.id,
      buyerEmail: `buyer-${sequence}-${RUN}@promo-race.example`,
      buyerName: 'Race Buyer',
      items: [{ ticketTypeId: world.tier.id, quantity: 1 }],
      ...body,
    },
  })
}

when()('a promo code on a real database', () => {
  it('gives exactly as many discounts as the code has uses, however many buyers race', async () => {
    const code = await promo({ maxRedemptions: 3 })

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => order({ promoCode: code.code })),
    )

    // Nobody is refused: a code used up by the time the lock is reached means
    // full price for an API client that sent no expected total.
    expect(responses.map((response) => response.statusCode)).toEqual(Array(12).fill(201))

    const discounted = responses.filter((response) => response.json().data.discountCents > 0)
    expect(discounted).toHaveLength(3)

    const orders = await prisma.order.findMany({ where: { promoCodeId: code.id } })
    expect(orders).toHaveLength(3)

    const after = await prisma.promoCode.findUnique({ where: { id: code.id } })
    expect(after.redemptionCount).toBe(3)
  })

  it('refuses, with nothing charged, every buyer promised a discount the code no longer has', async () => {
    const code = await promo({ maxRedemptions: 3 })

    const quote = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers: world.headers,
      payload: {
        eventId: world.event.id,
        items: [{ ticketTypeId: world.tier.id, quantity: 1 }],
        promoCode: code.code,
      },
    })
    expect(quote.statusCode).toBe(200)

    const expectedTotalCents = quote.json().data.totalCents
    const before = await prisma.order.count({ where: { eventId: world.event.id } })

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => order({ promoCode: code.code, expectedTotalCents })),
    )

    const statuses = responses.map((response) => response.statusCode).sort()
    expect(statuses.filter((status) => status === 201)).toHaveLength(3)
    expect(statuses.filter((status) => status === 409)).toHaveLength(9)

    for (const refused of responses.filter((response) => response.statusCode === 409)) {
      expect(refused.json().error.code).toBe('PRICE_CHANGED')
    }

    expect(await prisma.order.count({ where: { eventId: world.event.id } })).toBe(before + 3)
    expect((await prisma.promoCode.findUnique({ where: { id: code.id } })).redemptionCount).toBe(3)
  })

  it('refuses a count past the cap written directly, whatever the application forgets', async () => {
    const code = await promo({ maxRedemptions: 2, redemptionCount: 2 })

    await expect(
      prisma.promoCode.update({ where: { id: code.id }, data: { redemptionCount: 3 } }),
    ).rejects.toThrow(/promo_code_redemptions_within_cap/)

    await expect(
      prisma.promoCode.update({ where: { id: code.id }, data: { redemptionCount: -1 } }),
    ).rejects.toThrow(/promo_code_redemptions_within_cap/)
  })

  it('refuses rows whose terms cannot work', async () => {
    await expect(promo({ currency: 'USD' })).rejects.toThrow(
      /promo_code_percentage_has_no_currency/,
    )
    await expect(promo({ value: 10_001 })).rejects.toThrow(/promo_code_value_in_range/)
    await expect(promo({ type: 'FIXED_AMOUNT', value: -5, currency: 'USD' })).rejects.toThrow(
      /promo_code_value_in_range/,
    )
    await expect(
      promo({ startsAt: new Date('2027-01-02'), endsAt: new Date('2027-01-01') }),
    ).rejects.toThrow(/promo_code_window_ordered/)
    await expect(promo({ maxRedemptions: 0 })).rejects.toThrow(/promo_code_redemptions_within_cap/)
  })

  it('never leaves an order pointing at a code a racing delete removed', async () => {
    for (let round = 0; round < 5; round += 1) {
      const code = await promo({ maxRedemptions: 5 })

      const [placed, removed] = await Promise.all([
        order({ promoCode: code.code }),
        app.inject({
          method: 'DELETE',
          url: `/v1/organizations/${world.organization.id}/promo-codes/${code.id}`,
          headers: world.headers,
        }),
      ])

      const row = await prisma.promoCode.findUnique({ where: { id: code.id } })

      if (removed.statusCode === 200) {
        // Deleted first: the checkout found no such code, and was refused as
        // an unknown one, or never saw it at all.
        expect(row).toBeNull()
        expect([201, 422]).toContain(placed.statusCode)
        if (placed.statusCode === 201) expect(placed.json().data.discountCents).toBe(0)
      } else {
        // Used first: the code stays, used once, and the delete says why.
        expect(removed.statusCode).toBe(409)
        expect(removed.json().error.code).toBe('PROMO_IN_USE')
        expect(placed.statusCode).toBe(201)
        expect(row.redemptionCount).toBe(1)
      }

      if (placed.statusCode === 201) {
        const stored = await prisma.order.findUnique({
          where: { id: placed.json().data.id },
          select: { promoCodeId: true },
        })

        expect(stored.promoCodeId === null || stored.promoCodeId === code.id).toBe(true)
        if (stored.promoCodeId) expect(row).not.toBeNull()
      }
    }
  })

  it('writes nothing for a quote: no order, no redemption', async () => {
    const code = await promo({ maxRedemptions: 1 })
    const orders = await prisma.order.count({ where: { eventId: world.event.id } })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers: world.headers,
      payload: {
        eventId: world.event.id,
        items: [{ ticketTypeId: world.tier.id, quantity: 2 }],
        promoCode: code.code,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.promo).toMatchObject({ applied: true, percentBps: 2000 })
    expect(await prisma.order.count({ where: { eventId: world.event.id } })).toBe(orders)
    expect((await prisma.promoCode.findUnique({ where: { id: code.id } })).redemptionCount).toBe(0)
  })
})

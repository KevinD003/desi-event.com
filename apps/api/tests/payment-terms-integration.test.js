/**
 * An event's booking fee and its pay-at-the-venue switch against a real
 * database (SPEC3 §14.3): a fee changed during a checkout, a fee changed
 * between pricing and the order's insert, two administrators saving at once,
 * an organiser's tier racing a fee change (DF3), the decision record's
 * append-only trigger reaching a caller, a deleted event's restore, and an
 * Ontario event's tax on a booking paid at the venue.
 *
 * The rule under test is "new orders only": an order records the terms it was
 * priced with, for good, and a change reaches only orders priced after it. The
 * fee setters take `FOR NO KEY UPDATE` on the event, which an order's insert
 * (its foreign key's `FOR KEY SHARE`) does not wait for (SPEC3-XI M11).
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/payment-terms-integration
 */

import { createHash } from 'node:crypto'

import { applyBps } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { databaseRefusal } from '../src/lib/errors.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { createFeeEvent } from './helpers/fee-orders.js'
import { holdRow, waitingOn } from './helpers/row-locks.js'

/**
 * A barrier between `priceCheckout` and the order's insert: armed, the next
 * charge (`lock: true`) that has been priced stops there until it is opened.
 */
const barrier = vi.hoisted(() => ({ armed: false, reached: null, gate: null }))

vi.mock('../src/lib/checkout-pricing.js', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    async priceCheckout(tx, options) {
      const priced = await actual.priceCheckout(tx, options)

      if (barrier.armed && options.lock) {
        barrier.armed = false
        barrier.reached()
        await barrier.gate
      }

      return priced
    },
  }
})

const { prisma, reachable, when } = await connectTestDatabase('the payment terms suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** A reason inside every 10-500 character bound. */
const REASON = 'Agreed with the organiser for this event.'

/** The site default for USD in the test environment. */
const SITE_DEFAULT = Object.freeze({ percentageBps: 590, flatCentsPerTicket: 99 })

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
    .update(`payment-terms-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A tag unique to this run and this call, for slugs and references.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Wait until `count` backends queue behind a held row, directly or behind one
 * another (PostgreSQL queues the second waiter for a row on the first).
 *
 * @param {number} holderPid The holder's backend.
 * @param {number} count How many waiters to wait for.
 * @param {string} what What is being waited for, for the failure message.
 * @returns {Promise<number[]>} The waiters, in the order they were seen.
 * @throws {Error} After ten seconds without them.
 */
async function untilQueued(holderPid, count, what) {
  const deadline = Date.now() + 10_000
  const queue = []

  while (Date.now() < deadline) {
    const waiting = await waitingOn(prisma, [holderPid, ...queue])

    for (const pid of waiting) if (!queue.includes(pid)) queue.push(pid)

    if (queue.length >= count) return queue

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`Never saw ${what} queued behind the held row within ten seconds.`)
}

let app
let admins

/**
 * A user with a session, as sign-in leaves one.
 *
 * @param {string} label Distinguishes it.
 * @param {string} [role] The platform role.
 * @returns {Promise<{user: object, headers: object}>} The account and its request headers.
 */
async function account(label, role = 'ATTENDEE') {
  const user = await prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${RUN}@payment-terms.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (role !== 'ATTENDEE') {
    await prisma.mfaFactor.create({
      data: {
        id: id('factor'),
        userId: user.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  const { secret } = await startSession(prisma, {
    actor: { id: user.id, role: user.role, memberships: [] },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'payment-terms-suite-pseudonymisation-key',
    mfaSatisfied: role !== 'ATTENDEE',
  })

  return { user, headers: { authorization: `Bearer ${secret}` } }
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry({ payments: { idPrefix: `piterm${RUN}` } }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      quote: { max: 10_000, timeWindow: '1 minute' },
      paymentTerms: { max: 10_000, timeWindow: '1 minute' },
    },
  })

  // A code path that edits or removes a decision after the fact, as a future
  // bug might: the trigger refuses it, and the app's own error handler answers.
  app.post('/suite/fee-settings/:id/edit', async (request) => {
    await prisma.$executeRaw`UPDATE "EventFeeSetting" SET "reason" = ${'Rewritten after the fact by the suite.'} WHERE "id" = ${request.params.id}`

    return { data: null }
  })
  app.post('/suite/fee-settings/:id/remove', async (request) => {
    await prisma.$executeRaw`DELETE FROM "EventFeeSetting" WHERE "id" = ${request.params.id}`

    return { data: null }
  })

  await app.ready()

  admins = [await account('admina', 'ADMIN'), await account('adminb', 'ADMIN')]
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * Set an event's booking fee through `paymentTerms.setFee`.
 *
 * @param {string} eventId The event.
 * @param {object} body The request, without its reason.
 * @param {object} [by] The administrator; the first unless told.
 * @returns {Promise<object>} The inject result.
 */
function setFee(eventId, body, by = admins[0]) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/platform-fee`,
    headers: by.headers,
    payload: { reason: REASON, ...body },
  })
}

/**
 * Switch paying at the venue through `paymentTerms.setVenuePayment`.
 *
 * @param {string} eventId The event.
 * @param {object} body `enabled`, `limit` and `seen`.
 * @returns {Promise<object>} The inject result.
 */
function setVenue(eventId, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/venue-payment`,
    headers: admins[0].headers,
    payload: { reason: REASON, ...body },
  })
}

/**
 * Read an event's payment terms through `paymentTerms.get`.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object>} The `data`.
 */
async function termsOf(eventId) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/platform/events/${eventId}/payment-terms`,
    headers: admins[0].headers,
  })

  expect(response.statusCode, response.body).toBe(200)

  return response.json().data
}

/**
 * The basket a buyer prices or orders: tickets of one tier.
 *
 * @param {object} world The event.
 * @param {object} [options] Options.
 * @param {string} [options.tierId] The tier; the balcony unless told.
 * @param {number} [options.quantity] How many.
 * @returns {object} `eventId` and `items`.
 */
function basket(world, { tierId = world.tiers.balcony.id, quantity = 1 } = {}) {
  return { eventId: world.event.id, items: [{ ticketTypeId: tierId, quantity }] }
}

/**
 * Price a basket through `orders.quote`.
 *
 * @param {object} buyer From {@link account}.
 * @param {object} world The event.
 * @param {object} [extra] Extra request fields.
 * @param {string} [extra.tierId] The tier; the balcony unless told.
 * @param {number} [extra.quantity] How many.
 * @returns {Promise<object>} The quote's `data`.
 */
async function quote(buyer, world, { tierId, quantity, ...extra } = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/orders/quote',
    headers: buyer.headers,
    payload: { ...basket(world, { tierId, quantity }), ...extra },
  })

  expect(response.statusCode, response.body).toBe(200)

  return response.json().data
}

/**
 * Place an order through `orders.create`.
 *
 * @param {object} buyer From {@link account}.
 * @param {object} world The event.
 * @param {object} [extra] Extra request fields.
 * @param {string} [extra.tierId] The tier; the balcony unless told.
 * @param {number} [extra.quantity] How many.
 * @returns {Promise<object>} The inject result.
 */
function order(buyer, world, { tierId, quantity, ...extra } = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: buyer.headers,
    payload: {
      ...basket(world, { tierId, quantity }),
      buyerEmail: buyer.user.email,
      buyerName: buyer.user.displayName,
      ...extra,
    },
  })
}

/**
 * An event's newest fee decision.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object|null>} The `EventFeeSetting` row.
 */
function newestDecision(eventId) {
  return prisma.eventFeeSetting.findFirst({ where: { eventId }, orderBy: { sequence: 'desc' } })
}

when()('a booking fee changed during a checkout', () => {
  it('refuses the order priced before the change, prices the next at the new terms, and leaves earlier orders as they were', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('during') })
    const buyer = await account('during')

    const earlier = await order(buyer, world)

    expect(earlier.statusCode, earlier.body).toBe(201)

    const before = await quote(buyer, world)
    const siteFee = applyBps(2_000, SITE_DEFAULT.percentageBps) + SITE_DEFAULT.flatCentsPerTicket

    expect(before.feesCents).toBe(siteFee)

    const changed = await setFee(world.event.id, {
      source: 'EVENT',
      percentageBps: 1_000,
      flatCentsPerTicket: 150,
      expectedSequence: 0,
    })

    expect(changed.statusCode, changed.body).toBe(200)

    const newFee = applyBps(2_000, 1_000) + 150
    const refused = await order(buyer, world, { expectedTotalCents: before.totalCents })

    expect(refused.statusCode, refused.body).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'PRICE_CHANGED',
      details: { totalCents: 2_000 + newFee, feesCents: newFee },
    })
    expect(await prisma.order.count({ where: { userId: buyer.user.id } })).toBe(1)

    const after = await quote(buyer, world)

    expect(after.totalCents).toBe(2_000 + newFee)

    const placed = await order(buyer, world, { expectedTotalCents: after.totalCents })

    expect(placed.statusCode, placed.body).toBe(201)

    const decision = await newestDecision(world.event.id)
    const stored = await prisma.order.findUnique({ where: { id: placed.json().data.id } })

    expect(stored).toMatchObject({
      feeSource: 'EVENT',
      feeSettingId: decision.id,
      feePercentageBps: 1_000,
      feeFlatCentsPerTicket: 150,
      feesCents: newFee,
      feeGrossCents: newFee,
    })

    // The order placed before the change keeps what it was priced with.
    const kept = await prisma.order.findUnique({ where: { id: earlier.json().data.id } })

    expect(kept).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      feeSettingId: null,
      feePercentageBps: SITE_DEFAULT.percentageBps,
      feeFlatCentsPerTicket: SITE_DEFAULT.flatCentsPerTicket,
      feesCents: siteFee,
    })

    const read = await app.inject({
      method: 'GET',
      url: `/v1/orders/${kept.reference}`,
      headers: buyer.headers,
    })

    expect(read.statusCode, read.body).toBe(200)
    expect(read.json().data).toMatchObject({ feesCents: siteFee, fee: SITE_DEFAULT })
  })
})

when()('a booking fee changed between pricing and the order’s insert', () => {
  it('lets the change commit while the checkout waits, and the checkout keeps the terms it priced with', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('between') })
    const buyer = await account('between')
    const first = await setFee(world.event.id, {
      source: 'EVENT',
      percentageBps: 700,
      flatCentsPerTicket: 120,
      expectedSequence: 0,
    })

    expect(first.statusCode, first.body).toBe(200)

    const termsA = await newestDecision(world.event.id)

    let reached
    let open
    const atBarrier = new Promise((resolve) => {
      reached = resolve
    })

    barrier.gate = new Promise((resolve) => {
      open = resolve
    })
    barrier.reached = reached
    barrier.armed = true

    const placing = order(buyer, world)
    let changed

    try {
      await atBarrier

      // The checkout holds its tier and its night, and nothing on the event:
      // the setter's FOR NO KEY UPDATE goes straight through.
      changed = await setFee(world.event.id, {
        source: 'EVENT',
        percentageBps: 1_200,
        flatCentsPerTicket: 50,
        expectedSequence: 1,
      })
    } finally {
      barrier.armed = false
      open()
    }

    expect(changed.statusCode, changed.body).toBe(200)

    const placed = await placing

    expect(placed.statusCode, placed.body).toBe(201)

    const stored = await prisma.order.findUnique({ where: { id: placed.json().data.id } })

    expect(stored).toMatchObject({
      feeSource: 'EVENT',
      feeSettingId: termsA.id,
      feePercentageBps: 700,
      feeFlatCentsPerTicket: 120,
      feesCents: applyBps(2_000, 700) + 120,
    })
    expect(stored.pricingSnapshot.fee).toMatchObject({
      source: 'EVENT',
      settingId: termsA.id,
      percentageBps: 700,
      flatCentsPerTicket: 120,
    })

    const next = await quote(buyer, world)

    expect(next.feesCents).toBe(applyBps(2_000, 1_200) + 50)
    expect((await newestDecision(world.event.id)).sequence).toBe(2)
  })

  it('places an order while the event’s row is held as the fee setters hold it', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('nokey') })
    const buyer = await account('nokey')
    const held = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR NO KEY UPDATE' })

    let placed

    try {
      placed = await Promise.race([
        order(buyer, world),
        new Promise((resolve) => {
          setTimeout(() => resolve({ statusCode: 'still waiting on the event row' }), 8_000)
        }),
      ])
    } finally {
      held.release()
      await held.done
    }

    expect(placed.statusCode, placed.body).toBe(201)
    expect(placed.json().data.status).toBe('PAID')
  })

  it('places an order while a fee change is in flight on the event, holding its row', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('inflight') })
    const buyer = await account('inflight')

    // The administrator's account row, held: the change takes the event's row,
    // then stops at its decision's insert (whose foreign key names the
    // administrator) with the event's row still held.
    let release
    let held
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const holding = new Promise((resolve) => {
      held = resolve
    })
    const done = prisma.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${admins[1].user.id} FOR UPDATE`
        held(pid)
        await gate
      },
      { timeout: 20_000, maxWait: 10_000 },
    )
    const holderPid = await holding

    let changing
    let placed

    try {
      changing = setFee(
        world.event.id,
        { source: 'EVENT', percentageBps: 300, flatCentsPerTicket: 40, expectedSequence: 0 },
        admins[1],
      )

      await untilQueued(holderPid, 1, 'the fee change')

      placed = await Promise.race([
        order(buyer, world),
        new Promise((resolve) => {
          setTimeout(() => resolve({ statusCode: 'still waiting on the event row' }), 8_000)
        }),
      ])
    } finally {
      release()
      await done
    }

    expect(placed.statusCode, placed.body).toBe(201)

    // Priced before the change committed: the site default.
    expect(await prisma.order.findUnique({ where: { id: placed.json().data.id } })).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      feeSettingId: null,
    })

    const changed = await changing

    expect(changed.statusCode, changed.body).toBe(200)
  })
})

when()('two administrators saving one event’s fee at once', () => {
  it('saves one and refuses the other, which read the same decision', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('twoadmins') })
    const held = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR NO KEY UPDATE' })
    const racing = [
      setFee(
        world.event.id,
        { source: 'EVENT', percentageBps: 800, flatCentsPerTicket: 100, expectedSequence: 0 },
        admins[0],
      ),
      setFee(
        world.event.id,
        { source: 'EVENT', percentageBps: 900, flatCentsPerTicket: 100, expectedSequence: 0 },
        admins[1],
      ),
    ]

    try {
      await untilQueued(held.pid, 2, 'both administrators')
    } finally {
      held.release()
      await held.done
    }

    const responses = await Promise.all(racing)

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409])

    const refused = responses.find((response) => response.statusCode === 409)

    expect(refused.json().error).toMatchObject({
      code: 'PAYMENT_TERMS_CHANGED',
      details: { currentSequence: 1 },
    })
    expect(await prisma.eventFeeSetting.count({ where: { eventId: world.event.id } })).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { entityId: world.event.id, action: 'event.platform_fee_changed' },
      }),
    ).toBe(1)

    const saved = await prisma.event.findUnique({ where: { id: world.event.id } })
    const winner = responses.indexOf(responses.find((response) => response.statusCode === 200))

    expect(saved.feePercentageBps).toBe(winner === 0 ? 800 : 900)
  })
})

when()('the decision record behind an event’s fee', () => {
  it('answers an edit or a removal of a decision with 409, never 500, and keeps it as it was', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('appendonly') })
    const saved = await setFee(world.event.id, {
      source: 'EVENT',
      percentageBps: 400,
      flatCentsPerTicket: 60,
      expectedSequence: 0,
    })

    expect(saved.statusCode, saved.body).toBe(200)

    const decision = await newestDecision(world.event.id)

    for (const path of ['edit', 'remove']) {
      const response = await app.inject({
        method: 'POST',
        url: `/suite/fee-settings/${decision.id}/${path}`,
      })

      expect(response.statusCode, response.body).toBe(409)
      expect(response.json().error.code).toBe('PAYMENT_TERMS_CHANGED')
      expect(response.body).not.toMatch(/event_fee_setting_append_only|trigger|SQL|23514/u)
    }

    const error = await prisma.eventFeeSetting
      .update({ where: { id: decision.id }, data: { percentageBps: 1 } })
      .catch((thrown) => thrown)

    expect(databaseRefusal(error)).toMatchObject({
      statusCode: 409,
      code: 'PAYMENT_TERMS_CHANGED',
    })
    expect(await prisma.eventFeeSetting.findUnique({ where: { id: decision.id } })).toEqual(
      decision,
    )
  })
})

/**
 * A draft event with no tiers, or one tier, of an organisation paid out in
 * dollars, and an organiser who owns it: what an organiser's tier edit and the
 * Desi-Event team's fee change race over.
 *
 * @param {string} label Distinguishes it.
 * @param {object} [options] Options.
 * @param {boolean} [options.withTier] Give it one draft tier in USD.
 * @returns {Promise<object>} `{ event, tier, organiser }`: the event, its tier (null without one) and the owner.
 */
async function draftWithOrganiser(label, { withTier = false } = {}) {
  const slug = tag(label)
  const organization = await prisma.organization.create({
    data: {
      name: `Tier Race ${slug}`,
      slug: `tier-race-${slug}`,
      contactEmail: `owner-${slug}@payment-terms.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
      payoutCurrency: 'USD',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      organizationId: organization.id,
      name: `Tier Race Hall ${slug}`,
      slug: `tier-race-hall-${slug}`,
      addressLine1: '1 Test Road',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Tier Race Night ${slug}`,
      slug: `tier-race-night-${slug}`,
      category: 'MUSIC_CONCERT',
      summary: 'A draft an organiser prices while its fee is set.',
      description: 'Built by the payment terms suite.',
      status: 'DRAFT',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      timezone: 'America/Chicago',
    },
  })
  const tier = withTier
    ? await prisma.ticketType.create({
        data: {
          eventId: event.id,
          name: 'General',
          priceCents: 4_000,
          currency: 'USD',
          quantityTotal: 50,
          status: 'DRAFT',
        },
      })
    : null

  const user = await prisma.user.create({
    data: {
      id: id(`user-owner-${label}`),
      email: `owner-${slug}@payment-terms.example`,
      displayName: `Owner ${slug}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })

  await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
  })
  await prisma.mfaFactor.create({
    data: {
      id: id('factor'),
      userId: user.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  const { secret } = await startSession(prisma, {
    actor: { id: user.id, role: user.role, memberships: [] },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'payment-terms-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { event, tier, organiser: { user, headers: { authorization: `Bearer ${secret}` } } }
}

/** The fee the Desi-Event team sets in these races: its currency comes from the event. */
const RACE_FEE = Object.freeze({
  source: 'EVENT',
  percentageBps: 1_000,
  flatCentsPerTicket: 300,
  expectedSequence: 0,
})

/**
 * The organiser's three ways of pricing a tier in Canadian dollars, each as
 * an inject against the event.
 */
const CAD_TIER_WRITES = Object.freeze({
  'events.addTicketType': ({ event }) => ({
    method: 'POST',
    url: `/v1/events/${event.id}/tiers`,
    payload: {
      revision: event.revision,
      name: 'Loonie seats',
      priceCents: 4_000,
      currency: 'CAD',
      quantityTotal: 50,
    },
  }),
  'ticketTypes.create': ({ event }) => ({
    method: 'POST',
    url: `/v1/events/${event.id}/ticket-types`,
    payload: {
      eventId: event.id,
      name: 'Loonie seats',
      priceCents: 4_000,
      currency: 'CAD',
      quantityTotal: 50,
    },
  }),
  'events.updateTicketType': ({ event, tier }) => ({
    method: 'PATCH',
    url: `/v1/events/${event.id}/tiers/${tier.id}`,
    payload: { revision: event.revision, currency: 'CAD' },
  }),
})

when()('an organiser’s tier racing a fee change (DF3)', () => {
  for (const [route, write] of Object.entries(CAD_TIER_WRITES)) {
    const withTier = route === 'events.updateTicketType'

    it(`${route}: the fee saved first refuses a tier in another currency read before it, and the fee keeps applying`, async () => {
      const world = await draftWithOrganiser(`feefirst${route.split('.')[1]}`, { withTier })
      const held = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR NO KEY UPDATE' })
      let fee
      let tier

      try {
        // The fee change queues on the event's row first; the organiser's
        // request reads the event (still on the site default), passes its
        // checks there, and queues behind it.
        fee = setFee(world.event.id, RACE_FEE)
        await untilQueued(held.pid, 1, 'the fee change')
        tier = app.inject({ ...write(world), headers: world.organiser.headers })
        await untilQueued(held.pid, 2, `the organiser’s ${route}`)
      } finally {
        held.release()
        await held.done
      }

      const [feeResponse, tierResponse] = await Promise.all([fee, tier])

      expect(feeResponse.statusCode, feeResponse.body).toBe(200)
      expect(tierResponse.statusCode, tierResponse.body).toBe(409)
      expect(tierResponse.json().error).toMatchObject({
        code: 'FEE_TERMS_CURRENCY',
        message:
          "The Desi-Event team set this event's booking fee in USD. Ask them to change it before pricing tickets in another currency.",
      })

      // The event sells in the fee's currency: no tier in another, the
      // revision the refused write took back, and the fee still its own.
      const after = await prisma.event.findUnique({
        where: { id: world.event.id },
        select: {
          revision: true,
          feeSource: true,
          feeCurrency: true,
          ticketTypes: { select: { currency: true } },
        },
      })

      expect(after).toMatchObject({
        revision: world.event.revision,
        feeSource: 'EVENT',
        feeCurrency: 'USD',
      })
      expect(after.ticketTypes.map((row) => row.currency)).toEqual(withTier ? ['USD'] : [])
      expect(
        await prisma.auditLog.count({
          where: {
            entityId: world.event.id,
            action: { in: ['event.ticket_type_added', 'event.ticket_type_updated'] },
          },
        }),
      ).toBe(0)
    })

    it(`${route}: the tier saved first is what the fee change prices in`, async () => {
      const world = await draftWithOrganiser(`tierfirst${route.split('.')[1]}`, { withTier })
      const held = await holdRow(prisma, 'Event', world.event.id, { mode: 'FOR NO KEY UPDATE' })
      let fee
      let tier

      try {
        tier = app.inject({ ...write(world), headers: world.organiser.headers })
        await untilQueued(held.pid, 1, `the organiser’s ${route}`)
        fee = setFee(world.event.id, RACE_FEE)
        await untilQueued(held.pid, 2, 'the fee change')
      } finally {
        held.release()
        await held.done
      }

      const [feeResponse, tierResponse] = await Promise.all([fee, tier])

      expect(tierResponse.statusCode, tierResponse.body).toBe(withTier ? 200 : 201)
      expect(feeResponse.statusCode, feeResponse.body).toBe(200)

      // The fee change read the tier under the same row, so its own fee is in
      // the currency the event now sells in.
      const after = await prisma.event.findUnique({
        where: { id: world.event.id },
        select: { feeSource: true, feeCurrency: true, ticketTypes: { select: { currency: true } } },
      })

      expect(after).toMatchObject({ feeSource: 'EVENT', feeCurrency: 'CAD' })
      expect(after.ticketTypes.map((row) => row.currency)).toEqual(['CAD'])
    })
  }
})

when()('a deleted event restored', () => {
  it('comes back with its booking fee, its switch and its limit', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('restore') })
    const fee = await setFee(world.event.id, {
      source: 'EVENT',
      percentageBps: 650,
      flatCentsPerTicket: 80,
      expectedSequence: 0,
    })
    const venue = await setVenue(world.event.id, {
      enabled: true,
      limit: 7,
      seen: { enabled: false, limit: null },
    })

    expect(fee.statusCode, fee.body).toBe(200)
    expect(venue.statusCode, venue.body).toBe(200)

    const before = await prisma.event.findUnique({ where: { id: world.event.id } })
    const termsBefore = await termsOf(world.event.id)

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/events/${world.event.id}/deletion`,
      headers: admins[0].headers,
    })

    expect(preview.statusCode, preview.body).toBe(200)

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${world.event.id}/delete`,
      headers: admins[0].headers,
      payload: {
        revision: preview.json().data.revision,
        reason: 'Removed by the suite before it is restored.',
        confirmSlug: before.slug,
        expectedOutcome: preview.json().data.outcome,
      },
    })

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect((await prisma.event.findUnique({ where: { id: world.event.id } })).status).toBe(
      'DELETED',
    )

    const gone = await prisma.event.findUnique({ where: { id: world.event.id } })
    const restored = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${world.event.id}/restore`,
      headers: admins[0].headers,
      payload: { revision: gone.revision, reason: 'Restored by the suite after the check.' },
    })

    expect(restored.statusCode, restored.body).toBe(200)

    const after = await prisma.event.findUnique({ where: { id: world.event.id } })

    expect(after.status).not.toBe('DELETED')
    expect(after).toMatchObject({
      feeSource: 'EVENT',
      feePercentageBps: 650,
      feeFlatCentsPerTicket: 80,
      feeCurrency: before.feeCurrency,
      feeSettingId: before.feeSettingId,
      venuePaymentEnabled: true,
      venuePaymentLimit: 7,
    })
    expect(await prisma.eventFeeSetting.count({ where: { eventId: world.event.id } })).toBe(1)
    expect(await prisma.eventVenuePaymentChange.count({ where: { eventId: world.event.id } })).toBe(
      1,
    )

    const termsAfter = await termsOf(world.event.id)

    expect(termsAfter.fee).toEqual(termsBefore.fee)
    expect(termsAfter.venuePayment).toMatchObject({ enabled: true, limit: 7 })
  })
})

when()('an Ontario event, booked to pay at the venue and by card', () => {
  it('records no tax on a booking paid at the venue, with its snapshot, and 13% on a card order', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('ontario') })

    await prisma.venue.update({
      where: { id: world.venue.id },
      data: {
        city: 'Toronto',
        region: 'ON',
        postalCode: 'M5V 2T6',
        country: 'CA',
        timezone: 'America/Toronto',
      },
    })

    const tier = await prisma.ticketType.create({
      data: {
        id: id('tier'),
        eventId: world.event.id,
        eventSessionId: world.session.id,
        name: `Forty ${RUN}`,
        priceCents: 4_000,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const switched = await setVenue(world.event.id, {
      enabled: true,
      limit: 10,
      seen: { enabled: false, limit: null },
    })

    expect(switched.statusCode, switched.body).toBe(200)

    const buyer = await account('ontario')
    const fee = applyBps(4_000, SITE_DEFAULT.percentageBps) + SITE_DEFAULT.flatCentsPerTicket

    expect(fee).toBe(335)

    const atVenue = await order(buyer, world, { tierId: tier.id, paymentMethod: 'AT_VENUE' })

    expect(atVenue.statusCode, atVenue.body).toBe(201)

    const booked = await prisma.order.findUnique({ where: { id: atVenue.json().data.id } })

    expect(booked).toMatchObject({
      paymentMethod: 'AT_VENUE',
      taxCents: 0,
      feesCents: 335,
      totalCents: 335,
      venueDueCents: 4_000,
    })
    expect(booked.pricingSnapshot).toMatchObject({
      paymentMethod: 'AT_VENUE',
      tax: {
        rateBps: 1_300,
        applied: false,
        appliedTo: 'NOTHING',
        notAppliedReason: 'PAID_AT_VENUE',
      },
      fee: { source: 'SITE_DEFAULT', chargedCents: 335 },
    })

    const card = await order(buyer, world, { tierId: tier.id })

    expect(card.statusCode, card.body).toBe(201)

    const paid = await prisma.order.findUnique({ where: { id: card.json().data.id } })

    expect(paid).toMatchObject({
      paymentMethod: 'CARD',
      taxCents: applyBps(4_000 + 335, 1_300),
      totalCents: 4_000 + 335 + applyBps(4_000 + 335, 1_300),
      venueDueCents: 0,
    })
    expect(paid.taxCents).toBe(564)
    expect(paid.pricingSnapshot.tax).toMatchObject({
      rateBps: 1_300,
      applied: true,
      appliedTo: 'TICKETS_AND_FEE',
    })
  })
})

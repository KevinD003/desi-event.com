/**
 * Authoring through the real app on a real database.
 *
 * The stub serialises every write and models none of the CHECKs, triggers or
 * partial indexes the tier rules lean on, so the claims that matter most are
 * made here: every refusal the database would make is made first by the API as
 * a 4xx, never a 500; a quantity cut racing live holds never leaves more held
 * and sold than exists; and a reschedule whose revision has moved leaves the
 * event exactly as it was.
 *
 * Collected by `pnpm verify:tests:fresh` with the rest of the API suite, and
 * run with `REQUIRE_DATABASE=1` in CI, where an unreachable database is a
 * failure rather than a skip.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-authoring-live-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { rethrowTierTaken } from '../src/lib/event-authoring.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the live authoring suite')

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
    .update(`live-authoring-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

let app
let world

/**
 * Bearer headers for a real session, stepped up just now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'live-authoring-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * An event in a status, with one general-admission session and one tier.
 *
 * @param {string} label Distinguishes it.
 * @param {object} [options] Options.
 * @param {string} [options.status] The event's status.
 * @param {number} [options.quantity] The tier's quantity.
 * @returns {Promise<object>} The rows.
 */
async function liveEvent(label, { status = 'ON_SALE', quantity = 10 } = {}) {
  const startsAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000)
  const event = await prisma.event.create({
    data: {
      id: id(`event-${label}`),
      organizationId: world.organization.id,
      venueId: world.venue.id,
      title: `Live ${label} ${RUN}`,
      slug: `live-${label}-${RUN}`,
      summary: 'Seeded for the live authoring suite.',
      description: 'Seeded for the live authoring suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      publishedAt: new Date(),
      salesOpenedAt: status === 'ON_SALE' ? new Date() : null,
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })
  const session = await prisma.eventSession.create({
    data: {
      id: id(`session-${label}`),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      capacity: 100,
    },
  })
  const tier = await prisma.ticketType.create({
    data: {
      id: id(`tier-${label}`),
      eventId: event.id,
      name: `General ${label}`,
      priceCents: 3500,
      currency: 'USD',
      quantityTotal: quantity,
      maxPerOrder: 10,
      status: 'ON_SALE',
      eventSessionId: session.id,
    },
  })

  return { event, session, tier }
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Live authoring ${RUN}`,
      slug: `live-authoring-${RUN}`,
      contactEmail: `hello-${RUN}@live-authoring.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `Live Hall ${RUN}`,
      slug: `live-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      organizationId: organization.id,
    },
  })
  const owner = await prisma.user.create({
    data: {
      id: id('owner'),
      email: `owner-${RUN}@live-authoring.example`,
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

  world = { organization, venue, owner }
  world.headers = await sessionFor(owner)
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * The event's current revision.
 *
 * @param {string} eventId The event.
 * @returns {Promise<number>} The revision.
 */
async function revisionOf(eventId) {
  return (await prisma.event.findUnique({ where: { id: eventId }, select: { revision: true } }))
    .revision
}

/**
 * What a function threw.
 *
 * @param {function(): unknown} fn The function.
 * @returns {any} The thrown value, or undefined when it returned.
 */
function caughtBy(fn) {
  try {
    fn()
  } catch (caught) {
    return caught
  }

  return undefined
}

/**
 * POST a tier to an event with its current revision.
 *
 * @param {string} eventId The event.
 * @param {object} body The tier.
 * @returns {Promise<object>} The response.
 */
async function addTier(eventId, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/events/${eventId}/tiers`,
    headers: world.headers,
    payload: { revision: await revisionOf(eventId), priceCents: 0, quantityTotal: 10, ...body },
  })
}

when()('what the database would refuse, the API refuses first', () => {
  it('stores a free complimentary tier hidden, and a tier at every limit', async () => {
    const { event } = await liveEvent('limits', { status: 'DRAFT' })

    const comp = await addTier(event.id, { name: 'Guest list', complimentary: true })

    expect(comp.statusCode).toBe(201)
    expect(comp.json().data.visibility).toBe('HIDDEN')

    const boundary = await addTier(event.id, {
      name: 'n'.repeat(120),
      description: 'd'.repeat(500),
      minPerOrder: 50,
      maxPerOrder: 50,
      quantityTotal: 100,
    })

    expect(boundary.statusCode).toBe(201)
  })

  it.each([
    ['51 per order', { maxPerOrder: 51 }],
    ['a 501-character description', { description: 'd'.repeat(501) }],
    ['a priced complimentary tier', { complimentary: true, priceCents: 100 }],
    ['a public complimentary tier', { complimentary: true, visibility: 'PUBLIC' }],
  ])('answers 422, not 500, for %s', async (_label, body) => {
    const { event } = await liveEvent(`refused-${sequence}`, { status: 'DRAFT' })

    const response = await addTier(event.id, { name: 'Refused', ...body })

    expect(response.statusCode).toBe(422)
    expect(await prisma.ticketType.count({ where: { eventId: event.id, name: 'Refused' } })).toBe(0)
  })

  it('answers 422 for a zone of another map version and for a second tier on a zone', async () => {
    const { event } = await liveEvent('zones', { status: 'DRAFT' })
    const map = await prisma.venueMap.create({
      data: { id: id('map'), venueId: world.venue.id, name: `Hall ${RUN}` },
    })
    const version = await prisma.venueMapVersion.create({
      data: { id: id('version'), venueMapId: map.id, version: 1 },
    })
    const other = await prisma.venueMapVersion.create({
      data: { id: id('version'), venueMapId: map.id, version: 2 },
    })
    const zone = await prisma.priceZone.create({
      data: { id: id('zone'), venueMapVersionId: version.id, name: 'Stalls' },
    })
    const foreign = await prisma.priceZone.create({
      data: { id: id('zone'), venueMapVersionId: other.id, name: 'Terrace' },
    })

    await prisma.venueMapVersion.update({
      where: { id: version.id },
      data: { publishedAt: new Date() },
    })

    const seated = await prisma.eventSession.create({
      data: {
        id: id('seated'),
        eventId: event.id,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        timezone: 'America/Chicago',
        venueMapVersionId: version.id,
      },
    })

    const wrongZone = await addTier(event.id, {
      name: 'Wrong zone',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: seated.id,
      priceZoneId: foreign.id,
    })

    expect(wrongZone.statusCode).toBe(422)

    const first = await addTier(event.id, {
      name: 'Stalls',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: seated.id,
      priceZoneId: zone.id,
    })

    expect(first.statusCode).toBe(201)

    const second = await addTier(event.id, {
      name: 'Stalls again',
      reserved: true,
      quantityTotal: 0,
      eventSessionId: seated.id,
      priceZoneId: zone.id,
    })

    expect(second.statusCode).toBe(422)

    // The net under that check: the partial unique index's own refusal, as a
    // write racing past the check would meet it, reads as a 409.
    const raced = await prisma.ticketType
      .create({
        data: {
          id: id('raced-zone'),
          eventId: event.id,
          name: 'Stalls raced',
          priceCents: 0,
          currency: 'USD',
          quantityTotal: 0,
          reserved: true,
          eventSessionId: seated.id,
          priceZoneId: zone.id,
        },
      })
      .catch((caught) => caught)

    expect(caughtBy(() => rethrowTierTaken(raced, 'Stalls raced'))).toMatchObject({
      statusCode: 409,
      code: 'TIER_ZONE_TAKEN',
    })
  })

  it('answers 422, not 500, for a name another tier on the event has, added or renamed', async () => {
    const { event, tier } = await liveEvent('namesake', { status: 'DRAFT' })
    const sentence = `Another ticket type on this event is already called "${tier.name}". Give this one a different name.`

    const other = await addTier(event.id, { name: 'Encore' })

    expect(other.statusCode).toBe(201)

    const added = await addTier(event.id, { name: tier.name })

    expect(added.statusCode).toBe(422)
    expect(added.json().error.problems).toContain(sentence)

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}/tiers/${other.json().data.id}`,
      headers: world.headers,
      payload: { revision: await revisionOf(event.id), name: tier.name },
    })

    expect(renamed.statusCode).toBe(422)
    expect(renamed.json().error.problems).toContain(sentence)
    expect(await prisma.ticketType.count({ where: { eventId: event.id, name: tier.name } })).toBe(1)
  })

  it('reads the database refusing a taken name as 409 TIER_NAME_TAKEN, the net under that check', async () => {
    const { event, tier } = await liveEvent('name-net', { status: 'DRAFT' })

    const raced = await prisma.ticketType
      .create({
        data: {
          id: id('raced-name'),
          eventId: event.id,
          name: tier.name,
          priceCents: 0,
          currency: 'USD',
          quantityTotal: 1,
        },
      })
      .catch((caught) => caught)

    expect(caughtBy(() => rethrowTierTaken(raced, tier.name))).toMatchObject({
      statusCode: 409,
      code: 'TIER_NAME_TAKEN',
    })
    // Anything else is not this net's to translate.
    expect(caughtBy(() => rethrowTierTaken(new Error('boom'), tier.name)).message).toBe('boom')
  })

  it('refuses to remove the only night of a live event (409 LAST_SESSION), keeping its tiers', async () => {
    const { event, session } = await liveEvent('last-night')

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${event.id}/sessions/${session.id}?revision=${await revisionOf(event.id)}`,
      headers: world.headers,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('LAST_SESSION')
    expect(await prisma.eventSession.count({ where: { eventId: event.id } })).toBe(1)
    expect(await prisma.ticketType.count({ where: { eventId: event.id } })).toBe(1)
  })

  it('refuses to remove a night a general-admission order was placed for (409, not a foreign-key 500)', async () => {
    const { event, session, tier } = await liveEvent('orphan')

    await prisma.order.create({
      data: {
        id: id('order'),
        eventId: event.id,
        buyerEmail: `buyer-${RUN}@live-authoring.example`,
        buyerName: 'Buyer',
        reference: `DE-LV-${RUN}`.slice(0, 32).toUpperCase(),
        status: 'PAID',
        currency: 'USD',
        subtotalCents: 3500,
        totalCents: 3500,
        items: {
          create: [
            { ticketTypeId: tier.id, quantity: 1, unitPriceCents: 3500, subtotalCents: 3500 },
          ],
        },
      },
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${event.id}/sessions/${session.id}?revision=${await revisionOf(event.id)}`,
      headers: world.headers,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('SESSION_IN_USE')
    expect(await prisma.eventSession.count({ where: { id: session.id } })).toBe(1)
  })
})

when()('a quantity cut racing live holds', () => {
  it('never leaves more sold and held than the tier has', async () => {
    const { event, tier } = await liveEvent('race', { quantity: 10 })
    const revision = await revisionOf(event.id)

    const holds = Array.from({ length: 8 }, () =>
      app.inject({
        method: 'POST',
        url: '/v1/holds',
        payload: { ticketTypeId: tier.id, quantity: 1 },
      }),
    )
    const cut = app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}/tiers/${tier.id}`,
      headers: world.headers,
      payload: { revision, quantityTotal: 4 },
    })

    const [cutResponse, ...holdResponses] = await Promise.all([cut, ...holds])

    expect([200, 409]).toContain(cutResponse.statusCode)
    for (const response of holdResponses) expect([201, 409]).toContain(response.statusCode)

    const stored = await prisma.ticketType.findUnique({ where: { id: tier.id } })
    const live = await prisma.ticketHold.findMany({
      where: { ticketTypeId: tier.id, status: 'ACTIVE', expiresAt: { gt: new Date() } },
    })
    const held = live.reduce((total, hold) => total + hold.quantity, 0)

    expect(held + stored.quantitySold).toBeLessThanOrEqual(stored.quantityTotal)

    if (cutResponse.statusCode === 409) {
      expect(cutResponse.json().error.code).toBe('TIER_QUANTITY_BELOW_SOLD')
      expect(stored.quantityTotal).toBe(10)
    }
  })
})

when()('rescheduling a postponed event', () => {
  it('leaves status, dates and notices unchanged when the revision has moved', async () => {
    const { event, session } = await liveEvent('reschedule', { status: 'POSTPONED' })

    await prisma.order.create({
      data: {
        id: id('order'),
        eventId: event.id,
        buyerEmail: `resched-${RUN}@live-authoring.example`,
        buyerName: 'Buyer',
        reference: `DE-RS-${RUN}`.slice(0, 32).toUpperCase(),
        status: 'PAID',
        currency: 'USD',
        subtotalCents: 3500,
        totalCents: 3500,
      },
    })

    const newStart = new Date(Date.now() + 80 * 24 * 60 * 60 * 1000)
    const newEnd = new Date(newStart.getTime() + 3 * 60 * 60 * 1000)
    const body = {
      revision: (await revisionOf(event.id)) + 1,
      startsAt: newStart.toISOString(),
      endsAt: newEnd.toISOString(),
      sessions: [
        { id: session.id, startsAt: newStart.toISOString(), endsAt: newEnd.toISOString() },
      ],
      resume: 'ON_SALE',
      confirm: true,
      reason: 'Back on.',
    }

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/reschedule`,
      headers: world.headers,
      payload: body,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')

    const after = await prisma.event.findUnique({ where: { id: event.id } })
    const afterSession = await prisma.eventSession.findUnique({ where: { id: session.id } })

    expect(after.status).toBe('POSTPONED')
    expect(after.startsAt.getTime()).toBe(event.startsAt.getTime())
    expect(afterSession.startsAt.getTime()).toBe(session.startsAt.getTime())
    expect(
      await prisma.notificationOutbox.count({
        where: { dedupeKey: { startsWith: `event.changed:${event.id}:` } },
      }),
    ).toBe(0)

    const fresh = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/reschedule`,
      headers: world.headers,
      payload: { ...body, revision: body.revision - 1 },
    })

    expect(fresh.statusCode).toBe(200)
    expect(fresh.json().data.status).toBe('ON_SALE')
    expect(
      await prisma.notificationOutbox.count({
        where: { dedupeKey: { startsWith: `event.changed:${event.id}:` } },
      }),
    ).toBe(1)
  })
})

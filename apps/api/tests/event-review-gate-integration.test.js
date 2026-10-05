/**
 * The review gate, against PostgreSQL (SPEC2 §6).
 *
 * An event becomes public only after somebody on the Desi-Event team has
 * approved it. The service's transition table says so, and so does the
 * database: the trigger `desi_event_status_requires_review` refuses an
 * `UPDATE` that makes an event APPROVED from anywhere but REVIEW_PENDING, or
 * public from anywhere but APPROVED or another public status.
 *
 * Three layers are tried here:
 *
 *   1. the trigger itself, with raw SQL, for every move into a public status;
 *   2. the routes, on real rows: a create that asks to be public is a draft,
 *      an update cannot carry a status, publishing a draft is refused, and the
 *      honest path — submit, an independent approval, publish — works;
 *   3. a doctored transition table, standing in for a future code path that
 *      forgets the rule: the trigger refuses the write, and the caller is told
 *      409 `REVIEW_REQUIRED` rather than 500, with nothing changed.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @file @desi-event/api/tests/event-review-gate-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { REVIEW_REQUIRED_SENTENCE, databaseRefusal } from '../src/lib/errors.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

/**
 * The fault switch: while on, the transition table offers moves the review
 * gate forbids, as a careless future change might.
 */
const doctored = vi.hoisted(() => ({ on: false }))

vi.mock('@desi-event/schemas/lifecycle', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    findTransition(from, to) {
      if (doctored.on && from === 'DRAFT' && to === 'PUBLISHED') {
        return { to, actor: actual.ACTORS.ORGANIZER, gates: [] }
      }

      return actual.findTransition(from, to)
    },
  }
})

const { prisma, reachable, when } = await connectTestDatabase('the review gate suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The statuses in which an event can be seen by the public. */
const PUBLIC = ['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'COMPLETED', 'POSTPONED']

/** The statuses in which it cannot, short of being approved. */
const NOT_YET = ['DRAFT', 'REVIEW_PENDING', 'CHANGES_REQUIRED', 'REJECTED']

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`gate-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A user with a confirmed second factor.
 *
 * @param {string} local The address's local part.
 * @param {string} [role] The platform role.
 * @returns {Promise<object>} The user row.
 */
async function user(local, role = 'ORGANIZER') {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@gate-${RUN}.example`,
      displayName: local,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      id: id(`factor-${local}`),
      userId: row.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  return row
}

/**
 * Bearer headers for a real session with a second factor confirmed just now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} Headers.
 */
async function headersFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'review-gate-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

let app
let world

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

  const owner = await user('gate.owner')
  const reviewer = await user('gate.reviewer', 'ADMIN')
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Gate Keepers ${RUN}`,
      slug: `gate-keepers-${RUN}`,
      contactEmail: owner.email,
      verificationStatus: 'VERIFIED',
      verified: true,
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

  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `Gate Hall ${RUN}`,
      slug: `gate-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Houston',
      region: 'TX',
      postalCode: '77002',
      country: 'US',
      organizationId: organization.id,
    },
  })

  world = {
    owner,
    reviewer,
    organization,
    venue,
    ownerHeaders: await headersFor(owner),
    reviewerHeaders: await headersFor(reviewer),
  }
})

afterAll(async () => {
  doctored.on = false
  await app?.close()
  await prisma.$disconnect()
})

/**
 * A complete event, written directly, in the status asked for.
 *
 * Inserts are not covered by the trigger (only seeds and tests insert anything
 * but DRAFT), so a fixture can start anywhere.
 *
 * @param {string} status The status.
 * @returns {Promise<object>} The event row.
 */
async function eventIn(status) {
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000)
  const slug = `gate-${status.toLowerCase().replace(/_/gu, '-')}-${id('slug').slice(1, 12)}`
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: world.organization.id,
      venueId: world.venue.id,
      title: `Gate ${status} ${RUN}`,
      slug,
      summary: 'A summary long enough to be plausible.',
      description: 'A description long enough to be plausible prose.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })

  await prisma.eventSession.create({
    data: { eventId: event.id, startsAt, endsAt, timezone: 'America/Chicago', capacity: 100 },
  })

  return event
}

/**
 * Move an event with raw SQL, as a careless script would.
 *
 * @param {string} eventId The event.
 * @param {string} status The new status.
 * @returns {Promise<number>} Rows changed.
 */
function rawMove(eventId, status) {
  return prisma.$executeRaw`
    UPDATE "Event" SET "status" = ${status}::"EventStatus" WHERE "id" = ${eventId}`
}

/**
 * The status an event has in the database now.
 *
 * @param {string} eventId The event.
 * @returns {Promise<string>} The status.
 */
async function statusOf(eventId) {
  return (await prisma.event.findUnique({ where: { id: eventId }, select: { status: true } }))
    .status
}

const describeWhen = when()

describeWhen('the review gate, in the database', () => {
  it('refuses every move into a public status from one that was never approved', async () => {
    for (const from of NOT_YET) {
      for (const to of PUBLIC) {
        const event = await eventIn(from)

        await expect(rawMove(event.id, to), `${from} -> ${to}`).rejects.toMatchObject({
          message: expect.stringMatching(/event_public_requires_review/u),
        })
        expect(await statusOf(event.id)).toBe(from)
      }
    }
  })

  it('refuses APPROVED from anywhere but review', async () => {
    for (const from of ['DRAFT', 'CHANGES_REQUIRED', 'REJECTED']) {
      const event = await eventIn(from)

      await expect(rawMove(event.id, 'APPROVED'), from).rejects.toMatchObject({
        message: expect.stringMatching(/event_public_requires_review/u),
      })
    }
  })

  it('allows the reviewed path, and moves between public statuses', async () => {
    const event = await eventIn('REVIEW_PENDING')

    expect(await rawMove(event.id, 'APPROVED')).toBe(1)
    expect(await rawMove(event.id, 'PUBLISHED')).toBe(1)
    expect(await rawMove(event.id, 'ON_SALE')).toBe(1)
    expect(await rawMove(event.id, 'SALES_PAUSED')).toBe(1)
    expect(await statusOf(event.id)).toBe('SALES_PAUSED')

    // And out of public: a cancellation is not a publication.
    const live = await eventIn('ON_SALE')

    expect(await rawMove(live.id, 'CANCELLED')).toBe(1)
  })

  it('reaches the API as an error databaseRefusal maps to 409 REVIEW_REQUIRED', async () => {
    const event = await eventIn('DRAFT')
    const error = await prisma.event
      .update({ where: { id: event.id }, data: { status: 'PUBLISHED' } })
      .catch((thrown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect(databaseRefusal(error)).toMatchObject({
      statusCode: 409,
      code: 'REVIEW_REQUIRED',
      message: REVIEW_REQUIRED_SENTENCE,
    })
  })
})

describeWhen('the review gate, through the routes', () => {
  it('makes a create that asks to be public a draft', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: world.ownerHeaders,
      payload: {
        organizationId: world.organization.id,
        venueId: world.venue.id,
        title: `Asked To Be Public ${RUN}`,
        summary: 'A weekend of food, lights and music.',
        description: 'Long-form description of the mela, with stalls and a fireworks finale.',
        category: 'CULTURAL_FESTIVAL',
        status: 'PUBLISHED',
        startsAt: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString(),
        endsAt: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000 + 8 * 3_600_000).toISOString(),
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.status).toBe('DRAFT')
    expect(await statusOf(response.json().data.id)).toBe('DRAFT')
  })

  it('cannot carry a status in an update', async () => {
    const event = await eventIn('DRAFT')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}`,
      headers: world.ownerHeaders,
      payload: { status: 'PUBLISHED', revision: event.revision },
    })

    expect(response.statusCode).toBe(400)
    expect(await statusOf(event.id)).toBe('DRAFT')
  })

  it('saves the rest of an update that also carries a status, and leaves the status alone', async () => {
    const event = await eventIn('DRAFT')
    const title = `Renamed While Asking To Be Public ${RUN}`

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}`,
      headers: world.ownerHeaders,
      payload: { title, status: 'PUBLISHED', revision: event.revision },
    })

    // `status` is not a field of the update schema, so it is stripped: the
    // title is an update, and the status is nothing.
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toMatchObject({ title, status: 'DRAFT' })

    const stored = await prisma.event.findUnique({
      where: { id: event.id },
      select: { title: true, status: true },
    })

    expect(stored).toEqual({ title, status: 'DRAFT' })
  })

  it('refuses to publish a draft', async () => {
    const event = await eventIn('DRAFT')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/publish`,
      headers: world.ownerHeaders,
      payload: {},
    })

    expect(response.statusCode).toBe(409)
    expect(await statusOf(event.id)).toBe('DRAFT')
  })

  it('publishes after submission and an independent approval', async () => {
    const event = await eventIn('DRAFT')

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/submit-review`,
      headers: world.ownerHeaders,
      payload: {},
    })

    expect(submitted.statusCode, submitted.body).toBe(200)
    expect(await statusOf(event.id)).toBe('REVIEW_PENDING')

    const { revision } = await prisma.event.findUnique({
      where: { id: event.id },
      select: { revision: true },
    })
    const approved = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers: world.reviewerHeaders,
      payload: { decision: 'approve', revision },
    })

    expect(approved.statusCode, approved.body).toBe(200)
    expect(await statusOf(event.id)).toBe('APPROVED')

    const published = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/publish`,
      headers: world.ownerHeaders,
      payload: {},
    })

    expect(published.statusCode, published.body).toBe(200)
    expect(await statusOf(event.id)).toBe('PUBLISHED')
  })

  it('answers 409 REVIEW_REQUIRED, not 500, when a code path offers a move the gate forbids', async () => {
    const event = await eventIn('DRAFT')
    const auditsBefore = await prisma.auditLog.count({ where: { entityId: event.id } })

    doctored.on = true

    let response

    try {
      response = await app.inject({
        method: 'POST',
        url: `/v1/events/${event.id}/publish`,
        headers: world.ownerHeaders,
        payload: {},
      })
    } finally {
      doctored.on = false
    }

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error).toMatchObject({
      code: 'REVIEW_REQUIRED',
      message: REVIEW_REQUIRED_SENTENCE,
    })
    expect(response.body).not.toMatch(/"Event"|trigger|SQL|23514|event_public_requires_review/u)

    // Nothing changed: the move, its history and its audit row rolled back
    // together.
    expect(await statusOf(event.id)).toBe('DRAFT')
    expect(await prisma.eventModerationAction.count({ where: { eventId: event.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { entityId: event.id } })).toBe(auditsBefore)
  })
})

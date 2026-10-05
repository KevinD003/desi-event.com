/**
 * A NUL in a request is a 400, on every path that writes, against PostgreSQL.
 *
 * PostgreSQL stores no U+0000 anywhere: a text column refuses the byte
 * (SQLSTATE 22021) and a `jsonb` column refuses the `\u0000` escape (22P05).
 * Only the first used to be answered as a bad request. Free text that lands in
 * a JSON column — an event page's questions and line-up, a social link, the
 * reason carried in a change notice, the reason on a platform audit row — came
 * back as a 500 from deep inside a transaction.
 *
 * Two lines hold now, and this suite proves both on real rows:
 *
 *   1. The request validator refuses a NUL in any string of a validated body,
 *      query or path before a handler runs, naming the field. Nothing is
 *      written, so a write committed before the failing one cannot survive.
 *   2. Should a NUL reach PostgreSQL by some other road, the error handler
 *      answers 22P05 exactly as it answers 22021: 400, and what to change.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/unstorable-character-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import {
  UNSTORABLE_CHARACTER_MESSAGE,
  databaseErrorCode,
  normaliseError,
} from '../src/lib/errors.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the unstorable character suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `nul-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`nul-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A user with a confirmed second factor, as every privileged account needs.
 *
 * @param {string} local The address's local part.
 * @param {string} [role] The platform role.
 * @returns {Promise<object>} The user row.
 */
async function user(local, role = 'ATTENDEE') {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@${DOMAIN}`,
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
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const fresh = await prisma.user.findUnique({ where: { id: who.id } })
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: fresh.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'unstorable-character-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * An event in a status, with one session, one tier and, when live, one paid
 * order, so a material change has somebody to tell.
 *
 * @param {string} label Distinguishes it.
 * @param {string} status The event's status.
 * @returns {Promise<object>} `event`, and `order`: the paid order, or null for a draft.
 */
async function eventIn(label, status) {
  const startsAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000)
  const live = status !== 'DRAFT'
  const event = await prisma.event.create({
    data: {
      id: id(`event-${label}`),
      organizationId: world.organization.id,
      venueId: world.venue.id,
      title: `NUL ${label} ${RUN}`,
      slug: `nul-${label}-${RUN}`,
      summary: 'Seeded for the unstorable character suite.',
      description: 'Seeded for the unstorable character suite, long enough to be plausible.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      publishedAt: live ? new Date() : null,
      salesOpenedAt: status === 'ON_SALE' ? new Date() : null,
      policies: { entry: 'Doors at seven.' },
      faq: [{ question: 'Is there parking?', answer: 'Yes, behind the hall.' }],
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

  await prisma.ticketType.create({
    data: {
      id: id(`tier-${label}`),
      eventId: event.id,
      name: `General ${label}`,
      priceCents: 3500,
      currency: 'USD',
      quantityTotal: 10,
      maxPerOrder: 10,
      status: live ? 'ON_SALE' : 'DRAFT',
      eventSessionId: session.id,
    },
  })

  const order = live
    ? await prisma.order.create({
        data: {
          id: id(`order-${label}`),
          reference: `DE-NUL${sequence}${RUN}`.toUpperCase().slice(0, 24),
          eventId: event.id,
          buyerEmail: `buyer.${label}.${RUN}@${DOMAIN}`,
          buyerName: 'A Buyer',
          status: 'PAID',
          currency: 'USD',
          subtotalCents: 3500,
          totalCents: 3500,
          paidAt: new Date(),
        },
      })
    : null

  return { event, order }
}

/**
 * PATCH an event with its current revision.
 *
 * @param {string} eventId The event.
 * @param {object} body The change.
 * @returns {Promise<object>} The response.
 */
async function patchEvent(eventId, body) {
  const { revision } = await prisma.event.findUnique({
    where: { id: eventId },
    select: { revision: true },
  })

  return app.inject({
    method: 'PATCH',
    url: `/v1/events/${eventId}`,
    headers: world.headers,
    payload: { revision, ...body },
  })
}

/**
 * Assert a response is the NUL refusal, naming the field it was found in.
 *
 * @param {object} response The injected response.
 * @param {string} path The field's path, as the issue list spells it.
 * @returns {void}
 */
function expectNulRefusal(response, path) {
  expect(response.statusCode, response.body).toBe(400)

  const { error } = response.json()

  expect(error.code).toBe('VALIDATION_ERROR')
  expect(error.issues).toEqual([
    expect.objectContaining({ path, message: UNSTORABLE_CHARACTER_MESSAGE }),
  ])
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

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `NUL ${RUN}`,
      slug: `nul-${RUN}`,
      contactEmail: `hello.${RUN}@${DOMAIN}`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      name: `NUL Hall ${RUN}`,
      slug: `nul-hall-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
      organizationId: organization.id,
    },
  })
  const owner = await user('owner', 'ORGANIZER')

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

when()('a NUL in a request, against PostgreSQL', () => {
  it('refuses one in event page content bound for a JSON column, and changes nothing', async () => {
    const { event } = await eventIn('content', 'DRAFT')

    const cases = [
      [{ faq: [{ question: 'Is there parking?', answer: 'Yes\u0000' }] }, 'faq[0].answer'],
      [{ performers: [{ name: 'A\u0000B' }] }, 'performers[0].name'],
      [{ runningOrder: [{ time: '19:00', title: 'Open\u0000ing' }] }, 'runningOrder[0].title'],
      [{ sponsors: [{ name: 'Spon\u0000sor' }] }, 'sponsors[0].name'],
      // The organiser's website is not a social link any more (it has its own
      // field and switch); a social network's link still lands in JSON.
      [{ socialLinks: { instagram: 'https://instagram.com/a\u0000b' } }, 'socialLinks.instagram'],
      [{ policies: { refund: 'no\u0000refunds' } }, 'policies.refund'],
    ]

    for (const [body, path] of cases) {
      expectNulRefusal(await patchEvent(event.id, body), path)
    }

    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    expect(stored.revision).toBe(event.revision)
    expect(stored.faq).toEqual(event.faq)
    expect(stored.policies).toEqual(event.policies)
    expect(stored.performers).toEqual(event.performers)
    expect(stored.socialLinks).toEqual(event.socialLinks)
  })

  it('refuses one in the website address by the address rule itself, and stores nothing', async () => {
    const { event } = await eventIn('website', 'DRAFT')
    const response = await patchEvent(event.id, { websiteUrl: 'https://example.com/a\u0000b' })

    expect(response.statusCode, response.body).toBe(400)

    const { error } = response.json()

    // The field refuses control characters itself, so it keeps its own message.
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.issues).toEqual([
      expect.objectContaining({
        path: 'websiteUrl',
        message: 'An address has no spaces or line breaks in it.',
      }),
    ])

    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    expect(stored.revision).toBe(event.revision)
    expect(stored.websiteUrl).toBeNull()
    expect(stored.websiteDecisionPending).toBe(false)
  })

  it('refuses one in a material change reason, and queues no notice', async () => {
    const { event } = await eventIn('material', 'ON_SALE')

    const response = await patchEvent(event.id, {
      ageRestriction: 18,
      confirmMaterialChange: true,
      changeReason: 'Venue\u0000rule',
    })

    expectNulRefusal(response, 'changeReason')

    const stored = await prisma.event.findUnique({ where: { id: event.id } })
    const notices = await prisma.notificationOutbox.count({
      where: { template: 'event.changed', payload: { path: ['eventId'], equals: event.id } },
    })

    expect(stored.revision).toBe(event.revision)
    expect(stored.ageRestriction).toBe(event.ageRestriction)
    expect(notices).toBe(0)

    // And the same change with a reason that can be stored goes through, with
    // its notice: the refusal was about the character, not the change.
    const accepted = await patchEvent(event.id, {
      ageRestriction: 18,
      confirmMaterialChange: true,
      changeReason: 'Venue rule',
    })

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(
      await prisma.notificationOutbox.count({
        where: { template: 'event.changed', payload: { path: ['eventId'], equals: event.id } },
      }),
    ).toBe(1)
  })

  it('refuses one in a platform role or membership reason, and changes no role', async () => {
    const admin = await user('admin', 'SUPER_ADMIN')
    const target = await user('target')
    const headers = await sessionFor(admin)
    const auditsBefore = await prisma.auditLog.count({ where: { actorId: admin.id } })

    const role = await app.inject({
      method: 'POST',
      url: `/v1/platform/users/${target.id}/role`,
      headers,
      payload: { role: 'SUPPORT', reason: 'Needs\u0000access' },
    })

    expectNulRefusal(role, 'reason')

    const grant = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${world.organization.id}/members`,
      headers,
      payload: { userId: target.id, role: 'VIEWER', reason: 'Needs\u0000access' },
    })

    expectNulRefusal(grant, 'reason')

    expect((await prisma.user.findUnique({ where: { id: target.id } })).role).toBe('ATTENDEE')
    expect(await prisma.membership.count({ where: { userId: target.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { actorId: admin.id } })).toBe(auditsBefore)
  })

  it('answers 400 for a NUL that reaches a JSON column by another road (22P05)', async () => {
    const { event } = await eventIn('backstop', 'DRAFT')

    const refused = await prisma.event
      .update({ where: { id: event.id }, data: { faq: [{ question: 'Q', answer: 'A\u0000' }] } })
      .then(
        () => null,
        (error) => error,
      )

    expect(refused).not.toBeNull()
    expect(databaseErrorCode(refused)).toBe('22P05')

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(refused, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }
  })
})

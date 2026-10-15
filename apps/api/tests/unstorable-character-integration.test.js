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
 * A lone UTF-16 surrogate — `\ud800` in a JSON body, half of a pair — is the
 * same story for every JSON column: `JSON.parse` accepts it, no schema refused
 * it, and `jsonb` answers 22P02 ("invalid input syntax for type json", Prisma
 * P2007). Free-text reasons go into audit metadata, outbox payloads and the
 * import file, so the commands that write them answered 500. The validator
 * refuses one now as it refuses a NUL, and the error handler answers the
 * database's refusal as 400 should one arrive by another road.
 *
 * Numbers and dates PostgreSQL cannot hold go the same way. A revision past
 * 2147483647 is compared with an `integer` column and Prisma refuses the
 * query (P2020); a query date in year 0000 is no day in PostgreSQL's calendar
 * (22008). The request schemas bound both, naming the field, and the error
 * handler answers either refusal as 400 should one arrive by another road.
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
  OUT_OF_RANGE_MESSAGE,
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
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, eventImport: { max: 1000 } },
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

/** Half of a pair, alone: what `JSON.parse` makes of a `\ud800` escape. */
const LONE_HIGH = '\ud800'

/** The other half, alone. */
const LONE_LOW = '\udc00'

/**
 * An import file of one listing, as the importer reads it.
 *
 * @param {string} title The listing's title.
 * @returns {object} The dataset.
 */
function importFile(title) {
  sequence += 1

  const sourceId = `${String(Date.now()).slice(-8)}${String(sequence % 100).padStart(2, '0')}`

  return {
    format: 'desi-event-import/1',
    source: 'SULEKHA',
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
    events: [
      {
        sourceId,
        scrapedAt: '2026-09-29T21:25:00Z',
        title,
        category: 'GARBA_DANDIYA',
        sourceCategory: 'GARBA_DANDIYA',
        summary: 'An evening of garba and dandiya with a live band.',
        description: 'Dance the night away.',
        startsAt: new Date(Date.now() + 12 * 86_400_000).toISOString(),
        endsAt: null,
        timeZone: 'America/Chicago',
        venue: {
          name: `Irving Hall ${RUN}`,
          addressLine1: '500 W Las Colinas Blvd',
          city: 'Irving',
          region: 'TX',
          postalCode: '75039',
          country: 'US',
        },
        performers: [],
        presentedBy: 'DFW Garba Collective',
        languages: ['Gujarati'],
        prices: [],
        priceText: null,
        ageRestriction: null,
        dressCode: null,
        parking: null,
        faq: [],
        importNotes: [],
      },
    ],
  }
}

/**
 * Assert a response is the refusal of a character PostgreSQL cannot store,
 * naming the field, and that the character is not echoed back.
 *
 * @param {object} response The injected response.
 * @param {string} path The field's path, as the issue list spells it.
 * @returns {void}
 */
function expectLoneSurrogateRefusal(response, path) {
  expectNulRefusal(response, path)
  expect(response.body).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/iu)
}

/**
 * The audit rows about one event, of one action.
 *
 * @param {string} entityId The event.
 * @param {string} action The action.
 * @returns {Promise<number>} How many.
 */
function audits(entityId, action) {
  return prisma.auditLog.count({ where: { entityId, action } })
}

when()('a lone surrogate in a request, against PostgreSQL', () => {
  let administrator

  beforeAll(async () => {
    const admin = await user('lone-admin', 'ADMIN')

    administrator = { user: admin, headers: await sessionFor(admin) }
  })

  it('refuses one in an import file before a run is written, and takes the pair', async () => {
    const runsBefore = await prisma.eventImportRun.count({
      where: { createdById: administrator.user.id },
    })
    const refused = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: administrator.headers,
      payload: { fileName: 'listings.json', dataset: importFile(`Garba ${LONE_HIGH} night`) },
    })

    expectLoneSurrogateRefusal(refused, 'dataset.events[0].title')
    expect(
      await prisma.eventImportRun.count({ where: { createdById: administrator.user.id } }),
    ).toBe(runsBefore)

    // An emoji is a well-formed pair, and is read as one.
    const paired = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: administrator.headers,
      payload: { fileName: 'listings.json', dataset: importFile(`Garba 💃 night ${RUN}`) },
    })

    expect(paired.statusCode, paired.body).toBe(201)
  })

  it('refuses one in a website link decision, and changes nothing', async () => {
    const { event } = await eventIn('lone-website', 'PUBLISHED')

    await prisma.event.update({
      where: { id: event.id },
      data: { websiteUrl: 'https://example.org/', websiteDecisionPending: true },
    })

    const before = await prisma.event.findUnique({ where: { id: event.id } })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/website-redirect`,
      headers: administrator.headers,
      payload: {
        enabled: true,
        reason: `Looks good ${LONE_HIGH} here`,
        websiteUrl: 'https://example.org/',
      },
    })

    expectLoneSurrogateRefusal(response, 'reason')

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after.revision).toBe(before.revision)
    expect(after.websiteRedirectEnabled).toBe(false)
    expect(after.websiteRedirectReason).toBeNull()
    expect(await audits(event.id, 'event.website_redirect_changed')).toBe(0)
  })

  it('refuses one in the reason for opening an event for editing, and opens no sitting', async () => {
    const { event } = await eventIn('lone-sitting', 'PUBLISHED')
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${event.id}/edit`,
      headers: administrator.headers,
      payload: { reason: `Fixing a typo ${LONE_LOW} in the title` },
    })

    expectLoneSurrogateRefusal(response, 'reason')
    expect(await prisma.eventPlatformEdit.count({ where: { eventId: event.id } })).toBe(0)
  })

  it('refuses one in a deletion reason, and the event stays; the pair is taken', async () => {
    const { event } = await eventIn('lone-delete', 'DRAFT')
    const body = (reason) => ({
      revision: event.revision,
      reason,
      confirmSlug: event.slug,
      expectedOutcome: 'REMOVE',
    })
    const refused = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: world.headers,
      payload: body(`Duplicate listing \ud83d made by mistake`),
    })

    expectLoneSurrogateRefusal(refused, 'reason')

    const kept = await prisma.event.findUnique({ where: { id: event.id } })

    expect(kept).toMatchObject({ status: 'DRAFT', revision: event.revision, deletedAt: null })
    expect(await audits(event.id, 'event.deleted')).toBe(0)

    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: world.headers,
      payload: body('Duplicate listing 😀 made by mistake'),
    })

    expect(deleted.statusCode, deleted.body).toBe(200)
    expect((await prisma.event.findUnique({ where: { id: event.id } })).deletionReason).toBe(
      'Duplicate listing 😀 made by mistake',
    )
  })

  it('refuses one in a restore reason, and the event stays deleted', async () => {
    const { event } = await eventIn('lone-restore', 'DRAFT')
    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: world.headers,
      payload: {
        revision: event.revision,
        reason: 'Posted twice by mistake.',
        confirmSlug: event.slug,
        expectedOutcome: 'REMOVE',
      },
    })

    expect(deleted.statusCode, deleted.body).toBe(200)

    const gone = await prisma.event.findUnique({ where: { id: event.id } })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${event.id}/restore`,
      headers: administrator.headers,
      payload: { revision: gone.revision, reason: `Deleted by mistake ${LONE_HIGH} restore it` },
    })

    expectLoneSurrogateRefusal(response, 'reason')

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after).toMatchObject({ status: 'DELETED', revision: gone.revision })
    expect(await audits(event.id, 'event.restored')).toBe(0)
  })

  it('refuses one in a cancelled night’s reason, and the night stays on sale', async () => {
    const { event } = await eventIn('lone-night', 'ON_SALE')
    const second = await prisma.eventSession.create({
      data: {
        id: id('session-lone-night-2'),
        eventId: event.id,
        startsAt: new Date(event.startsAt.getTime() + 86_400_000),
        endsAt: new Date(event.endsAt.getTime() + 86_400_000),
        timezone: 'America/Chicago',
        capacity: 100,
      },
    })
    const outboxBefore = await prisma.notificationOutbox.count({
      where: {
        template: 'event.session_cancelled',
        payload: { path: ['eventId'], equals: event.id },
      },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/sessions/${second.id}/cancel`,
      headers: world.headers,
      payload: {
        revision: event.revision,
        reason: `The band could not travel ${LONE_LOW} that night.`,
        confirm: true,
        expectedOrders: 0,
      },
    })

    expectLoneSurrogateRefusal(response, 'reason')

    const night = await prisma.eventSession.findUnique({ where: { id: second.id } })

    expect(night.cancelledAt).toBeNull()
    expect(night.cancellationReason).toBeNull()
    expect((await prisma.event.findUnique({ where: { id: event.id } })).revision).toBe(
      event.revision,
    )
    expect(
      await prisma.notificationOutbox.count({
        where: {
          template: 'event.session_cancelled',
          payload: { path: ['eventId'], equals: event.id },
        },
      }),
    ).toBe(outboxBefore)
  })

  it('refuses one in the reason for moving an imported event, and it stays imported', async () => {
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: administrator.headers,
      payload: { fileName: 'listings.json', dataset: importFile(`Garba to move ${RUN}`) },
    })

    expect(previewed.statusCode, previewed.body).toBe(201)

    const run = previewed.json().data
    const applied = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers: administrator.headers,
      payload: { planDigest: run.planDigest },
    })

    expect(applied.statusCode, applied.body).toBe(200)

    const item = await prisma.eventImportItem.findFirst({
      where: { lastRunId: run.id },
      include: { event: true },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${item.event.id}/reassign`,
      headers: administrator.headers,
      payload: {
        organizationId: world.organization.id,
        reason: `They run this event ${LONE_HIGH} themselves.`,
        revision: item.event.revision,
      },
    })

    expectLoneSurrogateRefusal(response, 'reason')

    const after = await prisma.eventImportItem.findUnique({
      where: { id: item.id },
      include: { event: true },
    })

    expect(after.reassignedAt).toBeNull()
    expect(after.event.organizationId).toBe(item.event.organizationId)
    expect(after.event.revision).toBe(item.event.revision)
  })

  it('answers 400 for one that reaches a JSON column by another road (22P02, P2007)', async () => {
    const refused = await prisma.auditLog
      .create({
        data: {
          action: 'test.lone_surrogate',
          entityType: 'User',
          entityId: world.owner.id,
          actorId: world.owner.id,
          metadata: { reason: `Half a pair ${LONE_HIGH}` },
        },
      })
      .then(
        () => null,
        (error) => error,
      )

    expect(refused).not.toBeNull()
    expect(refused.code).toBe('P2007')

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(refused, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: UNSTORABLE_CHARACTER_MESSAGE,
        expected: true,
      })
    }

    // 22P02 is any malformed literal: an integer the database cannot read is
    // still a fault, and still hidden in production.
    const malformed = await prisma.$queryRawUnsafe(`SELECT 'not a number'::int`).then(
      () => null,
      (error) => error,
    )

    expect(malformed).not.toBeNull()
    expect(normaliseError(malformed, { exposeInternals: false })).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
    })
  })
})

/** One past the largest value an `integer` column holds. */
const PAST_INT_MAX = 2_147_483_648

/**
 * Assert a response is a 400 naming one field, as the request schemas answer.
 *
 * @param {object} response The injected response.
 * @param {string} path The field's path, as the issue list spells it.
 * @returns {void}
 */
function expectFieldRefusal(response, path) {
  expect(response.statusCode, response.body).toBe(400)

  const { error } = response.json()

  expect(error.code).toBe('VALIDATION_ERROR')
  expect(error.issues.map((issue) => issue.path)).toContain(path)
}

when()('a revision past an integer column, against PostgreSQL', () => {
  let administrator

  beforeAll(async () => {
    const admin = await user('range-admin', 'ADMIN')

    administrator = { user: admin, headers: await sessionFor(admin) }
  })

  it('refuses one in a deletion and leaves the event as it was', async () => {
    const { event } = await eventIn('range-delete', 'DRAFT')
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: world.headers,
      payload: {
        revision: PAST_INT_MAX,
        reason: 'Testing a revision past the column.',
        confirmSlug: event.slug,
        expectedOutcome: 'REMOVE',
      },
    })

    expectFieldRefusal(response, 'revision')
    expect(await prisma.event.findUnique({ where: { id: event.id } })).toMatchObject({
      status: 'DRAFT',
      revision: event.revision,
    })
  })

  it('refuses one in a restore and the event stays deleted', async () => {
    const { event } = await eventIn('range-restore', 'DRAFT')
    const deleted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: world.headers,
      payload: {
        revision: event.revision,
        reason: 'Posted twice by mistake.',
        confirmSlug: event.slug,
        expectedOutcome: 'REMOVE',
      },
    })

    expect(deleted.statusCode, deleted.body).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${event.id}/restore`,
      headers: administrator.headers,
      payload: { revision: PAST_INT_MAX + 1, reason: 'Restore with a huge revision.' },
    })

    expectFieldRefusal(response, 'revision')
    expect((await prisma.event.findUnique({ where: { id: event.id } })).status).toBe('DELETED')
  })

  it('refuses one in a night’s cancellation and the night stays on sale', async () => {
    const { event } = await eventIn('range-night', 'ON_SALE')
    const second = await prisma.eventSession.create({
      data: {
        id: id('session-range-night-2'),
        eventId: event.id,
        startsAt: new Date(event.startsAt.getTime() + 86_400_000),
        endsAt: new Date(event.endsAt.getTime() + 86_400_000),
        timezone: 'America/Chicago',
        capacity: 100,
      },
    })
    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/sessions/${second.id}/cancel`,
      headers: world.headers,
      payload: {
        revision: PAST_INT_MAX,
        reason: 'Cancel with a huge revision.',
        confirm: true,
        expectedOrders: 0,
      },
    })

    expectFieldRefusal(response, 'revision')
    expect(
      (await prisma.eventSession.findUnique({ where: { id: second.id } })).cancelledAt,
    ).toBeNull()
  })

  it('refuses one in an organiser’s edit, and in moving an imported event', async () => {
    const { event } = await eventIn('range-edit', 'DRAFT')
    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${event.id}`,
      headers: world.headers,
      payload: { revision: PAST_INT_MAX + 1, title: 'Owner edit with a huge revision' },
    })

    expectFieldRefusal(edited, 'revision')
    expect((await prisma.event.findUnique({ where: { id: event.id } })).title).toBe(event.title)

    const moved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers: administrator.headers,
      payload: {
        organizationId: world.organization.id,
        reason: 'Moving with a huge revision.',
        revision: PAST_INT_MAX,
      },
    })

    expectFieldRefusal(moved, 'revision')
  })

  it('answers 400 for one that reaches PostgreSQL by another road (P2020)', async () => {
    const refused = await prisma.event
      .updateMany({ where: { revision: PAST_INT_MAX }, data: { title: 'Never written' } })
      .then(
        () => null,
        (error) => error,
      )

    expect(refused).not.toBeNull()
    expect(refused.code).toBe('P2020')

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(refused, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: OUT_OF_RANGE_MESSAGE,
        expected: true,
      })
    }
  })
})

when()('a query date in year 0000, against PostgreSQL', () => {
  let platform

  beforeAll(async () => {
    const superAdmin = await user('range-super', 'SUPER_ADMIN')

    platform = await sessionFor(superAdmin)
  })

  it('refuses one on the platform’s visits list, naming the field', async () => {
    for (const [query, field] of [
      ['from=0000-01-01T00:00:00Z', 'from'],
      ['to=0000-01-01T00:00:00Z', 'to'],
      ['to=0000-01-02T00:00:00Z', 'to'],
      // Midnight on 1 January of year 1 ends on a day in year 0.
      ['to=0001-01-01T00:00:00Z', 'to'],
      ['from=0000-06-01T00:00:00Z&scope=all', 'from'],
    ]) {
      expectFieldRefusal(
        await app.inject({ method: 'GET', url: `/v1/traffic/events?${query}`, headers: platform }),
        field,
      )
    }

    const fine = await app.inject({
      method: 'GET',
      url: '/v1/traffic/events?from=1970-01-01T00:00:00Z',
      headers: platform,
    })

    expect(fine.statusCode, fine.body).toBe(200)
  })

  it('refuses one on an organisation’s analytics, its export and its finance summary', async () => {
    const organizationId = world.organization.id

    for (const [url, field] of [
      [`/v1/analytics/summary?organizationId=${organizationId}&from=0000-06-01T00:00:00Z`, 'from'],
      [`/v1/analytics/summary?organizationId=${organizationId}&to=0000-01-01T00:00:00Z`, 'to'],
      [
        `/v1/analytics/export.csv?organizationId=${organizationId}&from=0000-06-01T00:00:00Z`,
        'from',
      ],
      [`/v1/finance/summary?organizationId=${organizationId}&from=0000-01-01T00:00:00Z`, 'from'],
    ]) {
      expectFieldRefusal(await app.inject({ method: 'GET', url, headers: world.headers }), field)
    }

    // The owner reads the same views from 1970 on.
    const fine = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${organizationId}&from=1970-01-01T00:00:00Z`,
      headers: world.headers,
    })

    expect(fine.statusCode, fine.body).toBe(200)
  })

  it('refuses one on the public event list', async () => {
    expectFieldRefusal(
      await app.inject({ method: 'GET', url: '/v1/events?startsAfter=0000-01-01T00:00:00Z' }),
      'startsAfter',
    )
    expectFieldRefusal(
      await app.inject({ method: 'GET', url: '/v1/events?startsBefore=0000-01-01' }),
      'startsBefore',
    )
  })

  it('answers 400 for one that reaches PostgreSQL by another road (22008)', async () => {
    const refused = await prisma.refund
      .count({ where: { createdAt: { gte: new Date('0000-06-01T00:00:00Z') } } })
      .then(
        () => null,
        (error) => error,
      )

    expect(refused).not.toBeNull()
    expect(databaseErrorCode(refused)).toBe('22008')

    for (const exposeInternals of [true, false]) {
      expect(normaliseError(refused, { exposeInternals })).toEqual({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: OUT_OF_RANGE_MESSAGE,
        expected: true,
      })
    }
  })
})

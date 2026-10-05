/**
 * The website link against real PostgreSQL (SPEC2 §4.W).
 *
 * What a stub cannot show:
 *
 *   1. the CHECKs on the address's shape, the switch's invariants and the
 *      social links, and the trigger `desi_event_website_change`, which keeps
 *      "waiting for a decision" in step with the address for every writer and
 *      never moves the switch;
 *   2. the routes on real rows: an organiser's change while the link is on,
 *      an administrator's decision with its audit row, the lookup's count;
 *   3. the decision under real concurrency: an organiser and an administrator
 *      at once never leave the link going to an address nobody approved, and
 *      two administrators at once make one change;
 *   4. the decision inside a caller's transaction (SPEC2-XI O6), rolled back
 *      with it;
 *   5. the administrators' list on real rows, its search taking `_` and `%`
 *      literally.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @file @desi-event/api/tests/website-redirect-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { resetTrafficMemory } from '../src/lib/traffic.js'
import { decideWebsiteRedirect, isTransactionClient } from '../src/lib/website-redirect.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, reachable, when } = await connectTestDatabase('the website link suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const SITE_A = `https://a-${RUN}.example/`
const SITE_B = `https://b-${RUN}.example/`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`web-${RUN}-${kind}-${sequence}`).digest('hex')
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
 * @param {string} [displayName] The name shown.
 * @returns {Promise<object>} The user row.
 */
async function user(local, role = 'ORGANIZER', displayName = local) {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@web-${RUN}.example`,
      displayName,
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
    key: 'website-link-suite-pseudonymisation-key',
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

  const owner = await user('web.owner')
  const admin = await user('web.admin', 'ADMIN', `Asha Admin ${RUN}`)
  const secondAdmin = await user('web.admin2', 'ADMIN', `Bela Admin ${RUN}`)
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Website Links ${RUN}`,
      slug: `website-links-${RUN}`,
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

  world = {
    owner,
    admin,
    secondAdmin,
    organization,
    ownerHeaders: await headersFor(owner),
    adminHeaders: await headersFor(admin),
    secondAdminHeaders: await headersFor(secondAdmin),
    actor: { id: admin.id, role: 'ADMIN', memberships: [] },
  }
})

beforeEach(() => resetTrafficMemory())

afterAll(async () => {
  if (world) {
    await prisma.event.deleteMany({ where: { organizationId: world.organization.id } })
    await prisma.membership.deleteMany({ where: { organizationId: world.organization.id } })
    await prisma.organization.deleteMany({ where: { id: world.organization.id } })
  }

  await app?.close()
  await prisma.$disconnect()
})

/**
 * An event, written directly, in the status asked for.
 *
 * @param {string} status The status.
 * @param {object} [columns] Website columns and anything else.
 * @returns {Promise<object>} The event row.
 */
async function eventIn(status, columns = {}) {
  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000)

  return prisma.event.create({
    data: {
      id: id('event'),
      organizationId: world.organization.id,
      title: `Website ${status} ${RUN}`,
      slug: `web-${status.toLowerCase().replace(/_/gu, '-')}-${id('slug').slice(1, 12)}`,
      summary: 'A summary long enough to be plausible.',
      description: 'A description long enough to be plausible prose.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
      ...columns,
    },
  })
}

/**
 * The website columns of an event as the database holds them.
 *
 * @param {string} eventId The event.
 * @returns {Promise<object>} The columns.
 */
function stored(eventId) {
  return prisma.event.findUnique({
    where: { id: eventId },
    select: {
      revision: true,
      websiteUrl: true,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: true,
      websiteDecisionPending: true,
      websiteSubmittedAt: true,
      websiteRedirectChangedAt: true,
      websiteRedirectChangedById: true,
      websiteRedirectReason: true,
    },
  })
}

/**
 * Whether a raw statement is refused by a named constraint.
 *
 * @param {Promise<unknown>} statement The statement.
 * @param {RegExp} constraint The constraint's name.
 * @returns {Promise<void>}
 */
async function refusedBy(statement, constraint) {
  await expect(statement).rejects.toThrow(constraint)
}

/** An administrator's decision through the route. */
const decide = (eventId, headers, body) =>
  app.inject({
    method: 'POST',
    url: `/v1/moderation/events/${eventId}/website-redirect`,
    headers,
    payload: body,
  })

/** An organiser's change through the route, at the current revision. */
const patch = async (eventId, body) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/events/${eventId}`,
    headers: world.ownerHeaders,
    payload: { revision: (await stored(eventId)).revision, ...body },
  })

/** Audit rows for the website link on one event. */
const decisions = (eventId) =>
  prisma.auditLog.findMany({
    where: { entityId: eventId, action: 'event.website_redirect_changed' },
    orderBy: { createdAt: 'asc' },
  })

when()('the website link against real PostgreSQL', () => {
  it('holds the address to its stored shape, on both columns', async () => {
    const event = await eventIn('DRAFT')

    for (const bad of [
      'http://a.example/',
      'https://user@a.example/',
      'https://a.example:8443/',
      'https://A.example/',
      'https://a.example',
    ]) {
      await refusedBy(
        prisma.$executeRaw`UPDATE "Event" SET "websiteUrl" = ${bad} WHERE "id" = ${event.id}`,
        /event_website_url_shape/u,
      )
    }

    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "websiteDecidedUrl" = 'http://a.example/', "websiteRedirectChangedAt" = now() WHERE "id" = ${event.id}`,
      /event_website_url_shape/u,
    )

    await prisma.$executeRaw`UPDATE "Event" SET "websiteUrl" = ${SITE_A} WHERE "id" = ${event.id}`

    expect((await stored(event.id)).websiteUrl).toBe(SITE_A)
  })

  it('refuses a switch that is on without a decided address, and a reason out of bounds', async () => {
    const event = await eventIn('PUBLISHED', { websiteUrl: SITE_A })

    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "websiteRedirectEnabled" = true WHERE "id" = ${event.id}`,
      /event_website_redirect_consistency/u,
    )
    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "websiteDecidedUrl" = ${SITE_A} WHERE "id" = ${event.id}`,
      /event_website_redirect_consistency/u,
    )
    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "websiteRedirectReason" = '' WHERE "id" = ${event.id}`,
      /event_website_redirect_consistency/u,
    )
    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "websiteDecisionPending" = false WHERE "id" = ${event.id}`,
      /event_website_redirect_consistency/u,
    )
  })

  it('refuses a website among the social links', async () => {
    const event = await eventIn('DRAFT')

    await refusedBy(
      prisma.$executeRaw`UPDATE "Event" SET "socialLinks" = '{"website":"https://a.example/"}'::jsonb WHERE "id" = ${event.id}`,
      /event_social_links_shape/u,
    )
  })

  it('keeps "waiting" in step for any writer, and never moves the switch', async () => {
    // An INSERT with an address: waiting from the start.
    const inserted = await eventIn('DRAFT', { websiteUrl: SITE_A })

    expect(await stored(inserted.id)).toMatchObject({
      websiteDecisionPending: true,
      websiteRedirectEnabled: false,
    })
    expect((await stored(inserted.id)).websiteSubmittedAt).toBeInstanceOf(Date)

    // An ON row changed by a raw UPDATE: still on, still going to A, now waiting.
    const on = await eventIn('PUBLISHED')

    await prisma.$executeRaw`
      UPDATE "Event" SET "websiteUrl" = ${SITE_A}, "websiteRedirectEnabled" = true,
        "websiteDecidedUrl" = ${SITE_A}, "websiteRedirectChangedAt" = now(),
        "websiteRedirectReason" = 'Checked.' WHERE "id" = ${on.id}`

    expect(await stored(on.id)).toMatchObject({ websiteDecisionPending: false })

    await prisma.$executeRaw`UPDATE "Event" SET "websiteUrl" = ${SITE_B} WHERE "id" = ${on.id}`

    expect(await stored(on.id)).toMatchObject({
      websiteUrl: SITE_B,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: true,
      websiteRedirectReason: 'Checked.',
    })

    // Back to the decided address: nothing waits.
    await prisma.$executeRaw`UPDATE "Event" SET "websiteUrl" = ${SITE_A} WHERE "id" = ${on.id}`

    expect(await stored(on.id)).toMatchObject({
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
    })

    // Cleared while on: waiting, because the link still goes somewhere.
    await prisma.$executeRaw`UPDATE "Event" SET "websiteUrl" = NULL WHERE "id" = ${on.id}`

    expect(await stored(on.id)).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: true,
      websiteDecisionPending: true,
    })
  })

  it('lets the organiser change the address while on, the link still going to the approved one', async () => {
    const event = await eventIn('ON_SALE', { websiteUrl: SITE_A })

    const turnedOn = await decide(event.id, world.adminHeaders, {
      enabled: true,
      reason: 'Checked: their own site.',
      websiteUrl: SITE_A,
    })

    expect(turnedOn.statusCode, turnedOn.body).toBe(200)
    expect(turnedOn.json().data.redirect.changedByName).toBe(world.admin.displayName)

    const before = await stored(event.id)

    expect(before).toMatchObject({
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: false,
      websiteRedirectChangedById: world.admin.id,
      revision: event.revision,
    })

    const changed = await patch(event.id, { websiteUrl: SITE_B })

    expect(changed.statusCode, changed.body).toBe(200)
    expect(changed.json().data.websiteLink).toEqual({ host: `a-${RUN}.example` })
    expect(await stored(event.id)).toMatchObject({
      websiteUrl: SITE_B,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: SITE_A,
      websiteDecisionPending: true,
    })

    const lookup = await app.inject({
      method: 'POST',
      url: '/v1/traffic/website-visits',
      headers: {
        'user-agent': CHROME,
        'content-type': 'application/json',
        'x-desi-client-address': '203.0.113.61',
      },
      payload: { slug: event.slug, counted: true },
    })

    expect(lookup.statusCode, lookup.body).toBe(200)
    expect(lookup.json()).toEqual({ data: { url: SITE_A } })
    expect(
      await prisma.trafficEvent.count({ where: { eventId: event.id, kind: 'WEBSITE_REDIRECT' } }),
    ).toBe(1)

    const [audit] = await decisions(event.id)

    expect(audit).toMatchObject({
      actorId: world.admin.id,
      metadata: {
        enabled: true,
        previousEnabled: false,
        previousPending: true,
        websiteUrl: SITE_A,
        platformRole: 'ADMIN',
        eventStatus: 'ON_SALE',
      },
    })

    // Deleting the event deletes the visits counted for it.
    await prisma.event.delete({ where: { id: event.id } })

    expect(await prisma.trafficEvent.count({ where: { eventId: event.id } })).toBe(0)
  })

  it('never leaves the link going to an address nobody approved, however an organiser and an administrator race', async () => {
    for (let round = 0; round < 15; round += 1) {
      const event = await eventIn('PUBLISHED', { websiteUrl: SITE_A })
      const [decision, change] = await Promise.all([
        decide(event.id, world.adminHeaders, {
          enabled: true,
          reason: `Checked in round ${round}.`,
          websiteUrl: SITE_A,
        }),
        patch(event.id, { websiteUrl: SITE_B }),
      ])

      expect(change.statusCode, change.body).toBe(200)
      expect([200, 409], decision.body).toContain(decision.statusCode)

      const after = await stored(event.id)
      const audits = await decisions(event.id)

      // The organiser's change always lands, and always waits.
      expect(after.websiteUrl).toBe(SITE_B)
      expect(after.websiteDecisionPending).toBe(true)

      if (decision.statusCode === 200) {
        // The administrator decided first, about A: the link goes to A.
        expect(after).toMatchObject({ websiteRedirectEnabled: true, websiteDecidedUrl: SITE_A })
        expect(audits).toHaveLength(1)
      } else {
        // The organiser changed it first: nothing was decided.
        expect(decision.json().error.code).toBe('WEBSITE_CHANGED')
        expect(decision.json().error.details).toEqual({ currentWebsiteUrl: SITE_B })
        expect(after).toMatchObject({ websiteRedirectEnabled: false, websiteDecidedUrl: null })
        expect(audits).toHaveLength(0)
      }

      // Never on for an address nobody looked at.
      expect(after.websiteRedirectEnabled && after.websiteDecidedUrl === SITE_B).toBe(false)
    }
  })

  it('makes one change when two administrators decide at once', async () => {
    const event = await eventIn('PUBLISHED', { websiteUrl: SITE_A })
    const body = { enabled: true, reason: 'Checked by both of us.', websiteUrl: SITE_A }

    const answers = await Promise.all([
      decide(event.id, world.adminHeaders, body),
      decide(event.id, world.secondAdminHeaders, body),
    ])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409])
    expect(answers.find((answer) => answer.statusCode === 409).json().error).toMatchObject({
      code: 'WEBSITE_REDIRECT_UNCHANGED',
      details: { enabled: true },
    })
    expect(await decisions(event.id)).toHaveLength(1)
  })

  it('compares the exact stored string, so a legacy spelling is decided as stored', async () => {
    const legacy = `https://legacy-${RUN}.example/Nights/%7Eall`
    const event = await eventIn('PUBLISHED', { websiteUrl: legacy })

    const lowered = await decide(event.id, world.adminHeaders, {
      enabled: true,
      reason: 'Checked.',
      websiteUrl: legacy.toLowerCase(),
    })

    expect(lowered.statusCode).toBe(409)

    const exact = await decide(event.id, world.adminHeaders, {
      enabled: true,
      reason: 'Checked.',
      websiteUrl: legacy,
    })

    expect(exact.statusCode, exact.body).toBe(200)
    expect((await stored(event.id)).websiteDecidedUrl).toBe(legacy)
  })

  it('runs inside a caller’s transaction, and is undone with it', async () => {
    const event = await eventIn('PUBLISHED', { websiteUrl: SITE_A })

    await expect(
      prisma.$transaction(async (tx) => {
        // Prisma's transaction client is told from a client by its missing
        // connection methods (since Prisma 7 it has a `$transaction`, which
        // would open a savepoint); the decision runs in this transaction.
        expect(isTransactionClient(tx)).toBe(true)
        expect(isTransactionClient(prisma)).toBe(false)

        // Any reach for `$transaction` would be a savepoint of its own: refused.
        const guarded = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === '$transaction') throw new Error('opened a transaction of its own')

            return Reflect.get(target, property, receiver)
          },
        })
        const decided = await decideWebsiteRedirect(guarded, {
          eventId: event.id,
          enabled: true,
          reason: 'Checked inside the import.',
          seenUrl: SITE_A,
          actor: world.actor,
        })

        expect(decided.websiteRedirectEnabled).toBe(true)

        throw new Error('the caller gives up')
      }),
    ).rejects.toThrow('the caller gives up')

    expect(await stored(event.id)).toMatchObject({
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
    })
    expect(await decisions(event.id)).toHaveLength(0)

    await prisma.$transaction((tx) =>
      decideWebsiteRedirect(tx, {
        eventId: event.id,
        enabled: true,
        reason: 'Checked inside the import.',
        seenUrl: SITE_A,
        actor: world.actor,
      }),
    )

    expect((await stored(event.id)).websiteRedirectEnabled).toBe(true)
    expect(await decisions(event.id)).toHaveLength(1)
  })

  it('lists the waiting addresses, and searches with _ and % taken literally', async () => {
    const waiting = await eventIn('REVIEW_PENDING', {
      websiteUrl: `https://site-${RUN}.example/under_score`,
      title: `Garba_Night ${RUN}`,
    })
    const lookalike = await eventIn('REVIEW_PENDING', {
      websiteUrl: `https://site-${RUN}.example/underxscore`,
      title: `GarbaxNight ${RUN}`,
    })
    const draft = await eventIn('DRAFT', { websiteUrl: `https://draft-${RUN}.example/` })

    const list = async (query) => {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/moderation/website-links${query}`,
        headers: world.adminHeaders,
      })

      expect(response.statusCode, response.body).toBe(200)

      return response.json().data.map((entry) => entry.eventId)
    }

    const all = await list(`?perPage=100&q=${RUN}`)

    expect(all).toEqual(expect.arrayContaining([waiting.id, lookalike.id]))
    expect(all).not.toContain(draft.id)
    expect(await list(`?state=drafts&perPage=100&q=${RUN}`)).toContain(draft.id)

    const underscore = await list(`?state=all&perPage=100&q=${encodeURIComponent('a_N')}`)

    expect(underscore).toContain(waiting.id)
    expect(underscore).not.toContain(lookalike.id)

    const bySite = await list(`?state=all&perPage=100&q=${encodeURIComponent('under_score')}`)

    expect(bySite).toEqual([waiting.id])
  })
})

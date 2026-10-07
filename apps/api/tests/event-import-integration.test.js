/**
 * Importing listed events on a real database (SPEC2-XI area I).
 *
 * The stub models none of the triggers, CHECKs and unique indexes the import
 * leans on, and serialises every write, so these claims are made here:
 *
 *  - the platform-held organisation takes no member: the database's trigger
 *    refuses one, and `platform.grantMembership` answers 409
 *    `PLATFORM_HELD_ORGANIZATION` through `buildApp`, not a 500;
 *  - one platform-held organisation per source, and one import record per
 *    listing;
 *  - an imported event is created as a draft and moved into review through the
 *    review gate (`desi_event_status_requires_review`), and the approval moves
 *    it REVIEW_PENDING → APPROVED → PUBLISHED in one transaction the gate
 *    accepts, with its Sulekha link switched on consistently;
 *  - two applies of one run at once write once; two approvals of one event at
 *    once publish it once;
 *  - moving an imported event moves its venue, or copies one another event
 *    still uses;
 *  - two copying passes over one run's pictures at once store each listed
 *    picture once;
 *  - a file under the request's 2 MiB whose stored form is over the run's
 *    CHECK is refused with 422 `IMPORT_INVALID`, not a 500.
 *
 * Collected by the API suite and by `pnpm verify:tests:fresh`, and run with
 * `REQUIRE_DATABASE=1` in CI. Nothing is cleaned up; every row carries this
 * run's tag.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-import-integration
 */

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import {
  RUN_DATASET_BYTES,
  applyImport,
  jsonbTextBytes,
  previewImport,
  retryRunImages,
} from '../src/lib/event-import.js'
import { createPostgresMediaStorage } from '../src/lib/media-storage.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { solidPng } from './helpers/images.js'

const { prisma, reachable, when } = await connectTestDatabase('the import suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Digits for this run's listing ids (the CHECK allows 1-12 digits). */
const DIGITS = String(Date.now()).slice(-8)

/** One clock for every listing, so a file read twice plans the same. */
const NOW = Math.floor(Date.now() / 1000) * 1000

const COVER = solidPng(1200, 700)
const GALLERY = solidPng(400, 400)

let app
let world
let listingSequence = 0

/**
 * A picture fetcher answering from memory: no network in this suite.
 *
 * @param {string} url The address.
 * @returns {Promise<object>} What `fetchImportImage` answers.
 */
async function fetchFromMemory(url) {
  return { ok: true, bytes: url.includes('cover') ? COVER : GALLERY, contentType: 'image/png' }
}

/**
 * A fresh listing id for this run.
 *
 * @returns {string} 10 digits.
 */
function sourceId() {
  listingSequence += 1

  return `${DIGITS}${String(listingSequence).padStart(2, '0')}`
}

/**
 * One listing, twelve days from now.
 *
 * @param {string} id The listing id.
 * @param {object} [overrides] Fields to replace.
 * @returns {object} The listing.
 */
function listing(id, overrides = {}) {
  return {
    sourceId: id,
    sourceUrl: `https://events.sulekha.com/garba_event-in_irving-tx_${id}`,
    scrapedAt: '2026-09-29T21:25:00Z',
    title: `Imported Garba ${RUN} ${id}`,
    category: 'GARBA_DANDIYA',
    sourceCategory: 'GARBA_DANDIYA',
    summary: 'An evening of garba and dandiya with a live band.',
    description: 'Dance the night away.',
    startsAt: new Date(NOW + 12 * 86_400_000).toISOString(),
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
    prices: [{ name: 'Regular', priceCents: 2500, currency: 'USD', note: null }],
    priceText: '$25',
    ageRestriction: null,
    dressCode: null,
    parking: null,
    faq: [],
    images: [
      {
        url: `https://usimg.sulekha.io/cdn/events/images/cover-${id}.png`,
        role: 'cover',
        alt: 'The poster',
      },
    ],
    ticketUrl: `https://events.sulekha.com/garba_event-in_irving-tx_${id}`,
    importNotes: [],
    ...overrides,
  }
}

/**
 * A whole file.
 *
 * @param {object[]} events The listings.
 * @returns {object} The dataset.
 */
function dataset(events) {
  return {
    format: 'desi-event-import/1',
    source: 'SULEKHA',
    sourceName: 'Sulekha',
    sourceSite: 'https://events.sulekha.com/',
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
    imageHosts: ['usimg.sulekha.io'],
    events,
  }
}

/**
 * A user with a confirmed second factor.
 *
 * @param {string} label Distinguishes them.
 * @param {string} role The platform role.
 * @returns {Promise<object>} The user.
 */
async function person(label, role) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@import.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      userId: user.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  return user
}

/**
 * Bearer headers for a session whose second factor was confirmed just now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'import-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * Preview and apply a file as the administrator.
 *
 * @param {object} file The dataset.
 * @returns {Promise<object>} The run, as the preview answered it.
 */
async function importFile(file) {
  const previewed = await app.inject({
    method: 'POST',
    url: '/v1/platform/imports',
    headers: world.administrator.headers,
    payload: { fileName: 'listings.json', dataset: file },
  })

  expect(previewed.statusCode, previewed.body).toBe(201)

  const run = previewed.json().data
  const applied = await app.inject({
    method: 'POST',
    url: `/v1/platform/imports/${run.id}/apply`,
    headers: world.administrator.headers,
    payload: { planDigest: run.planDigest },
  })

  expect(applied.statusCode, applied.body).toBe(200)

  return run
}

/**
 * The imported event for a listing.
 *
 * @param {string} id The listing id.
 * @returns {Promise<object>} The event, with its organisation.
 */
async function eventFor(id) {
  const item = await prisma.eventImportItem.findUnique({
    where: { source_sourceId: { source: 'SULEKHA', sourceId: id } },
    include: { event: { include: { organization: true } } },
  })

  return item.event
}

/**
 * Approve events of a run at their current revisions.
 *
 * @param {string} runId The run.
 * @param {string[]} eventIds The events.
 * @returns {Promise<object>} The response.
 */
async function approve(runId, eventIds) {
  const events = await prisma.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, revision: true },
  })

  return app.inject({
    method: 'POST',
    url: `/v1/platform/imports/${runId}/approve`,
    headers: world.administrator.headers,
    payload: {
      items: eventIds.map((eventId) => ({
        eventId,
        revision: events.find((row) => row.id === eventId).revision,
      })),
    },
  })
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, eventImport: { max: 1000 } },
    fetchImportImage: fetchFromMemory,
  })
  await app.ready()

  const administrator = await person('import-admin', 'ADMIN')
  const superAdministrator = await person('import-super', 'SUPER_ADMIN')
  const organiser = await person('import-organiser', 'ORGANIZER')
  const target = await prisma.organization.create({
    data: {
      name: `Garba Target ${RUN}`,
      slug: `garba-target-${RUN}`,
      contactEmail: `target-${RUN}@import.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
      payoutCurrency: 'USD',
    },
  })

  world = {
    target,
    organiser,
    administrator: { user: administrator, headers: await sessionFor(administrator) },
    superAdministrator: {
      user: superAdministrator,
      headers: await sessionFor(superAdministrator),
    },
  }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

when()('the platform-held organisation and its records', () => {
  it('creates an imported event as a draft and moves it into review through the gate', async () => {
    const id = sourceId()
    const run = await importFile(dataset([listing(id)]))
    const event = await eventFor(id)

    expect(event.status).toBe('REVIEW_PENDING')
    expect(event.organization).toMatchObject({
      platformHeldSource: 'SULEKHA',
      verificationStatus: 'VERIFIED',
    })

    const moves = await prisma.eventModerationAction.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'asc' },
    })

    expect(moves.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      ['DRAFT', 'REVIEW_PENDING'],
    ])
    expect(moves[0].reason).toBe(`Imported from Sulekha, run ${run.id}.`)

    const night = await prisma.eventSession.findFirst({ where: { eventId: event.id } })

    expect(night.endTimeListed).toBe(false)
    expect(await prisma.ticketType.count({ where: { eventId: event.id } })).toBe(0)

    // The database never let it be inserted public: the gate refuses a draft
    // made public directly.
    await expect(
      prisma.event.update({ where: { id: event.id }, data: { status: 'PUBLISHED' } }),
    ).rejects.toThrow(/event_public_requires_review|review/u)
  })

  it('takes no member: the trigger refuses one, and the API answers 409, not 500', async () => {
    const id = sourceId()

    await importFile(dataset([listing(id)]))

    const { organization } = await eventFor(id)

    await expect(
      prisma.membership.create({
        data: { userId: world.organiser.id, organizationId: organization.id, role: 'OWNER' },
      }),
    ).rejects.toThrow(/platform_held_organization_has_no_members/u)

    await expect(
      prisma.invitation.create({
        data: {
          organizationId: organization.id,
          email: `invitee-${RUN}@import.example`,
          role: 'STAFF',
          tokenHash: 'a'.repeat(64),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      }),
    ).rejects.toThrow(/platform_held_organization_has_no_members/u)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${organization.id}/members`,
      headers: world.superAdministrator.headers,
      payload: {
        userId: world.organiser.id,
        role: 'OWNER',
        reason: 'Trying to put an owner into the platform-held organisation.',
      },
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('PLATFORM_HELD_ORGANIZATION')
    expect(await prisma.membership.count({ where: { organizationId: organization.id } })).toBe(0)
  })

  it('holds one platform-held organisation per source, and one record per listing', async () => {
    const id = sourceId()

    await importFile(dataset([listing(id)]))

    const event = await eventFor(id)

    await expect(
      prisma.organization.create({
        data: {
          name: 'Another Sulekha',
          slug: `another-sulekha-${RUN}`,
          contactEmail: `another-${RUN}@import.example`,
          platformHeldSource: 'SULEKHA',
        },
      }),
    ).rejects.toThrow(/Unique constraint|platformHeldSource/u)

    await expect(
      prisma.eventImportItem.create({
        data: {
          source: 'SULEKHA',
          sourceId: id,
          sourceUrl: `https://events.sulekha.com/x_${id}`,
          eventId: world.target.id,
          scrapedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/Unique constraint|Foreign key/u)

    expect(await prisma.organization.count({ where: { platformHeldSource: 'SULEKHA' } })).toBe(1)
    expect(event.organization.platformHeldSource).toBe('SULEKHA')
  })
})

when()('approving and publishing', () => {
  it('moves REVIEW_PENDING → APPROVED → PUBLISHED in one transaction the gate accepts, link on', async () => {
    const id = sourceId()
    const run = await importFile(dataset([listing(id)]))
    const event = await eventFor(id)
    const response = await approve(run.id, [event.id])

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.results[0]).toMatchObject({
      outcome: 'PUBLISHED',
      status: 'PUBLISHED',
      picturesApproved: 1,
    })

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after).toMatchObject({
      status: 'PUBLISHED',
      websiteRedirectEnabled: true,
      websiteDecidedUrl: after.websiteUrl,
      websiteDecisionPending: false,
    })

    const moves = await prisma.eventModerationAction.findMany({
      where: { eventId: event.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    expect(moves.map((row) => row.toStatus).sort()).toEqual(
      ['APPROVED', 'PUBLISHED', 'REVIEW_PENDING'].sort(),
    )

    const audits = await prisma.auditLog.findMany({
      where: { entityId: event.id, action: { in: ['event.approved', 'event.published'] } },
    })

    expect(audits.map((row) => row.action).sort()).toEqual(['event.approved', 'event.published'])
    expect(audits.find((row) => row.action === 'event.approved').metadata).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      importedById: world.administrator.user.id,
    })

    // The public page: who presents it, the listed price, the link to Sulekha.
    const page = await app.inject({ method: 'GET', url: `/v1/events/${after.slug}` })

    expect(page.statusCode).toBe(200)
    expect(page.json().data.importedFrom).toMatchObject({
      presentedBy: 'DFW Garba Collective',
      prices: [{ name: 'Regular', priceCents: 2500, currency: 'USD' }],
      ticketsOnSource: true,
    })
    expect(page.json().data.websiteLink).toEqual({ host: 'events.sulekha.com' })
    expect(page.body).not.toMatch(/usimg\.sulekha\.io/u)
  })

  it('applies a run once when two applies arrive together', async () => {
    const id = sourceId()
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: world.administrator.headers,
      payload: { fileName: 'listings.json', dataset: dataset([listing(id)]) },
    })
    const run = previewed.json().data
    const applyOnce = () =>
      app.inject({
        method: 'POST',
        url: `/v1/platform/imports/${run.id}/apply`,
        headers: world.administrator.headers,
        payload: { planDigest: run.planDigest },
      })

    const answers = await Promise.all([applyOnce(), applyOnce()])

    expect(answers.map((answer) => answer.statusCode).sort()).toEqual([200, 409])
    expect(answers.find((answer) => answer.statusCode === 409).json().error.code).toBe(
      'IMPORT_RUN_APPLIED',
    )
    expect(await prisma.eventImportItem.count({ where: { source: 'SULEKHA', sourceId: id } })).toBe(
      1,
    )
    expect(await prisma.event.count({ where: { title: `Imported Garba ${RUN} ${id}` } })).toBe(1)
  })

  it('publishes an event once when two approvals arrive together', async () => {
    const id = sourceId()
    const run = await importFile(dataset([listing(id)]))
    const event = await eventFor(id)
    const answers = await Promise.all([approve(run.id, [event.id]), approve(run.id, [event.id])])
    const outcomes = answers.map((answer) => answer.json().data.results[0].outcome).sort()

    expect(outcomes).toEqual(['PUBLISHED', 'REFUSED'])
    expect(
      await prisma.auditLog.count({ where: { entityId: event.id, action: 'event.published' } }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { entityId: event.id, action: 'event.website_redirect_changed' },
      }),
    ).toBe(1)
  })
})

when()('who imported it, when the import exemption is recorded (SPEC2-XI O5)', () => {
  /**
   * Preview and apply a file as a given administrator.
   *
   * @param {object} headers The administrator's headers.
   * @param {object} file The dataset.
   * @returns {Promise<object>} The run, as the preview answered it.
   */
  async function importAs(headers, file) {
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers,
      payload: { fileName: 'listings.json', dataset: file },
    })

    expect(previewed.statusCode, previewed.body).toBe(201)

    const run = previewed.json().data
    const applied = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers,
      payload: { planDigest: run.planDigest },
    })

    expect(applied.statusCode, applied.body).toBe(200)

    return run
  }

  it('names the administrator who sent this version for review, not the one who first imported it', async () => {
    const id = sourceId()
    const first = world.administrator.user

    await importAs(world.administrator.headers, dataset([listing(id)]))

    const second = await person('import-admin-second', 'ADMIN')
    const secondHeaders = await sessionFor(second)
    const run = await importAs(
      secondHeaders,
      dataset([listing(id, { description: 'Dance the night away, now with a live dhol.' })]),
    )

    expect(run.rows.map((row) => row.action)).toEqual(['UPDATE_DRAFT'])

    const event = await eventFor(id)
    const item = await prisma.eventImportItem.findUnique({ where: { eventId: event.id } })

    // The second administrator withdrew it, updated it and sent it back.
    expect(item.importedById).toBe(second.id)

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/approve`,
      headers: secondHeaders,
      payload: { items: [{ eventId: event.id, revision: event.revision }] },
    })

    expect(approved.statusCode, approved.body).toBe(200)
    expect(approved.json().data.results[0]).toMatchObject({ outcome: 'PUBLISHED' })

    const decision = await prisma.eventModerationAction.findFirst({
      where: { eventId: event.id, toStatus: 'APPROVED' },
    })

    expect(decision.reason).toContain(`imported by ${second.id}, approved by ${second.id}`)
    expect(decision.reason).not.toContain(first.id)

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: event.id, action: 'event.approved' },
    })

    expect(audit.metadata).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      importedById: second.id,
      approvedById: second.id,
    })
  })

  it('does not exempt an account that only sent an import back for review', async () => {
    const id = sourceId()

    await importAs(world.administrator.headers, dataset([listing(id)]))

    const event = await eventFor(id)
    const superHeaders = world.superAdministrator.headers

    // A super administrator may withdraw and resubmit any event, this one too;
    // that makes them its submitter, not its importer.
    const withdrawn = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/withdraw-review`,
      headers: superHeaders,
    })

    expect(withdrawn.statusCode, withdrawn.body).toBe(200)

    const resubmitted = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/submit-review`,
      headers: superHeaders,
      payload: {},
    })

    expect(resubmitted.statusCode, resubmitted.body).toBe(200)

    const current = await prisma.event.findUnique({ where: { id: event.id } })
    const decided = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers: superHeaders,
      payload: { decision: 'approve', revision: current.revision },
    })

    expect(decided.statusCode, decided.body).toBe(403)
    expect(decided.json().error.code).toBe('SELF_REVIEW')
    expect((await prisma.event.findUnique({ where: { id: event.id } })).status).toBe(
      'REVIEW_PENDING',
    )
    expect(
      (await prisma.eventImportItem.findUnique({ where: { eventId: event.id } })).importedById,
    ).toBe(world.administrator.user.id)
  })
})

when()('moving an imported event to an organiser', () => {
  it('moves the venue when nothing else uses it, and copies it when something does', async () => {
    const lone = sourceId()
    const shared = sourceId()
    const sibling = sourceId()
    const loneVenue = { ...listing(lone).venue, name: `Lone Hall ${RUN}` }

    const run = await importFile(
      dataset([listing(lone, { venue: loneVenue }), listing(shared), listing(sibling)]),
    )
    const moved = await eventFor(lone)
    const copied = await eventFor(shared)
    const kept = await eventFor(sibling)

    expect(copied.venueId).toBe(kept.venueId)

    // Published first, so the Sulekha link is on and must go off.
    await approve(run.id, [moved.id])

    for (const event of [moved, copied]) {
      const current = await prisma.event.findUnique({ where: { id: event.id } })
      const response = await app.inject({
        method: 'POST',
        url: `/v1/platform/imports/events/${event.id}/reassign`,
        headers: world.administrator.headers,
        payload: {
          organizationId: world.target.id,
          reason: 'They run this event themselves.',
          revision: current.revision,
        },
      })

      expect(response.statusCode, response.body).toBe(200)
    }

    const movedAfter = await prisma.event.findUnique({
      where: { id: moved.id },
      include: { venue: true },
    })
    const copiedAfter = await prisma.event.findUnique({
      where: { id: copied.id },
      include: { venue: true },
    })
    const keptVenue = await prisma.venue.findUnique({ where: { id: kept.venueId } })

    expect(movedAfter.organizationId).toBe(world.target.id)
    expect(movedAfter.venueId).toBe(moved.venueId)
    expect(movedAfter.venue.organizationId).toBe(world.target.id)
    expect(movedAfter.websiteRedirectEnabled).toBe(false)

    expect(copiedAfter.venueId).not.toBe(kept.venueId)
    expect(copiedAfter.venue).toMatchObject({
      organizationId: world.target.id,
      name: keptVenue.name,
      provenance: 'import:sulekha',
    })
    expect(keptVenue.organizationId).toBe(kept.organizationId)

    const items = await prisma.eventImportItem.findMany({
      where: { eventId: { in: [moved.id, copied.id] } },
    })

    expect(items.every((item) => item.reassignedToOrganizationId === world.target.id)).toBe(true)

    // No longer the platform's: no "Presented by", no Sulekha prices.
    const page = await app.inject({ method: 'GET', url: `/v1/events/${movedAfter.slug}` })

    expect(page.json().data.importedFrom).toBeNull()
    expect(page.json().data.websiteLink).toBeNull()
  })
})

when()('a night whose listing gave no end time', () => {
  it('keeps the estimate hidden while the night only moves, and shows an end its organiser sets', async () => {
    const id = sourceId()
    const run = await importFile(dataset([listing(id)]))
    const imported = await eventFor(id)

    await approve(run.id, [imported.id])

    const owner = await person('import-new-owner', 'ORGANIZER')

    await prisma.membership.create({
      data: { userId: owner.id, organizationId: world.target.id, role: 'OWNER' },
    })

    const ownerHeaders = await sessionFor(owner)
    const published = await prisma.event.findUnique({ where: { id: imported.id } })
    const moved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${imported.id}/reassign`,
      headers: world.administrator.headers,
      payload: {
        organizationId: world.target.id,
        reason: 'They run this event themselves.',
        revision: published.revision,
      },
    })

    expect(moved.statusCode, moved.body).toBe(200)

    const night = await prisma.eventSession.findFirst({ where: { eventId: imported.id } })
    const hour = 3_600_000

    expect(night.endTimeListed).toBe(false)

    /**
     * Change the night as its new owner, confirming the change for ticket holders.
     *
     * @param {object} patch The session fields.
     * @returns {Promise<object>} The response.
     */
    const change = async (patch) => {
      const { revision } = await prisma.event.findUnique({ where: { id: imported.id } })

      return app.inject({
        method: 'PATCH',
        url: `/v1/events/${imported.id}/sessions/${night.id}`,
        headers: ownerHeaders,
        payload: {
          revision,
          capacity: 400,
          confirmMaterialChange: true,
          changeReason: 'The hall moved the night by an hour.',
          ...patch,
        },
      })
    }
    const publicNight = async () =>
      (await app.inject({ method: 'GET', url: `/v1/events/${published.slug}` })).json().data
        .sessions[0]

    // The whole night an hour later: still the estimate, carried along.
    const later = await change({
      startsAt: new Date(night.startsAt.getTime() + hour).toISOString(),
      endsAt: new Date(night.endsAt.getTime() + hour).toISOString(),
    })

    expect(later.statusCode, later.body).toBe(200)
    // The editor's own copy says so too, so it can label the estimate.
    expect(later.json().data.endTimeListed).toBe(false)
    expect(await publicNight()).toMatchObject({ endTimeListed: false })

    // The organiser says when it really ends: that end is shown from now on.
    const realEnd = new Date(night.startsAt.getTime() + 6 * hour).toISOString()
    const ended = await change({
      endsAt: realEnd,
      changeReason: 'The organiser confirmed the night ends at one in the morning.',
    })

    expect(ended.statusCode, ended.body).toBe(200)
    expect(ended.json().data.endTimeListed).toBe(true)
    expect(await publicNight()).toMatchObject({ endsAt: realEnd, endTimeListed: true })
    expect((await prisma.eventSession.findUnique({ where: { id: night.id } })).endTimeListed).toBe(
      true,
    )
  })
})

when()('copying pictures', () => {
  it('stores each listed picture once when two copying passes overlap', async () => {
    const id = sourceId()
    const actor = world.administrator.user
    const storage = createPostgresMediaStorage(prisma)
    const file = dataset([
      listing(id, {
        images: [
          {
            url: `https://usimg.sulekha.io/cdn/events/images/cover-${id}.png`,
            role: 'cover',
            alt: 'The poster',
          },
          {
            url: `https://usimg.sulekha.io/cdn/events/images/gallery-${id}.png`,
            role: 'gallery',
            alt: 'The dance floor',
          },
        ],
      }),
    ])
    const previewed = await previewImport(prisma, {
      fileName: 'listings.json',
      dataset: file,
      actor,
      via: 'web',
    })

    // Applied while the picture host could not be reached: both failed.
    await applyImport(prisma, storage, {
      run: previewed,
      actor,
      planDigest: previewed.planDigest,
      via: 'web',
      env: {},
      fetchImage: async () => ({ ok: false, code: 'TIMEOUT' }),
    })

    const run = await prisma.eventImportRun.findUnique({ where: { id: previewed.id } })
    const slowly = async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 300))

      return fetchFromMemory(url)
    }

    // Two "Retry pictures" at once: two administrators, or a retry beside a
    // command-line apply still copying.
    const passes = await Promise.all([
      retryRunImages(prisma, storage, { run, actor, env: {}, fetchImage: slowly }),
      retryRunImages(prisma, storage, { run, actor, env: {}, fetchImage: slowly }),
    ])
    const event = await eventFor(id)
    const assets = await prisma.mediaAsset.findMany({
      where: { eventId: event.id },
      select: { id: true, kind: true },
    })
    const rows = await prisma.eventImportImage.findMany({
      where: { item: { eventId: event.id } },
      select: { status: true, mediaAssetId: true },
    })

    expect(assets.map((asset) => asset.kind).sort()).toEqual(['EVENT_COVER', 'EVENT_GALLERY'])
    expect(rows.map((row) => row.status)).toEqual(['STORED', 'STORED'])
    expect(rows.map((row) => row.mediaAssetId).sort()).toEqual(
      assets.map((asset) => asset.id).sort(),
    )
    expect(passes[0].stored + passes[1].stored).toBe(2)
    expect(
      await prisma.auditLog.count({
        where: { entityId: event.id, action: 'event.media_added' },
      }),
    ).toBe(2)

    // Approving publishes the two pictures the listing names, no more.
    const approved = await approve(run.id, [event.id])

    expect(approved.json().data.results[0]).toMatchObject({
      outcome: 'PUBLISHED',
      picturesApproved: 2,
    })
  })
})

when()('previewing a file near the size limit', () => {
  it('refuses a file whose stored form is over 2 MiB with 422, not 500', async () => {
    // Twelve-digit ids, apart from `sourceId()`'s ten.
    const events = Array.from({ length: 200 }, (_, index) =>
      listing(`${DIGITS}9${String(index).padStart(3, '0')}`, {
        performers: Array.from({ length: 20 }, (__, n) => ({ name: `P${n}`, role: 'r' })),
        prices: Array.from({ length: 20 }, (__, n) => ({
          name: `T${n}`,
          priceCents: n,
          currency: 'USD',
          note: null,
        })),
        faq: Array.from({ length: 10 }, (__, n) => ({ q: `q${n}`, a: `a${n}` })),
        images: [],
      }),
    )
    const file = dataset(events)
    const room =
      2 * 1024 * 1024 -
      4096 -
      Buffer.byteLength(JSON.stringify({ fileName: 'big.json', dataset: file }))
    const each = Math.floor(room / events.length)

    for (const event of events) event.description = `${event.description}${'D'.repeat(each)}`

    const payload = JSON.stringify({ fileName: 'big.json', dataset: file })

    // Under the request's limit as sent, over the run's CHECK as stored.
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(jsonbTextBytes(file)).toBeGreaterThan(RUN_DATASET_BYTES)

    const before = await prisma.eventImportRun.count({ where: { fileName: 'big.json' } })
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: { ...world.administrator.headers, 'content-type': 'application/json' },
      payload,
    })

    expect(response.statusCode, response.body.slice(0, 500)).toBe(422)
    expect(response.json().error.code).toBe('IMPORT_INVALID')
    expect(response.json().error.problems.join(' ')).toMatch(/keep it to 2 MiB/u)
    expect(await prisma.eventImportRun.count({ where: { fileName: 'big.json' } })).toBe(before)
  })
})

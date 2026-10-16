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
 *  - an imported event is created as a draft with a ticket type per listed
 *    price and moved into review through the review gate
 *    (`desi_event_status_requires_review`), and the approval moves it
 *    REVIEW_PENDING → APPROVED → PUBLISHED → ON_SALE in one transaction the
 *    gate accepts, with no website link;
 *  - two applies of one run at once write once; two approvals of one event at
 *    once publish it once;
 *  - moving an imported event moves its venue, or copies one another event
 *    still uses;
 *  - sold on The Desi Events (2026-10-15): a US and a Canadian listing are
 *    imported, approved and sold through the real checkout routes in MOCK mode
 *    (hold → quote → order → settlement), with the booking fee and tax applied,
 *    tickets issued and the allowance counted down; the tier the listing sold
 *    out of is refused; the door admits, a refund goes through and the finance
 *    and organiser views answer for the platform-held organisation; a re-import
 *    never changes a tier that has sold; and nothing is fetched from anywhere;
 *  - migration 20261015100000 clears every imported event's link to the
 *    source on an upgrade fixture, keeps everything else, and changes nothing
 *    the second time;
 *  - a file under the request's 2 MiB whose stored form is over the run's
 *    CHECK is refused with 422 `IMPORT_INVALID`, not a 500;
 *  - a listing in Canada is stored with its province, postal code, zone and
 *    CAD prices as given, its tiers in CAD, its venue reused by a second
 *    listing there, and is shown so on its page, in the listing filtered by
 *    its city and in the city facet, with no website link;
 *  - an administrator takes a published import off the site and puts it back
 *    live, twice over: off its page and the listing while deleted, back at the
 *    same address with its organiser after, back on sale in an editing
 *    session, the import leaving it alone meanwhile, and nothing purged;
 *  - a platform-held organisation made under its first name ends up named
 *    "The Desi Events": by migration 20261015090000 (its own SQL, run here),
 *    which makes a taken address unique and changes nothing the second time,
 *    and by the next import, which audits it once;
 *  - approving every pending imported event (2026-10-16), held to this
 *    suite's runs: a listing two runs imported is approved once, from the
 *    later; one with nothing to sell is published; one that has started is
 *    left; a stale digest is refused; a second call approves nothing.
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

import dns from 'node:dns'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import tls from 'node:tls'

import { computeOrderTotals, resolveTaxPolicy } from '@desi-event/pricing'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { feeConfigFor } from '../src/lib/checkout-pricing.js'
import { loadActor } from '../src/lib/actor.js'
import {
  IMPORT_POLICIES,
  RUN_DATASET_BYTES,
  approvePendingImports,
  jsonbTextBytes,
  pendingImports,
  reassignLinkReason,
  syncListingTiers,
} from '../src/lib/event-import.js'
import { lockTicketTypes } from '../src/lib/inventory.js'
import {
  PLATFORM_HELD_ORGANIZATIONS,
  ensurePlatformHeldOrganization,
  isPlatformHeldSlug,
} from '../src/lib/organization-provisioning.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, reachable, when } = await connectTestDatabase('the import suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Digits for this run's listing ids (the CHECK allows 1-12 digits). */
const DIGITS = String(Date.now()).slice(-8)

/** One clock for every listing, so a file read twice plans the same. */
const NOW = Math.floor(Date.now() / 1000) * 1000

let app
let world
let listingSequence = 0

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
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
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
    // Payment references unique to this run: the database keeps every run's.
    providers: createInMemoryProviderRegistry({ payments: { idPrefix: `piimport${RUN}` } }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, eventImport: { max: 1000 } },
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
    expect(moves[0].reason).toBe(`Imported from its listing, run ${run.id}.`)

    const night = await prisma.eventSession.findFirst({ where: { eventId: event.id } })

    expect(night.endTimeListed).toBe(false)
    // Its one listed price is a ticket type, not yet on sale, on the allowance.
    expect(
      await prisma.ticketType.findMany({
        where: { eventId: event.id },
        select: {
          name: true,
          priceCents: true,
          currency: true,
          status: true,
          quantityTotal: true,
          quantityIsAllowance: true,
          importKey: true,
        },
      }),
    ).toEqual([
      {
        name: 'Regular',
        priceCents: 2500,
        currency: 'USD',
        status: 'DRAFT',
        quantityTotal: 100,
        quantityIsAllowance: true,
        importKey: 'Regular',
      },
    ])
    expect(event.websiteUrl).toBeNull()

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
  it('moves REVIEW_PENDING → APPROVED → PUBLISHED → ON_SALE in one transaction the gate accepts, linking nowhere', async () => {
    const id = sourceId()
    const run = await importFile(dataset([listing(id)]))
    const event = await eventFor(id)
    const response = await approve(run.id, [event.id])

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.results[0]).toMatchObject({
      outcome: 'PUBLISHED',
      status: 'ON_SALE',
      ticketTypesOnSale: 1,
    })

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after).toMatchObject({
      status: 'ON_SALE',
      websiteUrl: null,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: false,
    })
    expect(after.salesOpenedAt).toBeInstanceOf(Date)

    const moves = await prisma.eventModerationAction.findMany({
      where: { eventId: event.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    expect(moves.map((row) => row.toStatus).sort()).toEqual(
      ['APPROVED', 'ON_SALE', 'PUBLISHED', 'REVIEW_PENDING'].sort(),
    )

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: event.id,
        action: { in: ['event.approved', 'event.published', 'event.on_sale'] },
      },
    })

    expect(audits.map((row) => row.action).sort()).toEqual([
      'event.approved',
      'event.on_sale',
      'event.published',
    ])
    expect(audits.find((row) => row.action === 'event.approved').metadata).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      importedById: world.administrator.user.id,
    })

    // The public page: who presents it, the listed price, its own tier on
    // sale here, and no link.
    const page = await app.inject({ method: 'GET', url: `/v1/events/${after.slug}` })

    expect(page.statusCode).toBe(200)
    expect(page.json().data.importedFrom).toEqual({
      presentedBy: 'DFW Garba Collective',
      listedOn: '2026-09-29',
      prices: [{ name: 'Regular', priceCents: 2500, currency: 'USD' }],
      priceListed: true,
    })
    expect(page.json().data.websiteLink).toBeNull()
    expect(
      page
        .json()
        .data.ticketTypes.map((tier) => [tier.name, tier.status, tier.quantityIsAllowance]),
    ).toEqual([['Regular', 'ON_SALE', true]])
    expect(page.body).not.toMatch(/sulekha/iu)
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
      await prisma.auditLog.count({ where: { entityId: event.id, action: 'event.on_sale' } }),
    ).toBe(1)
    expect(
      await prisma.auditLog.count({
        where: { entityId: event.id, action: 'event.website_redirect_changed' },
      }),
    ).toBe(0)
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

    // Published and on sale first: it moves with its tiers and sales.
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
      provenance: 'import:listing',
    })
    expect(keptVenue.organizationId).toBe(kept.organizationId)

    const items = await prisma.eventImportItem.findMany({
      where: { eventId: { in: [moved.id, copied.id] } },
    })

    expect(items.every((item) => item.reassignedToOrganizationId === world.target.id)).toBe(true)

    // No longer the platform's: no "Presented by", no listed prices.
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

when()('selling an imported event on The Desi Events (2026-10-15)', () => {
  /**
   * A buyer with a session of their own.
   *
   * @param {string} label Distinguishes them.
   * @returns {Promise<{user: object, headers: object}>} The buyer.
   */
  async function buyer(label) {
    const user = await person(label, 'ATTENDEE')

    return { user, headers: await sessionFor(user) }
  }

  /**
   * Hold, quote and buy tickets of one tier through the routes, as a buyer's
   * browser does: hold → quote → order, paid by the in-memory provider (MOCK).
   *
   * @param {object} who The buyer.
   * @param {object} event The event.
   * @param {object} tier The ticket type.
   * @param {number} quantity How many.
   * @returns {Promise<{quote: object, order: object}>} The quote's data and the paid order's.
   */
  async function buy(who, event, tier, quantity) {
    const held = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: who.headers,
      payload: { ticketTypeId: tier.id, quantity },
    })

    expect(held.statusCode, held.body).toBe(201)

    const items = [{ ticketTypeId: tier.id, quantity }]
    const holdIds = [held.json().data.id]
    const quoted = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers: who.headers,
      payload: { eventId: event.id, items, holdIds },
    })

    expect(quoted.statusCode, quoted.body).toBe(200)

    const quote = quoted.json().data
    const ordered = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: who.headers,
      payload: {
        eventId: event.id,
        buyerEmail: who.user.email,
        buyerName: who.user.displayName,
        items,
        holdIds,
        expectedTotalCents: quote.totalCents,
      },
    })

    expect(ordered.statusCode, ordered.body).toBe(201)

    return { quote, order: ordered.json().data }
  }

  /**
   * Import, approve and put on sale a US and a Canadian listing.
   *
   * @returns {Promise<{us: object, ca: object, run: object, file: object}>} The two events and their run.
   */
  async function onSale() {
    const usId = sourceId()
    const caId = sourceId()
    const usPrices = [
      { name: 'General', priceCents: 2500, currency: 'USD', note: null },
      { name: 'VIP (Final Call)', priceCents: 6000, currency: 'USD', note: 'Sold Out' },
      { name: 'Kids', priceCents: 0, currency: 'USD', note: null },
    ]
    const file = dataset([
      listing(usId, { prices: usPrices }),
      torontoListing(caId, {
        // Not the city, venue or title the Canadian suite below looks for.
        title: `Ontario Sale ${RUN} ${caId}`,
        venue: {
          name: `Square One Hall ${RUN}`,
          addressLine1: '100 City Centre Dr',
          city: 'Mississauga',
          region: 'ON',
          postalCode: 'L5B 2C9',
          country: 'CA',
        },
        prices: [
          { name: 'Adult', priceCents: 3000, currency: 'CAD', note: null },
          { name: 'Adult', priceCents: 3000, currency: 'CAD', note: 'Sold Out' },
        ],
      }),
    ])
    const run = await importFile(file)
    const us = await eventFor(usId)
    const ca = await eventFor(caId)
    const approved = await approve(run.id, [us.id, ca.id])

    expect(approved.statusCode, approved.body).toBe(200)
    expect(
      approved.json().data.results.map((row) => [row.outcome, row.status, row.ticketTypesOnSale]),
    ).toEqual([
      ['PUBLISHED', 'ON_SALE', 2],
      ['PUBLISHED', 'ON_SALE', 1],
    ])

    return { us, ca, run, file, usId, caId, usPrices }
  }

  /**
   * An event's ticket types, by their import key.
   *
   * @param {string} eventId The event.
   * @returns {Promise<Record<string, object>>} The tiers.
   */
  async function tiersOf(eventId) {
    const rows = await prisma.ticketType.findMany({ where: { eventId } })

    return Object.fromEntries(rows.map((row) => [row.importKey ?? row.name, row]))
  }

  it('imports a US and a Canadian listing, opens their sales, and sells through checkout with the booking fee and tax', async () => {
    const { us, ca } = await onSale()
    const usTiers = await tiersOf(us.id)
    const caTiers = await tiersOf(ca.id)

    // As the listing gave them, in the venue country's currency, on the
    // allowance, on sale from the approval until the event starts.
    expect(
      Object.values(usTiers)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((tier) => [
          tier.name,
          tier.priceCents,
          tier.currency,
          tier.status,
          tier.quantityTotal,
        ]),
    ).toEqual([
      ['General', 2500, 'USD', 'ON_SALE', 100],
      ['VIP', 6000, 'USD', 'CLOSED', 100],
      ['Kids', 0, 'USD', 'ON_SALE', 100],
    ])
    expect(Object.values(caTiers).map((tier) => [tier.name, tier.currency, tier.status])).toEqual([
      ['Adult', 'CAD', 'ON_SALE'],
    ])
    expect(usTiers.General.salesEndAt.getTime()).toBe(us.startsAt.getTime())
    expect(usTiers.General.quantityIsAllowance).toBe(true)

    // A US order: $25 × 2, the site's booking fee for USD, no US tax.
    const first = await buyer('import-buyer-us')
    const { quote, order } = await buy(first, us, usTiers.General, 2)
    const usTotals = computeOrderTotals({
      items: [{ ticketTypeId: usTiers.General.id, quantity: 2, unitPriceCents: 2500 }],
      feeConfig: feeConfigFor(testEnv(), 'USD'),
      taxRateBps: resolveTaxPolicy({ country: 'US', region: 'TX' }).rateBps,
      currency: 'USD',
    })

    expect(quote).toMatchObject({
      currency: 'USD',
      subtotalCents: 5000,
      feesCents: usTotals.feesCents,
      taxCents: usTotals.taxCents,
      totalCents: usTotals.totalCents,
    })
    expect(usTotals.feesCents).toBeGreaterThan(0)
    expect(order).toMatchObject({
      status: 'PAID',
      currency: 'USD',
      totalCents: usTotals.totalCents,
    })
    expect(order.tickets).toHaveLength(2)

    // A Canadian order: CA$30, the CAD booking fee, and Ontario's tax on both.
    const second = await buyer('import-buyer-ca')
    const canadian = await buy(second, ca, caTiers.Adult, 1)
    const caTotals = computeOrderTotals({
      items: [{ ticketTypeId: caTiers.Adult.id, quantity: 1, unitPriceCents: 3000 }],
      feeConfig: feeConfigFor(testEnv(), 'CAD'),
      taxRateBps: resolveTaxPolicy({ country: 'CA', region: 'ON' }).rateBps,
      currency: 'CAD',
    })

    expect(caTotals.taxCents).toBeGreaterThan(0)
    expect(canadian.order).toMatchObject({
      status: 'PAID',
      currency: 'CAD',
      taxCents: caTotals.taxCents,
      totalCents: caTotals.totalCents,
    })

    // A free tier sells too: nothing to pay, tickets issued.
    const free = await buy(first, us, usTiers.Kids, 1)

    expect(free.order).toMatchObject({ status: 'PAID', totalCents: 0 })

    // Tickets issued to the platform-held organisation's event, the
    // allowance counted down.
    const tickets = await prisma.ticket.findMany({
      where: { orderItem: { order: { id: order.id } } },
      select: { status: true, code: true },
    })

    expect(tickets.map((ticket) => ticket.status)).toEqual(['VALID', 'VALID'])
    expect(
      (await prisma.ticketType.findUnique({ where: { id: usTiers.General.id } })).quantitySold,
    ).toBe(2)
    expect(
      (await prisma.ticketType.findUnique({ where: { id: caTiers.Adult.id } })).quantitySold,
    ).toBe(1)

    const paid = await prisma.order.findUnique({ where: { id: order.id } })

    expect(paid).toMatchObject({
      eventId: us.id,
      feeGrossCents: usTotals.feeGrossCents,
      status: 'PAID',
    })
    expect(
      await prisma.ledgerBatch.count({ where: { orderId: order.id, status: 'POSTED' } }),
    ).toBeGreaterThan(0)

    // The public page offers no count of tickets left from the allowance:
    // the tiers say it is one.
    const page = (await app.inject({ method: 'GET', url: `/v1/events/${us.slug}` })).json().data

    expect(page.ticketTypes.every((tier) => tier.quantityIsAllowance === true)).toBe(true)
  })

  it('refuses the tier the listing sold out of, and never sells past the allowance', async () => {
    const { us } = await onSale()
    const tiers = await tiersOf(us.id)
    const who = await buyer('import-buyer-refused')

    const closed = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: who.headers,
      payload: { ticketTypeId: tiers.VIP.id, quantity: 1 },
    })

    expect(closed.statusCode).toBeGreaterThanOrEqual(400)
    expect(closed.statusCode).toBeLessThan(500)

    const ordered = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: who.headers,
      payload: {
        eventId: us.id,
        buyerEmail: who.user.email,
        buyerName: who.user.displayName,
        items: [{ ticketTypeId: tiers.VIP.id, quantity: 1 }],
      },
    })

    expect(ordered.statusCode).toBeGreaterThanOrEqual(400)
    expect(ordered.statusCode).toBeLessThan(500)
    expect(await prisma.order.count({ where: { eventId: us.id } })).toBe(0)

    // The allowance is a real limit here: an administrator who set it to 3
    // has 3 to sell, no more.
    await prisma.ticketType.update({ where: { id: tiers.General.id }, data: { quantityTotal: 3 } })

    await buy(who, us, tiers.General, 3)

    const fourth = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      headers: who.headers,
      payload: { ticketTypeId: tiers.General.id, quantity: 1 },
    })

    expect(fourth.statusCode).toBe(409)
    expect(
      (await prisma.ticketType.findUnique({ where: { id: tiers.General.id } })).quantitySold,
    ).toBe(3)
  })

  it('admits its tickets at the door, refunds them, and shows it in the finance and organiser views', async () => {
    const { us } = await onSale()
    const tiers = await tiersOf(us.id)
    const who = await buyer('import-buyer-door')
    const { order } = await buy(who, us, tiers.General, 2)
    const operator = world.superAdministrator.headers
    const [ticket] = await prisma.ticket.findMany({
      where: { orderItem: { orderId: order.id } },
      orderBy: { id: 'asc' },
    })

    // The door: the platform-held organisation has no members, so the team's
    // super administrator admits (the platform's door authority).
    const looked = await app.inject({
      method: 'POST',
      url: '/v1/tickets/admission/preview',
      headers: operator,
      payload: { code: ticket.code },
    })

    expect(looked.statusCode, looked.body).toBe(200)

    const admitted = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers: operator,
      payload: { code: ticket.code, previewReference: looked.json().data.previewReference },
    })

    expect(admitted.statusCode, admitted.body).toBe(200)
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status).toBe('CHECKED_IN')

    // A refund of the other ticket, asked, approved and sent by the team.
    const lines = await prisma.orderItem.findMany({ where: { orderId: order.id } })
    const asked = await app.inject({
      method: 'POST',
      url: `/v1/orders/${order.reference}/refunds`,
      headers: operator,
      payload: {
        lines: [{ orderItemId: lines[0].id, quantity: 1 }],
        reason: 'CUSTOMER_REQUEST',
        idempotencyKey: `import-refund-${RUN}`,
      },
    })

    expect(asked.statusCode, asked.body).toBe(201)

    const refundId = asked.json().data.id

    for (const step of ['approve', 'submit']) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/refunds/${refundId}/${step}`,
        headers: operator,
        payload: { reason: 'The buyer cannot come after all.' },
      })

      expect(response.statusCode, `${step}: ${response.body}`).toBe(200)
    }

    const refund = await prisma.refund.findUnique({ where: { id: refundId } })

    expect(['SUCCEEDED', 'SUBMITTED', 'PROCESSING']).toContain(refund.status)
    expect(refund.amountCents).toBeGreaterThan(0)

    // The finance view and the organiser's own view of the organisation.
    for (const url of [
      `/v1/finance/summary?organizationId=${us.organizationId}`,
      `/v1/analytics/summary?organizationId=${us.organizationId}`,
    ]) {
      const response = await app.inject({ method: 'GET', url, headers: operator })

      expect(response.statusCode, `${url}: ${response.body.slice(0, 300)}`).toBe(200)
      expect(response.body).not.toMatch(/sulekha/iu)
    }
  })

  it('updates a posted import from its listing without touching a tier that has sold', async () => {
    const { us, usId, usPrices } = await onSale()
    const tiers = await tiersOf(us.id)
    const who = await buyer('import-buyer-reimport')

    await buy(who, us, tiers.General, 1)

    // The listing changes every price and drops "Kids", which nobody bought.
    const changed = dataset([
      listing(usId, {
        title: `Imported Garba ${RUN} ${usId}, moved`,
        prices: [
          { ...usPrices[0], priceCents: 9900 },
          { ...usPrices[1], priceCents: 7000, note: null },
        ],
      }),
    ])
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: world.administrator.headers,
      payload: { fileName: 'listings.json', dataset: changed },
    })
    const run = previewed.json().data

    expect(run.rows[0]).toMatchObject({ action: 'POSTED_KEPT', updatable: true })

    const applied = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers: world.administrator.headers,
      payload: { planDigest: run.planDigest, updateFromSource: [usId] },
    })

    expect(applied.statusCode, applied.body).toBe(200)

    const after = await tiersOf(us.id)

    // Sold: as it was. Not sold: the listing's price, and still closed (a
    // posted event's tier is reopened by an administrator, not the import).
    // Dropped and never sold: gone.
    expect(after.General).toMatchObject({ priceCents: 2500, status: 'ON_SALE', quantitySold: 1 })
    expect(after.VIP).toMatchObject({ priceCents: 7000, status: 'CLOSED' })
    expect(after.Kids).toBeUndefined()
    expect((await prisma.event.findUnique({ where: { id: us.id } })).title).toMatch(/, moved$/u)
  })

  it('leaves a tier as it was when a hold lands while a re-import reads it', async () => {
    const { us, usId, usPrices } = await onSale()
    const tiers = await tiersOf(us.id)
    const who = await buyer('import-buyer-race')
    let release
    let locked
    const released = new Promise((resolve) => {
      release = resolve
    })
    const holdLocked = new Promise((resolve) => {
      locked = resolve
    })

    // A hold as `holds.create` writes one: its tier locked (never the event),
    // the hold written, and the transaction still open while the re-import
    // starts.
    const holding = prisma.$transaction(
      async (tx) => {
        await lockTicketTypes(tx, [tiers.General.id])
        await tx.ticketHold.create({
          data: {
            ticketTypeId: tiers.General.id,
            quantity: 1,
            status: 'ACTIVE',
            userId: who.user.id,
            expiresAt: new Date(Date.now() + 10 * 60_000),
          },
        })
        locked()
        await released
      },
      { timeout: 30_000 },
    )

    await holdLocked

    // The listing changes General's price. The re-import's own transaction
    // starts while the hold is uncommitted, and is given time to read.
    const syncing = prisma.$transaction(
      (tx) =>
        syncListingTiers(tx, {
          eventId: us.id,
          listing: listing(usId, {
            prices: [{ ...usPrices[0], priceCents: 9900 }, usPrices[1], usPrices[2]],
          }),
          posted: true,
          now: new Date(),
        }),
      { timeout: 30_000 },
    )

    await new Promise((resolve) => {
      setTimeout(resolve, 500)
    })
    release()
    await holding

    const tally = await syncing
    const after = await tiersOf(us.id)

    // The hold committed while the re-import waited on the tier's lock, so
    // the re-import read it and kept the tier: its price and status as they
    // were. Without the lock the re-import read no hold and repriced it.
    expect(after.General).toMatchObject({ priceCents: 2500, status: 'ON_SALE' })
    expect(tally.kept).toBeGreaterThanOrEqual(1)
    expect(
      await prisma.ticketHold.count({
        where: { ticketTypeId: tiers.General.id, status: 'ACTIVE' },
      }),
    ).toBe(1)
  })

  it('makes no outbound request while importing, approving and selling', async () => {
    const exits = [
      [globalThis, 'fetch'],
      [http, 'request'],
      [http, 'get'],
      [https, 'request'],
      [https, 'get'],
      [tls, 'connect'],
      [dns, 'lookup'],
    ]
    const calls = []

    for (const [owner, name] of exits) {
      vi.spyOn(owner, name).mockImplementation((...args) => {
        calls.push(`${name}(${String(args[0]).slice(0, 60)})`)
        throw new Error(`${name} during an import`)
      })
    }
    syncBuiltinESMExports()

    try {
      const { us } = await onSale()
      const tiers = await tiersOf(us.id)

      await buy(await buyer('import-buyer-offline'), us, tiers.General, 1)
    } finally {
      vi.restoreAllMocks()
      syncBuiltinESMExports()
    }

    expect(calls).toEqual([])
  })
})

/** The migration that switches imported events' links to the source off, as the repository holds it. */
const SOLD_HERE_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20261015100000_imported_events_sold_here/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

/**
 * The data statements of that migration (its link step, its datasets step and
 * its venue step), one per string: the rest changes the schema, which this
 * database already has.
 *
 * @returns {string[]} The UPDATE statements, in file order.
 */
function soldHereDataStatements() {
  const statements = SOLD_HERE_MIGRATION.split(/;\s*\n/u)
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((statement) => /^UPDATE\s/u.test(statement))

  expect(statements).toHaveLength(3)

  return statements
}

when()('the migration that takes imported events off the source site (20261015100000)', () => {
  it('on an upgrade fixture: clears every imported link to the source, keeps the rest, and changes nothing the second time', async () => {
    const statements = soldHereDataStatements()
    const held = await platformHeldNow()
    const legacy = (id) => `https://events.sulekha.com/garba_event-in_irving-tx_${id}`
    const organiserSite = 'https://dfw-garba.example/tickets'

    const seen = await rolledBack(async (tx) => {
      // As a database made before 2026-10-15 holds them: an import published
      // with its link to the source on; one moved to an organiser with the
      // source's address still waiting; one whose decided link is the
      // organiser's own while its current address is the source's; an
      // organiser's own event that names the source (left to the address
      // rule, never rewritten); and a run that stored the old file.
      const make = (label, data) =>
        tx.event.create({
          data: {
            organizationId: held.id,
            title: `Upgrade ${label} ${RUN}`,
            slug: `upgrade-${label}-${RUN}`,
            summary: 'An imported listing as an earlier build stored it.',
            description: 'An imported listing as an earlier build stored it.',
            category: 'GARBA_DANDIYA',
            startsAt: new Date(Date.now() + 20 * 86_400_000),
            endsAt: new Date(Date.now() + 20 * 86_400_000 + 3 * 3_600_000),
            timezone: 'America/Chicago',
            status: 'DRAFT',
            ...data,
          },
        })
      const decidedAt = new Date('2026-10-01T12:00:00Z')
      const on = await make('on', {
        websiteUrl: legacy(1),
        websiteRedirectEnabled: true,
        websiteDecidedUrl: legacy(1),
        websiteRedirectChangedAt: decidedAt,
        websiteRedirectChangedById: world.administrator.user.id,
        websiteRedirectReason: 'Tickets for this event are sold on its listing.',
      })
      const waiting = await make('waiting', {
        websiteUrl: legacy(2),
        websiteDecisionPending: true,
        websiteSubmittedAt: decidedAt,
      })
      const mixed = await make('mixed', {
        websiteUrl: legacy(3),
        websiteRedirectEnabled: true,
        websiteDecidedUrl: organiserSite,
        websiteDecisionPending: true,
        websiteSubmittedAt: decidedAt,
        websiteRedirectChangedAt: decidedAt,
        websiteRedirectChangedById: world.administrator.user.id,
        websiteRedirectReason: 'The organiser’s own page.',
      })
      const theirs = await make('theirs', {
        organizationId: world.target.id,
        websiteUrl: legacy(4),
        websiteDecisionPending: true,
        websiteSubmittedAt: decidedAt,
      })

      for (const [event, id] of [
        [on, '9100000001'],
        [waiting, '9100000002'],
        [mixed, '9100000003'],
      ]) {
        await tx.eventImportItem.create({
          data: {
            source: 'SULEKHA',
            sourceId: `${id}${DIGITS.slice(-2)}`,
            eventId: event.id,
            scrapedAt: decidedAt,
          },
        })
      }

      const venue = await tx.venue.create({
        data: {
          name: `Upgrade Hall ${RUN}`,
          addressLine1: '1 Main St',
          city: 'Irving',
          region: 'TX',
          postalCode: '75039',
          country: 'US',
          timezone: 'America/Chicago',
          provenance: 'import:sulekha',
          organizationId: held.id,
        },
      })
      const oldFile = {
        format: 'desi-event-import/1',
        source: 'SULEKHA',
        sourceName: 'Sulekha',
        sourceSite: 'https://events.sulekha.com/',
        imageHosts: ['usimg.sulekha.io'],
        events: [
          { sourceId: '1', sourceUrl: legacy(5), ticketUrl: legacy(5), images: [], title: 'Kept' },
        ],
      }
      const run = await tx.eventImportRun.create({
        data: {
          source: 'SULEKHA',
          fileName: 'sulekha-texas-2026.json',
          datasetSha256: 'e'.repeat(64),
          dataset: oldFile,
          plan: [],
          planDigest: 'f'.repeat(64),
          eventCount: 1,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      const counts = []

      for (const statement of statements) counts.push(await tx.$executeRawUnsafe(statement))

      const again = []

      for (const statement of statements) again.push(await tx.$executeRawUnsafe(statement))

      const read = (event) => tx.event.findUnique({ where: { id: event.id } })

      return {
        counts,
        again,
        before: { on, waiting, mixed, theirs },
        after: {
          on: await read(on),
          waiting: await read(waiting),
          mixed: await read(mixed),
          theirs: await read(theirs),
        },
        venue: await tx.venue.findUnique({ where: { id: venue.id } }),
        run: await tx.eventImportRun.findUnique({ where: { id: run.id } }),
      }
    })

    // Every imported event's links to the source are gone; nothing else is.
    expect(seen.after.on).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedAt: null,
      websiteRedirectChangedById: null,
      websiteRedirectReason: null,
      revision: seen.before.on.revision + 1,
    })
    expect(seen.after.waiting).toMatchObject({
      websiteUrl: null,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
    })
    // The organiser's own decided link stays; the source's address goes, and
    // whether a decision waits is worked out again from what is left.
    expect(seen.after.mixed).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: organiserSite,
      websiteDecisionPending: true,
    })
    // Not an imported event: left as it was (the address rule keeps it from
    // ever being linked).
    expect(seen.after.theirs).toMatchObject({
      websiteUrl: seen.before.theirs.websiteUrl,
      websiteDecisionPending: true,
      revision: seen.before.theirs.revision,
    })
    expect(seen.venue.provenance).toBe('import:listing')
    expect(seen.run.dataset).toEqual({
      format: 'desi-event-import/1',
      source: 'SULEKHA',
      events: [{ sourceId: '1', title: 'Kept' }],
    })
    expect(JSON.stringify(seen.run.dataset)).not.toMatch(/sulekha\.|https?:/iu)
    expect(seen.run.datasetSha256).toBe('e'.repeat(64))

    // Idempotent: a second run changes nothing.
    expect(seen.counts[0]).toBeGreaterThanOrEqual(3)
    expect(seen.counts[1]).toBeGreaterThanOrEqual(1)
    expect(seen.counts[2]).toBeGreaterThanOrEqual(1)
    expect(seen.again).toEqual([0, 0, 0])
  })
})

/** The migration that puts what an import wrote in words that name no other site, as the repository holds it. */
const LISTING_WORDS_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20261015110000_imported_listing_words/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

/**
 * That migration's statements, one per string, in file order: all five are
 * data changes.
 *
 * @returns {string[]} The UPDATE statements.
 */
function listingWordsStatements() {
  const statements = LISTING_WORDS_MIGRATION.split(/;\s*\n/u)
    .map((statement) =>
      statement
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean)

  expect(statements).toHaveLength(5)
  expect(statements.every((statement) => /^UPDATE\s/u.test(statement))).toBe(true)

  return statements
}

/** The terms an import wrote before 2026-10-15 (both spellings of the site's own name for us). */
const OLD_IMPORT_POLICIES = Object.freeze({
  entry: 'Entry is run by the organiser. Check the Sulekha listing for their rules.',
  refund:
    "Tickets for this event are sold on Sulekha, not on Desi-Event. Refunds follow Sulekha's and the organiser's terms.",
  refundLater:
    "Tickets for this event are sold on Sulekha, not on The Desi Events. Refunds follow Sulekha's and the organiser's terms.",
  conduct: "The organiser's and the venue's rules apply.",
})

when()('the migration that rewords what imports wrote (20261015110000)', () => {
  it('on an upgrade fixture: rewords terms, FAQ, notes, history and stored files, keeps what people wrote, and changes nothing the second time', async () => {
    const statements = listingWordsStatements()
    const held = await platformHeldNow()

    const seen = await rolledBack(async (tx) => {
      const make = (label, data) =>
        tx.event.create({
          data: {
            organizationId: held.id,
            title: `Words ${label} ${RUN}`,
            slug: `words-${label}-${RUN}`,
            summary: 'An imported listing as an earlier build stored it.',
            description: 'An imported listing as an earlier build stored it.',
            category: 'GARBA_DANDIYA',
            startsAt: new Date(Date.now() + 20 * 86_400_000),
            endsAt: new Date(Date.now() + 20 * 86_400_000 + 3 * 3_600_000),
            timezone: 'America/Chicago',
            status: 'DRAFT',
            ...data,
          },
        })
      const listingId = `92${DIGITS}`
      // As a database made before 2026-10-15 holds it: an import moved to an
      // organiser, with the terms, FAQ and switch reason the import wrote, a
      // FAQ entry an administrator added since, and its history and notes.
      const old = await make('old', {
        organizationId: world.target.id,
        policies: {
          entry: `${OLD_IMPORT_POLICIES.entry} Age: 18+.`,
          refund: OLD_IMPORT_POLICIES.refund,
          conduct: OLD_IMPORT_POLICIES.conduct,
        },
        faq: [
          {
            question: "What is Sulekha's Refund Policy?",
            answer: 'Sulekha refunds only the ticket face value',
          },
          { question: 'What is the refund policy?', answer: 'All sales are final.' },
          { question: 'Where is it happening?', answer: 'At the hall.' },
          {
            question: 'What is the refund policy?',
            answer: 'Written by our team: full refunds until a week before.',
          },
        ],
        websiteRedirectChangedAt: new Date('2026-10-02T12:00:00Z'),
        websiteRedirectChangedById: world.administrator.user.id,
        websiteRedirectReason:
          "Moved to Garba Target. The Sulekha ticket link is off until an administrator approves the organiser's own address.",
      })
      // An import already in this build's words: nothing to change.
      const current = await make('current', {
        policies: { ...IMPORT_POLICIES },
        faq: [{ question: 'Where is it happening?', answer: 'At the hall.' }],
      })
      // Nobody imported this one, though its terms read the same: left alone.
      const theirs = await make('theirs', {
        organizationId: world.target.id,
        policies: { entry: OLD_IMPORT_POLICIES.entry, refund: OLD_IMPORT_POLICIES.refundLater },
        faq: [{ question: 'Is Sulekha involved?', answer: 'No.' }],
      })
      const longNote = `Sulekha gives ${'"A" as "A"; '.repeat(40)}`.slice(0, 495)
      const item = await tx.eventImportItem.create({
        data: {
          source: 'SULEKHA',
          sourceId: listingId,
          eventId: old.id,
          scrapedAt: new Date('2026-09-29T21:25:00Z'),
          importNotes: [
            'Sulekha\'s export (curated 2026-10-15) shows this event as "Selling Fast". This is for the administrator only and is never shown publicly.',
            'This listing is also in sulekha-texas-2026.json (collected 29-30 September 2026). Importing it updates a draft; a posted event changes only if "Update from Sulekha" is ticked.',
            'Sulekha says tickets are sold at DesiComedyFest.com; the link still goes to the Sulekha page.',
            'Sulekha lists this as Poetry; The Desi Events has no such category, so it is listed under Theatre.',
            longNote,
            'A personal phone number was removed from the description.',
          ],
        },
      })

      await tx.eventImportItem.create({
        data: {
          source: 'SULEKHA',
          sourceId: `93${DIGITS}`,
          eventId: current.id,
          scrapedAt: new Date('2026-10-15T00:00:00Z'),
          importNotes: ['The source listing gives no description.'],
        },
      })

      const history = []

      for (const [event, reason] of [
        [old, 'Imported from Sulekha, run run-one.'],
        [old, 'Updated from its Sulekha listing, run run-two.'],
        [old, 'Published by the team at The Desi Events after review, run run-two.'],
        [theirs, 'Imported from Sulekha, run run-three.'],
      ]) {
        history.push(
          await tx.eventModerationAction.create({
            data: { eventId: event.id, fromStatus: 'DRAFT', toStatus: 'REVIEW_PENDING', reason },
          }),
        )
      }

      const notice = await tx.eventChangeNotice.create({
        data: {
          eventId: old.id,
          kind: 'MATERIAL_CHANGE',
          fields: ['startsAt'],
          changed: ['the start time'],
          reason: 'Updated from its Sulekha listing by the team at The Desi Events, run run-two.',
          byPlatform: true,
        },
      })
      const run = await tx.eventImportRun.create({
        data: {
          source: 'SULEKHA',
          fileName: 'sulekha-texas-2026.json',
          datasetSha256: 'e'.repeat(64),
          dataset: {
            format: 'desi-event-import/1',
            source: 'SULEKHA',
            events: [
              {
                sourceId: listingId,
                title: 'Kept',
                faq: [
                  {
                    q: "What is Sulekha's Refund Policy?",
                    a: 'Sulekha refunds only the ticket face value',
                  },
                  { q: 'What is the refund policy?', a: 'All sales are final.' },
                  { q: 'How do I purchase tickets?', a: 'On our website.' },
                  { q: 'Where is it happening?', a: 'At the hall.' },
                ],
                importNotes: ['Sulekha marks "VIP" as no longer on sale.'],
              },
            ],
          },
          plan: [],
          planDigest: 'f'.repeat(64),
          eventCount: 1,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      })
      const counts = []

      for (const statement of statements) counts.push(await tx.$executeRawUnsafe(statement))

      const again = []

      for (const statement of statements) again.push(await tx.$executeRawUnsafe(statement))

      const read = (event) => tx.event.findUnique({ where: { id: event.id } })

      return {
        counts,
        again,
        before: { old, current, theirs },
        after: { old: await read(old), current: await read(current), theirs: await read(theirs) },
        item: await tx.eventImportItem.findUnique({ where: { id: item.id } }),
        history: await tx.eventModerationAction.findMany({
          where: { id: { in: history.map((row) => row.id) } },
          orderBy: { createdAt: 'asc' },
        }),
        historyIds: history.map((row) => row.id),
        notice: await tx.eventChangeNotice.findUnique({ where: { id: notice.id } }),
        run: await tx.eventImportRun.findUnique({ where: { id: run.id } }),
      }
    })

    // The terms the import wrote are this build's, the age limit kept.
    expect(seen.after.old.policies).toEqual({
      entry: `${IMPORT_POLICIES.entry} Age: 18+.`,
      refund: IMPORT_POLICIES.refund,
      conduct: IMPORT_POLICIES.conduct,
    })
    // The entries naming the site and the import's refund answer go; the
    // venue question and the team's own refund answer stay, in order.
    expect(seen.after.old.faq).toEqual([
      { question: 'Where is it happening?', answer: 'At the hall.' },
      {
        question: 'What is the refund policy?',
        answer: 'Written by our team: full refunds until a week before.',
      },
    ])
    expect(seen.after.old.websiteRedirectReason).toBe(reassignLinkReason('Garba Target'))
    expect(seen.after.old.revision).toBe(seen.before.old.revision + 1)
    // Already in this build's words, and not imported: left as they were.
    expect(seen.after.current).toMatchObject({
      policies: seen.before.current.policies,
      faq: seen.before.current.faq,
      revision: seen.before.current.revision,
    })
    expect(seen.after.theirs).toMatchObject({
      policies: seen.before.theirs.policies,
      faq: seen.before.theirs.faq,
      revision: seen.before.theirs.revision,
    })

    // The administrators' notes in the converter's words, each within 500.
    expect(seen.item.importNotes.slice(0, 4)).toEqual([
      'The source listing\'s export (curated 2026-10-15) shows this event as "Selling Fast". This is for the administrator only and is never shown publicly.',
      'This listing is also in the Texas file (collected 29-30 September 2026). Importing it updates a draft; a posted event changes only if "Update from the source listing" is ticked.',
      "The source listing says tickets are sold at DesiComedyFest.com, the organiser's own site; on The Desi Events they are sold through this event's own ticket types.",
      "The source listing's category is Poetry; The Desi Events has no such category, so it is listed under Theatre.",
    ])
    expect(seen.item.importNotes[4]).toMatch(/^The source listing gives "A" as "A"; /u)
    expect(seen.item.importNotes[4].length).toBeLessThanOrEqual(500)
    expect(seen.item.importNotes[5]).toBe(
      'A personal phone number was removed from the description.',
    )

    // History and the public change notice.
    const reasons = Object.fromEntries(seen.history.map((row) => [row.id, row.reason]))

    expect(seen.historyIds.map((id) => reasons[id])).toEqual([
      'Imported from its listing, run run-one.',
      'Updated from its source listing, run run-two.',
      'Published by the team at The Desi Events after review, run run-two.',
      // Not an imported event's: left as it was.
      'Imported from Sulekha, run run-three.',
    ])
    expect(seen.notice.reason).toBe(
      'Updated from its source listing by the team at The Desi Events, run run-two.',
    )

    // The stored file: no sales-terms answer, no name, its other fields kept.
    expect(seen.run.dataset).toEqual({
      format: 'desi-event-import/1',
      source: 'SULEKHA',
      events: [
        {
          sourceId: expect.any(String),
          title: 'Kept',
          faq: [{ q: 'Where is it happening?', a: 'At the hall.' }],
          importNotes: ['The source listing marks "VIP" as no longer on sale.'],
        },
      ],
    })
    expect(seen.run.datasetSha256).toBe('e'.repeat(64))

    // Nothing an imported event, its record, history or stored file holds
    // names the site, but for the source's enum and the run's file name.
    const { source: _source, ...file } = seen.run.dataset

    expect(
      JSON.stringify([
        seen.after.old.policies,
        seen.after.old.faq,
        seen.after.old.websiteRedirectReason,
        seen.item.importNotes,
        seen.history.slice(0, 3).map((row) => row.reason),
        seen.notice.reason,
        file,
      ]),
    ).not.toMatch(/sulekha/iu)

    // Idempotent: a second run changes nothing.
    expect(seen.counts[0]).toBeGreaterThanOrEqual(1)
    expect(seen.counts[1]).toBeGreaterThanOrEqual(2)
    expect(seen.counts[2]).toBeGreaterThanOrEqual(1)
    expect(seen.counts[3]).toBeGreaterThanOrEqual(1)
    expect(seen.counts[4]).toBeGreaterThanOrEqual(1)
    expect(seen.again).toEqual([0, 0, 0, 0, 0])
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

/**
 * A listing at a Toronto venue, priced in Canadian dollars, as the North
 * American file gives one: the province's code, a Canadian postal code, the
 * venue's own zone and CAD.
 *
 * @param {string} id The listing id.
 * @param {object} [overrides] Fields to replace.
 * @returns {object} The listing.
 */
function torontoListing(id, overrides = {}) {
  return listing(id, {
    title: `Toronto Garba ${RUN} ${id}`,
    timeZone: 'America/Toronto',
    venue: {
      name: `Harbourfront Hall ${RUN}`,
      addressLine1: '235 Queens Quay W',
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5J 2G8',
      country: 'CA',
    },
    presentedBy: 'Toronto Garba Collective',
    prices: [
      { name: 'Adult', priceCents: 3000, currency: 'CAD', note: null },
      { name: 'Child', priceCents: 0, currency: 'CAD', note: null },
    ],
    priceText: 'CA$30',
    ...overrides,
  })
}

when()('a listing in Canada', () => {
  it('stores a Canadian venue, its zone and CAD prices, and shows them so on every public surface', async () => {
    const first = sourceId()
    const second = sourceId()
    const run = await importFile(dataset([torontoListing(first), torontoListing(second)]))
    const event = await eventFor(first)
    const other = await eventFor(second)

    // The venue as the listing gave it, made once and reused by the second
    // listing at the same address.
    const venue = await prisma.venue.findUnique({ where: { id: event.venueId } })

    expect(venue).toMatchObject({
      name: `Harbourfront Hall ${RUN}`,
      addressLine1: '235 Queens Quay W',
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5J 2G8',
      country: 'CA',
      timezone: 'America/Toronto',
      provenance: 'import:listing',
      organizationId: event.organizationId,
    })
    expect(other.venueId).toBe(event.venueId)
    expect(await prisma.venue.count({ where: { name: `Harbourfront Hall ${RUN}` } })).toBe(1)

    // The event and its night in the venue's zone; the prices kept in CAD,
    // and each made a ticket type in CAD.
    expect(event.timezone).toBe('America/Toronto')
    expect((await prisma.eventSession.findFirst({ where: { eventId: event.id } })).timezone).toBe(
      'America/Toronto',
    )

    const item = await prisma.eventImportItem.findUnique({ where: { eventId: event.id } })

    expect(item.prices).toEqual([
      { name: 'Adult', priceCents: 3000, currency: 'CAD', note: null },
      { name: 'Child', priceCents: 0, currency: 'CAD', note: null },
    ])
    expect(
      (
        await prisma.ticketType.findMany({
          where: { eventId: event.id },
          orderBy: { sortOrder: 'asc' },
        })
      ).map((tier) => [tier.name, tier.priceCents, tier.currency]),
    ).toEqual([
      ['Adult', 3000, 'CAD'],
      ['Child', 0, 'CAD'],
    ])

    const approved = await approve(run.id, [event.id, other.id])

    expect(approved.statusCode, approved.body).toBe(200)
    expect(approved.json().data.results.map((result) => result.outcome)).toEqual([
      'PUBLISHED',
      'PUBLISHED',
    ])

    // The public page: a Canadian address, its own zone, the prices in CAD.
    const page = await app.inject({ method: 'GET', url: `/v1/events/${event.slug}` })

    expect(page.statusCode, page.body).toBe(200)

    const data = page.json().data

    expect(data.timezone).toBe('America/Toronto')
    expect(data.venue).toMatchObject({
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5J 2G8',
      country: 'CA',
    })
    expect(data.importedFrom).toEqual({
      presentedBy: 'Toronto Garba Collective',
      listedOn: '2026-09-29',
      prices: [
        { name: 'Adult', priceCents: 3000, currency: 'CAD' },
        { name: 'Child', priceCents: 0, currency: 'CAD' },
      ],
      priceListed: true,
    })
    expect(data.ticketTypes.map((tier) => tier.currency)).toEqual(['CAD', 'CAD'])
    expect(page.body).not.toMatch(/"USD"/u)

    // The listing, filtered by its city, carries the same.
    const listed = await app.inject({
      method: 'GET',
      url: `/v1/events?city=Toronto&q=${encodeURIComponent(`Toronto Garba ${RUN}`)}`,
    })

    expect(listed.statusCode, listed.body).toBe(200)

    const cards = listed.json().data

    expect(cards.map((card) => card.id).sort()).toEqual([event.id, other.id].sort())
    expect(cards[0]).toMatchObject({ city: 'Toronto', timezone: 'America/Toronto' })
    expect(cards[0].importedFrom.prices.map((price) => price.currency)).toEqual(['CAD', 'CAD'])

    // The city is offered as a filter of the whole catalogue.
    const facets = await app.inject({ method: 'GET', url: '/v1/events/facets' })

    expect(facets.statusCode, facets.body).toBe(200)
    expect(
      facets.json().data.cities.find((city) => city.value === 'Toronto')?.count,
    ).toBeGreaterThanOrEqual(2)

    // It has no website link: following one goes nowhere.
    const visit = await app.inject({
      method: 'POST',
      url: '/v1/traffic/website-visits',
      headers: { 'content-type': 'application/json' },
      payload: { slug: event.slug, counted: false },
    })

    expect(visit.statusCode, visit.body).toBe(404)
    expect(visit.body).not.toMatch(/sulekha/iu)
  })
})

when()('taking an imported event off the site and putting it back', () => {
  /** The reason every deletion here gives. */
  const TAKEN_OFF = 'Taken off the site while the organiser confirms the date.'

  /** The reason every restore here gives. */
  const PUT_BACK = 'The organiser confirmed the date; back on the site.'

  /**
   * What the public sees of an event: its page, the listing filtered to it,
   * and where its website link goes.
   *
   * @param {object} event The event row, for its slug and title.
   * @returns {Promise<object>} `{ page, listed, visit }`: the three answers.
   */
  async function publicView(event) {
    const [page, listed, visit] = await Promise.all([
      app.inject({ method: 'GET', url: `/v1/events/${event.slug}` }),
      app.inject({
        method: 'GET',
        url: `/v1/events?perPage=100&q=${encodeURIComponent(event.title)}`,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/traffic/website-visits',
        headers: { 'content-type': 'application/json' },
        payload: { slug: event.slug, counted: false },
      }),
    ])

    return { page, listed, visit }
  }

  /**
   * Plan the same file again, as an administrator would, and read the
   * listing's action.
   *
   * @param {object} file The dataset.
   * @param {string} id The listing.
   * @returns {Promise<string>} Its plan action.
   */
  async function plannedAction(file, id) {
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers: world.administrator.headers,
      payload: { fileName: 'listings.json', dataset: file },
    })

    expect(previewed.statusCode, previewed.body).toBe(201)

    return previewed.json().data.rows.find((row) => row.sourceId === id).action
  }

  it('takes it off and puts it back live, again and again, at the same address, back on sale in an editing session', async () => {
    const id = sourceId()
    const file = dataset([torontoListing(id)])
    const run = await importFile(file)
    const imported = await eventFor(id)

    expect((await approve(run.id, [imported.id])).statusCode).toBe(200)

    const published = await prisma.event.findUnique({ where: { id: imported.id } })

    expect(published).toMatchObject({ status: 'ON_SALE', websiteRedirectEnabled: false })

    for (const round of [1, 2]) {
      // Taken off the site by the administrator: nothing is bought here, so
      // the only outcome is REMOVE.
      const before = await prisma.event.findUnique({ where: { id: imported.id } })
      const preview = await app.inject({
        method: 'GET',
        url: `/v1/events/${imported.id}/deletion`,
        headers: world.administrator.headers,
      })

      expect(preview.statusCode, preview.body).toBe(200)
      expect(preview.json().data.outcome).toBe('REMOVE')

      const deleted = await app.inject({
        method: 'POST',
        url: `/v1/events/${imported.id}/delete`,
        headers: world.administrator.headers,
        payload: {
          revision: before.revision,
          reason: TAKEN_OFF,
          confirmSlug: before.slug,
          expectedOutcome: 'REMOVE',
        },
      })

      expect(deleted.statusCode, `round ${round}: ${deleted.body}`).toBe(200)

      const off = await prisma.event.findUnique({ where: { id: imported.id } })

      expect(off).toMatchObject({
        status: 'DELETED',
        statusBeforeDeletion: 'ON_SALE',
        deletionAuthority: 'PLATFORM',
        // A web address that was public stays retired, never released.
        slug: published.slug,
        deletedSlug: null,
        // It never had a link, and has none now.
        websiteRedirectEnabled: false,
        websiteDecidedUrl: null,
      })

      // Off every public surface: no page, not listed, no link to follow.
      const gone = await publicView(published)

      expect(gone.page.statusCode).toBe(404)
      expect(gone.listed.json().data.map((card) => card.id)).not.toContain(imported.id)
      expect(gone.visit.statusCode).toBe(404)

      // Planning the listing again leaves it alone while it is off the site.
      expect(await plannedAction(file, id)).toBe('SKIPPED_DELETED')

      // Put back by the administrator, with a reason.
      const restored = await app.inject({
        method: 'POST',
        url: `/v1/platform/events/${imported.id}/restore`,
        headers: world.administrator.headers,
        payload: { revision: off.revision, reason: PUT_BACK },
      })

      expect(restored.statusCode, `round ${round}: ${restored.body}`).toBe(200)
      // An event taken off while on sale comes back with its sales paused:
      // somebody decides when to sell again (restoreTarget).
      expect(restored.json().data).toMatchObject({ status: 'SALES_PAUSED', slug: published.slug })

      const back = await prisma.event.findUnique({ where: { id: imported.id } })

      expect(back).toMatchObject({
        status: 'SALES_PAUSED',
        slug: published.slug,
        organizationId: published.organizationId,
        websiteRedirectEnabled: false,
        websiteDecidedUrl: null,
        websiteDecisionPending: false,
        deletedAt: null,
        statusBeforeDeletion: null,
      })

      // The team sells it again, in an editing session (it has no organiser
      // here to do it).
      const sitting = await app.inject({
        method: 'POST',
        url: `/v1/platform/events/${imported.id}/edit`,
        headers: world.administrator.headers,
        payload: { reason: 'Back on sale now the organiser has confirmed the date.' },
      })

      expect(sitting.statusCode, sitting.body).toBe(201)

      const resumed = await app.inject({
        method: 'POST',
        url: `/v1/events/${imported.id}/open-sales`,
        headers: world.administrator.headers,
        payload: {},
      })

      expect(resumed.statusCode, `round ${round}: ${resumed.body}`).toBe(200)

      await app.inject({
        method: 'POST',
        url: `/v1/platform/events/${imported.id}/edit/close`,
        headers: world.administrator.headers,
      })

      // Live again at the same address, presented by its organiser, on sale
      // here, with no link anywhere.
      const live = await publicView(published)

      expect(live.page.statusCode, live.page.body).toBe(200)
      expect(live.page.json().data).toMatchObject({
        status: 'ON_SALE',
        slug: published.slug,
        websiteLink: null,
      })
      expect(live.page.json().data.importedFrom).toMatchObject({
        presentedBy: 'Toronto Garba Collective',
      })
      expect(live.listed.json().data.map((card) => card.id)).toContain(imported.id)
      expect(live.visit.statusCode).toBe(404)

      // And the import treats it as published again.
      expect(await plannedAction(file, id)).toBe('UNCHANGED')
    }

    // Both rounds are on the record: who, when and why.
    const audits = await prisma.auditLog.findMany({
      where: { entityId: imported.id, action: { in: ['event.deleted', 'event.restored'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })

    expect(audits.map((row) => row.action)).toEqual([
      'event.deleted',
      'event.restored',
      'event.deleted',
      'event.restored',
    ])
    expect(audits.every((row) => row.actorId === world.administrator.user.id)).toBe(true)
    expect(audits.filter((row) => row.action === 'event.restored')[0].metadata).toMatchObject({
      from: 'DELETED',
      to: 'SALES_PAUSED',
      reason: PUT_BACK,
    })

    // Nothing was purged: its import record, its venue and its night stand.
    expect(await prisma.eventImportItem.count({ where: { eventId: imported.id } })).toBe(1)
    expect(await prisma.eventSession.count({ where: { eventId: imported.id } })).toBe(1)
  })
})

/** The rename migration, as the repository holds it. */
const RENAME_MIGRATION = readFileSync(
  new URL(
    '../../../packages/db/prisma/migrations/20261015090000_platform_held_organisation_name/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

/** The platform-held organisation as the first build made it: test data for the rename. */
const FIRST_PLATFORM_HELD = Object.freeze({
  name: 'Sulekha Events',
  slug: 'sulekha-events',
  description:
    'Events listed on Sulekha.com and shown on The Desi Events by its team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.',
})

/** Thrown to end a transaction whose writes the test only reads. */
class RolledBack extends Error {}

/**
 * Run work in a transaction that is always rolled back, so nothing it writes
 * reaches the suites sharing this database.
 *
 * @param {function(object): Promise<object>} work Given the transaction client.
 * @returns {Promise<object>} What the work returned.
 */
async function rolledBack(work) {
  let result

  try {
    await prisma.$transaction(
      async (tx) => {
        result = await work(tx)
        throw new RolledBack()
      },
      { timeout: 30_000 },
    )
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error
  }

  return result
}

/**
 * The platform-held organisation, imported into once by this suite if no
 * suite has yet.
 *
 * @returns {Promise<object>} Its row.
 */
async function platformHeldNow() {
  const existing = await prisma.organization.findUnique({
    where: { platformHeldSource: 'SULEKHA' },
  })

  if (existing) return existing

  await importFile(dataset([listing(sourceId())]))

  return prisma.organization.findUnique({ where: { platformHeldSource: 'SULEKHA' } })
}

when()('the platform-held organisation renamed "The Desi Events"', () => {
  const shape = PLATFORM_HELD_ORGANIZATIONS.SULEKHA

  it('the migration renames one made under its first name, and changes nothing the second time', async () => {
    const held = await platformHeldNow()

    const seen = await rolledBack(async (tx) => {
      await tx.organization.update({ where: { id: held.id }, data: FIRST_PLATFORM_HELD })

      const first = await tx.$executeRawUnsafe(RENAME_MIGRATION)
      const after = await tx.organization.findUnique({ where: { id: held.id } })
      const second = await tx.$executeRawUnsafe(RENAME_MIGRATION)
      const again = await tx.organization.findUnique({ where: { id: held.id } })

      return { first, after, second, again }
    })

    expect(seen.first).toBe(1)
    expect(seen.after).toMatchObject({
      name: 'The Desi Events',
      slug: 'the-desi-events',
      description: shape.description,
      platformHeldSource: 'SULEKHA',
    })
    // The SQL and the API give the same words.
    expect(seen.after.name).toBe(shape.name)
    expect(seen.after.slug).toBe(shape.slug)
    expect(seen.second).toBe(0)
    expect(seen.again).toEqual(seen.after)
  })

  it('the migration makes the address unique when another organisation has it, and the API keeps that address', async () => {
    const held = await platformHeldNow()

    const seen = await rolledBack(async (tx) => {
      await tx.organization.update({ where: { id: held.id }, data: FIRST_PLATFORM_HELD })
      await tx.organization.create({
        data: {
          name: `Desi Events of Ohio ${RUN}`,
          slug: 'the-desi-events',
          contactEmail: `ohio-${RUN}@import.example`,
          payoutCurrency: 'USD',
        },
      })
      await tx.$executeRawUnsafe(RENAME_MIGRATION)

      const renameAudits = { entityId: held.id, action: 'organization.platform_held_updated' }
      const auditedBefore = await tx.auditLog.count({ where: renameAudits })
      const after = await tx.organization.findUnique({ where: { id: held.id } })
      const [{ suffix }] = await tx.$queryRawUnsafe(
        'SELECT substr(md5($1), 1, 6) AS suffix',
        held.id,
      )
      const { organization, created } = await ensurePlatformHeldOrganization(tx, {
        source: 'SULEKHA',
        actor: world.administrator.user,
        now: new Date(),
      })
      const audited = (await tx.auditLog.count({ where: renameAudits })) - auditedBefore

      return { after, suffix, organization, created, audited }
    })

    expect(seen.after.name).toBe('The Desi Events')
    expect(seen.after.slug).toBe(`the-desi-events-${seen.suffix}`)
    expect(isPlatformHeldSlug(seen.after.slug, shape.slug)).toBe(true)
    // Already up to date: the API writes nothing to it.
    expect(seen.created).toBe(false)
    expect(seen.organization).toEqual(seen.after)
    expect(seen.audited).toBe(0)
  })

  it('the next import renames one the migration did not reach, audited once, then leaves it alone', async () => {
    const held = await platformHeldNow()
    const before = new Date()

    await prisma.organization.update({ where: { id: held.id }, data: FIRST_PLATFORM_HELD })

    const id = sourceId()

    await importFile(dataset([listing(id)]))

    const after = await prisma.organization.findUnique({ where: { id: held.id } })

    expect(after).toMatchObject({
      name: 'The Desi Events',
      description: shape.description,
      platformHeldSource: 'SULEKHA',
    })
    expect(isPlatformHeldSlug(after.slug, shape.slug)).toBe(true)
    expect((await eventFor(id)).organizationId).toBe(held.id)

    const audits = await prisma.auditLog.findMany({
      where: {
        entityId: held.id,
        action: 'organization.platform_held_updated',
        createdAt: { gte: before },
      },
    })

    // Another suite's import may have reached it first; either way, one rename.
    expect(audits).toHaveLength(1)
    expect(audits[0].metadata).toMatchObject({
      source: 'SULEKHA',
      fields: ['description', 'name', 'slug'],
      slug: after.slug,
    })
    // Never the old values: only the source's enum value names it.
    expect(JSON.stringify(audits[0].metadata)).not.toMatch(/Sulekha Events|sulekha-events/u)

    await importFile(dataset([listing(sourceId())]))

    expect(
      await prisma.auditLog.count({
        where: {
          entityId: held.id,
          action: 'organization.platform_held_updated',
          createdAt: { gte: before },
        },
      }),
    ).toBe(1)
    expect(await prisma.organization.findUnique({ where: { id: held.id } })).toEqual(after)
  })
})

when()('approving every pending imported event (2026-10-16)', () => {
  // Through the library, held to this block's own runs (`runIds`): the route
  // approves every pending import in the database, and on the shared test
  // database that would include the other suites'. The route itself is
  // tested on the stub (`event-import-pending.test.js`).
  it('lists events two runs imported once, from the later, and approves them all on PostgreSQL', async () => {
    const [a, b, c, bare, closed, past] = [1, 2, 3, 4, 5, 6].map(() => sourceId())
    const first = await importFile(dataset([listing(a), listing(b), listing(past)]))
    const second = await importFile(
      dataset([
        listing(b, { title: `Imported Garba ${RUN} ${b}, newer` }),
        listing(c),
        // Nothing to sell: no prices, and every price sold out.
        listing(bare, { prices: [], priceText: null }),
        listing(closed, {
          prices: [{ name: 'Regular', priceCents: 2500, currency: 'USD', note: 'Sold Out' }],
        }),
      ]),
    )
    const runIds = [first.id, second.id]

    // One of the first file's listings has started since it was imported.
    const started = await eventFor(past)

    await prisma.event.update({
      where: { id: started.id },
      data: { startsAt: new Date(Date.now() - 3_600_000) },
    })

    const list = await pendingImports(prisma, { runIds })

    expect(list).toMatchObject({ total: 5, willGoOnSale: 3, publishedNothingToSell: 2, past: 1 })
    expect(Object.fromEntries(list.items.map((item) => [item.sourceId, item.runId]))).toEqual({
      [a]: first.id,
      [b]: second.id,
      [c]: second.id,
      [bare]: second.id,
      [closed]: second.id,
    })

    // A digest from another moment of the list is refused, and nothing moves.
    await expect(
      approvePendingImports(prisma, {
        digest: 'f'.repeat(64),
        actor: (await loadActor(prisma, world.administrator.user.id)).actor,
        runIds,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'IMPORT_PENDING_CHANGED' })
    expect((await eventFor(a)).status).toBe('REVIEW_PENDING')

    const { actor } = await loadActor(prisma, world.administrator.user.id)
    const outcome = await approvePendingImports(prisma, { digest: list.digest, actor, runIds })

    expect(outcome).toMatchObject({
      total: 5,
      onSale: 3,
      publishedNothingToSell: 2,
      refused: 0,
      skippedPast: 1,
    })

    for (const id of [a, b, c]) expect((await eventFor(id)).status, id).toBe('ON_SALE')
    for (const id of [bare, closed]) expect((await eventFor(id)).status, id).toBe('PUBLISHED')
    expect((await eventFor(past)).status).toBe('REVIEW_PENDING')
    expect((await eventFor(b)).title).toBe(`Imported Garba ${RUN} ${b}, newer`)

    // Each event's own audit rows, and one for the request.
    const approved = await prisma.auditLog.count({
      where: {
        action: 'event.approved',
        entityId: {
          in: await Promise.all([a, b, c, bare, closed].map(async (id) => (await eventFor(id)).id)),
        },
      },
    })

    expect(approved).toBe(5)

    const summary = await prisma.auditLog.findFirst({
      where: { action: 'event_import.bulk_approved', actorId: world.administrator.user.id },
      orderBy: { createdAt: 'desc' },
    })

    expect(summary).toMatchObject({ entityType: 'EventImport', entityId: 'pending' })
    expect(summary.metadata).toMatchObject({
      digest: list.digest,
      total: 5,
      onSale: 3,
      publishedNothingToSell: 2,
      refused: 0,
      skippedPast: 1,
    })
    expect([...summary.metadata.runIds].sort()).toEqual([...runIds].sort())

    // A second call: the old digest is refused, and the list now holds only
    // the event that started.
    await expect(
      approvePendingImports(prisma, { digest: list.digest, actor, runIds }),
    ).rejects.toMatchObject({ code: 'IMPORT_PENDING_CHANGED' })

    const after = await pendingImports(prisma, { runIds })

    expect(after).toMatchObject({ total: 0, past: 1 })
    expect(
      await approvePendingImports(prisma, { digest: after.digest, actor, runIds }),
    ).toMatchObject({ total: 0, onSale: 0, refused: 0 })
  })
})

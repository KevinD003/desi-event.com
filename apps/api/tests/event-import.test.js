import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A doctored capability table, switched on for one test only: ADMIN keeps
 * `event:import` but loses `moderation:review`, so the approve route's own
 * check is the one that must refuse. Off, every check is the real one.
 */
const doctored = vi.hoisted(() => ({ withoutReview: false }))

vi.mock('@desi-event/permissions', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    assertCan(actor, capability, context) {
      if (doctored.withoutReview && capability === actual.CAPABILITIES.MODERATION_REVIEW) {
        // The real refusal, for an actor whose role grants nothing here.
        return actual.assertCan({ ...actor, role: 'ATTENDEE' }, capability, context)
      }

      return actual.assertCan(actor, capability, context)
    },
  }
})

import { importedFromView, publicPriceName } from '../src/lib/presenters.js'
import { normaliseError } from '../src/lib/errors.js'
import { runImportCommand } from '../scripts/import-events.mjs'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { solidPng } from './helpers/images.js'

/**
 * Importing listed events (SPEC2-XI area I), through the routes, on the stub:
 * the plan, applying it into the platform-held organisation, approving and
 * publishing, the review exemption and its limits, the website link, pictures,
 * moving an event to an organiser, and what the public pages carry.
 *
 * @file @desi-event/api/tests/event-import
 */

const DAY = 86_400_000

/** One clock for every listing in this file, to the second, so a file read twice plans the same. */
const NOW = Math.floor(Date.now() / 1000) * 1000

/** A cover large enough for a cover, and a gallery picture. */
const COVER = solidPng(1200, 700)
const GALLERY = solidPng(400, 400)

/**
 * A picture fetcher that answers from memory: a cover for an address with
 * `cover` in it, a gallery picture otherwise, and a 404 for `missing`.
 *
 * @param {string} url The address.
 * @returns {Promise<object>} What `fetchImportImage` answers.
 */
async function fetchFromMemory(url) {
  if (url.includes('missing')) return { ok: false, code: 'HTTP_404' }

  return {
    ok: true,
    bytes: url.includes('cover') ? COVER : GALLERY,
    contentType: 'image/png',
  }
}

/**
 * One listing, starting `days` from now.
 *
 * @param {string} sourceId The listing's id.
 * @param {object} [overrides] Fields to replace.
 * @returns {object} The listing.
 */
function listing(sourceId, overrides = {}) {
  const startsAt = new Date(NOW + (overrides.days ?? 12) * DAY)
  const { days: _days, ...rest } = overrides

  return {
    sourceId,
    sourceUrl: `https://events.sulekha.com/garba-night_event-in_irving-tx_${sourceId}`,
    scrapedAt: '2026-09-29T21:25:00Z',
    title: `Garba Night ${sourceId}`,
    category: 'GARBA_DANDIYA',
    sourceCategory: 'GARBA_DANDIYA',
    summary: 'An evening of garba and dandiya with a live band.',
    description: 'Dance the night away.\n\nFood stalls and a live band.',
    startsAt: startsAt.toISOString(),
    endsAt: null,
    timeZone: 'America/Chicago',
    venue: {
      name: 'Irving Convention Center',
      addressLine1: '500 W Las Colinas Blvd',
      city: 'Irving',
      region: 'TX',
      postalCode: '75039',
      country: 'US',
    },
    performers: [{ name: 'Falguni Pathak', role: 'Lead vocals' }],
    presentedBy: 'DFW Garba Collective',
    languages: ['Gujarati'],
    prices: [
      { name: 'Child', priceCents: 0, currency: 'USD', note: 'Under 5' },
      { name: 'Early Bird', priceCents: 2000, currency: 'USD', note: 'Sold Out' },
      { name: 'Regular', priceCents: 3500, currency: 'USD', note: null },
    ],
    priceText: '$20 - $35',
    ageRestriction: 'All Age',
    dressCode: 'Traditional',
    parking: 'Free parking in lot B.',
    faq: [{ q: 'Is there food?', a: 'Yes, stalls on site.' }],
    images: [
      {
        url: `https://usimg.sulekha.io/cdn/events/images/cover-${sourceId}.png`,
        role: 'cover',
        alt: `Garba Night ${sourceId} poster`,
      },
      {
        url: `https://usimg.sulekha.io/cdn/events/images/gallery-${sourceId}.png`,
        role: 'gallery',
        alt: 'Dancers in a circle',
      },
    ],
    ticketUrl: `https://events.sulekha.com/garba-night_event-in_irving-tx_${sourceId}`,
    importNotes: [`Note for ${sourceId}.`],
    ...rest,
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
 * Sign in, and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @param {{stepUp?: boolean}} [options] Whether to confirm the second factor.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email, { stepUp: confirm = true } = {}) {
  const headers = bearer(await signIn(app, email))

  if (confirm) await stepUp(app, email, headers)

  return headers
}

/**
 * Build the app with the picture fetcher from memory.
 *
 * @param {object} [options] Options for `createTestApp`.
 * @returns {Promise<object>} The harness.
 */
function importApp(options = {}) {
  return createTestApp({ fetchImportImage: fetchFromMemory, ...options })
}

/**
 * Upload a file.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {object} file The dataset.
 * @returns {Promise<object>} The response.
 */
function preview(app, headers, file) {
  return app.inject({
    method: 'POST',
    url: '/v1/platform/imports',
    headers,
    payload: { fileName: 'sulekha.json', dataset: file },
  })
}

/**
 * Apply a run.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {object} run The run, as the preview answered it.
 * @param {string[]} [updateFromSource] Posted listings to update.
 * @returns {Promise<object>} The response.
 */
function apply(app, headers, run, updateFromSource = []) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/imports/${run.id}/apply`,
    headers,
    payload: { planDigest: run.planDigest, updateFromSource },
  })
}

/**
 * Approve events of a run, each at its revision now.
 *
 * @param {object} app The app.
 * @param {object} prisma The stub.
 * @param {object} headers Whose request.
 * @param {string} runId The run.
 * @param {string[]} eventIds The events.
 * @returns {Promise<object>} The response.
 */
function approve(app, prisma, headers, runId, eventIds) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/imports/${runId}/approve`,
    headers,
    payload: {
      items: eventIds.map((eventId) => ({
        eventId,
        revision: prisma._store.event.find((row) => row.id === eventId)?.revision ?? 0,
      })),
    },
  })
}

/**
 * Preview and apply a file as Anil, the ADMIN.
 *
 * @param {object} app The app.
 * @param {object} headers Anil's headers.
 * @param {object} file The dataset.
 * @returns {Promise<{run: object, applied: object}>} The run and the apply's answer.
 */
async function importFile(app, headers, file) {
  const previewed = await preview(app, headers, file)

  expect(previewed.statusCode, previewed.body).toBe(201)

  const run = previewed.json().data
  const applied = await apply(app, headers, run)

  expect(applied.statusCode, applied.body).toBe(200)

  return { run, applied: applied.json() }
}

/**
 * The imported event for a listing.
 *
 * @param {object} prisma The stub.
 * @param {string} sourceId The listing.
 * @returns {object} The event row.
 */
function eventFor(prisma, sourceId) {
  const item = prisma._store.eventImportItem.find((row) => row.sourceId === sourceId)

  return prisma._store.event.find((row) => row.id === item?.eventId)
}

/**
 * Audit rows of an action.
 *
 * @param {object} prisma The stub.
 * @param {string} action The action.
 * @returns {object[]} The rows.
 */
function audits(prisma, action) {
  return prisma._store.auditLog.filter((row) => row.action === action)
}

const ANIL = 'anil@desi-event.example'
const OPS = 'ops@desi-event.example'
const MAYA = 'maya@desi-event.example'

describe('who may import (SPEC2-XI §4.3)', () => {
  it('admits ADMIN and SUPER_ADMIN, and refuses a moderator, an organiser and an attendee', async () => {
    const { app } = await importApp()
    const file = dataset([listing('900001')])

    for (const email of [MAYA, 'owner@rangoli.example', 'priya@example.com']) {
      const headers = await as(app, email, { stepUp: email === MAYA })

      for (const response of [
        await preview(app, headers, file),
        await app.inject({ method: 'GET', url: '/v1/platform/imports', headers }),
        await app.inject({ method: 'GET', url: '/v1/platform/import-targets', headers }),
      ]) {
        expect(response.statusCode, email).toBe(403)
      }
    }

    for (const email of [ANIL, OPS]) {
      const response = await preview(app, await as(app, email), file)

      expect(response.statusCode, email).toBe(201)
      expect(response.headers['cache-control']).toBe('no-store')
    }

    await app.close()
  })

  it('needs the MODERATION step-up to apply and to retry, and EVENT_PUBLISH to approve and move', async () => {
    const { app, prisma, ids } = await importApp()
    const fresh = await as(app, ANIL, { stepUp: false })

    // The factor given at sign-in, moved back past every window.
    for (const session of prisma._store.session) {
      if (session.userId === ids.platformAdministrator.id) {
        session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)
      }
    }

    const previewed = await preview(app, fresh, dataset([listing('900002')]))

    // Planning writes only the run, so it needs no second factor.
    expect(previewed.statusCode).toBe(201)

    const run = previewed.json().data
    const refused = await apply(app, fresh, run)

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.eventImportRun[0].status).toBe('PREVIEWED')

    for (const [url, payload] of [
      [`/v1/platform/imports/${run.id}/images/retry`, {}],
      [`/v1/platform/imports/${run.id}/approve`, { items: [{ eventId: run.id, revision: 0 }] }],
      [
        `/v1/platform/imports/events/${run.id}/reassign`,
        { organizationId: run.id, reason: 'They run it themselves.', revision: 0 },
      ],
    ]) {
      const response = await app.inject({ method: 'POST', url, headers: fresh, payload })

      expect(response.statusCode, url).toBe(403)
      expect(response.json().error.code, url).toBe('STEP_UP_REQUIRED')
    }

    await app.close()
  })

  it('shares twenty previews, applies and retries an hour per administrator', async () => {
    const { app } = await importApp({ rateLimit: { eventImport: { max: 2 } } })
    const headers = await as(app, ANIL)
    const file = dataset([listing('900003')])

    expect((await preview(app, headers, file)).statusCode).toBe(201)
    expect((await preview(app, headers, file)).statusCode).toBe(201)

    const third = await preview(app, headers, file)

    expect(third.statusCode).toBe(429)

    // Somebody else's budget is their own.
    expect((await preview(app, await as(app, OPS), file)).statusCode).toBe(201)

    await app.close()
  })
})

describe('POST /v1/platform/imports: the plan', () => {
  it('plans a file without writing anything but the run, audited', async () => {
    const { app, prisma, ids } = await importApp()
    const before = prisma._store.event.length
    const response = await preview(
      app,
      await as(app, ANIL),
      dataset([listing('900010'), listing('900011', { days: -2 })]),
    )

    expect(response.statusCode).toBe(201)

    const run = response.json().data

    expect(run).toMatchObject({ status: 'PREVIEWED', eventCount: 2, fileName: 'sulekha.json' })
    expect(run.rows.map((row) => [row.sourceId, row.action])).toEqual([
      ['900010', 'CREATE'],
      ['900011', 'SKIPPED_PAST'],
    ])
    expect(run.rows[0]).toMatchObject({
      importNotes: ['Note for 900010.'],
      imageCount: 2,
      priceCount: 3,
      endTimeListed: false,
      event: null,
    })
    expect(prisma._store.event).toHaveLength(before)
    expect(prisma._store.organization.some((row) => row.platformHeldSource)).toBe(false)

    const [audit] = audits(prisma, 'event_import.previewed')

    expect(audit).toMatchObject({ entityId: run.id, actorId: ids.platformAdministrator.id })
    expect(audit.metadata).toMatchObject({ eventCount: 2, via: 'web' })
    expect(JSON.stringify(audit.metadata)).not.toMatch(/usimg|events\.sulekha/u)

    await app.close()
  })

  it('refuses a file with problems, 422 IMPORT_INVALID, each placed', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const bad = dataset([
      listing('900020', { ticketUrl: 'https://tickets.example/elsewhere' }),
      listing('900021', {
        images: [{ url: 'https://images.example/a.png', role: 'cover', alt: 'A poster' }],
      }),
    ])
    const response = await preview(app, headers, bad)

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('IMPORT_INVALID')
    expect(response.json().error.problems.join('\n')).toMatch(
      /events\[0\] \(listing 900020\) ticketUrl/u,
    )
    expect(response.json().error.problems.join('\n')).toMatch(/events\[1\].*images\[0\]\.url/u)

    const wrongFormat = await preview(app, headers, {
      ...dataset([listing('900022')]),
      format: 'x',
    })

    expect(wrongFormat.statusCode).toBe(422)
    expect(prisma._store.eventImportRun).toHaveLength(0)

    await app.close()
  })
})

describe('POST /v1/platform/imports/:runId/apply', () => {
  it('creates each event as a draft in the platform-held organisation and sends it for review', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run, applied } = await importFile(app, headers, dataset([listing('900030')]))
    const event = eventFor(prisma, '900030')
    const organization = prisma._store.organization.find((row) => row.id === event.organizationId)

    // The organisation: created once, VERIFIED, member-less, platform-held.
    expect(organization).toMatchObject({
      name: 'Sulekha Events',
      slug: 'sulekha-events',
      platformHeldSource: 'SULEKHA',
      verificationStatus: 'VERIFIED',
      websiteUrl: null,
      payoutCurrency: 'USD',
    })
    expect(prisma._store.membership.some((row) => row.organizationId === organization.id)).toBe(
      false,
    )
    expect(audits(prisma, 'organization.platform_held_created')).toHaveLength(1)

    // The event went into review from a draft, by the import's own move.
    expect(event.status).toBe('REVIEW_PENDING')

    const moves = prisma._store.eventModerationAction.filter((row) => row.eventId === event.id)

    expect(moves.map((row) => [row.fromStatus, row.toStatus])).toEqual([
      ['DRAFT', 'REVIEW_PENDING'],
    ])
    expect(moves[0]).toMatchObject({
      actorId: ids.platformAdministrator.id,
      reason: `Imported from Sulekha, run ${run.id}.`,
    })

    const [review] = audits(prisma, 'event.review_pending').filter(
      (row) => row.entityId === event.id,
    )

    expect(review.metadata).toMatchObject({
      authority: 'PLATFORM',
      via: 'IMPORT',
      importRunId: run.id,
      from: 'DRAFT',
      to: 'REVIEW_PENDING',
    })
    expect(audits(prisma, 'event.imported')[0].metadata).toMatchObject({
      mode: 'CREATE',
      sourceId: '900030',
      importRunId: run.id,
      via: 'web',
    })

    // Nothing invented: no ticket type, and the night's end is a marked estimate.
    expect(prisma._store.ticketType.some((row) => row.eventId === event.id)).toBe(false)

    const night = prisma._store.eventSession.find((row) => row.eventId === event.id)

    expect(night.endTimeListed).toBe(false)
    expect(night.endsAt.getTime() - night.startsAt.getTime()).toBe(3 * 3_600_000)
    expect(event.endsAt.getTime()).toBe(night.endsAt.getTime())
    expect(event.websiteUrl).toBe(
      'https://events.sulekha.com/garba-night_event-in_irving-tx_900030',
    )
    expect(event.websiteRedirectEnabled).toBe(false)
    expect(event.policies.entry).toBe(
      'Entry is run by the organiser. Check the Sulekha listing for their rules. Age: All Age.',
    )
    expect(event.faq).toEqual([{ question: 'Is there food?', answer: 'Yes, stalls on site.' }])
    expect(event.directions).toBe('Free parking in lot B.')

    // The venue is the platform-held organisation's, marked as imported.
    const venue = prisma._store.venue.find((row) => row.id === event.venueId)

    expect(venue).toMatchObject({ organizationId: organization.id, provenance: 'import:sulekha' })

    // Pictures copied, stored waiting for approval, uploaded by the importer.
    const pictures = prisma._store.mediaAsset.filter((row) => row.eventId === event.id)

    expect(pictures.map((row) => [row.kind, row.moderationStatus]).sort()).toEqual([
      ['EVENT_COVER', 'PENDING'],
      ['EVENT_GALLERY', 'PENDING'],
    ])
    expect(pictures.every((row) => row.uploadedById === ids.platformAdministrator.id)).toBe(true)
    expect(applied.data.pictures).toEqual({ total: 2, stored: 2, failed: 0, waiting: 0 })
    expect(applied.data.status).toBe('APPLIED')
    expect(applied.data.summary).toEqual({ CREATE: 1 })

    await app.close()
  })

  it('applies a run once, within its hour, as planned', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const run = (await preview(app, headers, dataset([listing('900040')]))).json().data
    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers,
      payload: { planDigest: 'f'.repeat(64) },
    })

    expect(wrong.statusCode).toBe(409)
    expect(wrong.json().error.code).toBe('IMPORT_PLAN_CHANGED')

    expect((await apply(app, headers, run)).statusCode).toBe(200)

    const again = await apply(app, headers, run)

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('IMPORT_RUN_APPLIED')
    expect(prisma._store.event.filter((row) => row.title === 'Garba Night 900040')).toHaveLength(1)

    // A plan left for more than an hour.
    const stale = (await preview(app, headers, dataset([listing('900041')]))).json().data

    prisma._store.eventImportRun.find((row) => row.id === stale.id).expiresAt = new Date(
      Date.now() - 1000,
    )

    const expired = await apply(app, headers, stale)

    expect(expired.statusCode).toBe(409)
    expect(expired.json().error.code).toBe('IMPORT_RUN_EXPIRED')

    await app.close()
  })

  it('refuses a plan the database moved under: another run imported the listing first', async () => {
    const { app } = await importApp()
    const headers = await as(app, ANIL)
    const file = dataset([listing('900050')])
    const first = (await preview(app, headers, file)).json().data
    const second = (await preview(app, headers, file)).json().data

    expect((await apply(app, headers, first)).statusCode).toBe(200)

    const response = await apply(app, headers, second)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('IMPORT_PLAN_CHANGED')

    await app.close()
  })

  it('imports again without duplicating: unchanged, then updated as a draft', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900060')]))

    const event = eventFor(prisma, '900060')
    const again = await importFile(app, headers, dataset([listing('900060')]))

    expect(again.run.rows[0].action).toBe('UNCHANGED')
    expect(prisma._store.event.filter((row) => row.title === 'Garba Night 900060')).toHaveLength(1)

    const changed = await importFile(
      app,
      headers,
      dataset([listing('900060', { title: 'Garba Night, renamed' })]),
    )

    expect(changed.run.rows[0].action).toBe('UPDATE_DRAFT')

    const after = prisma._store.event.find((row) => row.id === event.id)

    expect(after.title).toBe('Garba Night, renamed')
    expect(after.status).toBe('REVIEW_PENDING')
    expect(
      prisma._store.eventModerationAction
        .filter((row) => row.eventId === event.id)
        .map((row) => `${row.fromStatus}>${row.toStatus}`),
    ).toEqual(['DRAFT>REVIEW_PENDING', 'REVIEW_PENDING>DRAFT', 'DRAFT>REVIEW_PENDING'])
    expect(prisma._store.eventImportItem.filter((row) => row.sourceId === '900060')).toHaveLength(1)

    await app.close()
  })

  it('stores a cover too small for a cover in the gallery, and records a picture that failed', async () => {
    const small = async (url) =>
      url.includes('missing')
        ? { ok: false, code: 'HTTP_404' }
        : { ok: true, bytes: GALLERY, contentType: 'image/png' }
    const { app, prisma } = await importApp({ fetchImportImage: small })
    const headers = await as(app, ANIL)

    await importFile(
      app,
      headers,
      dataset([
        listing('900070', {
          images: [
            {
              url: 'https://usimg.sulekha.io/cdn/events/images/cover-900070.png',
              role: 'cover',
              alt: 'A small poster',
            },
            {
              url: 'https://usimg.sulekha.io/cdn/events/images/missing.png',
              role: 'gallery',
              alt: 'A picture that is not there',
            },
          ],
        }),
      ]),
    )

    const event = eventFor(prisma, '900070')
    const stored = prisma._store.mediaAsset.filter((row) => row.eventId === event.id)

    expect(stored.map((row) => row.kind)).toEqual(['EVENT_GALLERY'])

    const rows = prisma._store.eventImportImage.sort(
      (left, right) => left.position - right.position,
    )

    expect(rows.map((row) => [row.status, row.failureCode])).toEqual([
      ['STORED', null],
      ['FAILED', 'HTTP_404'],
    ])
    expect(
      audits(prisma, 'event.media_added').find((row) => row.entityId === event.id).metadata,
    ).toMatchObject({ via: 'import', note: 'Too small for a cover' })

    // The run page says why the cover is in the gallery, and why the other failed.
    const view = await app.inject({
      method: 'GET',
      url: `/v1/platform/imports/${prisma._store.eventImportRun[0].id}`,
      headers,
    })
    const pictures = view.json().data.rows[0].pictures

    expect(pictures.map((picture) => [picture.role, picture.status, picture.note])).toEqual([
      ['COVER', 'STORED', 'Too small for a cover'],
      ['GALLERY', 'FAILED', null],
    ])

    await app.close()
  })

  it('puts a cover too small for a cover first in the gallery, even when it is copied last', async () => {
    let coverReachable = false
    const fetcher = async (url) =>
      url.includes('cover') && !coverReachable
        ? { ok: false, code: 'TIMEOUT' }
        : { ok: true, bytes: GALLERY, contentType: 'image/png' }
    const { app, prisma } = await importApp({ fetchImportImage: fetcher })
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900075')]))
    const event = eventFor(prisma, '900075')
    const gallery = () =>
      prisma._store.mediaAsset
        .filter((row) => row.eventId === event.id && row.kind === 'EVENT_GALLERY')
        .sort((left, right) => left.position - right.position)
    const [listed] = gallery()

    expect(gallery().map((row) => row.position)).toEqual([0])

    // Sulekha answers again: the small cover is copied after the gallery.
    coverReachable = true

    const retried = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers,
      payload: {},
    })

    expect(retried.statusCode, retried.body).toBe(200)

    const after = gallery()
    const cover = prisma._store.eventImportImage.find((row) => row.role === 'COVER')

    expect(after.map((row) => row.position)).toEqual([0, 1])
    expect(after[0].id).toBe(cover.mediaAssetId)
    expect(after[1].id).toBe(listed.id)

    await app.close()
  })

  it('leaves pictures waiting when the copying time runs out, for "Retry pictures"', async () => {
    let calls = 0
    const slow = async (url) => {
      calls += 1
      // Every fetch answers after the budget would be gone.
      await new Promise((resolve) => setTimeout(resolve, 5))

      return fetchFromMemory(url)
    }
    const { app, prisma } = await importApp({ fetchImportImage: slow })
    const headers = await as(app, ANIL)
    const run = (await preview(app, headers, dataset([listing('900080')]))).json().data
    const { IMPORT_IMAGE_BUDGET_MS } = await import('../src/lib/event-import.js')
    const realNow = Date.now

    // The clock jumps past the budget as soon as copying starts.
    vi.spyOn(Date, 'now').mockImplementation(() =>
      calls > 0 ? realNow() + IMPORT_IMAGE_BUDGET_MS + 1_000 : realNow(),
    )

    try {
      const response = await apply(app, headers, run)

      expect(response.statusCode).toBe(200)
      expect(response.json().meta.picturesWaiting).toBeGreaterThan(0)
    } finally {
      vi.restoreAllMocks()
    }

    expect(prisma._store.eventImportImage.some((row) => row.status === 'WAITING')).toBe(true)

    const retried = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers,
      payload: {},
    })

    expect(retried.statusCode).toBe(200)
    expect(retried.json().meta.picturesWaiting).toBe(0)
    expect(prisma._store.eventImportImage.every((row) => row.status === 'STORED')).toBe(true)
    expect(audits(prisma, 'event_import.images_retried')).toHaveLength(1)

    await app.close()
  })

  it('refuses to retry the pictures of an event the run did not write', async () => {
    const { app, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900090')]))
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers,
      payload: { eventIds: [ids.reviewPendingEvent.id] },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_IN_RUN')

    await app.close()
  })
})

describe('POST /v1/platform/imports/:runId/approve', () => {
  it('approves, publishes and switches the Sulekha link on, recording the exemption', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900100')]))
    const event = eventFor(prisma, '900100')
    const response = await approve(app, prisma, headers, run.id, [event.id])

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.results).toEqual([
      expect.objectContaining({
        eventId: event.id,
        outcome: 'PUBLISHED',
        status: 'PUBLISHED',
        picturesApproved: 2,
        code: null,
      }),
    ])

    const after = prisma._store.event.find((row) => row.id === event.id)

    expect(after).toMatchObject({
      status: 'PUBLISHED',
      websiteRedirectEnabled: true,
      websiteDecidedUrl: event.websiteUrl,
      websiteRedirectReason:
        'Tickets for this event are sold on its Sulekha page, which this link opens.',
    })
    expect(after.publishedAt).toBeInstanceOf(Date)

    // The importer approved their own import: the exemption, recorded.
    const [approved] = audits(prisma, 'event.approved').filter((row) => row.entityId === event.id)

    expect(approved.metadata).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      importedById: ids.platformAdministrator.id,
      approvedById: ids.platformAdministrator.id,
      via: 'import',
      importRunId: run.id,
    })

    const decision = prisma._store.eventModerationAction.find(
      (row) => row.eventId === event.id && row.toStatus === 'APPROVED',
    )

    expect(decision.reason).toMatch(/PLATFORM_HELD_IMPORT exemption/u)
    expect(decision.reason).toContain(ids.platformAdministrator.id)

    const [published] = audits(prisma, 'event.published').filter((row) => row.entityId === event.id)

    expect(published.metadata).toMatchObject({ authority: 'PLATFORM', via: 'IMPORT' })
    expect(audits(prisma, 'event.website_redirect_changed')).toHaveLength(1)
    expect(prisma._store.eventImportItem.find((row) => row.eventId === event.id)).toMatchObject({
      approvedById: ids.platformAdministrator.id,
    })
    expect(
      prisma._store.mediaAsset
        .filter((row) => row.eventId === event.id)
        .every((row) => row.moderationStatus === 'APPROVED'),
    ).toBe(true)

    // Published without opening sales: nothing can be sold.
    expect(prisma._store.ticketType.some((row) => row.eventId === event.id)).toBe(false)

    await app.close()
  })

  it('refuses another run’s event, an organiser’s own event and a moved one, writing nothing', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const first = await importFile(app, headers, dataset([listing('900110')]))
    const second = await importFile(app, headers, dataset([listing('900111')]))
    const other = eventFor(prisma, '900111')
    const response = await approve(app, prisma, headers, first.run.id, [
      other.id,
      ids.reviewPendingEvent.id,
    ])

    expect(response.statusCode).toBe(200)
    expect(response.json().data.results.map((row) => [row.outcome, row.code])).toEqual([
      ['REFUSED', 'NOT_IN_RUN'],
      ['REFUSED', 'NOT_IN_RUN'],
    ])
    expect(prisma._store.event.find((row) => row.id === other.id).status).toBe('REVIEW_PENDING')
    expect(prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id).status).toBe(
      'REVIEW_PENDING',
    )

    // Moved to an organiser: no longer the platform's to publish.
    const moved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${other.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: other.revision,
      },
    })

    expect(moved.statusCode, moved.body).toBe(200)

    const refused = await approve(app, prisma, headers, second.run.id, [other.id])

    expect(refused.json().data.results[0]).toMatchObject({
      outcome: 'REFUSED',
      code: 'NOT_PLATFORM_HELD',
    })
    expect(prisma._store.event.find((row) => row.id === other.id).status).toBe('REVIEW_PENDING')
    expect(audits(prisma, 'event.approved')).toHaveLength(0)

    await app.close()
  })

  it('refuses an approval at a revision the page did not show: a picture stored since', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900120')]))
    const event = eventFor(prisma, '900120')
    const seen = event.revision
    const image = prisma._store.eventImportImage.find((row) => row.role === 'GALLERY')

    // The picture is copied again after the page was read: the revision moves.
    image.status = 'FAILED'
    image.failureCode = 'TIMEOUT'
    prisma._store.mediaAsset = prisma._store.mediaAsset.filter(
      (row) => row.id !== image.mediaAssetId,
    )

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/platform/imports/${run.id}/images/retry`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/approve`,
      headers,
      payload: { items: [{ eventId: event.id, revision: seen }] },
    })

    expect(response.json().data.results[0]).toMatchObject({
      outcome: 'REFUSED',
      code: 'STALE_REVISION',
    })
    expect(prisma._store.event.find((row) => row.id === event.id).status).toBe('REVIEW_PENDING')

    await app.close()
  })

  it('publishes one a moderator approved without approving it again, and records that approver', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900130')]))
    const event = eventFor(prisma, '900130')
    const maya = await as(app, MAYA)
    const decided = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers: maya,
      payload: { decision: 'approve', revision: event.revision },
    })

    expect(decided.statusCode, decided.body).toBe(200)
    // A moderator who did not import it is independent: no exemption recorded.
    expect(audits(prisma, 'event.approved')[0].metadata.exemption).toBeUndefined()

    const response = await approve(app, prisma, headers, run.id, [event.id])

    expect(response.json().data.results[0]).toMatchObject({
      outcome: 'PUBLISHED',
      status: 'PUBLISHED',
    })
    expect(audits(prisma, 'event.approved')).toHaveLength(1)
    expect(prisma._store.eventImportItem.find((row) => row.eventId === event.id)).toMatchObject({
      approvedById: ids.moderator.id,
    })

    await app.close()
  })

  it('approves only the waiting imported pictures of an event already posted', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900140')]))
    const event = eventFor(prisma, '900140')

    await approve(app, prisma, headers, run.id, [event.id])

    // A picture copied after publication waits for approval.
    const image = prisma._store.eventImportImage.find((row) => row.role === 'GALLERY')

    prisma._store.mediaAsset = prisma._store.mediaAsset.filter(
      (row) => row.id !== image.mediaAssetId,
    )
    image.status = 'WAITING'
    image.mediaAssetId = null

    await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers,
      payload: {},
    })

    const waiting = prisma._store.mediaAsset.filter(
      (row) => row.eventId === event.id && row.moderationStatus === 'PENDING',
    )

    expect(waiting).toHaveLength(1)

    const response = await approve(app, prisma, headers, run.id, [event.id])

    expect(response.json().data.results[0]).toMatchObject({
      outcome: 'PICTURES_APPROVED',
      status: 'PUBLISHED',
      picturesApproved: 1,
    })
    expect(audits(prisma, 'event.published')).toHaveLength(1)

    await app.close()
  })

  it('leaves the link alone when another administrator already switched it on', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900150')]))
    const event = eventFor(prisma, '900150')
    const ops = await as(app, OPS)
    const switched = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/website-redirect`,
      headers: ops,
      payload: { enabled: true, reason: 'Checked the listing.', websiteUrl: event.websiteUrl },
    })

    expect(switched.statusCode, switched.body).toBe(200)

    const response = await approve(app, prisma, headers, run.id, [event.id])

    expect(response.json().data.results[0].outcome).toBe('PUBLISHED')
    expect(audits(prisma, 'event.website_redirect_changed')).toHaveLength(1)

    await app.close()
  })

  it('needs moderation:review as well as event:import', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900160')]))
    const event = eventFor(prisma, '900160')
    const response = await approve(app, prisma, headers, 'ckunknownrun000000000000', [event.id])

    expect(response.statusCode).toBe(404)

    // An importer whose capabilities lack `moderation:review` (a doctored
    // table): refused before anything is read or written.
    const auditsBefore = prisma._store.auditLog.length

    doctored.withoutReview = true

    try {
      const refused = await approve(app, prisma, headers, run.id, [event.id])

      expect(refused.statusCode, refused.body).toBe(403)
    } finally {
      doctored.withoutReview = false
    }

    expect(eventFor(prisma, '900160')).toMatchObject({
      status: 'REVIEW_PENDING',
      websiteRedirectEnabled: false,
    })
    expect(prisma._store.auditLog.length).toBe(auditsBefore)
    expect(prisma._store.eventImportItem.find((row) => row.sourceId === '900160')).toMatchObject({
      approvedById: null,
    })

    // Holding both, the same request approves and publishes it.
    expect((await approve(app, prisma, headers, run.id, [event.id])).statusCode).toBe(200)
    expect(eventFor(prisma, '900160').status).toBe('PUBLISHED')

    await app.close()
  })
})

describe('the review of a platform-held import (SPEC2-XI O5, O16)', () => {
  it('refuses request changes on it, from review and from approval, and offers no such move', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900200')]))

    const event = eventFor(prisma, '900200')
    const maya = await as(app, MAYA)
    const sendBack = () =>
      app.inject({
        method: 'POST',
        url: `/v1/moderation/events/${event.id}/decision`,
        headers: maya,
        payload: {
          decision: 'request_changes',
          reason: 'Please add a better category.',
          revision: prisma._store.event.find((row) => row.id === event.id).revision,
        },
      })

    const fromReview = await sendBack()

    expect(fromReview.statusCode).toBe(409)
    expect(fromReview.json().error.code).toBe('IMPORTED_EVENT_NO_EDITOR')
    // The web's sentence word for word, and no promise ("yet") in it.
    expect(fromReview.json().error.message).toBe(
      'Nobody runs this event on Desi-Event, so nobody could make changes you ask for. Approve it and correct it once it is published, reject it, or delete it.',
    )
    expect(fromReview.json().error.message).not.toMatch(/\byet\b|\bsoon\b/iu)

    const transitions = await app.inject({
      method: 'GET',
      url: `/v1/events/${event.id}/transitions`,
      headers: maya,
    })

    expect(transitions.json().data.transitions.map((move) => move.to)).not.toContain(
      'CHANGES_REQUIRED',
    )

    const approved = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers: maya,
      payload: { decision: 'approve', revision: event.revision },
    })

    expect(approved.statusCode).toBe(200)

    const fromApproval = await sendBack()

    expect(fromApproval.statusCode).toBe(409)
    expect(fromApproval.json().error.code).toBe('IMPORTED_EVENT_NO_EDITOR')
    expect(fromApproval.json().error.message).toBe(fromReview.json().error.message)
    expect(prisma._store.event.find((row) => row.id === event.id).status).toBe('APPROVED')

    await app.close()
  })

  it('lets the importer approve it from the ordinary queue, and keeps SELF_REVIEW for everything else', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900210')]))

    const event = eventFor(prisma, '900210')
    const decided = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers,
      payload: { decision: 'approve', revision: event.revision },
    })

    expect(decided.statusCode, decided.body).toBe(200)
    expect(audits(prisma, 'event.approved')[0].metadata).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      importedById: ids.platformAdministrator.id,
    })

    // An ordinary organisation's event Anil sent for review stays his to not decide.
    const own = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    prisma._store.eventModerationAction.push({
      id: 'ckmoveanil00000000000000a',
      eventId: own.id,
      actorId: ids.platformAdministrator.id,
      fromStatus: 'DRAFT',
      toStatus: 'REVIEW_PENDING',
      reason: null,
      requestedChanges: null,
      createdAt: new Date(),
    })

    const refused = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${own.id}/decision`,
      headers,
      payload: { decision: 'approve', revision: own.revision },
    })

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('SELF_REVIEW')

    await app.close()
  })

  it('lets the importer approve an imported picture, and not after the event has moved', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900220')]))
    const event = eventFor(prisma, '900220')

    await approve(app, prisma, headers, run.id, [event.id])

    // Two pictures copied again after publication.
    for (const image of prisma._store.eventImportImage) {
      prisma._store.mediaAsset = prisma._store.mediaAsset.filter(
        (row) => row.id !== image.mediaAssetId,
      )
      image.status = 'WAITING'
      image.mediaAssetId = null
    }

    await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers,
      payload: {},
    })

    const [first, second] = prisma._store.mediaAsset.filter(
      (row) => row.eventId === event.id && row.moderationStatus === 'PENDING',
    )
    const decide = (mediaId) =>
      app.inject({
        method: 'POST',
        url: `/v1/moderation/media/${mediaId}/decision`,
        headers,
        payload: { decision: 'approve' },
      })

    const allowed = await decide(first.id)

    expect(allowed.statusCode, allowed.body).toBe(200)
    expect(
      audits(prisma, 'moderation.media_approved').find((row) => row.entityId === first.id).metadata,
    ).toMatchObject({
      exemption: 'PLATFORM_HELD_IMPORT',
      approvedById: ids.platformAdministrator.id,
    })

    const current = prisma._store.event.find((row) => row.id === event.id)
    const moved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: current.revision,
      },
    })

    expect(moved.statusCode, moved.body).toBe(200)

    const refused = await decide(second.id)

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('SELF_REVIEW')

    await app.close()
  })
})

describe('nothing is sold here while the platform holds it (SPEC2-XI I5)', () => {
  it('refuses a ticket type and sales even to a super administrator, until the event moves', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900300')]))
    const event = eventFor(prisma, '900300')

    await approve(app, prisma, headers, run.id, [event.id])

    const ops = await as(app, OPS)
    const sitting = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${event.id}/edit`,
      headers: ops,
      payload: { reason: 'Adding the tiers the organiser sent us.' },
    })

    expect(sitting.statusCode, sitting.body).toBe(201)

    const revision = () => prisma._store.event.find((row) => row.id === event.id).revision
    const tier = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/tiers`,
      headers: ops,
      payload: { revision: revision(), name: 'General', priceCents: 2000, quantityTotal: 10 },
    })
    const legacy = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/ticket-types`,
      headers: ops,
      payload: { eventId: event.id, name: 'General', priceCents: 2000, quantityTotal: 10 },
    })
    const sales = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/open-sales`,
      headers: ops,
      payload: {},
    })

    for (const response of [tier, legacy, sales]) {
      expect(response.statusCode, response.body).toBe(409)
      expect(response.json().error.code).toBe('SOLD_ON_SOURCE')
    }

    expect(prisma._store.ticketType.some((row) => row.eventId === event.id)).toBe(false)
    expect(prisma._store.event.find((row) => row.id === event.id).status).toBe('PUBLISHED')

    // Moved to its organiser's organisation: they may sell.
    await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: revision(),
      },
    })

    const owner = await as(app, 'owner@rangoli.example', { stepUp: false })
    const theirs = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/tiers`,
      headers: owner,
      payload: { revision: revision(), name: 'General', priceCents: 2000, quantityTotal: 10 },
    })

    expect(theirs.statusCode, theirs.body).toBe(201)

    await app.close()
  })
})

describe('what the public pages carry (SPEC2-XI I-E)', () => {
  it('shows who presents it, Sulekha’s prices and the link, and no picture address', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900400')]))
    const event = eventFor(prisma, '900400')

    // Not public before approval.
    expect((await app.inject({ method: 'GET', url: `/v1/events/${event.slug}` })).statusCode).toBe(
      404,
    )

    await approve(app, prisma, headers, run.id, [event.id])

    const page = await app.inject({ method: 'GET', url: `/v1/events/${event.slug}` })

    expect(page.statusCode).toBe(200)

    const data = page.json().data

    expect(data.importedFrom).toEqual({
      sourceName: 'Sulekha',
      presentedBy: 'DFW Garba Collective',
      listedOn: '2026-09-29',
      prices: [
        { name: 'Child', priceCents: 0, currency: 'USD' },
        { name: 'Early Bird', priceCents: 2000, currency: 'USD' },
        { name: 'Regular', priceCents: 3500, currency: 'USD' },
      ],
      priceListed: true,
      ticketsOnSource: true,
    })
    expect(data.websiteLink).toEqual({ host: 'events.sulekha.com' })
    expect(data.ticketTypes).toEqual([])
    expect(data.sessions[0].endTimeListed).toBe(false)
    expect(page.body).not.toMatch(/usimg\.sulekha\.io|Sold Out|Under 5/u)

    const list = await app.inject({ method: 'GET', url: '/v1/events?perPage=100' })
    const card = list.json().data.find((row) => row.id === event.id)

    expect(card.importedFrom).toMatchObject({ priceListed: true, ticketsOnSource: true })
    expect(card.minPriceCents).toBeNull()
    expect(list.body).not.toMatch(/usimg\.sulekha\.io/u)

    await app.close()
  })

  it('is null for every other event, for a moved one, and says so when no price was listed', () => {
    const base = {
      status: 'PUBLISHED',
      websiteRedirectEnabled: true,
      websiteDecidedUrl: 'https://events.sulekha.com/x_1',
      organization: { platformHeldSource: 'SULEKHA' },
      importItem: {
        source: 'SULEKHA',
        sourceUrl: 'https://events.sulekha.com/x_1',
        scrapedAt: new Date('2026-09-30T23:59:00Z'),
        presentedBy: null,
        prices: [],
        reassignedAt: null,
      },
    }

    expect(importedFromView(base)).toMatchObject({
      listedOn: '2026-09-30',
      prices: [],
      priceListed: false,
      ticketsOnSource: true,
    })
    expect(importedFromView({ ...base, importItem: null })).toBeNull()
    expect(importedFromView({ ...base, organization: { platformHeldSource: null } })).toBeNull()
    expect(
      importedFromView({ ...base, importItem: { ...base.importItem, reassignedAt: new Date() } }),
    ).toBeNull()
    // The link off, or going elsewhere: not "Buy tickets on Sulekha".
    expect(importedFromView({ ...base, websiteRedirectEnabled: false }).ticketsOnSource).toBe(false)
    expect(
      importedFromView({ ...base, websiteDecidedUrl: 'https://organiser.example/' })
        .ticketsOnSource,
    ).toBe(false)
    expect(importedFromView({ ...base, status: 'APPROVED' }).ticketsOnSource).toBe(false)
  })

  it('never prints a sales date or a call to hurry that the listing put into a price name', () => {
    const event = {
      status: 'PUBLISHED',
      websiteRedirectEnabled: true,
      websiteDecidedUrl: 'https://events.sulekha.com/x_402109',
      organization: { platformHeldSource: 'SULEKHA' },
      importItem: {
        source: 'SULEKHA',
        sourceUrl: 'https://events.sulekha.com/x_402109',
        scrapedAt: new Date('2026-09-29T21:25:00Z'),
        presentedBy: 'DFW Garba Collective',
        // As the committed file lists 402109 and 401676.
        prices: [
          { name: 'Early Bird (Ends on 10/9)', priceCents: 2000, currency: 'USD', note: null },
          {
            name: 'GA – Ghost Hour Pass Admission (Final Call)',
            priceCents: 3500,
            currency: 'USD',
            note: null,
          },
          { name: 'Friday (Tier 1)', priceCents: 2500, currency: 'USD', note: 'Sold Out' },
          { name: 'VIP – Gold Tables (B1–B10)', priceCents: 9000, currency: 'USD', note: null },
          { name: 'GA - Spooky Pass (Early Bird)', priceCents: 1500, currency: 'USD', note: null },
        ],
        reassignedAt: null,
      },
    }
    const view = importedFromView(event)

    expect(view.prices.map((price) => price.name)).toEqual([
      'Early Bird',
      'GA – Ghost Hour Pass Admission',
      'Friday (Tier 1)',
      'VIP – Gold Tables (B1–B10)',
      'GA - Spooky Pass (Early Bird)',
    ])
    expect(JSON.stringify(view)).not.toMatch(/10\/9|Ends on|Final Call|Sold Out/u)

    // Whatever an upload names its prices, the same words are kept out.
    expect(publicPriceName('Tier 2 [Sold Out]')).toBe('Tier 2')
    expect(publicPriceName('GA (Until Oct 23)')).toBe('GA')
    expect(publicPriceName('Couple - last chance')).toBe('Couple')
    expect(publicPriceName('(Final Call)')).toBe('Ticket')
    expect(publicPriceName('Kids (Under 5)')).toBe('Kids (Under 5)')
    expect(publicPriceName('Marathon (5K)')).toBe('Marathon (5K)')
  })
})

describe('POST /v1/platform/imports/events/:eventId/reassign', () => {
  it('moves the event and its venue, stamps it, switches the Sulekha link off, audited', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900500')]))
    // A copy: the stub hands out its own rows.
    const event = { ...eventFor(prisma, '900500') }

    await approve(app, prisma, headers, run.id, [event.id])

    const current = prisma._store.event.find((row) => row.id === event.id)
    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: current.revision,
      },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toMatchObject({
      organizationId: ids.organization.id,
      status: 'PUBLISHED',
      slug: event.slug,
      importedFrom: null,
    })

    const after = prisma._store.event.find((row) => row.id === event.id)

    expect(after.websiteRedirectEnabled).toBe(false)
    expect(after.websiteRedirectReason).toBe(
      "Moved to Rangoli Collective. The Sulekha ticket link is off until an administrator approves the organiser's own address.",
    )
    expect(prisma._store.venue.find((row) => row.id === after.venueId).organizationId).toBe(
      ids.organization.id,
    )
    expect(prisma._store.eventImportItem.find((row) => row.eventId === event.id)).toMatchObject({
      reassignedById: ids.platformAdministrator.id,
      reassignedFromOrganizationId: event.organizationId,
      reassignedToOrganizationId: ids.organization.id,
    })

    const [audit] = audits(prisma, 'event.import_reassigned')

    expect(audit.metadata).toMatchObject({
      fromOrganizationId: event.organizationId,
      toOrganizationId: ids.organization.id,
      reason: 'They run this event themselves.',
      websiteLinkTurnedOff: true,
      venue: 'MOVED',
    })
    expect(audits(prisma, 'event.website_redirect_changed')).toHaveLength(2)

    // A second move is refused: it is no longer the platform's.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: after.revision,
      },
    })

    expect(again.json().error.code).toBe('NOT_PLATFORM_HELD')

    await app.close()
  })

  it('copies a venue another imported event still uses', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900510'), listing('900511')]))

    const event = eventFor(prisma, '900510')
    const sibling = eventFor(prisma, '900511')

    expect(event.venueId).toBe(sibling.venueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${event.id}/reassign`,
      headers,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: event.revision,
      },
    })

    expect(response.statusCode, response.body).toBe(200)

    const after = prisma._store.event.find((row) => row.id === event.id)

    expect(after.venueId).not.toBe(sibling.venueId)
    expect(prisma._store.venue.find((row) => row.id === sibling.venueId).organizationId).toBe(
      sibling.organizationId,
    )
    expect(audits(prisma, 'event.import_reassigned')[0].metadata.venue).toBe('COPIED')
    // The link was never on: nothing to switch off.
    expect(audits(prisma, 'event.website_redirect_changed')).toHaveLength(0)

    await app.close()
  })

  it('refuses an event that was not imported, an ineligible target and a stale revision', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900520')]))

    const event = eventFor(prisma, '900520')
    const move = (eventId, organizationId, revision) =>
      app.inject({
        method: 'POST',
        url: `/v1/platform/imports/events/${eventId}/reassign`,
        headers,
        payload: { organizationId, reason: 'They run this event themselves.', revision },
      })

    const own = await move(ids.publishedEvent.id, ids.organization.id, ids.publishedEvent.revision)

    expect(own.json().error.code).toBe('NOT_IMPORTED')

    // Unverified, suspended, or the platform-held organisation itself. A
    // refused write rolls the stub back to fresh rows, so each change is made
    // to the row the store holds now.
    const rangoli = (fields) =>
      Object.assign(
        prisma._store.organization.find((row) => row.id === ids.organization.id),
        fields,
      )

    rangoli({ verificationStatus: 'PENDING' })
    expect((await move(event.id, ids.organization.id, event.revision)).json().error.code).toBe(
      'TARGET_NOT_ELIGIBLE',
    )
    rangoli({ verificationStatus: 'VERIFIED', suspendedAt: new Date() })
    expect((await move(event.id, ids.organization.id, event.revision)).json().error.code).toBe(
      'TARGET_NOT_ELIGIBLE',
    )
    rangoli({ suspendedAt: null })
    expect((await move(event.id, event.organizationId, event.revision)).json().error.code).toBe(
      'TARGET_NOT_ELIGIBLE',
    )

    const stale = await move(event.id, ids.organization.id, event.revision - 1)

    expect(stale.json().error.code).toBe('STALE_REVISION')
    expect(prisma._store.event.find((row) => row.id === event.id).organizationId).toBe(
      event.organizationId,
    )
    expect(audits(prisma, 'event.import_reassigned')).toHaveLength(0)

    await app.close()
  })

  it('lists verified organisations to move to, never the platform-held one', async () => {
    const { app, prisma, ids } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900530')]))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/import-targets?q=rangoli',
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((row) => row.id)).toEqual([ids.organization.id])

    const all = await app.inject({ method: 'GET', url: '/v1/platform/import-targets', headers })

    expect(all.json().data.some((row) => row.slug === 'sulekha-events')).toBe(false)
    // A wildcard is a character, not a pattern.
    const wild = await app.inject({
      method: 'GET',
      url: '/v1/platform/import-targets?q=%25',
      headers,
    })

    expect(wild.json().data).toEqual([])
    expect(prisma._store.organization.some((row) => row.slug === 'sulekha-events')).toBe(true)

    await app.close()
  })
})

describe('updating a posted event from its listing', () => {
  it('keeps a posted listing unless it is named, then updates it as a live edit with a notice', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)
    const { run } = await importFile(app, headers, dataset([listing('900600')]))
    const event = eventFor(prisma, '900600')

    await approve(app, prisma, headers, run.id, [event.id])

    const moved = listing('900600', { days: 14, title: 'Garba Night, moved' })
    const kept = await importFile(app, headers, dataset([moved]))

    expect(kept.run.rows[0]).toMatchObject({ action: 'POSTED_KEPT', updatable: true })
    expect(prisma._store.event.find((row) => row.id === event.id).title).toBe('Garba Night 900600')

    const previewed = (await preview(app, headers, dataset([moved]))).json().data
    const unknown = await apply(app, headers, previewed, ['999999'])

    expect(unknown.statusCode).toBe(422)

    const updated = await apply(app, headers, previewed, ['900600'])

    expect(updated.statusCode, updated.body).toBe(200)

    const after = prisma._store.event.find((row) => row.id === event.id)

    expect(after).toMatchObject({ title: 'Garba Night, moved', status: 'PUBLISHED' })
    expect(prisma._store.eventChangeNotice.filter((row) => row.eventId === event.id)).toHaveLength(
      1,
    )
    expect(
      audits(prisma, 'event.updated').find((row) => row.entityId === event.id).metadata,
    ).toMatchObject({ authority: 'PLATFORM', importRunId: previewed.id })
    expect(
      audits(prisma, 'event.imported').filter((row) => row.metadata.mode === 'UPDATE_POSTED'),
    ).toHaveLength(1)

    await app.close()
  })

  it('plans approved, rejected and archived imports as decided, and leaves them', async () => {
    const { app, prisma } = await importApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('900610')]))

    const event = eventFor(prisma, '900610')

    for (const status of ['APPROVED', 'REJECTED', 'ARCHIVED']) {
      prisma._store.event.find((row) => row.id === event.id).status = status

      const run = (
        await preview(app, headers, dataset([listing('900610', { title: `Renamed ${status}` })]))
      ).json().data

      expect(run.rows[0].action, status).toBe('SKIPPED_DECIDED')
    }

    await app.close()
  })
})

describe('the platform-held organisation takes no members', () => {
  it('maps the trigger’s refusal to 409 PLATFORM_HELD_ORGANIZATION, never a 500', () => {
    const error = Object.assign(new Error('Invalid prisma.membership.create() invocation'), {
      code: 'P2010',
      meta: {
        driverAdapterError: {
          cause: {
            originalCode: '23514',
            originalMessage:
              'platform_held_organization_has_no_members: this organisation holds imported events',
          },
        },
      },
    })

    expect(normaliseError(error)).toMatchObject({
      statusCode: 409,
      code: 'PLATFORM_HELD_ORGANIZATION',
      message:
        "This organisation holds imported events for the Desi-Event team and has no members. Move the event to the organiser's own organisation instead.",
    })
    // Another check violation is still a fault.
    error.meta.driverAdapterError.cause.originalMessage = 'something_else'
    expect(normaliseError(error).statusCode).toBe(500)
  })
})

describe('the command line (SPEC2-XI I-G)', () => {
  let directory

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'desi-event-import-cli-'))
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('plans, and with --apply imports without ever updating a posted event', async () => {
    const { seed, ids } = await makeWorld()
    const { createPrismaStub } = await import('./helpers/prisma-stub.js')
    const prisma = createPrismaStub(seed)
    const file = path.join(directory, 'listings.json')
    const lines = []
    const out = { log: (line) => lines.push(line), error: (line) => lines.push(line) }

    await writeFile(file, JSON.stringify(dataset([listing('900700')])))

    const planned = await runImportCommand({
      argv: [file, '--as', ANIL],
      prisma,
      env: { NODE_ENV: 'test', IMPORT_IMAGE_SOURCE: 'network' },
      fetchImage: fetchFromMemory,
      out,
    })

    expect(planned.results).toBeNull()
    expect(prisma._store.event.some((row) => row.title === 'Garba Night 900700')).toBe(false)
    expect(lines.join('\n')).toMatch(/CREATE\s+900700/u)

    const sent = []
    const applied = await runImportCommand({
      argv: ['--', file, '--as', ANIL.toUpperCase(), '--apply'],
      prisma,
      env: { NODE_ENV: 'test', IMPORT_IMAGE_SOURCE: 'network' },
      fetchImage: fetchFromMemory,
      out,
      apply: async (...args) => {
        sent.push(args[2])

        const { applyImport } = await import('../src/lib/event-import.js')

        return applyImport(...args)
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ updateFromSource: [], via: 'cli' })
    expect(applied.results.map((row) => row.outcome)).toEqual(['WRITTEN'])
    expect(prisma._store.auditLog.find((row) => row.action === 'event.imported').metadata.via).toBe(
      'cli',
    )
    // It never approves or publishes.
    expect(prisma._store.event.find((row) => row.title === 'Garba Night 900700').status).toBe(
      'REVIEW_PENDING',
    )

    // The library refuses a command-line update of a posted event outright.
    const { applyImport } = await import('../src/lib/event-import.js')

    await expect(
      applyImport(prisma, null, {
        run: {},
        actor: { id: ids.platformAdministrator.id },
        planDigest: 'a'.repeat(64),
        updateFromSource: ['900700'],
        via: 'cli',
      }),
    ).rejects.toThrow(/never updates a posted event/u)

    await expect(
      runImportCommand({ argv: [file, '--as', 'maya@desi-event.example'], prisma, env: {}, out }),
    ).rejects.toThrow(/may not import events/u)
    await expect(runImportCommand({ argv: [file], prisma, env: {}, out })).rejects.toThrow(/Usage/u)
  })

  it('refuses a suspended account, as the web does, before planning anything', async () => {
    const { seed } = await makeWorld()
    const { createPrismaStub } = await import('./helpers/prisma-stub.js')
    const prisma = createPrismaStub(seed)
    const file = path.join(directory, 'suspended.json')
    const out = { log: () => {}, error: () => {} }
    const importer = prisma._store.user.find((row) => row.email === ANIL)

    importer.suspendedAt = new Date()
    await writeFile(file, JSON.stringify(dataset([listing('900701')])))

    const runs = prisma._store.eventImportRun.length

    await expect(
      runImportCommand({
        argv: [file, '--as', ANIL, '--apply'],
        prisma,
        env: { NODE_ENV: 'test', IMPORT_IMAGE_SOURCE: 'network' },
        fetchImage: fetchFromMemory,
        out,
      }),
    ).rejects.toThrow('This account is suspended.')
    expect(prisma._store.eventImportRun).toHaveLength(runs)
    expect(prisma._store.event.some((row) => row.title === 'Garba Night 900701')).toBe(false)
  })
})

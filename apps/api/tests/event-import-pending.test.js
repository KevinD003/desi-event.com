import { describe, expect, it, vi } from 'vitest'

/**
 * A doctored capability table, switched on for one test only: ADMIN keeps
 * `event:import` but loses `moderation:review`, so the routes' own check is
 * the one that must refuse. Off, every check is the real one.
 */
const doctored = vi.hoisted(() => ({ withoutReview: false }))

vi.mock('@desi-event/permissions', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    assertCan(actor, capability, context) {
      if (doctored.withoutReview && capability === actual.CAPABILITIES.MODERATION_REVIEW) {
        return actual.assertCan({ ...actor, role: 'ATTENDEE' }, capability, context)
      }

      return actual.assertCan(actor, capability, context)
    },
  }
})

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'

/**
 * "Approve and publish all pending imported events" (the owner, 2026-10-16:
 * "Add all the events and publish all of them on live"), through the routes,
 * on the stub, where each test has a world of its own: who may read the list
 * and approve it, the second factor, the digest, events two runs imported,
 * events with nothing to sell, events that have started, a posted event whose
 * imported tiers wait and one whose tiers are all closed, the audit row, and
 * a second call.
 *
 * On the stub because approving every pending event is global: on the shared
 * test database it would approve the other suites' imports under them. The
 * database-backed claims are in `event-import-integration.test.js`, scoped to
 * that suite's runs.
 *
 * @file @desi-event/api/tests/event-import-pending
 */

const DAY = 86_400_000

/** One clock for every listing, to the second, so a file read twice plans the same. */
const NOW = Math.floor(Date.now() / 1000) * 1000

const ANIL = 'anil@desi-event.example'
const OPS = 'ops@desi-event.example'
const MAYA = 'maya@desi-event.example'

/**
 * One listing.
 *
 * @param {string} sourceId The listing's id.
 * @param {object} [overrides] Fields to replace; `days` moves its start.
 * @returns {object} The listing.
 */
function listing(sourceId, overrides = {}) {
  const { days = 12, ...rest } = overrides

  return {
    sourceId,
    scrapedAt: '2026-09-29T21:25:00Z',
    title: `Garba Night ${sourceId}`,
    category: 'GARBA_DANDIYA',
    sourceCategory: 'GARBA_DANDIYA',
    summary: 'An evening of garba and dandiya with a live band.',
    description: 'Dance the night away.',
    startsAt: new Date(NOW + days * DAY).toISOString(),
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
    performers: [],
    presentedBy: 'DFW Garba Collective',
    languages: ['Gujarati'],
    prices: [{ name: 'Regular', priceCents: 3500, currency: 'USD', note: null }],
    priceText: '$35',
    ageRestriction: null,
    dressCode: null,
    parking: null,
    faq: [],
    importNotes: [],
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
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
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
 * Preview and apply a file.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {object} file The dataset.
 * @returns {Promise<object>} The run, as the preview answered it.
 */
async function importFile(app, headers, file) {
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

/**
 * The pending list.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @returns {Promise<object>} The response.
 */
function pending(app, headers) {
  return app.inject({ method: 'GET', url: '/v1/platform/imports/pending', headers })
}

/**
 * Approve every pending event, naming a digest.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {string} digest The digest read.
 * @returns {Promise<object>} The response.
 */
function approveAll(app, headers, digest) {
  return app.inject({
    method: 'POST',
    url: '/v1/platform/imports/approve-pending',
    headers,
    payload: { digest },
  })
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

describe('who may read the pending list and approve it', () => {
  it('admits ADMIN and SUPER_ADMIN, and refuses a moderator, an organiser and an attendee', async () => {
    const { app } = await createTestApp()

    for (const email of [MAYA, 'owner@rangoli.example', 'priya@example.com']) {
      const headers = await as(app, email, { stepUp: email === MAYA })

      expect((await pending(app, headers)).statusCode, email).toBe(403)
      expect((await approveAll(app, headers, '0'.repeat(64))).statusCode, email).toBe(403)
    }

    for (const email of [ANIL, OPS]) {
      const response = await pending(app, await as(app, email))

      expect(response.statusCode, email).toBe(200)
      expect(response.headers['cache-control']).toBe('no-store')
    }

    await app.close()
  })

  it('refuses an importer who may not review, on the list and the approval alike', async () => {
    const { app } = await createTestApp()
    const headers = await as(app, ANIL)
    const { digest } = (await pending(app, headers)).json().data

    doctored.withoutReview = true

    try {
      expect((await pending(app, headers)).statusCode).toBe(403)

      const refused = await approveAll(app, headers, digest)

      expect(refused.statusCode).toBe(403)
      expect(refused.json().error.code).toBe('FORBIDDEN')
    } finally {
      doctored.withoutReview = false
    }

    await app.close()
  })

  it('needs a second factor within the EVENT_PUBLISH window to approve, not to read', async () => {
    const { app, prisma, ids } = await createTestApp()
    const admin = await as(app, ANIL)

    await importFile(app, admin, dataset([listing('910001')]))

    const fresh = await as(app, ANIL, { stepUp: false })

    for (const session of prisma._store.session) {
      if (session.userId === ids.platformAdministrator.id) {
        session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)
      }
    }

    const listed = await pending(app, fresh)

    expect(listed.statusCode, listed.body).toBe(200)

    const refused = await approveAll(app, fresh, listed.json().data.digest)

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(eventFor(prisma, '910001').status).toBe('REVIEW_PENDING')
    expect(audits(prisma, 'event_import.bulk_approved')).toHaveLength(0)

    await app.close()
  })

  it('shares the import budget with previews and applies', async () => {
    const { app } = await createTestApp({ rateLimit: { eventImport: { max: 2 } } })
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('915001')]))

    // The preview and the apply spent the two; the list is a read and spends none.
    const { digest } = (await pending(app, headers)).json().data
    const third = await approveAll(app, headers, digest)

    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')

    await app.close()
  })

  it('refuses a digest that is not 64 hexadecimal characters before reading anything', async () => {
    const { app } = await createTestApp()
    const headers = await as(app, ANIL)

    for (const digest of ['', 'abc', 'Z'.repeat(64)]) {
      expect((await approveAll(app, headers, digest)).statusCode, digest).toBe(400)
    }

    const extra = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports/approve-pending',
      headers,
      payload: { digest: '0'.repeat(64), items: [] },
    })

    expect(extra.statusCode).toBe(400)

    await app.close()
  })
})

describe('the pending list', () => {
  it('lists every waiting event across runs once, from the run that last wrote it', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    const first = await importFile(app, headers, dataset([listing('920001'), listing('920002')]))
    // The second file has 920002 again, newer: it is now that run's.
    const second = await importFile(
      app,
      headers,
      dataset([listing('920002', { title: 'Garba Night 920002, newer' }), listing('920003')]),
    )

    const { data } = (await pending(app, headers)).json()

    expect(data.total).toBe(3)
    expect(Object.fromEntries(data.items.map((item) => [item.sourceId, item.runId]))).toEqual({
      920001: first.id,
      920002: second.id,
      920003: second.id,
    })
    expect(data.items.every((item) => item.status === 'REVIEW_PENDING')).toBe(true)
    expect(data).toMatchObject({ willGoOnSale: 3, publishedNothingToSell: 0, past: 0 })
    expect(data.digest).toMatch(/^[0-9a-f]{64}$/u)

    // A change to one of them is a different list.
    eventFor(prisma, '920001').revision += 1

    expect((await pending(app, headers)).json().data.digest).not.toBe(data.digest)

    await app.close()
  })

  it('counts what approving does: on sale, or published with nothing to sell', async () => {
    const { app } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(
      app,
      headers,
      dataset([
        listing('930001'),
        // No prices at all.
        listing('930002', { prices: [], priceText: null }),
        // Every price sold out on the listing: its tier is made CLOSED.
        listing('930003', {
          prices: [{ name: 'Regular', priceCents: 3500, currency: 'USD', note: 'Sold Out' }],
        }),
      ]),
    )

    const { data } = (await pending(app, headers)).json()

    expect(data).toMatchObject({ total: 3, willGoOnSale: 1, publishedNothingToSell: 2 })
    expect(
      Object.fromEntries(data.items.map((item) => [item.sourceId, item.willGoOnSale])),
    ).toEqual({ 930001: true, 930002: false, 930003: false })

    await app.close()
  })

  it('leaves out an event that has started or starts within the minute, and counts it', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('940001'), listing('940002')]))

    // Imported days ago; it started an hour ago.
    eventFor(prisma, '940001').startsAt = new Date(Date.now() - 3_600_000)

    const { data } = (await pending(app, headers)).json()

    expect(data.items.map((item) => item.sourceId)).toEqual(['940002'])
    expect(data.past).toBe(1)

    await app.close()
  })

  it('takes a posted event whose imported tiers wait, and not one whose tiers are all closed', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('950001'), listing('950002')]))

    const { data: before } = (await pending(app, headers)).json()
    const approved = await approveAll(app, headers, before.digest)

    expect(approved.statusCode, approved.body).toBe(200)

    // 950001: published again with its imported tier back to a draft, as a
    // re-import with a new price leaves it. 950002: published, its only tier
    // closed (sold out on the listing).
    for (const [sourceId, tierStatus] of [
      ['950001', 'DRAFT'],
      ['950002', 'CLOSED'],
    ]) {
      const event = eventFor(prisma, sourceId)

      event.status = 'PUBLISHED'
      for (const tier of prisma._store.ticketType.filter((row) => row.eventId === event.id)) {
        tier.status = tierStatus
      }
    }

    const { data } = (await pending(app, headers)).json()

    expect(data.items.map((item) => [item.sourceId, item.status, item.willGoOnSale])).toEqual([
      ['950001', 'PUBLISHED', true],
    ])

    await app.close()
  })

  it('leaves out an event moved to an organiser, and one of a run not applied', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('960001'), listing('960002')]))

    // Moved to an organiser's organisation: its organiser publishes it.
    prisma._store.eventImportItem.find((row) => row.sourceId === '960001').reassignedAt = new Date()

    // A preview alone writes no event.
    const previewed = await app.inject({
      method: 'POST',
      url: '/v1/platform/imports',
      headers,
      payload: { fileName: 'listings.json', dataset: dataset([listing('960003')]) },
    })

    expect(previewed.statusCode).toBe(201)

    const { data } = (await pending(app, headers)).json()

    expect(data.items.map((item) => item.sourceId)).toEqual(['960002'])

    await app.close()
  })
})

describe('approving every pending event', () => {
  it('approves and publishes them all, events two runs imported included, and reports each', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('970001'), listing('970002')]))
    await importFile(
      app,
      headers,
      dataset([
        listing('970002', { title: 'Garba Night 970002, newer' }),
        listing('970003', { prices: [], priceText: null }),
      ]),
    )

    const { data: list } = (await pending(app, headers)).json()
    const response = await approveAll(app, headers, list.digest)

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')

    const { data } = response.json()

    expect(data).toMatchObject({
      total: 3,
      onSale: 2,
      publishedNothingToSell: 1,
      refused: 0,
      skippedPast: 0,
      refusals: [],
    })
    expect(data.results.map((result) => result.outcome)).toEqual([
      'PUBLISHED',
      'PUBLISHED',
      'PUBLISHED',
    ])
    expect(eventFor(prisma, '970001').status).toBe('ON_SALE')
    // Approved from the later run, which is the one that last wrote it.
    expect(eventFor(prisma, '970002')).toMatchObject({
      status: 'ON_SALE',
      title: 'Garba Night 970002, newer',
    })
    expect(eventFor(prisma, '970003').status).toBe('PUBLISHED')

    // Each event's own rows, and one for the request.
    expect(audits(prisma, 'event.approved')).toHaveLength(3)
    expect(audits(prisma, 'event.published')).toHaveLength(3)

    const [summary] = audits(prisma, 'event_import.bulk_approved')

    expect(audits(prisma, 'event_import.bulk_approved')).toHaveLength(1)
    expect(summary).toMatchObject({
      entityType: 'EventImport',
      entityId: 'pending',
      actorId: ids.platformAdministrator.id,
    })
    expect(summary.metadata).toMatchObject({
      digest: list.digest,
      total: 3,
      onSale: 2,
      publishedNothingToSell: 1,
      refused: 0,
      skippedPast: 0,
      refusals: [],
    })
    expect(summary.metadata.runIds).toHaveLength(2)
    // Nothing secret: no session, no bearer, no second factor, no address.
    expect(Object.keys(summary.metadata).sort()).toEqual([
      'digest',
      'onSale',
      'publishedNothingToSell',
      'refusals',
      'refused',
      'runIds',
      'skippedPast',
      'total',
    ])
    expect(JSON.stringify(summary.metadata)).not.toMatch(/bearer|token|secret|https?:/iu)

    await app.close()
  })

  it('refuses a digest that is no longer the list, and approves nothing', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('980001')]))

    const { data: list } = (await pending(app, headers)).json()

    // Another listing joins after the list was read.
    await importFile(app, headers, dataset([listing('980002')]))

    const refused = await approveAll(app, headers, list.digest)

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('IMPORT_PENDING_CHANGED')
    expect(eventFor(prisma, '980001').status).toBe('REVIEW_PENDING')
    expect(audits(prisma, 'event.approved')).toHaveLength(0)
    expect(audits(prisma, 'event_import.bulk_approved')).toHaveLength(0)

    await app.close()
  })

  it('reports a refusal for its event and goes on with the rest', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('990001'), listing('990002')]))

    const { data: list } = (await pending(app, headers)).json()
    const blocked = eventFor(prisma, '990001')
    const original = prisma.eventImportItem.findUnique

    // Another run writes the listing between the list and its turn, as an
    // import applied at the same moment would: the approval's own check
    // finds the event is no longer that run's, and refuses it alone.
    prisma.eventImportItem.findUnique = async (args) => {
      const row = await original(args)

      return args?.where?.eventId === blocked.id && row
        ? { ...row, lastRunId: 'cotherrun0000000000000000' }
        : row
    }

    let response

    try {
      response = await approveAll(app, headers, list.digest)
    } finally {
      prisma.eventImportItem.findUnique = original
    }

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data).toMatchObject({ total: 2, onSale: 1, refused: 1 })
    expect(data.refusals).toEqual([
      { eventId: blocked.id, code: 'NOT_IN_RUN', message: expect.any(String) },
    ])
    expect(data.results.find((result) => result.eventId === blocked.id)).toMatchObject({
      outcome: 'REFUSED',
      status: null,
      code: 'NOT_IN_RUN',
    })
    expect(blocked.status).toBe('REVIEW_PENDING')
    expect(eventFor(prisma, '990002').status).toBe('ON_SALE')
    expect(audits(prisma, 'event_import.bulk_approved')[0].metadata.refusals).toEqual([
      { eventId: blocked.id, code: 'NOT_IN_RUN' },
    ])

    await app.close()
  })

  it('approves nothing the second time: the old digest is refused, and the new list is empty', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('991001'), listing('991002', { days: 30 })]))

    const { data: list } = (await pending(app, headers)).json()

    expect((await approveAll(app, headers, list.digest)).statusCode).toBe(200)

    const again = await approveAll(app, headers, list.digest)

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('IMPORT_PENDING_CHANGED')

    const { data: after } = (await pending(app, headers)).json()

    expect(after).toMatchObject({ total: 0, willGoOnSale: 0, publishedNothingToSell: 0 })

    const empty = await approveAll(app, headers, after.digest)

    expect(empty.statusCode, empty.body).toBe(200)
    expect(empty.json().data).toMatchObject({ total: 0, onSale: 0, refused: 0, results: [] })
    expect(audits(prisma, 'event.approved')).toHaveLength(2)
    expect(audits(prisma, 'event.published')).toHaveLength(2)

    await app.close()
  })

  it('leaves an event that has started where it is', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await as(app, ANIL)

    await importFile(app, headers, dataset([listing('992001'), listing('992002')]))
    eventFor(prisma, '992001').startsAt = new Date(Date.now() - 60_000)

    const { data: list } = (await pending(app, headers)).json()
    const { data } = (await approveAll(app, headers, list.digest)).json()

    expect(data).toMatchObject({ total: 1, onSale: 1, skippedPast: 1 })
    expect(eventFor(prisma, '992001').status).toBe('REVIEW_PENDING')
    expect(eventFor(prisma, '992002').status).toBe('ON_SALE')

    await app.close()
  })
})

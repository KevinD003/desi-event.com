import { describe, expect, it } from 'vitest'

import { bearer, claim, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  MFA_TEST_SECRET,
  addRows,
  deletedEventFixture,
  makeWorld,
  platformHeldImportFixture,
} from './helpers/fixtures.js'
import { solidPng } from './helpers/images.js'
import { seedPicture } from './helpers/media-world.js'
import { expectNoSecret } from './helpers/payloads.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * What full control of posted events and the Sulekha import let out, read from
 * the outside (SPEC2-XI §0, §5.I-E, §5.X, §7; Stage B6).
 *
 * The suites beside each route prove what that route returns. These walk every
 * read a stranger can make after the new paths have run — an imported event
 * published, another deleted, an organiser's event deleted, a sitting open —
 * and hold each answer to what a stranger may know: no picture address on
 * Sulekha's host, no deletion record, no sitting, no curator's note. Then they
 * drive every full-control and import route with credentials and show-once
 * codes in play and look for each one in what was answered, audited and
 * queued.
 *
 * @file @desi-event/api/tests/control-import-payloads
 */

const ANIL = 'anil@desi-event.example'
const OWNER = 'owner@rangoli.example'
const BUYER = 'priya@example.com'

/** Why the Desi-Event team opened the organiser's event: shown to the organiser, never to a stranger. */
const SITTING_REASON = 'Correcting the spelling the organiser asked us to fix.'

/** Why an organiser's own event was deleted. */
const DELETION_REASON = 'The venue withdrew the booking; private to the organiser and the team.'

/** Why an imported listing was deleted. */
const IMPORTED_DELETION_REASON = 'Sulekha withdrew this listing; the reason stays with the team.'

/** Why the organiser deleted the draft, through the route. */
const DRAFT_DELETION_REASON = 'We will not run this one after all, so it goes.'

/** A curator's note on an import record. */
const CURATOR_NOTE = 'Curator: the poster lists two dates; the earlier one is used.'

/** The approved website of the organisation's event that was deleted with its link on. */
const DELETED_EVENT_SITE = 'https://diwali-mela-on-the-lawn.example/tickets'

/**
 * Keys no stranger's answer may carry, at any depth: a deletion record, a
 * sitting, where an imported listing and its pictures came from, and the
 * columns an insider's view adds.
 */
const PRIVATE_KEYS = new Set([
  'administratorName',
  'contactEmail',
  'deletedAt',
  'deletedById',
  'deletedByName',
  'deletedSlug',
  'deletion',
  'deletionAuthority',
  'deletionOutcome',
  'deletionReason',
  'editId',
  'failureCode',
  'imageUrl',
  'importNotes',
  'moderationNote',
  'platformEdit',
  'platformEditId',
  'platformEdits',
  'priceText',
  'restoreTo',
  'sitting',
  'sourceUrl',
  'statusBeforeDeletion',
  // The switch, with the deciding administrator's name. (`websiteUrl` is not
  // here: the organiser's own public site is shown on purpose, NF-14; the
  // event's unapproved address is pinned absent in events.test.js.)
  'websiteRedirect',
])

/**
 * Every key in a parsed JSON value, at any depth.
 *
 * @param {unknown} value The value.
 * @param {Set<string>} [into] Where to collect.
 * @returns {Set<string>} The keys.
 */
function keysOf(value, into = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key)
      keysOf(child, into)
    }
  }

  return into
}

/**
 * Sign in, and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} The request headers.
 */
async function steppedUp(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * The world the walk reads: an imported event published with its copied
 * cover, a second imported listing deleted, an organisation's own event
 * deleted, and the rest of the shared world.
 *
 * @returns {Promise<object>} The harness, with the rows the walk names.
 */
async function walkWorld() {
  const world = await makeWorld()
  const { ids } = world
  const imported = platformHeldImportFixture(ids, { status: 'PUBLISHED' })
  const approvedAt = new Date('2026-09-30T13:00:00.000Z')

  Object.assign(imported.event, {
    publishedAt: approvedAt,
    approvedAt,
    websiteRedirectEnabled: true,
    websiteDecidedUrl: imported.item.sourceUrl,
    websiteRedirectReason:
      'Tickets for this event are sold on its Sulekha page, which this link opens.',
    websiteRedirectChangedAt: approvedAt,
    websiteRedirectChangedById: ids.platformAdministrator.id,
    websiteDecisionPending: false,
    websiteSubmittedAt: null,
  })
  Object.assign(imported.item, {
    importNotes: [CURATOR_NOTE],
    approvedById: ids.platformAdministrator.id,
    approvedAt,
  })

  // A second listing of the same organisation, published, then deleted.
  // Deleting leaves the website switch as it was, so its Sulekha link is
  // still on: only the status keeps the lookup from answering.
  const goneSourceUrl = 'https://events.sulekha.com/garba-night_event-in_plano-tx_402061'
  const goneEvent = {
    ...imported.event,
    id: cuid(),
    title: 'Garba Night in Plano',
    slug: 'garba-night-in-plano',
    status: 'DELETED',
    deletedAt: new Date('2026-10-01T09:00:00.000Z'),
    deletedById: ids.platformAdministrator.id,
    deletionReason: IMPORTED_DELETION_REASON,
    deletionOutcome: 'REMOVED',
    deletionAuthority: 'PLATFORM',
    statusBeforeDeletion: 'PUBLISHED',
    deletedSlug: null,
    websiteRedirectEnabled: true,
    websiteDecidedUrl: goneSourceUrl,
  }
  const goneItem = {
    ...imported.item,
    id: cuid(),
    sourceId: '402061',
    sourceUrl: goneSourceUrl,
    eventId: goneEvent.id,
  }
  const goneImage = {
    ...imported.image,
    id: cuid(),
    itemId: goneItem.id,
    url: 'https://usimg.sulekha.io/cdn/events/images/garba-night-plano.webp',
  }
  // The organisation's own event, deleted with its approved website link on.
  const deleted = deletedEventFixture(ids, {
    overrides: {
      deletionReason: DELETION_REASON,
      websiteUrl: DELETED_EVENT_SITE,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: DELETED_EVENT_SITE,
      websiteRedirectReason: 'Checked by hand: the organiser’s own page for this event.',
      websiteRedirectChangedAt: new Date('2025-02-04T00:00:00.000Z'),
      websiteRedirectChangedById: ids.platformAdministrator.id,
    },
  })

  addRows(world.seed, imported.rows)
  addRows(world.seed, {
    event: [goneEvent],
    eventSession: [{ ...imported.session, id: cuid(), eventId: goneEvent.id }],
    eventImportItem: [goneItem],
    eventImportImage: [goneImage],
  })
  addRows(world.seed, deleted.rows)

  const harness = await createTestApp({ seed: world.seed, ids })
  const { app, prisma } = harness

  // The imported cover, copied and approved; its import row points at it.
  const cover = seedPicture(prisma, { event: imported.event })

  Object.assign(
    prisma._store.eventImportImage.find((row) => row.id === imported.image.id),
    { status: 'STORED', mediaAssetId: cover.id, lastTriedAt: approvedAt, attempts: 1 },
  )

  // The Desi-Event team opens the organiser's posted event.
  const opened = await app.inject({
    method: 'POST',
    url: `/v1/platform/events/${ids.publishedEvent.id}/edit`,
    headers: await steppedUp(app, ANIL),
    payload: { reason: SITTING_REASON },
  })

  expect(opened.statusCode, opened.body).toBe(201)

  // The organiser deletes their draft through the route.
  const draft = prisma._store.event.find((row) => row.id === ids.draftEvent.id)
  const removed = await app.inject({
    method: 'POST',
    url: `/v1/events/${draft.id}/delete`,
    headers: await steppedUp(app, OWNER),
    payload: {
      revision: draft.revision ?? 0,
      reason: DRAFT_DELETION_REASON,
      confirmSlug: draft.slug,
      expectedOutcome: 'REMOVE',
    },
  })

  expect(removed.statusCode, removed.body).toBe(200)

  return { ...harness, imported, goneEvent, goneItem, goneImage, deleted, cover }
}

describe('what a stranger is shown after imports, deletions and sittings (SPEC2-XI §5.I-E, §5.X, §7)', () => {
  it('names no Sulekha picture or listing address, no deletion, no sitting and no curator’s note on any public read', async () => {
    const harness = await walkWorld()
    const { app, prisma, imported, goneItem, goneImage } = harness
    const attendee = bearer(await signIn(app, BUYER))
    const never = [
      'usimg.sulekha.io',
      imported.item.sourceUrl,
      goneItem.sourceUrl,
      imported.image.url,
      goneImage.url,
      SITTING_REASON,
      DELETION_REASON,
      IMPORTED_DELETION_REASON,
      DRAFT_DELETION_REASON,
      CURATOR_NOTE,
      DELETED_EVENT_SITE,
      // A listed price's note ("Under 5") is the curator's, not a price.
      'Under 5',
    ]
    const urls = [
      '/v1/events?perPage=100',
      '/v1/events?perPage=100&q=garba',
      '/v1/events?perPage=100&q=diwali',
      '/v1/events?perPage=100&city=Irving',
      '/v1/events/facets',
      '/v1/venues?perPage=100',
      ...prisma._store.event.map((event) => `/v1/events/${event.slug}`),
      ...prisma._store.event.map((event) => `/v1/events/${event.id}/ticket-types`),
      ...prisma._store.organization.map((organization) => `/v1/organizers/${organization.slug}`),
      ...prisma._store.venue.map((venue) => `/v1/venues/${venue.id}`),
      ...prisma._store.venue
        .filter((venue) => venue.slug)
        .map((venue) => `/v1/venues/slug/${venue.slug}`),
      ...prisma._store.mediaAsset.map((asset) => `/v1/media/${asset.id}`),
      // Every night's seat map, the deleted events' nights included.
      ...prisma._store.eventSession.map((session) => `/v1/sessions/${session.id}/seats`),
    ]
    /** @type {Record<string, number>} */
    const statuses = {}

    for (const [viewer, headers] of [
      ['a stranger', {}],
      ['a signed-in attendee', attendee],
    ]) {
      for (const url of urls) {
        const response = await app.inject({ method: 'GET', url, headers })
        const at = `${viewer}: GET ${url}`
        const text = response.rawPayload.toString('latin1')

        statuses[`${viewer} ${url}`] = response.statusCode
        expect(response.statusCode, at).toBeLessThan(500)

        for (const needle of never) {
          expect(text.includes(needle), `${at} carries "${needle}"`).toBe(false)
        }

        if (/json/u.test(String(response.headers['content-type']))) {
          const leaked = [...keysOf(response.json())].filter((key) => PRIVATE_KEYS.has(key))

          expect(leaked, at).toEqual([])
        }
      }
    }

    // Not vacuous: the imported event answered, with its provenance and its
    // copied cover; the deleted ones are not there to read.
    const nightOf = (event) => prisma._store.eventSession.find((row) => row.eventId === event.id)

    for (const viewer of ['a stranger', 'a signed-in attendee']) {
      expect(statuses[`${viewer} /v1/events/${imported.event.slug}`], viewer).toBe(200)
      expect(statuses[`${viewer} /v1/events/${harness.goneEvent.slug}`], viewer).toBe(404)
      expect(statuses[`${viewer} /v1/events/${harness.deleted.event.slug}`], viewer).toBe(404)
      expect(statuses[`${viewer} /v1/media/${harness.cover.id}`], viewer).toBe(200)

      for (const [event, status] of [
        [imported.event, 200],
        [harness.goneEvent, 404],
        [harness.deleted.event, 404],
      ]) {
        const url = `/v1/sessions/${nightOf(event).id}/seats`

        expect(statuses[`${viewer} ${url}`], `${viewer}: ${event.slug}'s seats`).toBe(status)
      }
    }

    // The website lookup behind `/events/<slug>/website`, for every event: a
    // deleted event answers nothing, even with its link left on, and the one
    // place a Sulekha address is given is the published import's own listing,
    // by the tracked redirect (SPEC2-XI §5.I-E).
    for (const event of prisma._store.event) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/traffic/website-visits',
        payload: { slug: event.slug, counted: false },
      })
      const at = `the website lookup for ${event.slug}`

      expect(response.statusCode, at).toBeLessThan(500)

      if (event.id === imported.event.id) {
        expect(response.statusCode, at).toBe(200)
        expect(response.json(), at).toEqual({ data: { url: imported.item.sourceUrl } })
        continue
      }

      for (const needle of never) {
        expect(response.body.includes(needle), `${at} carries "${needle}"`).toBe(false)
      }

      if (event.status === 'DELETED') expect(response.statusCode, at).toBe(404)
    }

    const page = (
      await app.inject({ method: 'GET', url: `/v1/events/${imported.event.slug}` })
    ).json().data

    expect(page.importedFrom).toMatchObject({ presentedBy: 'DFW Garba Collective' })
    expect(page.coverImage).not.toBeNull()

    const listed = (await app.inject({ method: 'GET', url: '/v1/events?perPage=100' }))
      .json()
      .data.map((event) => event.id)

    expect(listed).toContain(imported.event.id)
    expect(listed).not.toContain(harness.goneEvent.id)
    expect(listed).not.toContain(harness.deleted.event.id)

    await app.close()
  })

  it('keeps what deleting would do, and the team’s sittings, from anybody outside the event', async () => {
    const harness = await walkWorld()
    const { app, ids } = harness
    const attendee = bearer(await signIn(app, BUYER))

    for (const event of [ids.publishedEvent, harness.deleted.event, harness.imported.event]) {
      for (const url of [
        `/v1/events/${event.id}/deletion`,
        `/v1/events/${event.id}/platform-edits`,
      ]) {
        const stranger = await app.inject({ method: 'GET', url })
        const outsider = await app.inject({ method: 'GET', url, headers: attendee })

        expect(stranger.statusCode, url).toBe(401)
        expect([403, 404], url).toContain(outsider.statusCode)
        expect(outsider.body, url).not.toContain(SITTING_REASON)
        expect(outsider.body, url).not.toContain(DELETION_REASON)
      }
    }

    await app.close()
  })
})

/**
 * A minimal import file of one listing on the allowed hosts, twelve days out.
 *
 * @param {string} sourceId The listing's id.
 * @returns {object} The dataset.
 */
function oneListing(sourceId) {
  const startsAt = new Date(Date.now() + 12 * 86_400_000)

  startsAt.setUTCSeconds(0, 0)

  return {
    format: 'desi-event-import/1',
    source: 'SULEKHA',
    sourceName: 'Sulekha',
    sourceSite: 'https://events.sulekha.com/',
    collectedFrom: '2026-09-29T21:25:00Z',
    collectedTo: '2026-09-30T00:51:08Z',
    curatedOn: '2026-09-30',
    imageHosts: ['usimg.sulekha.io'],
    events: [
      {
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
        performers: [],
        presentedBy: 'DFW Garba Collective',
        languages: ['Gujarati'],
        prices: [{ name: 'Regular', priceCents: 3500, currency: 'USD', note: null }],
        priceText: '$35',
        ageRestriction: 'All Age',
        dressCode: null,
        parking: null,
        faq: [],
        images: [
          {
            url: `https://usimg.sulekha.io/cdn/events/images/cover-${sourceId}.png`,
            role: 'cover',
            alt: `Garba Night ${sourceId} poster`,
          },
        ],
        ticketUrl: `https://events.sulekha.com/garba-night_event-in_irving-tx_${sourceId}`,
        importNotes: [],
      },
    ],
  }
}

describe('no credential or show-once code in what full control and imports answer, audit or queue (SPEC2-XI §0)', () => {
  it('drives every full-control and import route with secrets in play, and finds none of them anywhere it wrote', async () => {
    const { app, prisma, ids } = await createTestApp({
      fetchImportImage: async () => ({
        ok: true,
        bytes: solidPng(1200, 700),
        contentType: 'image/png',
      }),
    })

    // A buyer with tickets, an entry pass, a group pass and a ticket on offer,
    // and a stranger holding a seat: every show-once value an event carries.
    const bought = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: BUYER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 3 }],
      },
    })

    expect(bought.statusCode, bought.body).toBe(201)

    const order = bought.json().data

    claim(prisma, order.tickets, ids.attendee.id)

    const buyerToken = await signIn(app, BUYER)
    const buyer = bearer(buyerToken)
    const pass = await app.inject({
      method: 'GET',
      url: `/v1/tickets/${order.tickets[0].id}/pass`,
      headers: buyer,
    })
    const group = await app.inject({
      method: 'GET',
      url: `/v1/orders/${order.reference}/group-pass`,
      headers: buyer,
    })
    const offered = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${order.tickets[2].id}/transfers`,
      headers: buyer,
      payload: { toEmail: 'rival@dhol.example' },
    })
    const held = await app.inject({
      method: 'POST',
      url: '/v1/holds',
      payload: { ticketTypeId: ids.generalAdmission.id, quantity: 1 },
    })

    expect([pass.statusCode, group.statusCode, offered.statusCode, held.statusCode]).toEqual([
      200, 200, 201, 201,
    ])

    const ownerToken = await signIn(app, OWNER)
    const owner = bearer(ownerToken)

    await stepUp(app, OWNER, owner)

    const anilToken = await signIn(app, ANIL)
    const anil = bearer(anilToken)

    await stepUp(app, ANIL, anil)

    const secrets = {
      'the buyer’s session': buyerToken,
      'the organiser’s session': ownerToken,
      'the administrator’s session': anilToken,
      'a second-factor secret': MFA_TEST_SECRET,
      'an entry pass': pass.json().data.credential,
      'a group pass': group.json().data.credential,
      'a group code': group.json().data.groupCode,
      'a transfer code': offered.json().data.delivery.invitationCode,
      'a guest hold token': held.json().data.guestToken,
    }

    for (const [name, value] of Object.entries(secrets)) {
      expect(typeof value === 'string' && value.length > 0, name).toBe(true)
    }

    const auditsBefore = prisma._store.auditLog.length
    const outboxBefore = prisma._store.notificationOutbox.length
    /** @type {Array<Array<*>>} Each request's label and its response. */
    const answers = []

    /**
     * Send one request and keep its answer.
     *
     * @param {string} label What it is.
     * @param {object} request The `inject` options.
     * @returns {Promise<object>} The response.
     */
    const send = async (label, request) => {
      const response = await app.inject(request)

      answers.push([label, response])
      expect(response.statusCode, `${label}: ${response.body}`).toBeLessThan(500)

      return response
    }

    const event = ids.publishedEvent
    const night = prisma._store.eventSession.find((row) => row.eventId === event.id)

    // Full control (X).
    const preview = await send('events.deletionPreview', {
      method: 'GET',
      url: `/v1/events/${event.id}/deletion`,
      headers: owner,
    })

    await send('events.platformEdits', {
      method: 'GET',
      url: `/v1/events/${event.id}/platform-edits`,
      headers: owner,
    })

    const nightPreview = await send('events.sessionCancellationPreview', {
      method: 'GET',
      url: `/v1/events/${event.id}/sessions/${night.id}/cancellation`,
      headers: owner,
    })

    await send('events.cancelSession', {
      method: 'POST',
      url: `/v1/events/${event.id}/sessions/${night.id}/cancel`,
      headers: owner,
      payload: {
        revision: prisma._store.event.find((row) => row.id === event.id).revision ?? 0,
        reason: SITTING_REASON,
        confirm: true,
        expectedOrders: nightPreview.json().data?.orders ?? 0,
      },
    })
    await send('platformEvents.list', { method: 'GET', url: '/v1/platform/events', headers: anil })

    const opened = await send('platformEvents.openEdit', {
      method: 'POST',
      url: `/v1/platform/events/${event.id}/edit`,
      headers: anil,
      payload: { reason: SITTING_REASON },
    })

    await send('moderation.mediaQueue', {
      method: 'GET',
      url: '/v1/moderation/media',
      headers: anil,
    })
    await send('platformEvents.closeEdit', {
      method: 'POST',
      url: `/v1/platform/events/${event.id}/edit/close`,
      headers: anil,
    })

    const current = prisma._store.event.find((row) => row.id === event.id)
    const deleted = await send('events.delete', {
      method: 'POST',
      url: `/v1/events/${event.id}/delete`,
      headers: owner,
      payload: {
        revision: current.revision ?? 0,
        reason: DELETION_REASON,
        confirmSlug: current.slug,
        expectedOutcome: preview.json().data.outcome,
      },
    })

    await send('events.finishRefunds', {
      method: 'POST',
      url: `/v1/events/${event.id}/refunds/finish`,
      headers: owner,
    })

    const restored = await send('platformEvents.restore', {
      method: 'POST',
      url: `/v1/platform/events/${event.id}/restore`,
      headers: anil,
      payload: {
        revision: prisma._store.event.find((row) => row.id === event.id).revision ?? 0,
        reason: 'Restoring it to check what a restore answers.',
      },
    })

    // What the buyer is shown of the change.
    await send('orders.get after deletion', {
      method: 'GET',
      url: `/v1/orders/${order.reference}`,
      headers: buyer,
    })
    await send('tickets.get after deletion', {
      method: 'GET',
      url: `/v1/tickets/${order.tickets[1].id}`,
      headers: buyer,
    })

    // Imports (I).
    const planned = await send('eventImports.preview', {
      method: 'POST',
      url: '/v1/platform/imports',
      headers: anil,
      payload: { fileName: 'sulekha.json', dataset: oneListing('901001') },
    })
    const run = planned.json().data

    await send('eventImports.list', { method: 'GET', url: '/v1/platform/imports', headers: anil })
    await send('eventImports.get', {
      method: 'GET',
      url: `/v1/platform/imports/${run.id}`,
      headers: anil,
    })

    const applied = await send('eventImports.apply', {
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/apply`,
      headers: anil,
      payload: { planDigest: run.planDigest, updateFromSource: [] },
    })

    await send('eventImports.retryImages', {
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/images/retry`,
      headers: anil,
      payload: {},
    })

    const item = prisma._store.eventImportItem.find((row) => row.sourceId === '901001')
    const importedEvent = () => prisma._store.event.find((row) => row.id === item.eventId)
    const approved = await send('eventImports.approve', {
      method: 'POST',
      url: `/v1/platform/imports/${run.id}/approve`,
      headers: anil,
      payload: { items: [{ eventId: item.eventId, revision: importedEvent().revision ?? 0 }] },
    })

    await send('eventImports.targets', {
      method: 'GET',
      url: '/v1/platform/import-targets?q=rangoli',
      headers: anil,
    })

    const moved = await send('eventImports.reassign', {
      method: 'POST',
      url: `/v1/platform/imports/events/${item.eventId}/reassign`,
      headers: anil,
      payload: {
        organizationId: ids.organization.id,
        reason: 'They run this event themselves.',
        revision: importedEvent().revision ?? 0,
      },
    })

    // Not vacuous: the commands that write did their work.
    expect(
      [preview, opened, deleted, restored, planned, applied, approved, moved].map(
        (response) => response.statusCode,
      ),
    ).toEqual([200, 201, 200, 200, 201, 200, 200, 200])
    expect(prisma._store.auditLog.length).toBeGreaterThan(auditsBefore)

    const tokenHashes = prisma._store.session.map((session) => session.tokenHash).filter(Boolean)
    const written = {
      'audit rows': prisma._store.auditLog.slice(auditsBefore),
      'outbox rows': prisma._store.notificationOutbox.slice(outboxBefore),
    }

    for (const [label, response] of answers) {
      for (const [name, value] of Object.entries(secrets)) {
        expectNoSecret(expect, response.body, value)
        expect(response.body.includes(value), `${label} carries ${name}`).toBe(false)
      }

      for (const hash of tokenHashes) expectNoSecret(expect, response.body, hash)
    }

    for (const [label, rows] of Object.entries(written)) {
      for (const [name, value] of Object.entries(secrets)) {
        expect(JSON.stringify(rows).includes(value), `${label} carry ${name}`).toBe(false)
      }

      for (const hash of tokenHashes) expectNoSecret(expect, rows, hash)
    }

    await app.close()
  })
})

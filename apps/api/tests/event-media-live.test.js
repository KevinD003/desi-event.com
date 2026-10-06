import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { solidPng } from './helpers/images.js'
import { seedPicture, uploadUrl } from './helpers/media-world.js'

/**
 * Pictures on a posted event (SPEC2-XI X-3, X-P): a new picture or a
 * replacement cover waits for somebody on the Desi-Event team other than its
 * uploader, and the old cover stays until then.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/tests/event-media-live
 */

/**
 * Sign in and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Upload a cover to the published event, at its current revision.
 *
 * @param {object} app The app.
 * @param {object} prisma The stub.
 * @param {object} event The event.
 * @param {object} headers Whose request.
 * @returns {Promise<object>} The response.
 */
function uploadCover(app, prisma, event, headers) {
  const revision = prisma._store.event.find((row) => row.id === event.id).revision

  return app.inject({
    method: 'POST',
    url: uploadUrl(event.id, { kind: 'EVENT_COVER', revision }),
    headers: { ...headers, 'content-type': 'image/png' },
    payload: solidPng(960, 540),
  })
}

/**
 * Decide on one picture.
 *
 * @param {object} app The app.
 * @param {object} headers Whose request.
 * @param {string} id The picture.
 * @param {object} payload The decision.
 * @returns {Promise<object>} The response.
 */
function decide(app, headers, id, payload) {
  return app.inject({
    method: 'POST',
    url: `/v1/moderation/media/${id}/decision`,
    headers,
    payload,
  })
}

/**
 * The public cover's id on the event page.
 *
 * @param {object} app The app.
 * @param {object} event The event.
 * @returns {Promise<string|null>} The id.
 */
async function publicCoverId(app, event) {
  const response = await app.inject({ method: 'GET', url: `/v1/events/${event.slug}` })

  return response.json().data.coverImage?.id ?? null
}

describe('a replacement cover on a posted event', () => {
  it('waits beside the current cover, which stays public until the replacement is approved', async () => {
    const { app, prisma, ids } = await createTestApp()
    const old = seedPicture(prisma, { event: ids.publishedEvent })
    const organiser = await as(app, 'arun@rangoli.example')

    const first = await uploadCover(app, prisma, ids.publishedEvent, organiser)

    expect(first.statusCode).toBe(201)
    expect(first.json().data).toMatchObject({
      moderationStatus: 'PENDING',
      publiclyVisible: false,
      replacesMediaId: old.id,
    })
    expect(await publicCoverId(app, ids.publishedEvent)).toBe(old.id)

    // A second replacement takes the first one's place.
    const second = await uploadCover(app, prisma, ids.publishedEvent, organiser)

    expect(second.statusCode).toBe(201)
    expect(prisma._store.mediaAsset.some((row) => row.id === first.json().data.id)).toBe(false)

    // Approved by somebody else on the Desi-Event team: the swap.
    const approved = await decide(
      app,
      await as(app, 'maya@desi-event.example'),
      second.json().data.id,
      {
        decision: 'approve',
      },
    )

    expect(approved.statusCode).toBe(200)
    expect(prisma._store.mediaAsset.some((row) => row.id === old.id)).toBe(false)
    expect(prisma._store.mediaBlob.some((row) => row.storageKey === old.storageKey)).toBe(false)
    expect(prisma._store.mediaAsset.find((row) => row.id === second.json().data.id)).toMatchObject({
      moderationStatus: 'APPROVED',
      replacesMediaId: null,
    })
    expect(await publicCoverId(app, ids.publishedEvent)).toBe(second.json().data.id)
    expect(
      prisma._store.auditLog.some((entry) => entry.action === 'event.media_replacement_applied'),
    ).toBe(true)

    await app.close()
  })

  it('keeps the old cover when the replacement is taken down', async () => {
    const { app, prisma, ids } = await createTestApp()
    const old = seedPicture(prisma, { event: ids.publishedEvent })
    const replacement = await uploadCover(
      app,
      prisma,
      ids.publishedEvent,
      await as(app, 'arun@rangoli.example'),
    )

    const rejected = await decide(
      app,
      await as(app, 'maya@desi-event.example'),
      replacement.json().data.id,
      { decision: 'reject', reason: 'Shows the crowd’s faces up close.' },
    )

    expect(rejected.statusCode).toBe(200)
    expect(await publicCoverId(app, ids.publishedEvent)).toBe(old.id)

    await app.close()
  })

  it('makes the waiting replacement the (pending) cover when the old one is removed', async () => {
    const { app, prisma, ids } = await createTestApp()
    const old = seedPicture(prisma, { event: ids.publishedEvent })
    const organiser = await as(app, 'arun@rangoli.example')
    const replacement = await uploadCover(app, prisma, ids.publishedEvent, organiser)
    const revision = prisma._store.event.find((row) => row.id === ids.publishedEvent.id).revision

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.publishedEvent.id}/media/${old.id}?revision=${revision}`,
      headers: organiser,
    })

    expect(removed.statusCode).toBe(200)
    expect(
      prisma._store.mediaAsset.find((row) => row.id === replacement.json().data.id),
    ).toMatchObject({ replacesMediaId: null, moderationStatus: 'PENDING' })
    expect(await publicCoverId(app, ids.publishedEvent)).toBeNull()

    await app.close()
  })
})

describe('deciding a picture on a posted event', () => {
  it('refuses the uploader (SELF_REVIEW), even on the Desi-Event team', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')

    await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit`,
      headers: anil,
      payload: { reason: 'Adding the photographer’s pictures for the organiser.' },
    })

    const revision = prisma._store.event.find((row) => row.id === ids.publishedEvent.id).revision
    const uploaded = await app.inject({
      method: 'POST',
      url: uploadUrl(ids.publishedEvent.id, { kind: 'EVENT_GALLERY', revision }),
      headers: { ...anil, 'content-type': 'image/png' },
      payload: solidPng(320, 320),
    })

    expect(uploaded.statusCode).toBe(201)

    const self = await decide(app, anil, uploaded.json().data.id, { decision: 'approve' })

    expect(self.statusCode).toBe(403)
    expect(self.json().error.code).toBe('SELF_REVIEW')

    const other = await decide(
      app,
      await as(app, 'maya@desi-event.example'),
      uploaded.json().data.id,
      {
        decision: 'approve',
      },
    )

    expect(other.statusCode).toBe(200)

    await app.close()
  })

  it('refuses a deleted event’s picture', async () => {
    const { app, prisma, ids } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent, moderationStatus: 'PENDING' })

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'DELETED'

    const response = await decide(app, await as(app, 'maya@desi-event.example'), picture.id, {
      decision: 'approve',
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_EDITABLE')
    expect(response.json().error.message).toBe('This event was deleted.')

    await app.close()
  })
})

describe('GET /v1/moderation/media', () => {
  it('lists posted events’ pictures waiting, with the event and organisation, never the uploader', async () => {
    const { app, prisma, ids } = await createTestApp()
    const organiser = await as(app, 'arun@rangoli.example')
    const revision = prisma._store.event.find((row) => row.id === ids.publishedEvent.id).revision
    const uploaded = await app.inject({
      method: 'POST',
      url: uploadUrl(ids.publishedEvent.id, { kind: 'EVENT_GALLERY', revision }),
      headers: { ...organiser, 'content-type': 'image/png' },
      payload: solidPng(320, 320),
    })
    // A draft's pictures wait for the event's review instead, and are not here.
    seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/media',
      headers: await as(app, 'maya@desi-event.example'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data).toHaveLength(1)
    expect(response.json().data[0]).toMatchObject({
      id: uploaded.json().data.id,
      moderationStatus: 'PENDING',
      uploadedByOrganiser: true,
      event: {
        id: ids.publishedEvent.id,
        slug: ids.publishedEvent.slug,
        status: 'PUBLISHED',
        organizationName: 'Rangoli Collective',
      },
    })
    expect(response.body).not.toMatch(/Arun|arun@|uploadedById/)

    const owner = await app.inject({
      method: 'GET',
      url: '/v1/moderation/media',
      headers: await as(app, 'owner@rangoli.example'),
    })

    expect(owner.statusCode).toBe(403)

    await app.close()
  })
})

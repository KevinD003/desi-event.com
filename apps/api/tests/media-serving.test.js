/**
 * `GET /v1/media/:id`, against the Prisma stub: who is served which picture,
 * with which headers, and what a stranger learns from a refusal.
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { seedPicture } from './helpers/media-world.js'

/**
 * Read a picture.
 *
 * @param {object} app The Fastify instance.
 * @param {string} id The asset id.
 * @param {object} [headers] Request headers.
 * @param {string} [method] GET or HEAD.
 * @returns {Promise<object>} The response.
 */
function read(app, id, headers = {}, method = 'GET') {
  return app.inject({ method, url: `/v1/media/${id}`, headers })
}

/**
 * Set a fixture event's status in the stub.
 *
 * @param {object} prisma The stub.
 * @param {object} event The fixture event.
 * @param {string} status The status.
 * @returns {void}
 */
function setStatus(prisma, event, status) {
  prisma._store.event.find((row) => row.id === event.id).status = status
}

describe('a public picture', () => {
  it.each(['PUBLISHED', 'ON_SALE', 'POSTPONED', 'CANCELLED', 'COMPLETED'])(
    'is served to anybody on a %s event, with every header the design names',
    async (status) => {
      const { app, ids, prisma } = await createTestApp()

      setStatus(prisma, ids.publishedEvent, status)

      const picture = seedPicture(prisma, { event: ids.publishedEvent })
      const response = await read(app, picture.id)

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toBe('image/png')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['cache-control']).toBe('public, max-age=86400')
      expect(response.headers.etag).toBe(`"sha256-${picture.checksum}"`)
      expect(Number(response.headers['content-length'])).toBe(response.rawPayload.length)
      expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
      expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
      expect(response.headers['content-disposition']).toBe(`inline; filename="${picture.id}.png"`)
      expect(response.headers['last-modified']).toBeTruthy()

      const blob = prisma._store.mediaBlob.find((row) => row.storageKey === picture.storageKey)

      expect(response.rawPayload.equals(blob.bytes)).toBe(true)

      await app.close()
    },
  )

  it('is private to a reader with the session cookie, whose rotated session rides on the reply', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'priya@example.com', password: 'correct-horse-battery' },
    })
    const cookie = [login.headers['set-cookie']]
      .flat()
      .map((value) => value.split(';')[0])
      .join('; ')

    // Age the session past its rotation window, so this very read rotates it.
    for (const session of prisma._store.session) {
      session.rotatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      session.createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      session.lastSeenAt = new Date()
    }

    const response = await read(app, picture.id, { cookie })
    const setCookies = [response.headers['set-cookie'] ?? []].flat().join('\n')

    expect(response.statusCode).toBe(200)
    // The scenario is real: a fresh session secret is on this response...
    expect(setCookies).toMatch(/desi_session=/u)
    // ...so no shared cache may store it.
    expect(response.headers['cache-control']).toBe('private, max-age=86400')

    // The same picture read without a cookie is still public.
    expect((await read(app, picture.id)).headers['cache-control']).toBe('public, max-age=86400')

    await app.close()
  })

  it('answers a matching If-None-Match with 304 and no body', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    const response = await read(app, picture.id, {
      'if-none-match': `"sha256-${picture.checksum}"`,
    })

    expect(response.statusCode).toBe(304)
    expect(response.rawPayload.length).toBe(0)
    expect(response.headers.etag).toBe(`"sha256-${picture.checksum}"`)

    const weak = await read(app, picture.id, {
      'if-none-match': `W/"x", W/"sha256-${picture.checksum}"`,
    })

    expect(weak.statusCode).toBe(304)

    const stale = await read(app, picture.id, { 'if-none-match': '"sha256-other"' })

    expect(stale.statusCode).toBe(200)

    await app.close()
  })

  it('answers HEAD with the headers and no body', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    const response = await read(app, picture.id, {}, 'HEAD')

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('image/png')
    expect(response.rawPayload.length).toBe(0)

    await app.close()
  })
})

describe('a picture that is not public', () => {
  it.each([
    ['PENDING on a published event', { moderationStatus: 'PENDING' }, 'publishedEvent'],
    ['REJECTED on a published event', { moderationStatus: 'REJECTED' }, 'publishedEvent'],
    ['APPROVED on a draft', {}, 'draftEvent'],
    ['APPROVED on an event in review', {}, 'reviewPendingEvent'],
    ['APPROVED on an approved, unpublished event', {}, 'approvedEvent'],
    ['APPROVED on a rejected event', {}, 'rejectedEvent'],
  ])('is a no-store 404 to an anonymous caller when %s', async (_name, options, key) => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids[key], ...options })

    const response = await read(app, picture.id)

    expect(response.statusCode).toBe(404)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().error.code).toBe('NOT_FOUND')

    await app.close()
  })

  it('is a 404 on an archived event', async () => {
    const { app, ids, prisma } = await createTestApp()

    setStatus(prisma, ids.publishedEvent, 'ARCHIVED')

    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    expect((await read(app, picture.id)).statusCode).toBe(404)

    await app.close()
  })

  it('answers exactly as a missing id does', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

    const hidden = await read(app, picture.id)
    const missing = await read(app, 'cnosuchpicture0000000000')

    expect(hidden.statusCode).toBe(missing.statusCode)
    expect(hidden.json().error.message).toBe(missing.json().error.message)
    expect(hidden.headers['cache-control']).toBe(missing.headers['cache-control'])

    await app.close()
  })

  it('never confirms it exists with a 304, even to a caller holding its tag', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

    const outsider = bearer(await signIn(app, 'rival@dhol.example'))
    const response = await read(app, picture.id, {
      ...outsider,
      'if-none-match': `"sha256-${picture.checksum}"`,
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it.each([
    ['a VIEWER of the organisation', 'finance@rangoli.example'],
    ['the manager', 'arun@rangoli.example'],
    ['a moderator', 'maya@desi-event.example'],
    ['a platform administrator', 'ops@desi-event.example'],
  ])('is served privately to %s', async (_who, email) => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

    const response = await read(app, picture.id, bearer(await signIn(app, email)))

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers['x-content-type-options']).toBe('nosniff')

    await app.close()
  })

  it.each(['rival@dhol.example', 'priya@example.com'])(
    'is a 404 to %s, who has no say over it',
    async (email) => {
      const { app, ids, prisma } = await createTestApp()
      const picture = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

      expect((await read(app, picture.id, bearer(await signIn(app, email)))).statusCode).toBe(404)

      await app.close()
    },
  )

  it('is a 404 when its bytes are missing, and says nothing about why', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    prisma._store.mediaBlob.length = 0

    const response = await read(app, picture.id)

    expect(response.statusCode).toBe(404)
    expect(response.body).not.toMatch(/pg\/|storage/)
    // Not cacheable, and nothing a cache could revalidate to a 304 later.
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers.etag).toBeUndefined()
    expect(response.headers['last-modified']).toBeUndefined()
    expect(response.headers['content-disposition']).toBeUndefined()
    expect(response.headers['content-security-policy']).not.toBe("default-src 'none'; sandbox")

    await app.close()
  })

  it('refuses an id that is not an id with 400', async () => {
    const { app } = await createTestApp()

    expect((await read(app, 'NOT-AN-ID')).statusCode).toBe(400)

    await app.close()
  })
})

describe('the read budget', () => {
  it('has its own rate limit, and answers 429 past it', async () => {
    const { app, ids, prisma } = await createTestApp({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, mediaRead: { max: 2 } },
    })
    const picture = seedPicture(prisma, { event: ids.publishedEvent })

    expect((await read(app, picture.id)).statusCode).toBe(200)
    expect((await read(app, picture.id)).statusCode).toBe(200)

    const limited = await read(app, picture.id)

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('RATE_LIMITED')

    await app.close()
  })
})

describe('public payloads', () => {
  it('put an approved cover on the event page and the card, and a pending one on neither', async () => {
    const { app, ids, prisma } = await createTestApp()
    const pending = seedPicture(prisma, { event: ids.publishedEvent, moderationStatus: 'PENDING' })

    const before = (
      await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    ).json().data

    expect(before.coverImage).toBeNull()
    expect(before.gallery).toEqual([])

    const list = (await app.inject({ method: 'GET', url: '/v1/events?perPage=50' })).json().data
    expect(list.find((row) => row.id === ids.publishedEvent.id).coverImage).toBeNull()

    prisma._store.mediaAsset.find((row) => row.id === pending.id).moderationStatus = 'APPROVED'

    const gallery = [
      seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY', position: 1 }),
      seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY', position: 0 }),
      seedPicture(prisma, {
        event: ids.publishedEvent,
        kind: 'EVENT_GALLERY',
        position: 2,
        moderationStatus: 'REJECTED',
      }),
    ]

    const after = (
      await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })
    ).json().data

    expect(after.coverImage).toEqual({
      id: pending.id,
      url: `/v1/media/${pending.id}`,
      altText: pending.altText,
      width: 960,
      height: 540,
      contentType: 'image/png',
    })
    expect(after.gallery.map((row) => row.id)).toEqual([gallery[1].id, gallery[0].id])

    const card = (await app.inject({ method: 'GET', url: '/v1/events?perPage=50' })).json().data
    const row = card.find((entry) => entry.id === ids.publishedEvent.id)

    expect(row.coverImage.id).toBe(pending.id)
    expect(row).not.toHaveProperty('gallery')
    expect(JSON.stringify(card)).not.toMatch(/storageKey|scanNote|uploadedById/)

    await app.close()
  })

  it('show an insider no cover on a draft, because the page is not public', async () => {
    const { app, ids, prisma } = await createTestApp()

    seedPicture(prisma, { event: ids.draftEvent })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.slug}`,
      headers: bearer(await signIn(app, 'arun@rangoli.example')),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.coverImage).toBeNull()

    await app.close()
  })
})

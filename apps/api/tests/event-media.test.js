/**
 * The organiser's picture routes, against the Prisma stub: the upload and its
 * early refusals, the three arranging writes, and what each one records.
 */

import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { MEDIA_LIMITS } from '@desi-event/schemas/media'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { SVG_AS_PNG, cameraJpeg, solidPng } from './helpers/images.js'
import { seedPicture, uploadUrl } from './helpers/media-world.js'

const MANAGER = 'arun@rangoli.example'

/**
 * A request body that counts how much of itself was read.
 *
 * @param {number} total Bytes it would send.
 * @returns {{stream: Readable, sent: function(): number}} The stream and its counter.
 */
function countingBody(total) {
  let sent = 0
  const chunk = Buffer.alloc(64 * 1024, 7)
  const stream = new Readable({
    read() {
      if (sent >= total) {
        this.push(null)
        return
      }

      sent += chunk.length
      this.push(chunk)
    },
  })

  return { stream, sent: () => sent }
}

/**
 * Upload a picture.
 *
 * @param {object} app The Fastify instance.
 * @param {object} headers Auth headers.
 * @param {string} url The upload URL.
 * @param {Buffer|Readable|string} payload The body.
 * @param {string} [contentType] The declared type.
 * @returns {Promise<object>} The response.
 */
function upload(app, headers, url, payload, contentType = 'image/png') {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...headers, 'content-type': contentType },
    payload,
  })
}

describe('uploading: refused before the body is read', () => {
  it('answers an anonymous 10 MiB upload with 401 and reads none of it', async () => {
    const { app, ids } = await createTestApp()
    const body = countingBody(MEDIA_LIMITS.maxBytes)

    const response = await app.inject({
      method: 'POST',
      url: uploadUrl(ids.draftEvent.id),
      headers: { 'content-type': 'image/png', 'content-length': String(MEDIA_LIMITS.maxBytes) },
      payload: body.stream,
    })

    expect(response.statusCode).toBe(401)
    expect(body.sent()).toBe(0)

    await app.close()
  })

  it.each([
    ['a VIEWER of the organisation', 'finance@rangoli.example', 403],
    ['an owner of another organisation', 'rival@dhol.example', 403],
    ['an attendee', 'priya@example.com', 403],
  ])('refuses %s with %i and reads none of the body', async (_who, email, status) => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, email))
    const body = countingBody(MEDIA_LIMITS.maxBytes)

    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), body.stream)

    expect(response.statusCode).toBe(status)
    expect(body.sent()).toBe(0)

    await app.close()
  })

  // SPEC2-XI X-3 (§8): a posted event takes new pictures, each waiting for the
  // Desi-Event team; a held, rejected, filed or deleted one still takes none.
  it.each([
    ['REVIEW_PENDING', 'reviewPendingEvent'],
    ['APPROVED', 'approvedEvent'],
    ['REJECTED', 'rejectedEvent'],
    ['ARCHIVED', 'publishedEvent'],
    ['DELETED', 'publishedEvent'],
  ])('refuses a %s event with 409 NOT_EDITABLE before the body', async (status, key) => {
    const { app, ids, prisma } = await createTestApp()

    prisma._store.event.find((row) => row.id === ids[key].id).status = status

    const headers = bearer(await signIn(app, MANAGER))
    const body = countingBody(1024 * 1024)

    const response = await upload(app, headers, uploadUrl(ids[key].id), body.stream)

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('NOT_EDITABLE')
    expect(body.sent()).toBe(0)

    await app.close()
  })

  it('stores a picture added to a PUBLISHED event waiting for review, and not public', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.publishedEvent.id, { kind: 'EVENT_GALLERY' }),
      solidPng(320, 320),
    )

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({
      moderationStatus: 'PENDING',
      publiclyVisible: false,
    })
    expect(
      prisma._store.mediaAsset.find((row) => row.id === response.json().data.id).moderationStatus,
    ).toBe('PENDING')

    await app.close()
  })

  it('refuses a ninth gallery picture with 409 GALLERY_FULL before the body', async () => {
    const { app, ids, prisma } = await createTestApp()

    for (let position = 0; position < 8; position += 1) {
      seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position })
    }

    const headers = bearer(await signIn(app, MANAGER))
    const body = countingBody(1024 * 1024)
    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { kind: 'EVENT_GALLERY' }),
      body.stream,
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('GALLERY_FULL')
    expect(body.sent()).toBe(0)

    await app.close()
  })

  it('refuses an upload past the organisation quota with 409 MEDIA_QUOTA_EXCEEDED', async () => {
    const { app, ids, prisma } = await createTestApp()

    seedPicture(prisma, {
      event: ids.publishedEvent,
      byteSize: MEDIA_LIMITS.organizationQuotaBytes - 100,
    })

    const headers = bearer(await signIn(app, MANAGER))
    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), solidPng(1200, 630))

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('MEDIA_QUOTA_EXCEEDED')
    expect(prisma._store.mediaAsset).toHaveLength(1)

    await app.close()
  })

  it('a 404 for an event that does not exist', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl('cnosuchevent00000000000'),
      solidPng(1200, 630),
    )

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('rate-limits uploads per account', async () => {
    const { app, ids } = await createTestApp({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, mediaUpload: { max: 1 } },
    })
    const headers = bearer(await signIn(app, MANAGER))

    const first = await upload(app, headers, uploadUrl(ids.draftEvent.id), solidPng(1200, 630))
    const second = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { revision: 1 }),
      solidPng(1200, 630),
    )

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(429)
    expect(second.json().error.code).toBe('RATE_LIMITED')

    await app.close()
  })
})

describe('uploading: refused for what the body is', () => {
  it('refuses SVG bytes declared as image/png with 415, whatever they claim', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), SVG_AS_PNG)

    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(response.json().error.message).toContain('not a JPEG, PNG or WebP')
    expect(prisma._store.mediaAsset).toHaveLength(0)

    await app.close()
  })

  it.each([
    [
      'a JSON array that starts like a JPEG',
      'application/json',
      JSON.stringify([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0]),
    ],
    ['a JSON object', 'application/json; charset=utf-8', JSON.stringify({ picture: 'a.png' })],
    ['plain text', 'text/plain', 'not a picture'],
  ])('refuses %s with 415, not a crash, and stores nothing', async (_name, type, payload) => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), payload, type)

    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
    expect(prisma._store.mediaAsset).toHaveLength(0)

    await app.close()
  })

  it.each(['application/json', 'text/plain', 'image/svg+xml'])(
    'refuses a %s body with 415 before reading any of it',
    async (type) => {
      const { app, ids } = await createTestApp()
      const headers = bearer(await signIn(app, MANAGER))
      const body = countingBody(1024 * 1024)

      const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), body.stream, type)

      expect(response.statusCode).toBe(415)
      expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
      expect(body.sent()).toBe(0)

      await app.close()
    },
  )

  it('answers 415 for a declared type the route does not take', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id),
      '<svg/>',
      'image/svg+xml',
    )

    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE')

    await app.close()
  })

  it('answers 413 for 10 MiB and one byte', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id),
      Buffer.alloc(MEDIA_LIMITS.maxBytes + 1),
      'application/octet-stream',
    )

    expect(response.statusCode).toBe(413)
    expect(response.json().error.code).toBe('PAYLOAD_TOO_LARGE')

    await app.close()
  })

  it('answers 422 IMAGE_TOO_SMALL for a cover below 960 × 540', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), solidPng(800, 450))

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('IMAGE_TOO_SMALL')

    await app.close()
  })

  it('answers 400 EMPTY_UPLOAD for no body', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'POST',
      url: uploadUrl(ids.draftEvent.id),
      headers: { ...headers, 'content-type': 'image/png' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('EMPTY_UPLOAD')

    await app.close()
  })

  it.each([
    ['no alt text', 'kind=EVENT_COVER&revision=0'],
    ['blank alt text', 'kind=EVENT_COVER&revision=0&altText=%20%20'],
    ['a file name for alt text', 'kind=EVENT_COVER&revision=0&altText=IMG_1234.jpg'],
    ['no revision', 'kind=EVENT_COVER&altText=Stage'],
    ['a non-numeric revision', 'kind=EVENT_COVER&altText=Stage&revision=three'],
    ['an empty revision', 'kind=EVENT_COVER&altText=Stage&revision='],
    ['an unknown kind', 'kind=AVATAR&altText=Stage&revision=0'],
    ['an unknown key', 'kind=EVENT_COVER&altText=Stage&revision=0&url=https://x.test/a.png'],
  ])('answers 400 for %s', async (_name, query) => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      `/v1/events/${ids.draftEvent.id}/media?${query}`,
      solidPng(1200, 630),
    )

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')
    expect(prisma._store.mediaAsset).toHaveLength(0)

    await app.close()
  })

  it('answers 409 STALE_REVISION for a revision somebody else moved', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { revision: 5 }),
      solidPng(1200, 630),
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('STALE_REVISION')
    expect(prisma._store.mediaAsset).toHaveLength(0)
    expect(prisma._store.mediaBlob).toHaveLength(0)

    await app.close()
  })
})

describe('uploading: what is stored', () => {
  it('stores a rebuilt picture, waiting for review, and bumps the revision', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))
    const original = cameraJpeg(1600, 1200, { orientation: 6 })

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { altText: '  Dancers   circling a lit garbo ' }),
      original,
      'application/octet-stream',
    )

    expect(response.statusCode).toBe(201)

    const { data, meta } = response.json()

    expect(meta.revision).toBe(1)
    expect(meta.removed).toEqual(
      expect.arrayContaining(['camera and location details (EXIF)', 'XMP metadata', 'comments']),
    )
    expect(data).toMatchObject({
      kind: 'EVENT_COVER',
      contentType: 'image/jpeg',
      altText: 'Dancers circling a lit garbo',
      width: 1200,
      height: 1600,
      position: null,
      moderationStatus: 'PENDING',
      publiclyVisible: false,
      url: `/v1/media/${data.id}`,
    })
    expect(Object.keys(data).sort()).toEqual(
      [
        'altText',
        'byteSize',
        'checksum',
        'contentType',
        'createdAt',
        'height',
        'id',
        'kind',
        'moderationStatus',
        'position',
        'publiclyVisible',
        'rejectionReason',
        // A replacement cover names the cover it waits to replace (SPEC2-XI X-3).
        'replacesMediaId',
        'url',
        'width',
      ].sort(),
    )
    expect(response.body).not.toMatch(/storageKey|scanNote|uploadedById|pg\//)

    const [asset] = prisma._store.mediaAsset
    const [blob] = prisma._store.mediaBlob

    expect(asset).toMatchObject({
      eventId: ids.draftEvent.id,
      ownerType: 'EVENT',
      ownerId: ids.draftEvent.id,
      scanStatus: 'CLEAN',
      moderationStatus: 'PENDING',
      uploadedById: ids.manager.id,
    })
    expect(asset.sanitisedAt).toBeInstanceOf(Date)
    expect(asset.scanNote).toContain('no antivirus engine')
    expect(blob.storageKey).toBe(asset.storageKey)

    // The stored bytes are the rebuilt ones: no EXIF, no GPS, no second image,
    // and the checksum is theirs.
    const stored = Buffer.from(blob.bytes).toString('latin1')

    expect(stored).not.toContain('SecretCam')
    expect(stored).not.toContain('GPSLAT')
    expect(stored).not.toContain('http://ns.adobe.com/xap')
    expect(createHash('sha256').update(blob.bytes).digest('hex')).toBe(asset.checksum)
    expect(data.checksum).toBe(asset.checksum)
    expect(blob.bytes.length).toBeLessThan(original.length)

    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).revision).toBe(1)

    await app.close()
  })

  it('audits the upload without the alt text or the bytes', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { altText: 'A very particular description' }),
      solidPng(1200, 630),
    )
    const { data } = response.json()
    const rows = prisma._store.auditLog.filter((row) => row.action === 'event.media_added')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      entityType: 'Event',
      entityId: ids.draftEvent.id,
      actorId: ids.manager.id,
    })
    expect(rows[0].metadata).toMatchObject({
      mediaId: data.id,
      kind: 'EVENT_COVER',
      contentType: 'image/png',
      width: 1200,
      height: 630,
      checksum: data.checksum,
      byteSize: data.byteSize,
      altTextLength: 'A very particular description'.length,
      revision: 1,
    })
    expect(JSON.stringify(rows[0].metadata)).not.toContain('particular')
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/pg\//)

    await app.close()
  })

  it('replaces the cover, deleting the old row and its bytes in the same write', async () => {
    const { app, ids, prisma } = await createTestApp()
    const old = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })
    const headers = bearer(await signIn(app, MANAGER))

    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), solidPng(1200, 630))

    expect(response.statusCode).toBe(201)
    expect(prisma._store.mediaAsset.map((row) => row.id)).toEqual([response.json().data.id])
    expect(prisma._store.mediaBlob.some((row) => row.storageKey === old.storageKey)).toBe(false)
    expect(prisma._store.mediaBlob).toHaveLength(1)
    expect(
      prisma._store.auditLog.find((row) => row.action === 'event.media_added').metadata
        .replacedMediaId,
    ).toBe(old.id)

    await app.close()
  })

  it('appends gallery pictures in order', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const first = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { kind: 'EVENT_GALLERY', revision: 0 }),
      solidPng(400, 400),
    )
    const second = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { kind: 'EVENT_GALLERY', revision: 1 }),
      solidPng(400, 400),
    )

    expect(first.json().data.position).toBe(0)
    expect(second.json().data.position).toBe(1)
    expect(second.json().meta.revision).toBe(2)

    await app.close()
  })

  it('refuses the ninth gallery picture inside the transaction too', async () => {
    // Seven pictures pass the gate; an eighth is added between the gate and
    // the write, the way a second tab would. The write must still refuse.
    const { app, ids, prisma } = await createTestApp()

    for (let position = 0; position < 7; position += 1) {
      seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position })
    }

    const headers = bearer(await signIn(app, MANAGER))
    const original = prisma.mediaAsset.count
    let calls = 0

    prisma.mediaAsset.count = async (args) => {
      calls += 1
      if (calls === 2)
        seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 7 })
      return original(args)
    }

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id, { kind: 'EVENT_GALLERY' }),
      solidPng(400, 400),
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('GALLERY_FULL')
    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).revision).toBe(0)

    await app.close()
  })

  it('takes a WebP with its metadata removed', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { metadataWebp } = await import('./helpers/images.js')

    const response = await upload(
      app,
      headers,
      uploadUrl(ids.draftEvent.id),
      metadataWebp(1200, 630),
      'image/webp',
    )

    expect(response.statusCode).toBe(201)
    expect(response.json().data.contentType).toBe('image/webp')
    expect(Buffer.from(prisma._store.mediaBlob[0].bytes).toString('latin1')).not.toMatch(
      /GPS|xmpmeta/,
    )

    await app.close()
  })
})

describe('the organiser’s list', () => {
  it('shows every picture with its review state, cover first, to a member and a moderator', async () => {
    const { app, ids, prisma } = await createTestApp()

    seedPicture(prisma, {
      event: ids.draftEvent,
      kind: 'EVENT_GALLERY',
      position: 1,
      moderationStatus: 'REJECTED',
    })
    seedPicture(prisma, {
      event: ids.draftEvent,
      kind: 'EVENT_GALLERY',
      position: 0,
      moderationStatus: 'PENDING',
    })
    seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })

    for (const email of [
      'finance@rangoli.example',
      'maya@desi-event.example',
      'ops@desi-event.example',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/events/${ids.draftEvent.id}/media`,
        headers: bearer(await signIn(app, email)),
      })

      expect(response.statusCode, email).toBe(200)

      const { data, meta } = response.json()

      expect(data.map((row) => [row.kind, row.position])).toEqual([
        ['EVENT_COVER', null],
        ['EVENT_GALLERY', 0],
        ['EVENT_GALLERY', 1],
      ])
      expect(data[2]).toMatchObject({
        moderationStatus: 'REJECTED',
        rejectionReason: 'Shows a private home.',
      })
      // The column's own name is the event's private note's name; it never
      // reaches the organiser's browser.
      expect(response.body).not.toContain('moderationNote')
      expect(data.every((row) => row.publiclyVisible === false)).toBe(true)
      expect(meta.revision).toBe(0)
      expect(response.body).not.toMatch(/storageKey|scanNote|uploadedById/)
    }

    await app.close()
  })

  it('answers 404 to another organisation and to an attendee', async () => {
    const { app, ids } = await createTestApp()

    for (const email of ['rival@dhol.example', 'priya@example.com']) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/events/${ids.draftEvent.id}/media`,
        headers: bearer(await signIn(app, email)),
      })

      expect(response.statusCode, email).toBe(404)
    }

    expect(
      (await app.inject({ method: 'GET', url: `/v1/events/${ids.draftEvent.id}/media` }))
        .statusCode,
    ).toBe(401)

    await app.close()
  })
})

describe('describing, reordering and removing', () => {
  it('describes a picture again on a PUBLISHED event and audits only the length', async () => {
    const { app, ids, prisma } = await createTestApp()
    const cover = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}/media/${cover.id}`,
      headers,
      payload: { revision: 0, altText: 'The band at soundcheck, lit in amber' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      altText: 'The band at soundcheck, lit in amber',
      publiclyVisible: true,
    })
    expect(response.json().meta.revision).toBe(1)

    const audit = prisma._store.auditLog.find((row) => row.action === 'event.media_described')

    expect(audit.metadata).toMatchObject({
      mediaId: cover.id,
      kind: 'EVENT_COVER',
      altTextLength: 36,
    })
    expect(JSON.stringify(audit.metadata)).not.toContain('soundcheck')

    await app.close()
  })

  it('refuses a description that is a file name, and a picture from another event', async () => {
    const { app, ids, prisma } = await createTestApp()
    const cover = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = bearer(await signIn(app, MANAGER))

    const named = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}/media/${cover.id}`,
      headers,
      payload: { revision: 0, altText: 'DSC_0042' },
    })

    expect(named.statusCode).toBe(400)

    const elsewhere = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/media/${cover.id}`,
      headers,
      payload: { revision: 0, altText: 'Stage' },
    })

    expect(elsewhere.statusCode).toBe(404)
    // The refused write left no revision bump behind.
    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).revision).toBe(0)

    await app.close()
  })

  it('reorders the gallery on a PUBLISHED event', async () => {
    const { app, ids, prisma } = await createTestApp()
    const a = seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY', position: 0 })
    const b = seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY', position: 1 })
    const c = seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY', position: 2 })
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/events/${ids.publishedEvent.id}/media/order`,
      headers,
      payload: { revision: 0, galleryIds: [c.id, a.id, b.id] },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((row) => row.id)).toEqual([c.id, a.id, b.id])
    expect(response.json().data.map((row) => row.position)).toEqual([0, 1, 2])
    expect(response.json().meta.revision).toBe(1)
    expect(
      prisma._store.auditLog.find((row) => row.action === 'event.media_reordered').metadata
        .galleryIds,
    ).toEqual([c.id, a.id, b.id])

    await app.close()
  })

  it('answers 409 GALLERY_CHANGED to a reorder that does not name exactly the gallery', async () => {
    const { app, ids, prisma } = await createTestApp()
    const a = seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 0 })
    const b = seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 1 })
    const cover = seedPicture(prisma, { event: ids.draftEvent })
    const headers = bearer(await signIn(app, MANAGER))

    for (const galleryIds of [[a.id], [a.id, b.id, cover.id], [b.id, cover.id]]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/v1/events/${ids.draftEvent.id}/media/order`,
        headers,
        payload: { revision: 0, galleryIds },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('GALLERY_CHANGED')
    }

    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).revision).toBe(0)

    await app.close()
  })

  it('removes a gallery picture and its bytes, and closes the gap', async () => {
    const { app, ids, prisma } = await createTestApp()
    const a = seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 0 })
    const b = seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 1 })
    const c = seedPicture(prisma, { event: ids.draftEvent, kind: 'EVENT_GALLERY', position: 2 })
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.draftEvent.id}/media/${a.id}?revision=0`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.map((row) => [row.id, row.position])).toEqual([
      [b.id, 0],
      [c.id, 1],
    ])
    expect(prisma._store.mediaBlob.some((row) => row.storageKey === a.storageKey)).toBe(false)
    expect(
      prisma._store.auditLog.find((row) => row.action === 'event.media_removed').metadata,
    ).toMatchObject({
      mediaId: a.id,
      kind: 'EVENT_GALLERY',
      checksum: a.checksum,
    })

    await app.close()
  })

  it('removes from a live, a cancelled and an archived event, so storage can always be freed', async () => {
    const { app, ids, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    for (const status of ['PUBLISHED', 'CANCELLED', 'ARCHIVED']) {
      const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

      event.status = status

      const picture = seedPicture(prisma, { event: ids.publishedEvent })
      const response = await app.inject({
        method: 'DELETE',
        url: `/v1/events/${ids.publishedEvent.id}/media/${picture.id}?revision=${event.revision}`,
        headers,
      })

      expect(response.statusCode, status).toBe(200)
    }

    // A deleted event's pictures stay as they are until it is restored.
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    event.status = 'DELETED'

    const kept = seedPicture(prisma, { event: ids.publishedEvent })
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.publishedEvent.id}/media/${kept.id}?revision=${event.revision}`,
      headers,
    })

    expect(deleted.statusCode).toBe(409)
    expect(deleted.json().error.code).toBe('NOT_EDITABLE')

    await app.close()
  })

  it('refuses a removal while a moderator holds the event, and a revision passed in a body', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      moderationStatus: 'PENDING',
    })
    const headers = bearer(await signIn(app, MANAGER))

    const held = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.reviewPendingEvent.id}/media/${picture.id}?revision=0`,
      headers,
    })

    expect(held.statusCode).toBe(409)
    expect(held.json().error.code).toBe('NOT_EDITABLE')
    expect(held.json().error.message).toMatch(/waiting for review\. A moderator is looking/u)

    const noQuery = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.draftEvent.id}/media/${picture.id}`,
      headers,
    })

    expect(noQuery.statusCode).toBe(400)
    expect(prisma._store.mediaAsset).toHaveLength(1)

    await app.close()
  })

  it('tells the organiser of an APPROVED event the moderator has decided and publishing is next', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.approvedEvent })
    const headers = bearer(await signIn(app, MANAGER))

    const removal = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.approvedEvent.id}/media/${picture.id}?revision=0`,
      headers,
    })
    const description = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.approvedEvent.id}/media/${picture.id}`,
      headers,
      payload: { revision: 0, altText: 'A new description' },
    })

    for (const response of [removal, description]) {
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('NOT_EDITABLE')
      expect(response.json().error.message).toBe(
        'This event is approved and waiting for you to publish it. Its pictures can be described again, reordered or removed once it is published.',
      )
      // Not the in-review sentence: nobody is still deciding.
      expect(response.json().error.message).not.toMatch(/moderator/iu)
    }

    expect(prisma._store.mediaAsset).toHaveLength(1)

    await app.close()
  })

  // SPEC2-XI X-8: a deleted event's pictures stay as they were, so a restore
  // brings it back whole. The refusal says so; it is not the in-review
  // sentence, because no moderator holds a deleted event.
  it('refuses every picture change on a deleted event with the deleted sentence, never the review one', async () => {
    const { app, ids, prisma } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    Object.assign(event, {
      status: 'DELETED',
      deletedAt: new Date(),
      deletionReason: 'The venue withdrew the booking before any ticket was sold.',
      deletionOutcome: 'REMOVED',
      deletionAuthority: 'ORGANIZATION',
      statusBeforeDeletion: 'PUBLISHED',
    })

    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = bearer(await signIn(app, MANAGER))
    const removal = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${ids.publishedEvent.id}/media/${picture.id}?revision=${event.revision}`,
      headers,
    })
    const description = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}/media/${picture.id}`,
      headers,
      payload: { revision: event.revision, altText: 'A new description' },
    })
    const added = await upload(
      app,
      headers,
      uploadUrl(ids.publishedEvent.id, { kind: 'EVENT_GALLERY' }),
      solidPng(1200, 630),
    )

    for (const response of [removal, description, added]) {
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('NOT_EDITABLE')
      expect(response.json().error.message).toBe(
        'This event was deleted. Its pictures stay as they were, so a restore by the Desi-Event team brings the event back whole.',
      )
      expect(response.json().error.message).not.toMatch(/review|moderator/iu)
    }

    expect(prisma._store.mediaAsset).toHaveLength(1)

    await app.close()
  })

  // Nobody can remove a deleted event's pictures (MEDIA_REMOVE_STATUSES), so
  // they cannot count against the room the organisation can free.
  it('does not count a deleted event’s pictures toward the organisation quota', async () => {
    const { app, ids, prisma } = await createTestApp()
    const deleted = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    Object.assign(deleted, {
      status: 'DELETED',
      deletedAt: new Date(),
      deletionReason: 'The venue withdrew the booking before any ticket was sold.',
      deletionOutcome: 'REMOVED',
      deletionAuthority: 'ORGANIZATION',
      statusBeforeDeletion: 'PUBLISHED',
    })
    seedPicture(prisma, {
      event: ids.publishedEvent,
      byteSize: MEDIA_LIMITS.organizationQuotaBytes - 100,
    })

    const headers = bearer(await signIn(app, MANAGER))
    const response = await upload(app, headers, uploadUrl(ids.draftEvent.id), solidPng(1200, 630))

    expect(response.statusCode).toBe(201)
    expect(prisma._store.mediaAsset).toHaveLength(2)

    await app.close()
  })

  // SPEC2-XI X-1 (§8): a cancelled event's words and pictures can still be
  // updated; an archived or deleted one's cannot.
  it('describes and reorders a cancelled event’s pictures, and refuses an archived or deleted one', async () => {
    const { app, ids, prisma } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    event.status = 'CANCELLED'

    const cover = seedPicture(prisma, { event: ids.publishedEvent })
    const gallery = seedPicture(prisma, { event: ids.publishedEvent, kind: 'EVENT_GALLERY' })
    const headers = bearer(await signIn(app, MANAGER))
    const described = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}/media/${cover.id}`,
      headers,
      payload: { revision: event.revision, altText: 'A new description' },
    })

    expect(described.statusCode).toBe(200)

    const reordered = await app.inject({
      method: 'PUT',
      url: `/v1/events/${ids.publishedEvent.id}/media/order`,
      headers,
      payload: { revision: event.revision, galleryIds: [gallery.id] },
    })

    expect(reordered.statusCode).toBe(200)

    for (const status of ['ARCHIVED', 'DELETED']) {
      event.status = status

      const refused = await app.inject({
        method: 'PATCH',
        url: `/v1/events/${ids.publishedEvent.id}/media/${cover.id}`,
        headers,
        payload: { revision: event.revision, altText: 'Another description' },
      })

      expect(refused.statusCode, status).toBe(409)
      expect(refused.json().error.code).toBe('NOT_EDITABLE')
    }

    await app.close()
  })

  it('refuses every arranging write to a VIEWER with 403', async () => {
    const { app, ids, prisma } = await createTestApp()
    const cover = seedPicture(prisma, { event: ids.draftEvent })
    const headers = bearer(await signIn(app, 'finance@rangoli.example'))

    const requests = [
      {
        method: 'PATCH',
        url: `/v1/events/${ids.draftEvent.id}/media/${cover.id}`,
        payload: { revision: 0, altText: 'Stage' },
      },
      {
        method: 'PUT',
        url: `/v1/events/${ids.draftEvent.id}/media/order`,
        payload: { revision: 0, galleryIds: [cover.id] },
      },
      { method: 'DELETE', url: `/v1/events/${ids.draftEvent.id}/media/${cover.id}?revision=0` },
    ]

    for (const request of requests) {
      const response = await app.inject({ ...request, headers })

      expect(response.statusCode, request.method).toBe(403)
    }

    expect(prisma._store.mediaAsset).toHaveLength(1)

    await app.close()
  })
})

describe('the external cover address is gone', () => {
  it('answers events.update with 400 naming the upload route', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}`,
      headers,
      payload: { revision: 0, coverImageUrl: 'https://tracker.example/pixel.png' },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json().error.issues)).toContain('POST /v1/events/:id/media')

    await app.close()
  })
})

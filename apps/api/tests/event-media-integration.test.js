/**
 * Event pictures against PostgreSQL: what the database refuses on its own,
 * what a race resolves to, and a real upload's bytes all the way down and back.
 *
 * The stub cannot prove any of this. It has no CHECK constraints, no partial
 * index, no trigger, no cascade and no concurrency, so every case here is one
 * the application's own checks also cover — and the point is that the database
 * holds the line without them.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-media-integration
 */

import { createHash, randomUUID } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { MEDIA_LIMITS } from '@desi-event/schemas/media'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { assertQuota } from '../src/lib/event-media.js'
import { createPostgresMediaStorage } from '../src/lib/media-storage.js'
import { startSession } from '../src/lib/sessions.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { cameraJpeg, solidPng } from './helpers/images.js'

const { prisma, reachable, when } = await connectTestDatabase('the event media suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Organisations this suite created; deleting them cascades to everything else it made. */
const made = { organizations: [], users: [] }

let app
let world

/**
 * A verified organisation with one event in the given status.
 *
 * @param {string} label Distinguishes it.
 * @param {string} [status] The event's status.
 * @returns {Promise<object>} `{ organization, event }`: the rows.
 */
async function eventIn(label, status = 'DRAFT') {
  const organization = await prisma.organization.create({
    data: {
      name: `Media ${label} ${RUN}`,
      slug: `media-${label}-${RUN}`.toLowerCase(),
      contactEmail: `media-${label}-${RUN}@example.test`.toLowerCase(),
      verificationStatus: 'VERIFIED',
      verified: true,
    },
  })

  made.organizations.push(organization.id)

  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      title: `Media ${label} ${RUN}`,
      slug: `media-${label}-${RUN}`.toLowerCase(),
      summary: 'A summary long enough to be plausible.',
      description: 'A description long enough to be plausible prose.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 60 * 60 * 1000),
      timezone: 'Asia/Kolkata',
      isOnline: true,
      onlineUrl: 'https://stream.example.test/live',
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })

  return { organization, event }
}

/**
 * The columns an event picture needs, with overrides.
 *
 * @param {object} event The event.
 * @param {object} [overrides] Column overrides.
 * @returns {object} `MediaAsset` create data.
 */
function asset(event, overrides = {}) {
  return {
    ownerType: 'EVENT',
    ownerId: event.id,
    eventId: event.id,
    kind: 'EVENT_GALLERY',
    storageKey: `pg/${randomUUID()}`,
    contentType: 'image/png',
    byteSize: 100,
    width: 400,
    height: 400,
    checksum: 'a'.repeat(64),
    altText: 'Dancers circling a lit garbo',
    position: 0,
    sanitisedAt: new Date(),
    scanStatus: 'CLEAN',
    ...overrides,
  }
}

/**
 * A member with a confirmed second factor and a live session.
 *
 * @param {object} organization Where they are a member.
 * @param {string} role Their organisation role.
 * @returns {Promise<object>} Bearer headers.
 */
async function memberSession(organization, role) {
  const user = await prisma.user.create({
    data: {
      email: `media-${role.toLowerCase()}-${RUN}-${made.users.length}@example.test`,
      displayName: `${role} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  made.users.push(user.id)

  await prisma.mfaFactor.create({
    data: {
      userId: user.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role },
  })
  const { secret } = await startSession(prisma, {
    actor: { id: user.id, role: 'ORGANIZER', memberships: [membership] },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'media-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

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

  const home = await eventIn('home')
  const headers = await memberSession(home.organization, 'MANAGER')

  world = { home, headers }
})

afterAll(async () => {
  if (reachable) {
    for (const id of made.organizations) {
      await prisma.event.deleteMany({ where: { organizationId: id } }).catch(() => {})
      await prisma.membership.deleteMany({ where: { organizationId: id } }).catch(() => {})
    }

    for (const id of made.users) {
      await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {})
      await prisma.mfaFactor.deleteMany({ where: { userId: id } }).catch(() => {})
    }
  }

  await app?.close()
  await prisma.$disconnect()
})

when()('what the database refuses on its own', () => {
  it.each([
    [
      'a cover with a position',
      { kind: 'EVENT_COVER', position: 0 },
      /media_asset_position_by_kind/u,
    ],
    ['a gallery position of 8', { position: 8 }, /media_asset_position_by_kind/u],
    ['a missing description', { altText: null }, /media_asset_event_media_shape/u],
    ['a blank description', { altText: '   ' }, /media_asset_event_media_shape/u],
    [
      'a type that is not a picture',
      { contentType: 'image/svg+xml' },
      /media_asset_event_media_shape/u,
    ],
    ['a side over 8000', { width: 8001 }, /media_asset_event_media_shape/u],
    ['a malformed checksum', { checksum: 'nope' }, /media_asset_event_media_shape/u],
    [
      'an approval of bytes that were never rebuilt',
      { moderationStatus: 'APPROVED', sanitisedAt: null, moderatedAt: new Date() },
      /media_asset_approved_is_servable/u,
    ],
    [
      'an approval before the structural check passed',
      { moderationStatus: 'APPROVED', scanStatus: 'PENDING', moderatedAt: new Date() },
      /media_asset_approved_is_servable/u,
    ],
    [
      'a rejection with no note',
      { moderationStatus: 'REJECTED', moderatedAt: new Date() },
      /media_asset_rejection_has_note/u,
    ],
    [
      'a decision with no time stamped',
      { moderationStatus: 'APPROVED' },
      /media_asset_decision_is_stamped/u,
    ],
  ])('refuses %s', async (_name, overrides, constraint) => {
    const { event } = await eventIn(`check-${randomUUID().slice(0, 8)}`)

    await expect(prisma.mediaAsset.create({ data: asset(event, overrides) })).rejects.toThrow(
      constraint,
    )
  })

  it('refuses a blob whose size does not match its bytes, and one with a malformed checksum', async () => {
    const { event } = await eventIn('blob-checks')
    const row = await prisma.mediaAsset.create({ data: asset(event) })

    await expect(
      prisma.mediaBlob.create({
        data: {
          storageKey: row.storageKey,
          bytes: Buffer.from([1, 2, 3]),
          byteSize: 4,
          checksum: 'b'.repeat(64),
        },
      }),
    ).rejects.toThrow(/media_blob_size_matches/u)

    await expect(
      prisma.mediaBlob.create({
        data: {
          storageKey: row.storageKey,
          bytes: Buffer.from([1, 2, 3]),
          byteSize: 3,
          checksum: 'B'.repeat(64),
        },
      }),
    ).rejects.toThrow(/media_blob_checksum_shape/u)

    // And one with no asset at all.
    await expect(
      prisma.mediaBlob.create({
        data: {
          storageKey: `pg/${randomUUID()}`,
          bytes: Buffer.from([1]),
          byteSize: 1,
          checksum: 'c'.repeat(64),
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses a second cover on one event with the partial unique index', async () => {
    const { event } = await eventIn('two-covers')

    await prisma.mediaAsset.create({ data: asset(event, { kind: 'EVENT_COVER', position: null }) })

    await expect(
      prisma.mediaAsset.create({ data: asset(event, { kind: 'EVENT_COVER', position: null }) }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // A cover on another event is no collision.
    const other = await eventIn('two-covers-other')

    await expect(
      prisma.mediaAsset.create({
        data: asset(other.event, { kind: 'EVENT_COVER', position: null }),
      }),
    ).resolves.toBeTruthy()
  })

  it('refuses a ninth gallery picture with the trigger', async () => {
    const { event } = await eventIn('gallery-cap')

    for (let position = 0; position < 8; position += 1) {
      await prisma.mediaAsset.create({ data: asset(event, { position }) })
    }

    await expect(prisma.mediaAsset.create({ data: asset(event, { position: 7 }) })).rejects.toThrow(
      /already has 8 gallery pictures/u,
    )
  })

  it('lets exactly eight of ten parallel gallery inserts commit', async () => {
    const { event } = await eventIn('gallery-race')

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        prisma.mediaAsset.create({ data: asset(event, { position: index % 8 }) }),
      ),
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(8)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2)
    expect(
      await prisma.mediaAsset.count({ where: { eventId: event.id, kind: 'EVENT_GALLERY' } }),
    ).toBe(8)
  })

  it('deletes the bytes with the asset, and both with the event', async () => {
    const { event } = await eventIn('cascade')
    const storage = createPostgresMediaStorage(prisma)
    const bytes = Buffer.from([1, 2, 3, 4])
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const first = await prisma.mediaAsset.create({ data: asset(event, { byteSize: 4, checksum }) })
    const second = await prisma.mediaAsset.create({
      data: asset(event, { byteSize: 4, checksum, position: 1 }),
    })

    for (const row of [first, second]) {
      await storage.put(prisma, { key: row.storageKey, bytes, checksum, byteSize: 4 })
    }

    await prisma.mediaAsset.delete({ where: { id: first.id } })

    expect(await storage.read(first.storageKey)).toBeNull()
    expect((await storage.read(second.storageKey)).bytes.equals(bytes)).toBe(true)

    await prisma.event.delete({ where: { id: event.id } })

    expect(await prisma.mediaAsset.count({ where: { eventId: event.id } })).toBe(0)
    expect(await storage.read(second.storageKey)).toBeNull()
  })

  it('round-trips a full 10 MiB of bytes', async () => {
    const { event } = await eventIn('ten-mebibytes')
    const storage = createPostgresMediaStorage(prisma)
    const bytes = Buffer.alloc(MEDIA_LIMITS.maxBytes)

    for (let index = 0; index < bytes.length; index += 4096) bytes[index] = index % 251

    const checksum = createHash('sha256').update(bytes).digest('hex')
    const row = await prisma.mediaAsset.create({
      data: asset(event, { byteSize: bytes.length, checksum }),
    })

    await storage.put(prisma, { key: row.storageKey, bytes, checksum, byteSize: bytes.length })

    const read = await storage.read(row.storageKey)

    expect(read.bytes.length).toBe(MEDIA_LIMITS.maxBytes)
    expect(createHash('sha256').update(read.bytes).digest('hex')).toBe(checksum)

    // One byte more is refused by the database, whatever the application did.
    const tooBig = await prisma.mediaAsset.create({
      data: asset(event, { byteSize: 100, checksum, position: 1 }),
    })

    await expect(
      prisma.mediaBlob.create({
        data: {
          storageKey: tooBig.storageKey,
          bytes: Buffer.alloc(MEDIA_LIMITS.maxBytes + 1),
          byteSize: MEDIA_LIMITS.maxBytes + 1,
          checksum,
        },
      }),
    ).rejects.toThrow(/media_blob_size_matches/u)
  })
})

when()('through the real application', () => {
  it('stores a GPS-tagged JPEG without its GPS, and serves back exactly the stored bytes', async () => {
    const { event } = world.home
    const original = cameraJpeg(1600, 1200, { orientation: 6 })

    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/media?kind=EVENT_COVER&altText=Dancers%20circling%20a%20lit%20garbo&revision=0`,
      headers: { ...world.headers, 'content-type': 'image/jpeg' },
      payload: original,
    })

    expect(uploaded.statusCode, uploaded.body).toBe(201)

    const { data } = uploaded.json()
    const row = await prisma.mediaAsset.findUnique({ where: { id: data.id } })
    const blob = await prisma.mediaBlob.findUnique({ where: { storageKey: row.storageKey } })
    const stored = Buffer.from(blob.bytes)

    expect(stored.toString('latin1')).not.toContain('GPSLAT')
    expect(stored.toString('latin1')).not.toContain('SecretCam')
    expect(createHash('sha256').update(stored).digest('hex')).toBe(row.checksum)
    expect(row).toMatchObject({
      scanStatus: 'CLEAN',
      moderationStatus: 'PENDING',
      width: 1200,
      height: 1600,
    })

    const served = await app.inject({
      method: 'GET',
      url: `/v1/media/${data.id}`,
      headers: world.headers,
    })

    expect(served.statusCode).toBe(200)
    expect(served.headers['cache-control']).toBe('private, no-store')
    expect(served.rawPayload.equals(stored)).toBe(true)
    expect(served.headers.etag).toBe(`"sha256-${row.checksum}"`)

    const anonymous = await app.inject({ method: 'GET', url: `/v1/media/${data.id}` })

    expect(anonymous.statusCode).toBe(404)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'event.media_added', entityId: event.id },
    })

    expect(audit.metadata).toMatchObject({ mediaId: data.id, kind: 'EVENT_COVER', revision: 1 })
    expect(JSON.stringify(audit.metadata)).not.toContain('garbo')
  })

  it('lets one of two uploads quoting the same revision win, and tells the other it is stale', async () => {
    const { event } = world.home
    const { revision } = await prisma.event.findUnique({ where: { id: event.id } })
    const send = () =>
      app.inject({
        method: 'POST',
        url: `/v1/events/${event.id}/media?kind=EVENT_GALLERY&altText=The%20band%20at%20soundcheck&revision=${revision}`,
        headers: { ...world.headers, 'content-type': 'image/png' },
        payload: solidPng(400, 400),
      })

    const [first, second] = await Promise.all([send(), send()])
    const statuses = [first.statusCode, second.statusCode].sort()

    expect(statuses).toEqual([201, 409])

    const loser = first.statusCode === 409 ? first : second

    expect(loser.json().error.code).toBe('STALE_REVISION')
    expect(
      await prisma.mediaAsset.count({ where: { eventId: event.id, kind: 'EVENT_GALLERY' } }),
    ).toBe(1)
    // The loser left no orphaned bytes behind.
    expect(await prisma.mediaBlob.count({ where: { asset: { eventId: event.id } } })).toBe(
      await prisma.mediaAsset.count({ where: { eventId: event.id } }),
    )
  })
})

when()('the organisation quota', () => {
  // SPEC2-XI X-8: a deleted event's pictures are kept for a restore and nobody
  // can remove them while it is deleted, so the quota does not count them. The
  // relation filter is PostgreSQL's here, not the stub's.
  it('counts a live event’s pictures and not a deleted event’s', async () => {
    const live = await eventIn(`quota-live-${randomUUID().slice(0, 8)}`)
    const gone = await eventIn(`quota-gone-${randomUUID().slice(0, 8)}`)

    await prisma.mediaAsset.create({ data: asset(live.event, { byteSize: 1000 }) })
    await prisma.mediaAsset.create({ data: asset(gone.event, { byteSize: 1000 }) })
    await prisma.event.update({
      where: { id: gone.event.id },
      data: {
        status: 'DELETED',
        deletedAt: new Date(),
        deletionReason: 'Taken down before any ticket was sold.',
        deletionOutcome: 'REMOVED',
        deletionAuthority: 'ORGANIZATION',
        statusBeforeDeletion: 'DRAFT',
      },
    })

    const adding = MEDIA_LIMITS.organizationQuotaBytes - 500

    await expect(assertQuota(prisma, live.organization.id, adding)).rejects.toMatchObject({
      statusCode: 409,
      code: 'MEDIA_QUOTA_EXCEEDED',
    })
    await expect(assertQuota(prisma, gone.organization.id, adding)).resolves.toBeUndefined()
  })
})

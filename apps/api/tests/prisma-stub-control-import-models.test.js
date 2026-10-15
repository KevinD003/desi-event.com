/**
 * The Prisma stub's models for full control of posted events and the Sulekha
 * import (SPEC2-XI), and the fixtures built on them.
 *
 * The stub is what most API tests run against. A unique index it forgets lets a
 * double click open two editing sittings, or a re-import duplicate an event,
 * and the route's test still passes; so each index the database holds for
 * these models is held here too, and checked here. The stub runs no triggers
 * and holds no CHECK: those are proved on PostgreSQL by the fresh-database
 * probes (`packages/db/scripts/event-control-probes.mjs`).
 *
 * @module @desi-event/api/tests/prisma-stub-control-import-models
 */

import { describe, expect, it } from 'vitest'

import {
  addRows,
  deletedEventFixture,
  makeWorld,
  platformHeldImportFixture,
  threeNightEventFixture,
} from './helpers/fixtures.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

/**
 * A stub over the default world, with whichever fixtures a test adds.
 *
 * @param {...function(object): {rows: object}} fixtures Builders given the world's ids.
 * @returns {Promise<{prisma: object, ids: object, built: object[]}>} The stub, the ids and what each builder returned.
 */
async function world(...fixtures) {
  const { seed, ids } = await makeWorld()
  const built = fixtures.map((fixture) => fixture(ids))

  for (const fixture of built) addRows(seed, fixture.rows)

  return { prisma: createPrismaStub(seed), ids, built }
}

describe('columns added over existing rows', () => {
  it('reads every seeded event as not deleted, as the migration leaves every existing row', async () => {
    const { prisma } = await world()
    const all = await prisma.event.count()

    expect(all).toBeGreaterThan(0)
    expect(
      await prisma.event.count({ where: { deletedAt: null, statusBeforeDeletion: null } }),
    ).toBe(all)
    expect(await prisma.event.count({ where: { status: { not: 'DELETED' } } })).toBe(all)
  })

  it('reads every seeded night as not cancelled and with its end listed', async () => {
    const { prisma } = await world()
    const nights = await prisma.eventSession.findMany()

    expect(nights.length).toBeGreaterThan(0)
    for (const night of nights) {
      expect(night).toMatchObject({
        cancelledAt: null,
        cancellationReason: null,
        endTimeListed: true,
      })
    }
  })

  it('reads every seeded organisation as not platform-held', async () => {
    const { prisma } = await world()

    expect(await prisma.organization.count({ where: { platformHeldSource: { not: null } } })).toBe(
      0,
    )
  })

  it('leaves a column a seeded row spells out as it was', async () => {
    const { prisma, built } = await world((ids) => deletedEventFixture(ids))
    const [{ event }] = built
    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    expect(stored).toMatchObject({
      status: 'DELETED',
      statusBeforeDeletion: 'ON_SALE',
      deletionOutcome: 'REMOVED',
      deletionAuthority: 'ORGANIZATION',
    })
  })
})

describe('replacement covers in the stub', () => {
  /**
   * A cover row of an event.
   *
   * @param {string} eventId The event.
   * @param {object} [overrides] Column overrides.
   * @returns {object} `MediaAsset` create data.
   */
  const cover = (eventId, overrides = {}) => ({
    ownerType: 'EVENT',
    ownerId: eventId,
    eventId,
    kind: 'EVENT_COVER',
    storageKey: `cover-${Math.random().toString(36).slice(2)}`,
    contentType: 'image/png',
    byteSize: 1024,
    altText: 'A cover',
    ...overrides,
  })

  it('keeps one current cover per event and lets a waiting replacement stand beside it', async () => {
    const { prisma, ids } = await world()
    const eventId = ids.publishedEvent.id
    const current = await prisma.mediaAsset.create({ data: cover(eventId) })

    expect(current.replacesMediaId).toBeNull()
    await expect(prisma.mediaAsset.create({ data: cover(eventId) })).rejects.toMatchObject({
      code: 'P2002',
      message: expect.stringContaining('MediaAsset_one_current_cover_per_event_key'),
    })

    const waiting = await prisma.mediaAsset.create({
      data: cover(eventId, { replacesMediaId: current.id }),
    })

    expect(waiting.replacesMediaId).toBe(current.id)
    await expect(
      prisma.mediaAsset.create({ data: cover(eventId, { replacesMediaId: current.id }) }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const read = await prisma.mediaAsset.findUnique({
      where: { id: current.id },
      include: { replacedBy: true },
    })
    expect(read.replacedBy.id).toBe(waiting.id)
  })

  it('makes the replacement the current cover once the old one goes and the pointer is cleared', async () => {
    const { prisma, ids } = await world()
    const eventId = ids.publishedEvent.id
    const current = await prisma.mediaAsset.create({ data: cover(eventId) })
    const waiting = await prisma.mediaAsset.create({
      data: cover(eventId, { replacesMediaId: current.id }),
    })

    await prisma.mediaAsset.deleteMany({ where: { id: current.id } })
    await prisma.mediaAsset.update({ where: { id: waiting.id }, data: { replacesMediaId: null } })

    // A second current cover is refused again: the replacement is the cover now.
    await expect(prisma.mediaAsset.create({ data: cover(eventId) })).rejects.toMatchObject({
      code: 'P2002',
    })
  })

  // `MediaAsset_replacesMediaId_fkey` is ON DELETE SET NULL: removing the cover
  // a replacement waits beside clears its pointer in the database, so the
  // replacement becomes the current cover with no write of its own. The stub
  // clears it the same way, or an approval written for PostgreSQL would leave
  // a replacement pointing at nothing here.
  it.each(['delete', 'deleteMany'])(
    'clears a waiting replacement’s pointer when the cover it replaces goes (%s), as ON DELETE SET NULL does',
    async (method) => {
      const { prisma, ids } = await world()
      const eventId = ids.publishedEvent.id
      const current = await prisma.mediaAsset.create({ data: cover(eventId) })
      const waiting = await prisma.mediaAsset.create({
        data: cover(eventId, { replacesMediaId: current.id }),
      })
      const elsewhere = await prisma.mediaAsset.create({
        data: cover(ids.draftEvent.id),
      })

      await prisma.mediaAsset[method]({ where: { id: current.id } })

      const after = await prisma.mediaAsset.findUnique({ where: { id: waiting.id } })
      expect(after.replacesMediaId).toBeNull()
      // It is the current cover now: a second current cover is refused.
      await expect(prisma.mediaAsset.create({ data: cover(eventId) })).rejects.toMatchObject({
        code: 'P2002',
        message: expect.stringContaining('MediaAsset_one_current_cover_per_event_key'),
      })
      // Nothing else was touched.
      expect(
        (await prisma.mediaAsset.findUnique({ where: { id: elsewhere.id } })).replacesMediaId,
      ).toBeNull()
    },
  )
})

describe('platform edit sittings in the stub', () => {
  /**
   * An open sitting's create data.
   *
   * @param {object} ids The world's ids.
   * @param {object} [overrides] Column overrides.
   * @returns {object} `EventPlatformEdit` create data.
   */
  const sitting = (ids, overrides = {}) => ({
    eventId: ids.publishedEvent.id,
    actorId: ids.platformAdministrator.id,
    reason: 'Correcting the start time the organiser asked us to fix.',
    expiresAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  })

  it('fills the defaults, opening it now', async () => {
    const { prisma, ids } = await world()
    const before = Date.now()
    const row = await prisma.eventPlatformEdit.create({ data: sitting(ids) })

    expect(row).toMatchObject({ closedAt: null, endedBy: null, sessionId: null })
    expect(row.openedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('keeps one open sitting per administrator per event, and a closed one makes way', async () => {
    const { prisma, ids } = await world()
    const first = await prisma.eventPlatformEdit.create({ data: sitting(ids) })

    await expect(prisma.eventPlatformEdit.create({ data: sitting(ids) })).rejects.toMatchObject({
      code: 'P2002',
      message: expect.stringContaining('EventPlatformEdit_one_open_per_actor_key'),
    })

    // Another administrator, or the same one on another event, is not the same sitting.
    await expect(
      prisma.eventPlatformEdit.create({ data: sitting(ids, { actorId: ids.platformAdmin.id }) }),
    ).resolves.toMatchObject({ closedAt: null })
    await expect(
      prisma.eventPlatformEdit.create({ data: sitting(ids, { eventId: ids.onlineEvent.id }) }),
    ).resolves.toMatchObject({ closedAt: null })

    await prisma.eventPlatformEdit.update({
      where: { id: first.id },
      data: { closedAt: new Date(), endedBy: 'SUPERSEDED' },
    })
    await expect(prisma.eventPlatformEdit.create({ data: sitting(ids) })).resolves.toMatchObject({
      closedAt: null,
    })
  })

  it('refuses reopening a closed sitting while another is open (the index holds on update too)', async () => {
    const { prisma, ids } = await world()
    const first = await prisma.eventPlatformEdit.create({ data: sitting(ids) })

    await prisma.eventPlatformEdit.update({
      where: { id: first.id },
      data: { closedAt: new Date(), endedBy: 'CLOSED' },
    })
    await prisma.eventPlatformEdit.create({ data: sitting(ids) })

    await expect(
      prisma.eventPlatformEdit.update({
        where: { id: first.id },
        data: { closedAt: null, endedBy: null },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('follows a sitting to its event, its administrator and its browser session', async () => {
    const { prisma, ids } = await world()
    const session = await prisma.session.create({
      data: {
        userId: ids.platformAdministrator.id,
        tokenHash: 'f'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    const row = await prisma.eventPlatformEdit.create({
      data: sitting(ids, { sessionId: session.id }),
    })
    const read = await prisma.eventPlatformEdit.findUnique({
      where: { id: row.id },
      include: { event: true, actor: true, session: true },
    })

    expect(read.event.id).toBe(ids.publishedEvent.id)
    expect(read.actor.email).toBe('anil@desi-event.example')
    expect(read.session.id).toBe(session.id)

    const event = await prisma.event.findUnique({
      where: { id: ids.publishedEvent.id },
      include: { platformEdits: true },
    })
    expect(event.platformEdits.map((edit) => edit.id)).toEqual([row.id])
  })
})

describe('change notices in the stub', () => {
  it('fills the defaults and stamps the time', async () => {
    const { prisma, ids } = await world()
    const notice = await prisma.eventChangeNotice.create({
      data: { eventId: ids.publishedEvent.id, kind: 'MATERIAL_CHANGE' },
    })

    expect(notice).toMatchObject({
      eventSessionId: null,
      fields: [],
      changed: [],
      before: null,
      after: null,
      reason: null,
      byPlatform: false,
      revision: null,
    })
    expect(notice.createdAt).toBeInstanceOf(Date)
  })
})

describe('imports in the stub', () => {
  it('keeps one platform-held organisation per source, and any number of ordinary ones', async () => {
    const { prisma, built } = await world((ids) => platformHeldImportFixture(ids))
    const [{ organization }] = built

    expect(organization.platformHeldSource).toBe('SULEKHA')
    await expect(
      prisma.organization.create({
        data: {
          name: 'Another Sulekha holder',
          slug: 'another-sulekha-holder',
          contactEmail: 'a@example.com',
          platformHeldSource: 'SULEKHA',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      prisma.organization.create({
        data: { name: 'Ordinary', slug: 'ordinary-org', contactEmail: 'b@example.com' },
      }),
    ).resolves.toMatchObject({ platformHeldSource: null })
  })

  it('keeps one record per listing and per event, and one picture per address per record', async () => {
    const { prisma, ids, built } = await world((given) => platformHeldImportFixture(given))
    const [{ item, organization }] = built
    const other = await prisma.event.create({
      data: {
        organizationId: organization.id,
        title: 'Another listing',
        slug: 'another-listing',
        summary: 'Another.',
        description: 'Another listing.',
        category: 'COMEDY',
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 2 * 86_400_000),
      },
    })
    const record = {
      source: 'SULEKHA',
      sourceUrl: item.sourceUrl,
      scrapedAt: item.scrapedAt,
      importedById: ids.platformAdministrator.id,
    }

    await expect(
      prisma.eventImportItem.create({
        data: { ...record, sourceId: item.sourceId, eventId: other.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
    await expect(
      prisma.eventImportItem.create({
        data: { ...record, sourceId: '402061', eventId: item.eventId },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const created = await prisma.eventImportItem.create({
      data: { ...record, sourceId: '402061', eventId: other.id },
    })

    expect(created).toMatchObject({
      prices: [],
      importNotes: [],
      presentedBy: null,
      approvedById: null,
      reassignedToOrganizationId: null,
    })
    expect(created.importedAt).toBeInstanceOf(Date)
    expect(created.lastSyncedAt).toBeInstanceOf(Date)

    const picture = { itemId: created.id, url: 'https://usimg.sulekha.io/a.webp', role: 'COVER' }
    const image = await prisma.eventImportImage.create({
      data: { ...picture, alt: 'A poster', position: 0 },
    })

    expect(image).toMatchObject({
      status: 'WAITING',
      attempts: 0,
      failureCode: null,
      mediaAssetId: null,
    })
    await expect(
      prisma.eventImportImage.create({ data: { ...picture, alt: 'Again', position: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  // `EventImportImage_mediaAssetId_fkey` is ON DELETE SET NULL: the organiser
  // may remove an imported picture later, and the import record keeps saying it
  // was stored while no longer naming a picture that is gone.
  it('clears an imported picture’s stored copy when that picture is removed, as ON DELETE SET NULL does', async () => {
    const { prisma, built } = await world((ids) => platformHeldImportFixture(ids))
    const [{ event, image }] = built
    const stored = await prisma.mediaAsset.create({
      data: {
        ownerType: 'EVENT',
        ownerId: event.id,
        eventId: event.id,
        kind: 'EVENT_COVER',
        storageKey: 'imported-cover',
        contentType: 'image/webp',
        byteSize: 2048,
        altText: 'A poster',
      },
    })

    await prisma.eventImportImage.update({
      where: { id: image.id },
      data: { status: 'STORED', mediaAssetId: stored.id },
    })
    await prisma.mediaAsset.delete({ where: { id: stored.id } })

    expect(await prisma.eventImportImage.findUnique({ where: { id: image.id } })).toMatchObject({
      status: 'STORED',
      mediaAssetId: null,
    })
  })

  it('fills a run’s defaults and follows the record to its event, run, importer and pictures', async () => {
    const { prisma, built } = await world((ids) => platformHeldImportFixture(ids))
    const [{ item, run, event, image }] = built
    const fresh = await prisma.eventImportRun.create({
      data: {
        source: 'SULEKHA',
        fileName: 'texas.json',
        datasetSha256: 'c'.repeat(64),
        dataset: {},
        plan: [],
        planDigest: 'd'.repeat(64),
        eventCount: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })

    expect(fresh).toMatchObject({ status: 'PREVIEWED', appliedAt: null, summary: null })
    expect(fresh.createdAt).toBeInstanceOf(Date)

    const read = await prisma.eventImportItem.findUnique({
      where: { id: item.id },
      include: { event: true, lastRun: true, importedBy: true, images: true },
    })

    expect(read.event.id).toBe(event.id)
    expect(read.lastRun.id).toBe(run.id)
    expect(read.importedBy.email).toBe('anil@desi-event.example')
    expect(read.images.map((row) => row.id)).toEqual([image.id])

    const back = await prisma.event.findUnique({
      where: { id: event.id },
      include: { importItem: true },
    })
    expect(back.importItem.sourceId).toBe('402059')
  })
})

describe('the SPEC2-XI fixtures', () => {
  it('builds a deleted event that was on sale, removed, with its slug kept', async () => {
    const { prisma, ids, built } = await world((given) => deletedEventFixture(given))
    const [{ event, session }] = built

    expect(event).toMatchObject({
      status: 'DELETED',
      statusBeforeDeletion: 'ON_SALE',
      deletionOutcome: 'REMOVED',
      deletedById: ids.owner.id,
      deletedSlug: null,
    })
    expect(event.publishedAt).toBeInstanceOf(Date)
    expect(event.deletionReason.trim().length).toBeGreaterThanOrEqual(10)
    expect(await prisma.eventSession.count({ where: { eventId: event.id } })).toBe(1)
    expect(session.status).toBe('SCHEDULED')
  })

  it('can say a deleted event was taken down by the team at The Desi Events', async () => {
    const { built } = await world((given) =>
      deletedEventFixture(given, { deletedBy: given.platformAdministrator, authority: 'PLATFORM' }),
    )

    expect(built[0].event).toMatchObject({ deletionAuthority: 'PLATFORM' })
  })

  it('builds a three-night live event with a paid order per night and one every-night pass', async () => {
    const { prisma, built } = await world((given) => threeNightEventFixture(given))
    const [{ event, nights, tiers, pass, orders, passOrder }] = built

    expect(event.status).toBe('ON_SALE')
    expect(nights.map((night) => night.label)).toEqual(['Night 1', 'Night 2', 'Night 3'])
    expect(tiers.map((tier) => tier.eventSessionId)).toEqual(nights.map((night) => night.id))
    expect(pass.eventSessionId).toBeNull()
    expect(orders.map((order) => order.eventSessionId)).toEqual(nights.map((night) => night.id))
    expect(passOrder.eventSessionId).toBeNull()

    const paid = await prisma.order.findMany({
      where: { eventId: event.id, status: 'PAID' },
      include: { items: { include: { tickets: true } }, payments: true },
    })

    expect(paid).toHaveLength(4)
    for (const order of paid) {
      expect(order.payments.map((payment) => payment.status)).toEqual(['SUCCEEDED'])
      expect(order.items[0].tickets.map((ticket) => ticket.status)).toEqual(['VALID'])
    }
  })

  it('builds a platform-held organisation with no member and one imported event under review', async () => {
    const { prisma, built } = await world((given) => platformHeldImportFixture(given))
    const [{ organization, event, session, venue }] = built

    expect(await prisma.membership.count({ where: { organizationId: organization.id } })).toBe(0)
    expect(organization).toMatchObject({ verificationStatus: 'VERIFIED', verified: true })
    expect(venue).toMatchObject({ provenance: 'import:sulekha', organizationId: organization.id })
    expect(event).toMatchObject({ status: 'REVIEW_PENDING', organizationId: organization.id })
    expect(session.endTimeListed).toBe(false)
    expect(session.endsAt.getTime() - session.startsAt.getTime()).toBe(3 * 3_600_000)
  })
})

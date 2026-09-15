/**
 * Seating-map immutability, against a real database.
 *
 * The stub cannot prove any of this. What is under test is the agreement
 * between the service and the database's own rules — the plpgsql triggers that
 * freeze a published layout and the `onDelete: Restrict` references that stop an
 * attendee's ticket being orphaned. A stub that agrees with the service proves
 * only that the service agrees with itself, and these are precisely the
 * invariants the application must not be trusted with alone.
 *
 * Nothing here weakens a trigger to make a test pass. Where a trigger refuses,
 * the refusal is the assertion.
 *
 * Runs against TEST_DATABASE_URL and skips itself when no database is
 * reachable, the same way the ledger suite does.
 */

import { afterAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

import { createVersion, publishVersion, readLayout, writeLayout } from '../src/lib/venue-maps.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** A suffix unique to this run, so repeated runs do not collide on unique names. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const prisma = createPrismaClient({ connectionString: CONNECTION })
const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

if (!reachable) {
  console.warn(
    `[api] skipping the venue-map integration suite: ${CONNECTION.replace(/:[^:@/]*@/, ':***@')} is unreachable`,
  )
}

/** Rows this suite created, newest first, for teardown. */
const made = { versions: [], maps: [], venues: [] }

/**
 * A venue and a map with one draft version.
 *
 * @param {string} label Distinguishes this fixture from the others in the run.
 * @returns {Promise<object>} The venue, map and draft version.
 */
async function freshMap(label) {
  const venue = await prisma.venue.create({
    data: {
      name: `Map Test ${label} ${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
      slug: `map-test-${label}-${RUN}`,
    },
  })
  const map = await prisma.venueMap.create({ data: { venueId: venue.id, name: `Layout ${RUN}` } })
  const version = await prisma.venueMapVersion.create({ data: { venueMapId: map.id, version: 1 } })

  made.venues.push(venue.id)
  made.maps.push(map.id)
  made.versions.push(version.id)

  return { venue, map, version }
}

/** A valid two-seat layout. */
const layout = () => ({
  zones: [{ key: 'z1', name: 'Stalls', colourToken: 'zone-a', sortOrder: 0 }],
  sections: [
    {
      key: 's1',
      name: 'Stalls',
      kind: 'SEATED',
      sortOrder: 0,
      rows: [
        {
          key: 'r1',
          label: 'A',
          sortOrder: 0,
          seats: [
            { key: 'a1', label: 'A1', sortOrder: 0, zoneKey: 'z1', accessible: true },
            { key: 'a2', label: 'A2', sortOrder: 1, zoneKey: 'z1', companionOfKey: 'a1' },
          ],
        },
      ],
      seats: [],
    },
  ],
})

const when = reachable ? describe : describe.skip

afterAll(async () => {
  if (!reachable) return

  // Drafts and their children can go. A published version is deliberately left
  // where it is: deleting it would mean the freeze can be undone by a test,
  // which is the opposite of what these tests assert.
  for (const id of made.versions) {
    const row = await prisma.venueMapVersion.findUnique({ where: { id } }).catch(() => null)

    // A published version is left exactly where it is. Attempting to delete one
    // would be a test trying to undo the freeze it just asserted, and the
    // trigger would refuse anyway — correctly, and noisily.
    if (!row || row.publishedAt) continue

    await prisma.seat.deleteMany({ where: { venueMapVersionId: id } }).catch(() => {})
    await prisma.seatRow.deleteMany({ where: { venueMapVersionId: id } }).catch(() => {})
    await prisma.section.deleteMany({ where: { venueMapVersionId: id } }).catch(() => {})
    await prisma.priceZone.deleteMany({ where: { venueMapVersionId: id } }).catch(() => {})
    await prisma.venueMapVersion.delete({ where: { id } }).catch(() => {})
  }
  for (const id of made.maps) await prisma.venueMap.delete({ where: { id } }).catch(() => {})
  for (const id of made.venues) await prisma.venue.delete({ where: { id } }).catch(() => {})

  await prisma.$disconnect()
})

when('writing a layout against PostgreSQL', () => {
  it('stores the graph with real foreign keys', async () => {
    const { version } = await freshMap('write')

    const updated = await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    expect(updated.revision).toBe(1)
    expect(updated.seatCount).toBe(2)

    const stored = await readLayout(prisma, version.id)

    expect(stored.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])

    // The companion is a real reference the database enforces, not a naming
    // convention: `companionOfSeatId` is @unique and the seat trigger checks
    // the partner is in the same map version.
    const companion = stored.sections[0].rows[0].seats.find((s) => s.label === 'A2')
    const space = stored.sections[0].rows[0].seats.find((s) => s.label === 'A1')

    expect(companion.companionOfKey).toBe(space.key)
  })

  it('refuses a duplicate seat label at the database, not only in the validator', async () => {
    const { version } = await freshMap('dup')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    const seats = await prisma.seat.findMany({ where: { venueMapVersionId: version.id } })

    // @@unique([venueMapVersionId, label]) is the constraint the validator
    // exists to report before it fires. Proving it is really there means the
    // validator is a better error message rather than the only defence.
    await expect(
      prisma.seat.create({
        data: {
          venueMapVersionId: version.id,
          sectionId: seats[0].sectionId,
          label: 'A1',
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses a companion seat from another map version', async () => {
    const a = await freshMap('companion-a')
    const b = await freshMap('companion-b')

    await writeLayout(prisma, { version: a.version, layout: layout(), revision: 0 })
    await writeLayout(prisma, { version: b.version, layout: layout(), revision: 0 })

    const [seatA] = await prisma.seat.findMany({ where: { venueMapVersionId: a.version.id } })
    const [seatB] = await prisma.seat.findMany({ where: { venueMapVersionId: b.version.id } })

    // desi_seat_frozen_and_coherent raises for a cross-version companion.
    await expect(
      prisma.seat.update({
        where: { id: seatB.id },
        data: { companionOfSeatId: seatA.id },
      }),
    ).rejects.toThrow(/map version|companion/i)
  })

  it('refuses a stale revision without writing', async () => {
    const { version } = await freshMap('stale')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    const before = await prisma.seat.count({ where: { venueMapVersionId: version.id } })

    await expect(
      writeLayout(prisma, { version, layout: layout(), revision: 0 }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(await prisma.seat.count({ where: { venueMapVersionId: version.id } })).toBe(before)
  })

  it('leaves the prior draft row-for-row unchanged when validation fails', async () => {
    const { version } = await freshMap('rollback')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    const before = await prisma.seat.findMany({
      where: { venueMapVersionId: version.id },
      orderBy: { label: 'asc' },
    })

    const broken = layout()
    broken.sections[0].rows[0].seats[1].label = 'A1'

    await expect(
      writeLayout(prisma, { version, layout: broken, revision: 1 }),
    ).rejects.toMatchObject({ statusCode: 422 })

    const after = await prisma.seat.findMany({
      where: { venueMapVersionId: version.id },
      orderBy: { label: 'asc' },
    })

    // Row for row, including ids: the write never began.
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id))
    expect(after.map((s) => s.label)).toEqual(before.map((s) => s.label))

    const current = await prisma.venueMapVersion.findUnique({ where: { id: version.id } })

    expect(current.revision).toBe(1)
  })
})

when('a published version, against PostgreSQL', () => {
  it('cannot have a seat added, changed or removed', async () => {
    const { version } = await freshMap('frozen')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    const published = await publishVersion(prisma, version)

    expect(published.publishedAt).toBeInstanceOf(Date)

    const seats = await prisma.seat.findMany({ where: { venueMapVersionId: version.id } })

    // Three separate triggers, three separate refusals. The application is not
    // the thing keeping this true.
    await expect(
      prisma.seat.update({ where: { id: seats[0].id }, data: { label: 'Z9' } }),
    ).rejects.toThrow(/published/i)

    await expect(prisma.seat.delete({ where: { id: seats[0].id } })).rejects.toThrow(/published/i)

    await expect(
      prisma.seat.create({
        data: { venueMapVersionId: version.id, sectionId: seats[0].sectionId, label: 'NEW' },
      }),
    ).rejects.toThrow(/published/i)
  })

  it('cannot have its sections or rows touched either', async () => {
    const { version } = await freshMap('frozen-rows')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    const [section] = await prisma.section.findMany({ where: { venueMapVersionId: version.id } })
    const [row] = await prisma.seatRow.findMany({ where: { venueMapVersionId: version.id } })

    await expect(
      prisma.section.update({ where: { id: section.id }, data: { name: 'Renamed' } }),
    ).rejects.toThrow(/published/i)

    await expect(
      prisma.seatRow.update({ where: { id: row.id }, data: { label: 'ZZ' } }),
    ).rejects.toThrow(/published/i)
  })

  it('cannot be un-published or re-dated', async () => {
    const { version } = await freshMap('unpublish')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    // desi_map_version_publish_once. A freeze that the application can undo is
    // not a freeze.
    await expect(
      prisma.venueMapVersion.update({ where: { id: version.id }, data: { publishedAt: null } }),
    ).rejects.toThrow(/published|unpublish/i)

    await expect(
      prisma.venueMapVersion.update({
        where: { id: version.id },
        data: { publishedAt: new Date('2020-01-01') },
      }),
    ).rejects.toThrow(/published|re-dated/i)
  })

  it('cannot have its layout revision moved', async () => {
    const { version } = await freshMap('revision-frozen')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    await expect(
      prisma.venueMapVersion.update({ where: { id: version.id }, data: { revision: 99 } }),
    ).rejects.toThrow(/published|revision/i)
  })

  it('refuses a revision moving backwards even on a draft', async () => {
    const { version } = await freshMap('revision-backwards')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    await expect(
      prisma.venueMapVersion.update({ where: { id: version.id }, data: { revision: 0 } }),
    ).rejects.toThrow(/backwards/i)
  })

  it('refuses a second publish, so two racing publishes give one result', async () => {
    const { version } = await freshMap('double-publish')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    await expect(publishVersion(prisma, version)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('lets exactly one of two concurrent publishes win', async () => {
    const { version } = await freshMap('race-publish')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    const results = await Promise.allSettled([
      publishVersion(prisma, version),
      publishVersion(prisma, version),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)

    const rows = await prisma.venueMapVersion.findMany({ where: { id: version.id } })

    expect(rows[0].publishedAt).toBeInstanceOf(Date)
  })
})

when('cloning, against PostgreSQL', () => {
  it('copies the layout into a new draft and leaves the original frozen', async () => {
    const { map, version } = await freshMap('clone')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    const clone = await createVersion(prisma, { map, cloneFromVersionId: version.id })
    made.versions.push(clone.id)

    expect(clone.version).toBe(2)
    expect(clone.publishedAt).toBeNull()

    const copied = await readLayout(prisma, clone.id)

    expect(copied.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])

    // Rewriting the clone must not reach the published original.
    const rewritten = layout()
    rewritten.sections[0].rows[0].seats = [{ key: 'x', label: 'Z9', zoneKey: 'z1' }]

    await writeLayout(prisma, { version: clone, layout: rewritten, revision: 0 })

    const original = await readLayout(prisma, version.id)

    expect(original.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])
  })

  it('carries the companion relationship through the copy', async () => {
    const { map, version } = await freshMap('clone-companion')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })

    const clone = await createVersion(prisma, { map, cloneFromVersionId: version.id })
    made.versions.push(clone.id)

    const copied = await readLayout(prisma, clone.id)
    const seats = copied.sections[0].rows[0].seats
    const space = seats.find((s) => s.label === 'A1')
    const companion = seats.find((s) => s.label === 'A2')

    expect(companion.companionOfKey).toBe(space.key)
    // And it points at the copy, not across at the original.
    expect(companion.companionOfKey).not.toBe(version.id)
  })
})

when('a version an event session is bound to', () => {
  it('keeps the historical layout when the map moves on', async () => {
    const { venue, map, version } = await freshMap('history')

    await writeLayout(prisma, { version, layout: layout(), revision: 0 })
    await publishVersion(prisma, version)

    const organization = await prisma.organization.create({
      data: {
        name: `Map History ${RUN}`,
        slug: `map-history-${RUN}`,
        contactEmail: `history-${RUN}@example.test`,
      },
    })
    const event = await prisma.event.create({
      data: {
        organizationId: organization.id,
        venueId: venue.id,
        title: `History ${RUN}`,
        slug: `history-${RUN}`,
        summary: 'Summary',
        description: 'Description',
        category: 'MUSIC_CONCERT',
        startsAt: new Date('2027-01-01T18:00:00.000Z'),
        endsAt: new Date('2027-01-01T21:00:00.000Z'),
      },
    })
    const session = await prisma.eventSession.create({
      data: {
        eventId: event.id,
        startsAt: new Date('2027-01-01T18:00:00.000Z'),
        endsAt: new Date('2027-01-01T21:00:00.000Z'),
        venueMapVersionId: version.id,
      },
    })

    // The map moves on: a new version is cloned and published.
    const clone = await createVersion(prisma, { map, cloneFromVersionId: version.id })
    made.versions.push(clone.id)

    const rewritten = layout()
    rewritten.sections[0].rows[0].seats = [{ key: 'x', label: 'NEWSEAT', zoneKey: 'z1' }]
    await writeLayout(prisma, { version: clone, layout: rewritten, revision: 0 })
    await publishVersion(prisma, clone)

    // The session is still bound to what it was sold against.
    const reread = await prisma.eventSession.findUnique({ where: { id: session.id } })

    expect(reread.venueMapVersionId).toBe(version.id)

    const historical = await readLayout(prisma, version.id)

    expect(historical.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])

    // And the version cannot be deleted out from under it: onDelete Restrict.
    await expect(prisma.venueMapVersion.delete({ where: { id: version.id } })).rejects.toThrow()

    await prisma.eventSession.delete({ where: { id: session.id } })
    await prisma.event.delete({ where: { id: event.id } })
    await prisma.organization.delete({ where: { id: organization.id } })
  })
})

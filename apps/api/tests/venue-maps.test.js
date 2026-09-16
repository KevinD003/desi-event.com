/**
 * Seating-map authoring, attacked.
 *
 * The requirements this file exists to hold are all about what must *not*
 * happen, so almost every test here tries to make it happen:
 *
 *   - a rejected layout must leave the previous draft exactly as it was
 *   - a published version must be unchangeable, and un-publishable
 *   - a version somebody has sold against must be untouchable
 *   - two authors must not silently overwrite each other
 *   - two publishes must produce one published version
 *   - an organiser must not author maps for a venue they merely use
 *   - a generic PATCH must not be able to publish anything
 *
 * @module @desi-event/api/tests/venue-maps
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

const MANAGER = 'venues@rangoli.example'

/**
 * A harness whose organisation owns a venue and has an EVENT_MANAGER.
 *
 * @returns {Promise<object>} The harness, plus the owned venue's id.
 */
async function createMapApp() {
  const world = await makeWorld()
  const { seed, ids } = world
  const template = seed.user.find((row) => row.email === 'arun@rangoli.example')
  const manager = { ...template, id: cuid(), email: MANAGER }

  seed.user.push(manager)
  seed.membership.push({
    id: cuid(),
    userId: manager.id,
    organizationId: ids.organization.id,
    role: 'EVENT_MANAGER',
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
  })

  // seed.venue[1] becomes the organisation's own; seed.venue[0] stays shared.
  seed.venue[1].organizationId = ids.organization.id

  const harness = await createTestApp({ seed, ids })

  return { ...harness, ownedVenueId: seed.venue[1].id, sharedVenueId: seed.venue[0].id }
}

/** A small, valid layout: one zone, one section, one row, two seats. */
function layout(revision = 0) {
  return {
    revision,
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
              { key: 'a1', label: 'A1', sortOrder: 0, zoneKey: 'z1' },
              { key: 'a2', label: 'A2', sortOrder: 1, zoneKey: 'z1' },
            ],
          },
        ],
      },
    ],
  }
}

/**
 * Create a map and return its first draft version id.
 *
 * @param {object} app The Fastify instance.
 * @param {object} headers Auth headers.
 * @param {string} venueId The venue.
 * @returns {Promise<{mapId: string, versionId: string}>} The ids.
 */
async function createMap(app, headers, venueId) {
  const response = await app.inject({
    method: 'POST',
    url: `/v1/venues/${venueId}/maps`,
    headers,
    payload: { name: 'End stage' },
  })

  expect(response.statusCode, response.body).toBe(201)

  const map = response.json().data

  return { mapId: map.id, versionId: map.versions[0].id }
}

describe('creating a map', () => {
  it('creates the map and its first draft together', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ownedVenueId}/maps`,
      headers,
      payload: { name: 'End stage', notes: 'Standard rig' },
    })

    expect(response.statusCode).toBe(201)
    // A map with no version is not yet anything.
    expect(response.json().data.versions).toHaveLength(1)
    expect(response.json().data.versions[0]).toMatchObject({
      version: 1,
      revision: 0,
      publishedAt: null,
    })

    await app.close()
  })

  it('refuses an organiser authoring maps for a shared venue they merely use', async () => {
    // The sharp end of the shared-venue rule: an organiser can put an event in
    // this hall and must not be able to renumber its stalls for everybody else
    // listed there.
    const { app, sharedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${sharedVenueId}/maps`,
      headers,
      payload: { name: 'Mine now' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a member of another organisation', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ownedVenueId}/maps`,
      headers,
      payload: { name: 'Theirs' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app, ownedVenueId } = await createMapApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ownedVenueId}/maps`,
      payload: { name: 'Anon' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a second map with the same name on one venue', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))

    await createMap(app, headers, ownedVenueId)

    const again = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ownedVenueId}/maps`,
      headers,
      payload: { name: 'End stage' },
    })

    expect(again.statusCode).toBe(409)

    await app.close()
  })
})

describe('authoring a draft layout', () => {
  it('writes the whole graph and bumps the revision', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ revision: 1, seatCount: 2 })
    expect(response.json().data.layout.sections[0].rows[0].seats).toHaveLength(2)

    await app.close()
  })

  it('reads back in the same shape it accepts', async () => {
    // An editor that has to translate between a read shape and a write shape is
    // where drafts get corrupted.
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    const read = await app.inject({
      method: 'GET',
      url: `/v1/venue-map-versions/${versionId}`,
      headers,
    })

    const document = read.json().data.layout

    expect(document.sections[0].name).toBe('Stalls')
    expect(document.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])
    expect(document.zones[0].name).toBe('Stalls')

    await app.close()
  })

  it('writes nothing at all when the layout is invalid', async () => {
    // The requirement in one test: a failed validation leaves the previous
    // draft row-for-row unchanged.
    const { app, prisma, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    const before = {
      seats: prisma._store.seat.map((s) => ({ ...s })),
      rows: prisma._store.seatRow.map((r) => ({ ...r })),
      sections: prisma._store.section.map((s) => ({ ...s })),
      zones: prisma._store.priceZone.map((z) => ({ ...z })),
      revision: prisma._store.venueMapVersion.find((v) => v.id === versionId).revision,
    }

    const broken = layout(1)
    broken.sections[0].rows[0].seats[1].label = 'A1' // duplicate label
    broken.sections[0].rows[0].seats[0].zoneKey = 'z-nope' // dangling zone

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: broken,
    })

    expect(response.statusCode).toBe(422)

    const after = {
      seats: prisma._store.seat,
      rows: prisma._store.seatRow,
      sections: prisma._store.section,
      zones: prisma._store.priceZone,
      revision: prisma._store.venueMapVersion.find((v) => v.id === versionId).revision,
    }

    expect(after.seats).toEqual(before.seats)
    expect(after.rows).toEqual(before.rows)
    expect(after.sections).toEqual(before.sections)
    expect(after.zones).toEqual(before.zones)
    // Not even the revision moved: the write never began.
    expect(after.revision).toBe(before.revision)

    await app.close()
  })

  it('names every problem so an editor can link to each one', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const broken = layout(0)
    broken.sections[0].rows[0].seats[1].label = 'A1'
    broken.sections[0].rows[0].seats[0].zoneKey = 'z-nope'

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: broken,
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toMatch(/previous draft is untouched/)

    await app.close()
  })

  it('refuses a write quoting a stale revision, and says what the current one is', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    // Somebody else's editor still believes revision 0.
    const stale = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.message).toMatch(/revision 0, it is now 1/)
    expect(stale.json().error.message).toMatch(/nothing of yours has been saved/)

    await app.close()
  })

  it('lets only one of two concurrent writes land', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const write = () =>
      app.inject({
        method: 'PUT',
        url: `/v1/venue-map-versions/${versionId}/layout`,
        headers,
        payload: layout(0),
      })

    const [first, second] = await Promise.all([write(), write()])

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409])

    await app.close()
  })

  it('refuses an organiser from another organisation', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const rival = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers: rival,
      payload: layout(0),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('rejects a companion seat pointing across a section boundary', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const body = layout(0)
    body.sections[0].rows[0].seats[0].accessible = true
    body.sections.push({
      key: 's2',
      name: 'Circle',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [
        {
          key: 'r2',
          label: 'A',
          seats: [{ key: 'c1', label: 'C1', companionOfKey: 'a1', zoneKey: 'z1' }],
        },
      ],
    })

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: body,
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('stores an accessible seat with its companion when the pair is coherent', async () => {
    const { app, prisma, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const body = layout(0)
    body.sections[0].rows[0].seats[0].accessible = true
    body.sections[0].rows[0].seats[1].companionOfKey = 'a1'

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: body,
    })

    expect(response.statusCode).toBe(200)

    const seats = prisma._store.seat.filter((s) => s.venueMapVersionId === versionId)
    const space = seats.find((s) => s.label === 'A1')
    const companion = seats.find((s) => s.label === 'A2')

    expect(space.accessible).toBe(true)
    // The link is stored as a real reference, not as a label convention.
    expect(companion.companionOfSeatId).toBe(space.id)

    await app.close()
  })
})

describe('publishing', () => {
  /**
   * Author a valid layout and return the ids.
   *
   * @param {object} app The instance.
   * @param {object} headers Auth headers.
   * @param {string} venueId The venue.
   * @returns {Promise<object>} The ids.
   */
  async function authored(app, headers, venueId) {
    const { mapId, versionId } = await createMap(app, headers, venueId)

    const write = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    expect(write.statusCode, write.body).toBe(200)

    return { mapId, versionId }
  }

  it('publishes a draft and freezes its seat count', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.publishedAt).toBeTruthy()
    expect(response.json().data.seatCount).toBe(2)

    await app.close()
  })

  it('refuses to publish a version with nothing in it', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('makes a published version immutable', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(1),
    })

    expect(edit.statusCode).toBe(409)
    expect(edit.json().error.message).toMatch(/cannot be changed/)
    // And it says what to do instead, rather than leaving a dead end.
    expect(edit.json().error.message).toMatch(/new version/)

    await app.close()
  })

  it('lets only one of two concurrent publishes win', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    const publish = () =>
      app.inject({ method: 'POST', url: `/v1/venue-map-versions/${versionId}/publish`, headers })

    const [first, second] = await Promise.all([publish(), publish()])

    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409])

    await app.close()
  })

  it('refuses a second publish of the same version', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    const again = await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    expect(again.statusCode).toBe(409)

    await app.close()
  })

  it('refuses an organiser from another organisation', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    const rival = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers: rival,
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('cannot be reached by a venue PATCH', async () => {
    // Publication is an explicit transition. A generic update must not be able
    // to perform it, directly or by carrying a field that means it.
    const { app, prisma, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await authored(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${ownedVenueId}`,
      headers,
      payload: { capacity: 500, publishedAt: new Date().toISOString(), publish: true },
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.venueMapVersion.find((v) => v.id === versionId).publishedAt).toBeNull()

    await app.close()
  })
})

describe('cloning a published version', () => {
  /**
   * Author and publish, returning the ids.
   *
   * @param {object} app The instance.
   * @param {object} headers Auth headers.
   * @param {string} venueId The venue.
   * @returns {Promise<object>} The ids.
   */
  async function published(app, headers, venueId) {
    const { mapId, versionId } = await createMap(app, headers, venueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })
    await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })

    return { mapId, versionId }
  }

  it('clones the layout into a fresh draft with a new number', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { mapId } = await published(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-maps/${mapId}/versions`,
      headers,
      payload: { cloneFromVersionId: undefined },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({ version: 2, publishedAt: null, revision: 0 })

    await app.close()
  })

  it('copies the seats when asked to clone', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { mapId, versionId } = await published(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-maps/${mapId}/versions`,
      headers,
      payload: { cloneFromVersionId: versionId },
    })

    expect(response.statusCode).toBe(201)

    const clone = response.json().data

    expect(clone.layout.sections[0].rows[0].seats.map((s) => s.label)).toEqual(['A1', 'A2'])
    // Fresh rows, not the originals: editing the clone must not touch history.
    expect(clone.layout.sections[0].key).not.toBe(versionId)

    await app.close()
  })

  it('leaves the published original untouched when the clone is edited', async () => {
    const { app, prisma, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { mapId, versionId } = await published(app, headers, ownedVenueId)

    const clone = (
      await app.inject({
        method: 'POST',
        url: `/v1/venue-maps/${mapId}/versions`,
        headers,
        payload: { cloneFromVersionId: versionId },
      })
    ).json().data

    const rewritten = layout(0)
    rewritten.sections[0].rows[0].seats = [{ key: 'x', label: 'Z9', zoneKey: 'z1' }]

    const edit = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${clone.id}/layout`,
      headers,
      payload: rewritten,
    })

    expect(edit.statusCode).toBe(200)

    const originalSeats = prisma._store.seat
      .filter((s) => s.venueMapVersionId === versionId)
      .map((s) => s.label)
      .sort()

    expect(originalSeats).toEqual(['A1', 'A2'])

    await app.close()
  })

  it('refuses to clone a version belonging to a different map', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await published(app, headers, ownedVenueId)

    const other = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ownedVenueId}/maps`,
      headers,
      payload: { name: 'In the round' },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-maps/${other.json().data.id}/versions`,
      headers,
      payload: { cloneFromVersionId: versionId },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('refuses to clone a version that does not exist', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { mapId } = await published(app, headers, ownedVenueId)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/venue-maps/${mapId}/versions`,
      headers,
      payload: { cloneFromVersionId: cuid() },
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })
})

describe('a version a session is using', () => {
  it('cannot have its layout rewritten', async () => {
    // This is what somebody bought a seat on.
    const { app, prisma, ownedVenueId, ids } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })

    prisma._store.eventSession.push({
      id: cuid(),
      eventId: prisma._store.event[0].id,
      name: 'Opening night',
      startsAt: new Date('2026-12-01T18:00:00.000Z'),
      endsAt: new Date('2026-12-01T21:00:00.000Z'),
      venueMapVersionId: versionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(1),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/somebody bought/)
    expect(ids).toBeDefined()

    await app.close()
  })

  it('is reported as in use, so an editor can grey it out', async () => {
    const { app, prisma, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { versionId } = await createMap(app, headers, ownedVenueId)

    prisma._store.eventSession.push({
      id: cuid(),
      eventId: prisma._store.event[0].id,
      name: 'Opening night',
      startsAt: new Date('2026-12-01T18:00:00.000Z'),
      endsAt: new Date('2026-12-01T21:00:00.000Z'),
      venueMapVersionId: versionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/venue-map-versions/${versionId}`,
      headers,
    })

    expect(response.json().data.inUse).toBe(true)

    await app.close()
  })
})

describe('listing maps and their history', () => {
  it('lists every version newest first, with its state', async () => {
    const { app, ownedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))
    const { mapId, versionId } = await createMap(app, headers, ownedVenueId)

    await app.inject({
      method: 'PUT',
      url: `/v1/venue-map-versions/${versionId}/layout`,
      headers,
      payload: layout(0),
    })
    await app.inject({
      method: 'POST',
      url: `/v1/venue-map-versions/${versionId}/publish`,
      headers,
    })
    await app.inject({
      method: 'POST',
      url: `/v1/venue-maps/${mapId}/versions`,
      headers,
      payload: { cloneFromVersionId: versionId },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/venues/${ownedVenueId}/maps`,
      headers,
    })

    const versions = response.json().data[0].versions

    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(versions[1].publishedAt).toBeTruthy()
    expect(versions[0].publishedAt).toBeNull()

    await app.close()
  })

  it('refuses to list maps for a venue the caller cannot author', async () => {
    const { app, sharedVenueId } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({
      method: 'GET',
      url: `/v1/venues/${sharedVenueId}/maps`,
      headers,
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('is not found for a venue that does not exist', async () => {
    const { app } = await createMapApp()
    const headers = bearer(await signIn(app, MANAGER))

    const response = await app.inject({ method: 'GET', url: `/v1/venues/${cuid()}/maps`, headers })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

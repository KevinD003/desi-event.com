/**
 * Seating-map authoring: drafts, publication, and the one-way door between them.
 *
 * The rules this module exists to hold, in the order they matter:
 *
 *   1. **A draft is written whole.** `writeLayout` validates the entire graph
 *      first and opens no transaction until it is coherent, so a rejected
 *      layout leaves the previous draft exactly as it was — not rolled back,
 *      never begun.
 *   2. **Publication is a one-way door.** It is its own operation, never a side
 *      effect of an update, and the database enforces the freeze with triggers
 *      rather than trusting this file. `desi_map_version_publish_once` refuses
 *      to un-publish or re-date; `desi_map_version_frozen` and
 *      `desi_seat_frozen_and_coherent` refuse to touch a published layout's
 *      rows at all.
 *   3. **History is never rewritten.** A published version that a session
 *      points at cannot be edited or deleted — `EventSession.venueMapVersionId`
 *      and `EventSeat.seatId` are both `onDelete: Restrict`, so an attendee's
 *      ticket cannot be orphaned by an organiser tidying a layout. Changing a
 *      published map means cloning it.
 *   4. **Two authors do not silently overwrite each other.** Every layout write
 *      quotes the revision it read, and a write whose precondition no longer
 *      holds is refused with the current revision so the editor can say what
 *      happened.
 *
 * @module @desi-event/api/lib/venue-maps
 */

import { validateLayout } from '@desi-event/inventory'

import { conflict, notFound, unprocessable } from './errors.js'

/**
 * Read a version's layout back in the shape the authoring PUT accepts.
 *
 * The same document goes out and comes back, so an editor is never translating
 * between a read shape and a write shape — which is where the mismatches that
 * corrupt a draft come from.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} versionId The version.
 * @returns {Promise<{zones: object[], sections: object[]}>} The layout document.
 */
export async function readLayout(db, versionId) {
  const [zones, sections, rows, seats] = await Promise.all([
    db.priceZone.findMany({
      where: { venueMapVersionId: versionId },
      orderBy: { sortOrder: 'asc' },
    }),
    db.section.findMany({ where: { venueMapVersionId: versionId }, orderBy: { sortOrder: 'asc' } }),
    db.seatRow.findMany({ where: { venueMapVersionId: versionId }, orderBy: { sortOrder: 'asc' } }),
    db.seat.findMany({ where: { venueMapVersionId: versionId }, orderBy: { sortOrder: 'asc' } }),
  ])

  // Keys are the database ids on the way out. They are opaque to the editor and
  // stable for as long as the draft is, which is exactly what a key is for.
  const zoneKeyById = new Map(zones.map((zone) => [zone.id, zone.id]))
  const seatsByRow = new Map()
  const looseBySection = new Map()

  for (const seat of seats) {
    const target = seat.rowId ? seatsByRow : looseBySection
    const groupKey = seat.rowId ?? seat.sectionId
    if (!target.has(groupKey)) target.set(groupKey, [])
    target.get(groupKey).push(seat)
  }

  /**
   * One seat in authoring shape.
   *
   * @param {object} seat A `Seat` row.
   * @returns {object} The authored seat.
   */
  const toSeat = (seat) => ({
    key: seat.id,
    label: seat.label,
    sortOrder: seat.sortOrder,
    zoneKey: seat.priceZoneId ? (zoneKeyById.get(seat.priceZoneId) ?? null) : null,
    accessible: seat.accessible,
    companionOfKey: seat.companionOfSeatId ?? null,
    obstructedView: seat.obstructedView,
    restricted: seat.restricted,
    restrictionNote: seat.restrictionNote ?? null,
  })

  return {
    zones: zones.map((zone) => ({
      key: zone.id,
      name: zone.name,
      colourToken: zone.colourToken,
      sortOrder: zone.sortOrder,
    })),
    sections: sections.map((section) => ({
      key: section.id,
      name: section.name,
      kind: section.kind,
      sortOrder: section.sortOrder,
      standingCapacity: section.standingCapacity ?? null,
      rows: rows
        .filter((row) => row.sectionId === section.id)
        .map((row) => ({
          key: row.id,
          label: row.label,
          sortOrder: row.sortOrder,
          seats: (seatsByRow.get(row.id) ?? []).map(toSeat),
        })),
      seats: (looseBySection.get(section.id) ?? []).map(toSeat),
    })),
  }
}

/**
 * Whether anything has been sold or scheduled against a version.
 *
 * A version a session points at is history, whatever its publication state.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} versionId The version.
 * @returns {Promise<boolean>} True when it is in use.
 */
export async function versionInUse(db, versionId) {
  return (await db.eventSession.count({ where: { venueMapVersionId: versionId } })) > 0
}

/**
 * Refuse a write to a version that must not change.
 *
 * Two separate reasons, kept separate because they mean different things to
 * whoever hits them: published means "clone it", in use means "this is what
 * somebody bought".
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {object} version The version row.
 * @returns {Promise<void>} Resolves when the version is editable.
 * @throws {Error} A 409 when it is not.
 */
export async function assertEditable(db, version) {
  if (version.publishedAt) {
    throw conflict(
      `This map version was published on ${version.publishedAt.toISOString().slice(0, 10)} and cannot be changed. ` +
        'Create a new version from it, edit that, and publish the copy.',
    )
  }

  if (await versionInUse(db, version.id)) {
    throw conflict(
      'A session is already using this map version, so its layout is what somebody bought a seat on. Clone it instead.',
    )
  }
}

/**
 * Replace a draft's layout, having first proved the whole graph is coherent.
 *
 * The ordering is the guarantee. Validation is a pure function over the payload
 * and runs before any transaction opens, so a layout that fails never touches a
 * row. Only once it is known good does the write begin, and that write is
 * conditional on the revision the caller quoted.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} params The write.
 * @param {object} params.version The version as read.
 * @param {object} params.layout The whole layout document.
 * @param {number} params.revision The revision the caller believes is current.
 * @returns {Promise<object>} The updated version row.
 * @throws {Error} A 422 when the layout is incoherent, a 409 when the revision is stale.
 */
export async function writeLayout(prisma, { version, layout, revision }) {
  // Before anything else, and outside any transaction: is this a map at all?
  const verdict = validateLayout(layout)

  if (!verdict.valid) {
    throw unprocessable(
      `This layout has ${verdict.issues.length} problem${verdict.issues.length === 1 ? '' : 's'}. ` +
        'Nothing has been saved; the previous draft is untouched.',
      { issues: verdict.issues },
    )
  }

  return prisma.$transaction(async (tx) => {
    // The precondition. Conditional on both the revision and the draft state,
    // so a version published between the read and the write is refused here
    // rather than by a trigger further down.
    const { count } = await tx.venueMapVersion.updateMany({
      where: { id: version.id, revision, publishedAt: null },
      data: { revision: revision + 1, seatCount: verdict.seatCount },
    })

    if (count !== 1) {
      const current = await tx.venueMapVersion.findUnique({ where: { id: version.id } })

      if (current?.publishedAt) {
        throw conflict(
          'This version was published while you were editing it. Clone it to carry on.',
        )
      }

      throw conflict(
        `This draft has moved on since you loaded it (you sent revision ${revision}, it is now ${current?.revision ?? 'gone'}). ` +
          'Reload to pick up the other changes; nothing of yours has been saved.',
        { currentRevision: current?.revision ?? null },
      )
    }

    // The old draft goes wholesale. Seats first: a row cannot be deleted while
    // a seat points at it, and `onDelete: Restrict` on EventSeat means a sold
    // seat refuses here, which is the protection working rather than failing.
    await tx.seat.deleteMany({ where: { venueMapVersionId: version.id } })
    await tx.seatRow.deleteMany({ where: { venueMapVersionId: version.id } })
    await tx.section.deleteMany({ where: { venueMapVersionId: version.id } })
    await tx.priceZone.deleteMany({ where: { venueMapVersionId: version.id } })

    await insertLayout(tx, version.id, layout)

    return tx.venueMapVersion.findUnique({ where: { id: version.id } })
  })
}

/**
 * Write a validated layout's rows, resolving keys to ids as it goes.
 *
 * Companions are applied in a second pass: a seat can only point at another
 * seat that already exists, and within one layout either order is possible.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {string} versionId The version to write into.
 * @param {object} layout The validated layout.
 * @returns {Promise<void>} Resolves once written.
 */
async function insertLayout(tx, versionId, layout) {
  const zoneIds = new Map()

  for (const zone of layout.zones ?? []) {
    const row = await tx.priceZone.create({
      data: {
        venueMapVersionId: versionId,
        name: zone.name,
        colourToken: zone.colourToken ?? 'zone-default',
        sortOrder: zone.sortOrder ?? 0,
      },
    })
    zoneIds.set(zone.key, row.id)
  }

  const seatIds = new Map()
  const companions = []

  for (const section of layout.sections) {
    const sectionRow = await tx.section.create({
      data: {
        venueMapVersionId: versionId,
        name: section.name,
        kind: section.kind ?? 'SEATED',
        sortOrder: section.sortOrder ?? 0,
        standingCapacity: section.standingCapacity ?? null,
      },
    })

    /**
     * Create one seat and remember its id against its key.
     *
     * @param {object} seat The authored seat.
     * @param {string|null} rowId The row it belongs to, when it has one.
     * @returns {Promise<void>} Resolves once created.
     */
    const createSeat = async (seat, rowId) => {
      const created = await tx.seat.create({
        data: {
          venueMapVersionId: versionId,
          sectionId: sectionRow.id,
          rowId,
          label: seat.label,
          sortOrder: seat.sortOrder ?? 0,
          priceZoneId: seat.zoneKey ? (zoneIds.get(seat.zoneKey) ?? null) : null,
          accessible: seat.accessible ?? false,
          obstructedView: seat.obstructedView ?? false,
          restricted: seat.restricted ?? false,
          restrictionNote: seat.restrictionNote ?? null,
        },
      })

      seatIds.set(seat.key, created.id)
      if (seat.companionOfKey) companions.push([created.id, seat.companionOfKey])
    }

    for (const row of section.rows ?? []) {
      const rowRow = await tx.seatRow.create({
        data: {
          venueMapVersionId: versionId,
          sectionId: sectionRow.id,
          label: row.label,
          sortOrder: row.sortOrder ?? 0,
        },
      })

      for (const seat of row.seats ?? []) await createSeat(seat, rowRow.id)
    }

    for (const seat of section.seats ?? []) await createSeat(seat, null)
  }

  for (const [seatId, companionKey] of companions) {
    await tx.seat.update({
      where: { id: seatId },
      data: { companionOfSeatId: seatIds.get(companionKey) ?? null },
    })
  }
}

/**
 * Start a new draft version of a map, optionally copying an existing one.
 *
 * Cloning is how a published map is changed. The copy is a fresh draft with
 * fresh ids; everything already bound to the source version stays bound to it,
 * which is what keeps an attendee's ticket pointing at the layout they actually
 * chose a seat on.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} params The request.
 * @param {object} params.map The `VenueMap` row.
 * @param {string|null} [params.cloneFromVersionId] The version to copy.
 * @returns {Promise<object>} The new version row.
 * @throws {Error} A 422 when the source version belongs to another map.
 */
export async function createVersion(prisma, { map, cloneFromVersionId = null }) {
  const source = cloneFromVersionId
    ? await prisma.venueMapVersion.findUnique({ where: { id: cloneFromVersionId } })
    : null

  if (cloneFromVersionId && !source) {
    throw unprocessable('There is no such map version to copy.')
  }

  if (source && source.venueMapId !== map.id) {
    // Cloning across maps would carry one hall's layout into another's history.
    throw unprocessable('That map version belongs to a different map.')
  }

  const layout = source ? await readLayout(prisma, source.id) : null

  return prisma.$transaction(async (tx) => {
    const highest = await tx.venueMapVersion.findFirst({
      where: { venueMapId: map.id },
      orderBy: { version: 'desc' },
    })

    const version = await tx.venueMapVersion.create({
      data: {
        venueMapId: map.id,
        version: (highest?.version ?? 0) + 1,
        seatCount: source?.seatCount ?? 0,
      },
    })

    if (layout) await insertLayout(tx, version.id, layout)

    return tx.venueMapVersion.findUnique({ where: { id: version.id } })
  })
}

/**
 * Publish a draft, which freezes it for good.
 *
 * Conditional on the version still being a draft, so two simultaneous publishes
 * produce one published version and one 409 rather than two publications of
 * different seat counts.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} version The version as read.
 * @param {Date} [now] The instant.
 * @returns {Promise<object>} The published version.
 * @throws {Error} A 422 for an empty layout, a 409 when somebody else published first.
 */
export async function publishVersion(prisma, version, now = new Date()) {
  const seatCount = await prisma.seat.count({ where: { venueMapVersionId: version.id } })
  const sections = await prisma.section.count({ where: { venueMapVersionId: version.id } })

  if (sections === 0) {
    throw unprocessable('There is nothing in this version to publish. Author a layout first.')
  }

  const { count } = await prisma.venueMapVersion.updateMany({
    where: { id: version.id, publishedAt: null },
    data: { publishedAt: now, seatCount },
  })

  if (count !== 1) {
    throw conflict('This version has already been published.')
  }

  return prisma.venueMapVersion.findUnique({ where: { id: version.id } })
}

/**
 * Load a map version with the map and venue behind it, or 404.
 *
 * @param {object} prisma The Prisma client.
 * @param {string} versionId The version.
 * @returns {Promise<{version: object, map: object, venue: object}>} The chain.
 * @throws {Error} A 404 when any link is missing.
 */
export async function loadVersionChain(prisma, versionId) {
  const version = await prisma.venueMapVersion.findUnique({ where: { id: versionId } })

  if (!version) throw notFound('No such map version.')

  const map = await prisma.venueMap.findUnique({ where: { id: version.venueMapId } })

  if (!map) throw notFound('No such map version.')

  const venue = await prisma.venue.findUnique({ where: { id: map.venueId } })

  if (!venue) throw notFound('No such map version.')

  return { version, map, venue }
}

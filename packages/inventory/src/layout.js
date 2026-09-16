/**
 * Validating a whole seating layout before any of it is written.
 *
 * A seating map is one artefact. Half a map is not a smaller map, it is a
 * broken one: a row whose section was rejected, a companion seat whose partner
 * never landed, a price zone three hundred seats point at that does not exist.
 * So the authoring API takes the entire draft in one request, and this module
 * answers one question about it — is this graph coherent — before the first row
 * is touched.
 *
 * That ordering is the whole design. Validation is a pure function over the
 * payload: no database, no transaction, no partial application. A layout that
 * fails here never reaches a write, which is what makes "a failed validation
 * leaves the previous draft exactly as it was" true by construction rather than
 * by careful rollback.
 *
 * References inside the payload are by **key**, a caller-supplied string that is
 * stable only within one request. Database ids are minted on write. The reason
 * is that a draft is replaced wholesale, so the ids of the previous draft are
 * not the author's to reuse — and a payload that carried database ids would let
 * a caller point a seat at a row in somebody else's map, which is exactly the
 * cross-map reference this module refuses.
 *
 * @module @desi-event/inventory/layout
 */

/** Section kinds, mirroring the Prisma enum. */
export const SECTION_KINDS = Object.freeze(['SEATED', 'STANDING', 'TABLE'])

/** Kinds whose capacity is a count of seats rather than a number somebody typed. */
const SEATED_KINDS = Object.freeze(['SEATED', 'TABLE'])

/**
 * Every way a layout can be wrong.
 *
 * Codes rather than sentences, so the editor can link each one to the thing it
 * is about. The message is for a person; the code is for the screen.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LAYOUT_ISSUES = Object.freeze({
  DUPLICATE_SECTION_KEY: 'Two sections share a key.',
  DUPLICATE_SECTION_NAME: 'Two sections share a name.',
  DUPLICATE_ROW_KEY: 'Two rows share a key.',
  DUPLICATE_ROW_LABEL: 'Two rows in the same section share a label.',
  DUPLICATE_SEAT_KEY: 'Two seats share a key.',
  DUPLICATE_SEAT_LABEL: 'Two seats in this map share a label.',
  DUPLICATE_ZONE_KEY: 'Two price zones share a key.',
  DUPLICATE_ZONE_NAME: 'Two price zones share a name.',
  UNKNOWN_ZONE: 'A seat points at a price zone this layout does not declare.',
  UNKNOWN_SECTION: 'A row or seat points at a section this layout does not declare.',
  UNKNOWN_ROW: 'A seat points at a row this layout does not declare.',
  ROW_SECTION_MISMATCH: 'A seat is in a row that belongs to a different section.',
  UNKNOWN_COMPANION: 'A companion seat points at a seat this layout does not declare.',
  COMPANION_SELF: 'A seat is its own companion.',
  COMPANION_CROSS_SECTION: 'A companion seat is in a different section from the seat it serves.',
  COMPANION_CYCLE: 'Companion seats point at each other in a loop.',
  COMPANION_SHARED: 'Two seats claim the same companion.',
  COMPANION_NOT_ACCESSIBLE:
    'A companion seat is attached to a seat that is not an accessible space.',
  COMPANION_CHAIN: 'A companion seat has a companion of its own.',
  STANDING_HAS_SEATS: 'A standing section has numbered seats.',
  STANDING_NEEDS_CAPACITY: 'A standing section has no capacity.',
  SEATED_NEEDS_SEATS: 'A seated section has no seats.',
  SEATED_HAS_CAPACITY: 'A seated section carries a standing capacity.',
  EMPTY_LAYOUT: 'A layout with no sections is not a layout.',
  RESTRICTION_NEEDS_NOTE: 'A restricted seat does not say why.',
})

/**
 * One problem with a layout.
 *
 * @typedef {object} LayoutIssue
 * @property {string} code One of {@link LAYOUT_ISSUES}.
 * @property {string} message What is wrong, in a sentence.
 * @property {string} path Where, as a dotted path into the payload.
 * @property {string|null} key The key of the offending entity, so an editor can focus it.
 */

/**
 * Collect the issues in a layout.
 *
 * Every rule is checked and every violation reported, rather than stopping at
 * the first: an author who has made four mistakes should be told about four
 * mistakes, not led through four round trips.
 *
 * @param {object} layout The whole draft: `{ zones, sections }`.
 * @returns {{valid: boolean, issues: LayoutIssue[], seatCount: number}} The verdict.
 */
export function validateLayout(layout) {
  /** @type {LayoutIssue[]} */
  const issues = []

  /**
   * Record a problem.
   *
   * @param {string} code The issue code.
   * @param {string} path Where in the payload.
   * @param {string|null} [key] The offending entity's key.
   * @param {string} [detail] Extra context appended to the standard message.
   * @returns {void}
   */
  const fail = (code, path, key = null, detail = '') => {
    issues.push({ code, message: LAYOUT_ISSUES[code] + (detail ? ` ${detail}` : ''), path, key })
  }

  const zones = layout?.zones ?? []
  const sections = layout?.sections ?? []

  if (sections.length === 0) fail('EMPTY_LAYOUT', 'sections')

  // --- price zones ------------------------------------------------------
  const zoneKeys = new Set()
  const zoneNames = new Set()

  zones.forEach((zone, index) => {
    if (zoneKeys.has(zone.key)) fail('DUPLICATE_ZONE_KEY', `zones[${index}].key`, zone.key)
    zoneKeys.add(zone.key)

    const name = normalise(zone.name)
    if (zoneNames.has(name)) fail('DUPLICATE_ZONE_NAME', `zones[${index}].name`, zone.key)
    zoneNames.add(name)
  })

  // --- sections, rows and seats -----------------------------------------
  const sectionKeys = new Set()
  const sectionNames = new Set()
  /** Every seat in the layout, indexed by key, with the section it sits in. */
  const seatsByKey = new Map()
  const seatLabels = new Set()
  const rowKeys = new Set()
  let seatCount = 0

  sections.forEach((section, sIndex) => {
    const sPath = `sections[${sIndex}]`

    if (sectionKeys.has(section.key)) fail('DUPLICATE_SECTION_KEY', `${sPath}.key`, section.key)
    sectionKeys.add(section.key)

    const sName = normalise(section.name)
    if (sectionNames.has(sName)) fail('DUPLICATE_SECTION_NAME', `${sPath}.name`, section.key)
    sectionNames.add(sName)

    const rows = section.rows ?? []
    const loose = section.seats ?? []
    const rowLabels = new Set()

    rows.forEach((row, rIndex) => {
      const rPath = `${sPath}.rows[${rIndex}]`

      if (rowKeys.has(row.key)) fail('DUPLICATE_ROW_KEY', `${rPath}.key`, row.key)
      rowKeys.add(row.key)

      const label = normalise(row.label)
      if (rowLabels.has(label)) fail('DUPLICATE_ROW_LABEL', `${rPath}.label`, row.key)
      rowLabels.add(label)

      ;(row.seats ?? []).forEach((seat, seatIndex) => {
        seatCount += 1
        recordSeat(seat, `${rPath}.seats[${seatIndex}]`, section, row)
      })
    })

    loose.forEach((seat, seatIndex) => {
      seatCount += 1
      recordSeat(seat, `${sPath}.seats[${seatIndex}]`, section, null)
    })

    // --- shape rules per kind -------------------------------------------
    const ownSeats = rows.reduce((total, row) => total + (row.seats ?? []).length, 0) + loose.length

    if (section.kind === 'STANDING') {
      if (ownSeats > 0) fail('STANDING_HAS_SEATS', `${sPath}.seats`, section.key)
      if (!(section.standingCapacity > 0)) {
        fail('STANDING_NEEDS_CAPACITY', `${sPath}.standingCapacity`, section.key)
      }
    }

    if (SEATED_KINDS.includes(section.kind)) {
      if (ownSeats === 0) fail('SEATED_NEEDS_SEATS', `${sPath}.seats`, section.key)
      if (section.standingCapacity !== null && section.standingCapacity !== undefined) {
        fail('SEATED_HAS_CAPACITY', `${sPath}.standingCapacity`, section.key)
      }
    }
  })

  /**
   * Index one seat and check everything about it that does not need the others.
   *
   * @param {object} seat The seat.
   * @param {string} path Where it is.
   * @param {object} section Its section.
   * @param {object|null} row Its row, when it has one.
   * @returns {void}
   */
  function recordSeat(seat, path, section, row) {
    if (seatsByKey.has(seat.key)) fail('DUPLICATE_SEAT_KEY', `${path}.key`, seat.key)

    const label = normalise(seat.label)
    // Unique across the whole version, not per section: this mirrors
    // `@@unique([venueMapVersionId, label])`, and a duplicate here would be a
    // constraint violation reported as a 500 rather than a 422 that says which
    // seat.
    if (seatLabels.has(label)) fail('DUPLICATE_SEAT_LABEL', `${path}.label`, seat.key)
    seatLabels.add(label)

    if (seat.restricted && !normalise(seat.restrictionNote)) {
      fail('RESTRICTION_NEEDS_NOTE', `${path}.restrictionNote`, seat.key)
    }

    seatsByKey.set(seat.key, { seat, section, row, path })
  }

  // --- cross-references, once everything is indexed ---------------------
  for (const { seat, section, row, path } of seatsByKey.values()) {
    if (seat.zoneKey != null && !zoneKeys.has(seat.zoneKey)) {
      fail('UNKNOWN_ZONE', `${path}.zoneKey`, seat.key, `Zone "${seat.zoneKey}" is not declared.`)
    }

    // A seat naming a row it is not nested under, or a section that is not its
    // own, is the cross-map reference this shape exists to make impossible.
    if (seat.rowKey != null) {
      if (!rowKeys.has(seat.rowKey)) {
        fail('UNKNOWN_ROW', `${path}.rowKey`, seat.key, `Row "${seat.rowKey}" is not declared.`)
      } else if (row && seat.rowKey !== row.key) {
        fail('ROW_SECTION_MISMATCH', `${path}.rowKey`, seat.key)
      }
    }

    if (seat.sectionKey != null && seat.sectionKey !== section.key) {
      if (!sectionKeys.has(seat.sectionKey)) {
        fail(
          'UNKNOWN_SECTION',
          `${path}.sectionKey`,
          seat.key,
          `Section "${seat.sectionKey}" is not declared.`,
        )
      } else {
        fail('ROW_SECTION_MISMATCH', `${path}.sectionKey`, seat.key)
      }
    }
  }

  // --- companions -------------------------------------------------------
  const claimed = new Map()

  for (const { seat, section, path } of seatsByKey.values()) {
    const target = seat.companionOfKey

    if (target == null) continue

    if (target === seat.key) {
      fail('COMPANION_SELF', `${path}.companionOfKey`, seat.key)
      continue
    }

    const partner = seatsByKey.get(target)

    if (!partner) {
      fail(
        'UNKNOWN_COMPANION',
        `${path}.companionOfKey`,
        seat.key,
        `Seat "${target}" is not declared.`,
      )
      continue
    }

    if (partner.section.key !== section.key) {
      // A wheelchair user separated from their carer by a section boundary is
      // the exact outcome the companion relationship exists to prevent.
      fail('COMPANION_CROSS_SECTION', `${path}.companionOfKey`, seat.key)
    }

    if (!partner.seat.accessible) {
      fail('COMPANION_NOT_ACCESSIBLE', `${path}.companionOfKey`, seat.key)
    }

    if (partner.seat.companionOfKey != null) {
      // `companionOfSeatId` is `@unique`, so a chain is a constraint violation
      // waiting to happen; it is also meaningless — a companion of a companion
      // is just another seat.
      fail('COMPANION_CHAIN', `${path}.companionOfKey`, seat.key)
    }

    if (claimed.has(target)) {
      fail(
        'COMPANION_SHARED',
        `${path}.companionOfKey`,
        seat.key,
        `Seat "${target}" is already served.`,
      )
    }
    claimed.set(target, seat.key)
  }

  for (const cycle of companionCycles(seatsByKey)) {
    fail(
      'COMPANION_CYCLE',
      `seats.${cycle[0]}.companionOfKey`,
      cycle[0],
      `Loop: ${cycle.join(' -> ')}.`,
    )
  }

  return { valid: issues.length === 0, issues, seatCount }
}

/**
 * Trim and case-fold a label for comparison.
 *
 * "Row A" and "row a" are the same row to everybody except a string comparison,
 * and a map with both in it is one an usher cannot read.
 *
 * @param {unknown} value The label.
 * @returns {string} The normalised form.
 */
function normalise(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Every cycle in the companion graph.
 *
 * Reported as the loop itself rather than as "a cycle exists", for the same
 * reason the role-inheritance check reports its loop: an author told there is a
 * cycle somewhere in four hundred seats has been told nothing.
 *
 * @param {Map<string, object>} seatsByKey Every seat, by key.
 * @returns {string[][]} Each cycle, as the keys around it.
 */
function companionCycles(seatsByKey) {
  const cycles = []
  const settled = new Set()

  for (const key of seatsByKey.keys()) {
    if (settled.has(key)) continue

    const path = []
    const onPath = new Map()
    let current = key

    while (current != null && !settled.has(current)) {
      if (onPath.has(current)) {
        cycles.push([...path.slice(onPath.get(current)), current])
        break
      }

      onPath.set(current, path.length)
      path.push(current)
      current = seatsByKey.get(current)?.seat.companionOfKey ?? null
    }

    for (const visited of path) settled.add(visited)
  }

  return cycles
}

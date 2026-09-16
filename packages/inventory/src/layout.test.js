/**
 * Whole-layout validation.
 *
 * Each rule gets a test that breaks the layout in exactly one way, because a
 * validator that rejects everything is as useless as one that accepts
 * everything and both pass a test that only ever sends rubbish.
 *
 * @module @desi-event/inventory/layout.test
 */

import { describe, expect, it } from 'vitest'

import { LAYOUT_ISSUES, SECTION_KINDS, validateLayout } from './layout.js'

/** A small, entirely valid layout: one zone, one seated section, two rows. */
function valid() {
  return {
    zones: [
      { key: 'z-stalls', name: 'Stalls', colourToken: 'zone-a', sortOrder: 0 },
      { key: 'z-circle', name: 'Circle', colourToken: 'zone-b', sortOrder: 1 },
    ],
    sections: [
      {
        key: 's-stalls',
        name: 'Stalls',
        kind: 'SEATED',
        sortOrder: 0,
        rows: [
          {
            key: 'r-a',
            label: 'A',
            sortOrder: 0,
            seats: [
              { key: 'a1', label: 'Stalls A1', sortOrder: 0, zoneKey: 'z-stalls' },
              { key: 'a2', label: 'Stalls A2', sortOrder: 1, zoneKey: 'z-stalls' },
            ],
          },
          {
            key: 'r-b',
            label: 'B',
            sortOrder: 1,
            seats: [{ key: 'b1', label: 'Stalls B1', sortOrder: 0, zoneKey: 'z-stalls' }],
          },
        ],
      },
    ],
  }
}

/**
 * Codes reported for a layout.
 *
 * @param {object} layout The layout.
 * @returns {string[]} The issue codes.
 */
const codes = (layout) => validateLayout(layout).issues.map((issue) => issue.code)

describe('a layout that is fine', () => {
  it('passes, and counts its seats', () => {
    const result = validateLayout(valid())

    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
    expect(result.seatCount).toBe(3)
  })

  it('accepts a standing section with a capacity and no seats', () => {
    const layout = valid()
    layout.sections.push({
      key: 's-pit',
      name: 'Pit',
      kind: 'STANDING',
      sortOrder: 1,
      standingCapacity: 400,
      rows: [],
      seats: [],
    })

    expect(validateLayout(layout).valid).toBe(true)
  })

  it('accepts a table section whose seats hang off the section, not a row', () => {
    const layout = valid()
    layout.sections.push({
      key: 's-tables',
      name: 'Tables',
      kind: 'TABLE',
      sortOrder: 2,
      rows: [],
      seats: [
        { key: 't1', label: 'Table 7 / Seat 1', sortOrder: 0, zoneKey: 'z-circle' },
        { key: 't2', label: 'Table 7 / Seat 2', sortOrder: 1, zoneKey: 'z-circle' },
      ],
    })

    const result = validateLayout(layout)

    expect(result.valid).toBe(true)
    expect(result.seatCount).toBe(5)
  })

  it('accepts an accessible space with its companion', () => {
    const layout = valid()
    layout.sections[0].rows[1].seats.push(
      { key: 'w1', label: 'Stalls W1', sortOrder: 1, accessible: true, zoneKey: 'z-stalls' },
      {
        key: 'w1c',
        label: 'Stalls W1 companion',
        sortOrder: 2,
        companionOfKey: 'w1',
        zoneKey: 'z-stalls',
      },
    )

    expect(validateLayout(layout).valid).toBe(true)
  })

  it('reports every problem at once rather than the first', () => {
    // Four mistakes should be four messages, not four round trips.
    const layout = valid()
    layout.sections[0].rows[0].seats[1].label = 'Stalls A1'
    layout.sections[0].rows[0].seats[1].zoneKey = 'z-nope'
    layout.sections[0].rows[1].label = 'A'
    layout.zones.push({ key: 'z-dup', name: 'Stalls' })

    expect(codes(layout).length).toBeGreaterThanOrEqual(4)
  })
})

describe('duplicate identities', () => {
  it('rejects two sections with the same key', () => {
    const layout = valid()
    layout.sections.push({ ...valid().sections[0], name: 'Other' })

    expect(codes(layout)).toContain('DUPLICATE_SECTION_KEY')
  })

  it('rejects two sections with the same name, whatever the case', () => {
    const layout = valid()
    layout.sections.push({ ...valid().sections[0], key: 's-two', name: '  stalls ' })

    expect(codes(layout)).toContain('DUPLICATE_SECTION_NAME')
  })

  it('rejects two rows in one section sharing a label', () => {
    const layout = valid()
    layout.sections[0].rows[1].label = 'a'

    expect(codes(layout)).toContain('DUPLICATE_ROW_LABEL')
  })

  it('allows the same row label in different sections, which is normal', () => {
    // Row A exists in the stalls and in the circle of most theatres.
    const layout = valid()
    layout.sections.push({
      key: 's-circle',
      name: 'Circle',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [
        {
          key: 'r-ca',
          label: 'A',
          sortOrder: 0,
          seats: [{ key: 'ca1', label: 'Circle A1', sortOrder: 0, zoneKey: 'z-circle' }],
        },
      ],
    })

    expect(validateLayout(layout).valid).toBe(true)
  })

  it('rejects two seats sharing a label anywhere in the map', () => {
    // Mirrors @@unique([venueMapVersionId, label]): catching it here is a 422
    // naming the seat instead of a constraint violation reported as a 500.
    const layout = valid()
    layout.sections[0].rows[1].seats[0].label = 'Stalls A1'

    expect(codes(layout)).toContain('DUPLICATE_SEAT_LABEL')
  })

  it('rejects two seats sharing a key', () => {
    const layout = valid()
    layout.sections[0].rows[1].seats[0].key = 'a1'

    expect(codes(layout)).toContain('DUPLICATE_SEAT_KEY')
  })

  it('rejects two rows sharing a key across sections', () => {
    const layout = valid()
    layout.sections.push({
      key: 's-circle',
      name: 'Circle',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [
        {
          key: 'r-a',
          label: 'A',
          sortOrder: 0,
          seats: [{ key: 'c1', label: 'C1', zoneKey: 'z-circle' }],
        },
      ],
    })

    expect(codes(layout)).toContain('DUPLICATE_ROW_KEY')
  })

  it('rejects duplicate zone keys and names', () => {
    const layout = valid()
    layout.zones.push({ key: 'z-stalls', name: 'Elsewhere' })
    layout.zones.push({ key: 'z-other', name: 'stalls' })

    expect(codes(layout)).toContain('DUPLICATE_ZONE_KEY')
    expect(codes(layout)).toContain('DUPLICATE_ZONE_NAME')
  })
})

describe('references that do not resolve', () => {
  it('rejects a seat pointing at a zone nobody declared', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].zoneKey = 'z-from-another-map'

    const issues = validateLayout(layout).issues

    expect(issues.map((i) => i.code)).toContain('UNKNOWN_ZONE')
    // The message names the zone, so the editor can point at it.
    expect(issues.find((i) => i.code === 'UNKNOWN_ZONE').message).toContain('z-from-another-map')
  })

  it('rejects a seat pointing at a row from another map', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].rowKey = 'r-in-another-venue'

    expect(codes(layout)).toContain('UNKNOWN_ROW')
  })

  it('rejects a seat pointing at a section from another map', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].sectionKey = 's-elsewhere'

    expect(codes(layout)).toContain('UNKNOWN_SECTION')
  })

  it('rejects a seat claiming a section other than the one it sits in', () => {
    const layout = valid()
    layout.sections.push({
      key: 's-circle',
      name: 'Circle',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [{ key: 'r-c', label: 'A', seats: [{ key: 'c1', label: 'C1', zoneKey: 'z-circle' }] }],
    })
    layout.sections[0].rows[0].seats[0].sectionKey = 's-circle'

    expect(codes(layout)).toContain('ROW_SECTION_MISMATCH')
  })

  it('rejects a seat nested in one row while naming another', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].rowKey = 'r-b'

    expect(codes(layout)).toContain('ROW_SECTION_MISMATCH')
  })
})

describe('accessible seats and their companions', () => {
  /** A layout with an accessible space and a companion seat beside it. */
  function withCompanion() {
    const layout = valid()
    layout.sections[0].rows[1].seats.push(
      { key: 'w1', label: 'Stalls W1', accessible: true, zoneKey: 'z-stalls' },
      { key: 'w1c', label: 'Stalls W1 companion', companionOfKey: 'w1', zoneKey: 'z-stalls' },
    )
    return layout
  }

  it('rejects a companion pointing at a seat nobody declared', () => {
    const layout = withCompanion()
    layout.sections[0].rows[1].seats[2].companionOfKey = 'w-nope'

    expect(codes(layout)).toContain('UNKNOWN_COMPANION')
  })

  it('rejects a seat that is its own companion', () => {
    const layout = withCompanion()
    layout.sections[0].rows[1].seats[2].companionOfKey = 'w1c'

    expect(codes(layout)).toContain('COMPANION_SELF')
  })

  it('rejects a companion in a different section', () => {
    // The whole point of the relationship is that the pair are held and
    // released together. Across a section boundary they are two seats.
    const layout = withCompanion()
    layout.sections.push({
      key: 's-circle',
      name: 'Circle',
      kind: 'SEATED',
      sortOrder: 1,
      rows: [
        {
          key: 'r-c',
          label: 'A',
          seats: [{ key: 'c1', label: 'Circle A1', companionOfKey: 'w1', zoneKey: 'z-circle' }],
        },
      ],
    })

    expect(codes(layout)).toContain('COMPANION_CROSS_SECTION')
  })

  it('rejects a companion attached to a seat that is not an accessible space', () => {
    const layout = withCompanion()
    layout.sections[0].rows[1].seats[1].accessible = false

    expect(codes(layout)).toContain('COMPANION_NOT_ACCESSIBLE')
  })

  it('rejects a chain of companions', () => {
    const layout = withCompanion()
    layout.sections[0].rows[1].seats.push({
      key: 'w1cc',
      label: 'Stalls W1 second companion',
      companionOfKey: 'w1c',
      zoneKey: 'z-stalls',
    })

    expect(codes(layout)).toContain('COMPANION_CHAIN')
  })

  it('rejects two seats claiming the same companion', () => {
    const layout = withCompanion()
    layout.sections[0].rows[1].seats.push({
      key: 'w1c2',
      label: 'Stalls W1 other companion',
      companionOfKey: 'w1',
      zoneKey: 'z-stalls',
    })

    expect(codes(layout)).toContain('COMPANION_SHARED')
  })

  it('rejects a companion loop, and says which seats are in it', () => {
    const layout = valid()
    layout.sections[0].rows[1].seats.push(
      { key: 'x', label: 'Stalls X', accessible: true, companionOfKey: 'y', zoneKey: 'z-stalls' },
      { key: 'y', label: 'Stalls Y', accessible: true, companionOfKey: 'x', zoneKey: 'z-stalls' },
    )

    const issues = validateLayout(layout).issues
    const cycle = issues.find((issue) => issue.code === 'COMPANION_CYCLE')

    expect(cycle).toBeDefined()
    expect(cycle.message).toMatch(/x|y/)
  })

  it('finds a three-seat loop, not only a reciprocal pair', () => {
    const layout = valid()
    layout.sections[0].rows[1].seats.push(
      { key: 'p', label: 'P', accessible: true, companionOfKey: 'q', zoneKey: 'z-stalls' },
      { key: 'q', label: 'Q', accessible: true, companionOfKey: 'r', zoneKey: 'z-stalls' },
      { key: 'r', label: 'R', accessible: true, companionOfKey: 'p', zoneKey: 'z-stalls' },
    )

    expect(codes(layout)).toContain('COMPANION_CYCLE')
  })
})

describe('section shape', () => {
  it('rejects a standing section with seats in it', () => {
    const layout = valid()
    layout.sections.push({
      key: 's-pit',
      name: 'Pit',
      kind: 'STANDING',
      standingCapacity: 100,
      rows: [],
      seats: [{ key: 'p1', label: 'Pit 1' }],
    })

    expect(codes(layout)).toContain('STANDING_HAS_SEATS')
  })

  it('rejects a standing section with no capacity', () => {
    const layout = valid()
    layout.sections.push({ key: 's-pit', name: 'Pit', kind: 'STANDING', rows: [], seats: [] })

    expect(codes(layout)).toContain('STANDING_NEEDS_CAPACITY')
  })

  it('rejects a seated section with no seats', () => {
    const layout = valid()
    layout.sections.push({ key: 's-empty', name: 'Empty', kind: 'SEATED', rows: [], seats: [] })

    expect(codes(layout)).toContain('SEATED_NEEDS_SEATS')
  })

  it('rejects a seated section carrying a standing capacity', () => {
    const layout = valid()
    layout.sections[0].standingCapacity = 50

    expect(codes(layout)).toContain('SEATED_HAS_CAPACITY')
  })

  it('rejects a layout with no sections at all', () => {
    expect(codes({ zones: [], sections: [] })).toContain('EMPTY_LAYOUT')
  })

  it('rejects a restricted seat that does not say why', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].restricted = true

    expect(codes(layout)).toContain('RESTRICTION_NEEDS_NOTE')
  })

  it('accepts a restricted seat that does', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].restricted = true
    layout.sections[0].rows[0].seats[0].restrictionNote = 'Camera platform'

    expect(validateLayout(layout).valid).toBe(true)
  })

  it('accepts an obstructed-view seat without further ceremony', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].obstructedView = true

    expect(validateLayout(layout).valid).toBe(true)
  })
})

describe('the issue vocabulary', () => {
  it('names every section kind the database has', () => {
    expect([...SECTION_KINDS].sort()).toEqual(['SEATED', 'STANDING', 'TABLE'])
  })

  it('gives every code a sentence a person can act on', () => {
    for (const [code, message] of Object.entries(LAYOUT_ISSUES)) {
      expect(message.length, code).toBeGreaterThan(15)
      expect(message.endsWith('.'), code).toBe(true)
    }
  })

  it('points every issue at a path into the payload', () => {
    const layout = valid()
    layout.sections[0].rows[0].seats[0].zoneKey = 'nope'

    for (const issue of validateLayout(layout).issues) {
      expect(issue.path, issue.code).toMatch(/\w/)
    }
  })
})

import { describe, expect, it } from 'vitest'

import { eventStatusSchema } from './enums.js'
import {
  ACTORS,
  EDITABLE_STATUSES,
  GATES,
  INDEXABLE_STATUSES,
  MATERIAL_FIELDS,
  PUBLICLY_VISIBLE_STATUSES,
  SELLING_STATUSES,
  TRANSITIONS,
  canTransition,
  findTransition,
  isIndexable,
  isPubliclyVisible,
  materialChanges,
  transitionsFrom,
} from './lifecycle.js'

/**
 * Every status the enum admits, taken from the enum rather than retyped, so a
 * new status added to the schema fails these tests until somebody decides what
 * it can become.
 *
 * @type {string[]}
 */
const ALL_STATUSES = eventStatusSchema.options

describe('the transition table covers the enum', () => {
  it('names every status the enum admits', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort())
  })

  it('never proposes a destination the enum does not admit', () => {
    const destinations = Object.values(TRANSITIONS).flatMap((moves) => moves.map((m) => m.to))

    for (const destination of destinations) {
      expect(ALL_STATUSES).toContain(destination)
    }
  })

  it('gives every move a known actor and known gates', () => {
    const actors = new Set(Object.values(ACTORS))
    const gates = new Set(Object.values(GATES))

    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves) {
        expect(actors, `${from} -> ${move.to}`).toContain(move.actor)
        for (const gate of move.gates) expect(gates, `${from} -> ${move.to}`).toContain(gate)
      }
    }
  })

  it('never lets a status move to itself', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      expect(moves.map((m) => m.to)).not.toContain(from)
    }
  })

  it('offers each destination at most once per source', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      const destinations = moves.map((m) => m.to)
      expect(new Set(destinations).size, `duplicate destination from ${from}`).toBe(
        destinations.length,
      )
    }
  })

  it('leaves CANCELLED and ARCHIVED terminal', () => {
    // An attendee who has been refunded cannot be told the event is back on.
    expect(TRANSITIONS.CANCELLED).toEqual([])
    expect(TRANSITIONS.ARCHIVED).toEqual([])
  })

  it('reaches every status from DRAFT', () => {
    // A status nothing can reach is a status nothing can be in, which means
    // either the table or the enum is wrong.
    const seen = new Set(['DRAFT'])
    const queue = ['DRAFT']

    while (queue.length > 0) {
      for (const move of TRANSITIONS[queue.shift()] ?? []) {
        if (seen.has(move.to)) continue
        seen.add(move.to)
        queue.push(move.to)
      }
    }

    expect([...seen].sort()).toEqual([...ALL_STATUSES].sort())
  })
})

describe('who may make which move', () => {
  it('lets only a moderator approve, reject or request changes', () => {
    for (const decision of ['APPROVED', 'REJECTED', 'CHANGES_REQUIRED']) {
      const moves = Object.entries(TRANSITIONS).flatMap(([from, list]) =>
        list.filter((m) => m.to === decision).map((m) => ({ from, ...m })),
      )

      expect(moves.length).toBeGreaterThan(0)

      for (const move of moves) {
        expect(move.actor, `${move.from} -> ${decision}`).toBe(ACTORS.MODERATOR)
      }
    }
  })

  it('never lets an organiser move their own event into APPROVED', () => {
    for (const from of ALL_STATUSES) {
      const organiserMoves = transitionsFrom(from, ACTORS.ORGANIZER).map((m) => m.to)
      expect(organiserMoves, `from ${from}`).not.toContain('APPROVED')
    }
  })

  it('reaches PUBLISHED only from APPROVED or POSTPONED', () => {
    const sources = Object.entries(TRANSITIONS)
      .filter(([, moves]) => moves.some((m) => m.to === 'PUBLISHED'))
      .map(([from]) => from)

    expect(sources.sort()).toEqual(['APPROVED', 'POSTPONED'])
  })

  it('gates every route to PUBLISHED on a verified organiser', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves.filter((m) => m.to === 'PUBLISHED')) {
        expect(move.gates, `${from} -> PUBLISHED`).toContain(GATES.VERIFIED_ORGANIZER)
      }
    }
  })

  it('gates every route to ON_SALE on a verified organiser and something to sell', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves.filter((m) => m.to === 'ON_SALE' && m.actor !== ACTORS.SYSTEM)) {
        expect(move.gates, `${from} -> ON_SALE`).toContain(GATES.VERIFIED_ORGANIZER)
        expect(move.gates, `${from} -> ON_SALE`).toContain(GATES.SELLABLE)
      }
    }
  })

  it('keeps SOLD_OUT and COMPLETED out of a caller’s hands', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves.filter((m) => m.to === 'SOLD_OUT' || m.to === 'COMPLETED')) {
        expect(move.actor, `${from} -> ${move.to}`).toBe(ACTORS.SYSTEM)
      }
    }
  })
})

describe('the individual lookups', () => {
  it('finds a move that exists and refuses one that does not', () => {
    expect(canTransition('DRAFT', 'REVIEW_PENDING')).toBe(true)
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(false)
    expect(canTransition('DRAFT', 'APPROVED')).toBe(false)
    expect(canTransition('CANCELLED', 'ON_SALE')).toBe(false)
  })

  it('returns null rather than undefined for a move that does not exist', () => {
    expect(findTransition('DRAFT', 'PUBLISHED')).toBeNull()
    expect(findTransition('NOT_A_STATUS', 'DRAFT')).toBeNull()
  })

  it('treats an unknown status as terminal rather than throwing', () => {
    expect(transitionsFrom('NOT_A_STATUS')).toEqual([])
    expect(canTransition('NOT_A_STATUS', 'DRAFT')).toBe(false)
  })
})

describe('what a stranger may see', () => {
  it('hides every unfinished or private status', () => {
    for (const status of ['DRAFT', 'REVIEW_PENDING', 'CHANGES_REQUIRED', 'REJECTED', 'ARCHIVED']) {
      expect(isPubliclyVisible(status), status).toBe(false)
      expect(isIndexable(status), status).toBe(false)
    }
  })

  it('keeps a cancelled event visible, because a ticket holder needs the page', () => {
    expect(isPubliclyVisible('CANCELLED')).toBe(true)
  })

  it('keeps a cancelled or finished event out of the sitemap', () => {
    expect(isIndexable('CANCELLED')).toBe(false)
    expect(isIndexable('COMPLETED')).toBe(false)
    expect(isIndexable('POSTPONED')).toBe(false)
  })

  it('indexes only what is genuinely on offer', () => {
    expect([...INDEXABLE_STATUSES].sort()).toEqual([
      'ON_SALE',
      'PUBLISHED',
      'SALES_PAUSED',
      'SOLD_OUT',
    ])
  })

  it('never indexes something it would not show', () => {
    for (const status of INDEXABLE_STATUSES) {
      expect(PUBLICLY_VISIBLE_STATUSES.has(status), status).toBe(true)
    }
  })

  it('sells only in ON_SALE', () => {
    expect([...SELLING_STATUSES]).toEqual(['ON_SALE'])
  })

  it('never sells in a status it would not show', () => {
    for (const status of SELLING_STATUSES) {
      expect(PUBLICLY_VISIBLE_STATUSES.has(status), status).toBe(true)
    }
  })
})

describe('material changes', () => {
  it('names the fields somebody bought a ticket on the strength of', () => {
    expect(materialChanges({ startsAt: '2027-01-01T00:00:00Z' })).toEqual(['startsAt'])
    expect(materialChanges({ venueId: 'abc', policies: {} })).toEqual(['venueId', 'policies'])
  })

  it('treats housekeeping as housekeeping', () => {
    expect(materialChanges({ description: 'A better description.' })).toEqual([])
    expect(
      materialChanges({ summary: 'Tidier.', coverImageUrl: 'https://example.test/a.jpg' }),
    ).toEqual([])
  })

  it('returns the fields in declaration order, not request order', () => {
    // So the confirmation prompt reads the same way every time.
    expect(materialChanges({ policies: {}, startsAt: 'x', venueId: 'y' })).toEqual([
      'startsAt',
      'venueId',
      'policies',
    ])
  })

  it('survives a null or non-object argument', () => {
    expect(materialChanges(null)).toEqual([])
    expect(materialChanges(undefined)).toEqual([])
    expect(materialChanges('startsAt')).toEqual([])
  })

  it('is not fooled by a prototype property', () => {
    // `'startsAt' in obj` would be true here; `Object.hasOwn` is not.
    const sneaky = Object.create({ startsAt: 'inherited' })
    expect(materialChanges(sneaky)).toEqual([])
  })

  it('only names fields that exist on the event', () => {
    for (const field of MATERIAL_FIELDS) {
      expect(typeof field).toBe('string')
      expect(field.length).toBeGreaterThan(0)
    }
  })
})

describe('editing', () => {
  it('lets an organiser edit freely only before a moderator is involved', () => {
    expect([...EDITABLE_STATUSES].sort()).toEqual(['CHANGES_REQUIRED', 'DRAFT'])
  })

  it('does not consider a review-pending event freely editable', () => {
    // Editing under a moderator's nose changes what they are reviewing.
    expect(EDITABLE_STATUSES.has('REVIEW_PENDING')).toBe(false)
  })
})

describe('the table is immutable', () => {
  it('refuses a new move at runtime', () => {
    expect(() => {
      TRANSITIONS.DRAFT.push({ to: 'PUBLISHED', actor: 'organizer', gates: [] })
    }).toThrow()
  })

  it('refuses a new source at runtime', () => {
    expect(() => {
      TRANSITIONS.SOMETHING_NEW = []
    }).toThrow()
  })

  it('refuses to rewrite an existing move', () => {
    expect(() => {
      TRANSITIONS.DRAFT[0].to = 'PUBLISHED'
    }).toThrow()
  })
})

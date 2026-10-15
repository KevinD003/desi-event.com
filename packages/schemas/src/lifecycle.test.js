import { describe, expect, it } from 'vitest'

import { eventStatusSchema } from './enums.js'
import {
  ACTORS,
  CONTENT_ONLY_STATUSES,
  DELETION_OUTCOMES,
  DELETION_OUTCOME_COLUMN,
  EDITABLE_STATUSES,
  EDIT_MODES,
  GATES,
  BOOKABLE_STATUSES,
  INDEXABLE_STATUSES,
  LIVE_STATUSES,
  MATERIAL_FIELDS,
  PLATFORM_EDITABLE_STATUSES,
  PUBLICLY_VISIBLE_STATUSES,
  SELLING_STATUSES,
  TRANSITIONS,
  canTransition,
  editModeFor,
  findTransition,
  isIndexable,
  isPubliclyVisible,
  materialChanges,
  restoreTarget,
  transitionsFrom,
} from './lifecycle.js'
import { EVENT_DELETION_OUTCOMES } from './enums.js'

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

  it('CANCELLED and ARCHIVED never go back: their only move is deletion', () => {
    // An attendee who has been refunded cannot be told the event is back on.
    for (const status of ['CANCELLED', 'ARCHIVED']) {
      expect(
        TRANSITIONS[status].filter((m) => m.actor !== ACTORS.DELETION),
        status,
      ).toEqual([])
      expect(findTransition(status, 'DELETED'), status).toEqual({
        to: 'DELETED',
        actor: ACTORS.DELETION,
        gates: [],
      })
    }
  })

  it('leaves DELETED only by a platform restore, to restoreTarget', () => {
    expect(TRANSITIONS.DELETED.length).toBeGreaterThan(0)

    for (const move of TRANSITIONS.DELETED) {
      expect(move.actor, `DELETED -> ${move.to}`).toBe(ACTORS.RESTORE)
      expect(move.gates, `DELETED -> ${move.to}`).toContain(GATES.RESTORE_TARGET)
    }

    const landings = new Set(ALL_STATUSES.filter((s) => s !== 'DELETED').map(restoreTarget))
    expect(new Set(TRANSITIONS.DELETED.map((m) => m.to))).toEqual(landings)
  })

  it('offers exactly one deletion move from every status but DELETED, and no other', () => {
    for (const from of ALL_STATUSES) {
      const deletions = TRANSITIONS[from].filter((m) => m.actor === ACTORS.DELETION)

      if (from === 'DELETED') {
        expect(deletions).toEqual([])
      } else {
        expect(
          deletions.map((m) => m.to),
          from,
        ).toEqual(['DELETED'])
      }

      expect(
        TRANSITIONS[from].filter((m) => m.to === 'DELETED' && m.actor !== ACTORS.DELETION),
        from,
      ).toEqual([])
    }
  })

  it('restores only from DELETED', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      if (from === 'DELETED') continue
      expect(
        moves.filter((m) => m.actor === ACTORS.RESTORE),
        from,
      ).toEqual([])
    }
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
  it('lets only a moderator approve, reject or request changes; a restore only returns an event to the decision it had', () => {
    for (const decision of ['APPROVED', 'REJECTED', 'CHANGES_REQUIRED']) {
      const moves = Object.entries(TRANSITIONS).flatMap(([from, list]) =>
        list.filter((m) => m.to === decision).map((m) => ({ from, ...m })),
      )

      expect(moves.length).toBeGreaterThan(0)

      for (const move of moves) {
        if (move.actor === ACTORS.RESTORE) {
          // Only out of DELETED, and only to the decision the event already had.
          expect(move.from, `${move.from} -> ${decision}`).toBe('DELETED')
          expect(restoreTarget(decision)).toBe(decision)
          continue
        }

        expect(move.actor, `${move.from} -> ${decision}`).toBe(ACTORS.MODERATOR)
      }
    }

    // Nothing but a review approves: no restore lands on APPROVED.
    expect(findTransition('DELETED', 'APPROVED')).toBeNull()
  })

  it('never lets an organiser move their own event into APPROVED', () => {
    for (const from of ALL_STATUSES) {
      const organiserMoves = transitionsFrom(from, ACTORS.ORGANIZER).map((m) => m.to)
      expect(organiserMoves, `from ${from}`).not.toContain('APPROVED')
    }
  })

  it('reaches PUBLISHED from APPROVED or POSTPONED by an organiser, and otherwise only by a platform restore of an event that was PUBLISHED when deleted', () => {
    const sources = Object.entries(TRANSITIONS)
      .filter(([, moves]) => moves.some((m) => m.to === 'PUBLISHED' && m.actor !== ACTORS.RESTORE))
      .map(([from]) => from)

    expect(sources.sort()).toEqual(['APPROVED', 'POSTPONED'])

    const restores = Object.entries(TRANSITIONS)
      .filter(([, moves]) => moves.some((m) => m.to === 'PUBLISHED' && m.actor === ACTORS.RESTORE))
      .map(([from]) => from)

    expect(restores).toEqual(['DELETED'])
    expect(
      ALL_STATUSES.filter((prior) => prior !== 'DELETED' && restoreTarget(prior) === 'PUBLISHED'),
    ).toEqual(['PUBLISHED'])
  })

  it('never restores to APPROVED or ON_SALE', () => {
    for (const prior of ALL_STATUSES) {
      expect(restoreTarget(prior), prior).not.toBe('APPROVED')
      expect(restoreTarget(prior), prior).not.toBe('ON_SALE')
    }
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

  it('keeps SOLD_OUT and COMPLETED out of a caller’s hands, but for a restore of a finished event to where it was', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves.filter((m) => m.to === 'SOLD_OUT' || m.to === 'COMPLETED')) {
        if (move.actor === ACTORS.RESTORE) {
          expect(`${from} -> ${move.to}`).toBe('DELETED -> COMPLETED')
          continue
        }

        expect(move.actor, `${from} -> ${move.to}`).toBe(ACTORS.SYSTEM)
      }
    }
  })

  it('gates every restore into a public status on a verified organiser', () => {
    for (const move of TRANSITIONS.DELETED) {
      if (!PUBLICLY_VISIBLE_STATUSES.has(move.to)) continue
      expect(move.gates, `DELETED -> ${move.to}`).toContain(GATES.VERIFIED_ORGANIZER)
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
    for (const status of [
      'DRAFT',
      'REVIEW_PENDING',
      'CHANGES_REQUIRED',
      'REJECTED',
      'ARCHIVED',
      'DELETED',
    ]) {
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

  it('books in ON_SALE, and in PUBLISHED as every existing event does, and nowhere else', () => {
    expect([...BOOKABLE_STATUSES].sort()).toEqual(['ON_SALE', 'PUBLISHED'])

    for (const status of SELLING_STATUSES) expect(BOOKABLE_STATUSES.has(status), status).toBe(true)
    for (const stopped of ['SALES_PAUSED', 'SOLD_OUT', 'CANCELLED', 'POSTPONED', 'DRAFT']) {
      expect(BOOKABLE_STATUSES.has(stopped), stopped).toBe(false)
    }
  })

  it('never books a status a listing would not show', () => {
    for (const status of BOOKABLE_STATUSES) {
      expect(INDEXABLE_STATUSES.has(status), status).toBe(true)
    }
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
    expect(materialChanges({ summary: 'Tidier.', artists: ['A new headliner'] })).toEqual([])
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

  it('calls an event live once somebody outside the organisation may have committed to it', () => {
    // Moved here from the API unchanged, so the web and the API read one list.
    expect([...LIVE_STATUSES].sort()).toEqual([
      'ON_SALE',
      'POSTPONED',
      'PUBLISHED',
      'SALES_PAUSED',
      'SOLD_OUT',
    ])
  })

  it('never calls an event both freely editable and live', () => {
    for (const status of EDITABLE_STATUSES) expect(LIVE_STATUSES.has(status)).toBe(false)
    // A moderator's version is refused outright, not amended as a live deal.
    expect(LIVE_STATUSES.has('APPROVED')).toBe(false)
    expect(LIVE_STATUSES.has('REVIEW_PENDING')).toBe(false)
  })
})

describe('a deleted event', () => {
  it('is in none of the indexable, publicly visible, bookable, selling, live, editable or content-only sets', () => {
    for (const set of [
      INDEXABLE_STATUSES,
      PUBLICLY_VISIBLE_STATUSES,
      BOOKABLE_STATUSES,
      SELLING_STATUSES,
      LIVE_STATUSES,
      EDITABLE_STATUSES,
      CONTENT_ONLY_STATUSES,
      PLATFORM_EDITABLE_STATUSES,
    ]) {
      expect(set.has('DELETED')).toBe(false)
    }
  })

  it.each([
    ['DRAFT', 'DRAFT'],
    ['REVIEW_PENDING', 'DRAFT'],
    ['CHANGES_REQUIRED', 'CHANGES_REQUIRED'],
    ['APPROVED', 'DRAFT'],
    ['PUBLISHED', 'PUBLISHED'],
    ['ON_SALE', 'SALES_PAUSED'],
    ['SALES_PAUSED', 'SALES_PAUSED'],
    ['SOLD_OUT', 'SALES_PAUSED'],
    ['COMPLETED', 'COMPLETED'],
    ['POSTPONED', 'POSTPONED'],
    ['CANCELLED', 'CANCELLED'],
    ['REJECTED', 'REJECTED'],
    ['ARCHIVED', 'ARCHIVED'],
  ])('deleted from %s, comes back as %s', (prior, target) => {
    expect(restoreTarget(prior)).toBe(target)
    expect(canTransition('DELETED', target)).toBe(true)
  })

  it('names every status in the restore table', () => {
    // The it.each above lists every status but DELETED, which is never a prior.
    expect(ALL_STATUSES.filter((status) => status !== 'DELETED')).toHaveLength(13)
  })

  it('names the three outcomes on the wire and maps each to the stored value', () => {
    expect([...DELETION_OUTCOMES]).toEqual(['REMOVE', 'CANCEL_AND_REFUND', 'REMOVE_AFTER_EVENT'])
    expect(DELETION_OUTCOMES.map((outcome) => DELETION_OUTCOME_COLUMN[outcome])).toEqual([
      ...EVENT_DELETION_OUTCOMES,
    ])
  })
})

describe('edit modes', () => {
  it.each([
    ['DRAFT', 'draft'],
    ['CHANGES_REQUIRED', 'draft'],
    ['PUBLISHED', 'live'],
    ['ON_SALE', 'live'],
    ['SALES_PAUSED', 'live'],
    ['SOLD_OUT', 'live'],
    ['POSTPONED', 'live'],
    ['COMPLETED', 'content'],
    ['CANCELLED', 'content'],
    ['REVIEW_PENDING', 'locked'],
    ['APPROVED', 'locked'],
    ['REJECTED', 'locked'],
    ['ARCHIVED', 'locked'],
    ['DELETED', 'locked'],
  ])('%s is edited in %s mode', (status, mode) => {
    expect(editModeFor(status)).toBe(mode)
  })

  it('answers every status, and locks one it does not know', () => {
    for (const status of ALL_STATUSES) expect(EDIT_MODES).toContain(editModeFor(status))
    expect(editModeFor('SOMETHING_NEW')).toBe('locked')
    expect(editModeFor(undefined)).toBe('locked')
  })

  it('keeps the words of a finished or cancelled event editable, and nothing else', () => {
    expect([...CONTENT_ONLY_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED'])
  })

  it('lets the team at The Desi Events edit posted events only, through the very set of publicly visible statuses', () => {
    expect(PLATFORM_EDITABLE_STATUSES).toBe(PUBLICLY_VISIBLE_STATUSES)
    for (const status of ['DRAFT', 'REVIEW_PENDING', 'APPROVED', 'REJECTED', 'DELETED']) {
      expect(PLATFORM_EDITABLE_STATUSES.has(status), status).toBe(false)
    }
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

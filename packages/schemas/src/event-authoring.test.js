/**
 * The authoring contract: tier and session edits, the DELETE precondition, the
 * online-link rule, rescheduling, and the tolerant organiser tier shape.
 */

import { describe, expect, it } from 'vitest'

import { eventWithRelationsSchema } from './entities.js'
import {
  LIVE_STATUSES,
  MATERIAL_FIELDS,
  SESSION_MATERIAL_FIELDS,
  sessionMaterialChanges,
} from './lifecycle.js'
import {
  authorTicketTypeRequestSchema,
  createEventRequestSchema,
  deleteSessionRequestSchema,
  deleteTicketTypeRequestSchema,
  rescheduleEventRequestSchema,
  revisionQuerySchema,
  updateAuthorTicketTypeRequestSchema,
  updateEventRequestSchema,
  updateSessionRequestSchema,
} from './requests.js'
import {
  authorTicketTypeListResponseSchema,
  authorTicketTypeResponseSchema,
  authorTicketTypeSchema,
  eventSessionSchema,
  inventoryPreparationResponseSchema,
} from './responses.js'

const ID = 'ckv9w1p0a0000qz0l7h2k3m4n'
const OTHER_ID = 'ckv9w1p0a0001qz0l7h2k3m4n'

/**
 * The paths of every issue a failed parse reported.
 *
 * @param {object} result A `safeParse` result.
 * @returns {string[]} Dotted paths.
 */
function issuePaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('an online event may be saved before its link is typed', () => {
  it('lets an update tick online with no link yet', () => {
    expect(
      updateEventRequestSchema.safeParse({ isOnline: true, onlineUrl: null, revision: 2 }).success,
    ).toBe(true)
  })

  it('still requires the link to create an online event', () => {
    const base = {
      organizationId: ID,
      title: 'Online kathak',
      summary: 'A class',
      description: 'Learn the basics.',
      category: 'WORKSHOP',
      startsAt: '2027-03-01T18:00:00Z',
      endsAt: '2027-03-01T19:00:00Z',
      isOnline: true,
    }

    expect(issuePaths(createEventRequestSchema.safeParse(base))).toEqual(['onlineUrl'])
  })

  it('still refuses a window that ends before it starts on update', () => {
    expect(
      issuePaths(
        updateEventRequestSchema.safeParse({
          startsAt: '2027-03-01T18:00:00Z',
          endsAt: '2027-03-01T17:00:00Z',
        }),
      ),
    ).toEqual(['endsAt'])
  })

  it('accepts the new content fields and clears text ones with a blank', () => {
    const parsed = updateEventRequestSchema.parse({
      faq: [{ question: 'Parking?', answer: 'North lot.' }],
      performers: [{ name: 'Asha', role: 'Vocals', bio: 'Trained in Pune.' }],
      runningOrder: [{ time: '19:30', title: 'Doors' }],
      sponsors: [{ name: 'Chai Co', url: 'https://chai.example' }],
      socialLinks: { instagram: 'https://instagram.com/desi' },
      dressCode: ' ',
      directions: 'Use the east gate.',
      publicEmail: 'Box@Example.com',
      publicPhone: '+1 555 010 2000',
    })

    expect(parsed.dressCode).toBeNull()
    expect(parsed.publicEmail).toBe('box@example.com')
    expect(parsed.performers[0]).toEqual({ name: 'Asha', role: 'Vocals', bio: 'Trained in Pune.' })
  })

  it('refuses an http social link and a bad running-order time', () => {
    expect(
      issuePaths(
        updateEventRequestSchema.safeParse({ socialLinks: { website: 'http://a.example' } }),
      ),
    ).toEqual(['socialLinks.website'])
    expect(
      issuePaths(
        updateEventRequestSchema.safeParse({ runningOrder: [{ time: '7:30pm', title: 'Set' }] }),
      ),
    ).toEqual(['runningOrder.0.time'])
  })
})

describe('the DELETE precondition travels as text', () => {
  it('reads a numeric string as the revision', () => {
    expect(revisionQuerySchema.parse({ revision: '3' })).toEqual({ revision: 3 })
    expect(revisionQuerySchema.parse({ revision: 3 })).toEqual({ revision: 3 })
    expect(revisionQuerySchema.parse({ revision: '0' })).toEqual({ revision: 0 })
  })

  it.each(['', '-1', '3.5', 'abc', '1e3', ' 3', '03'])('refuses %j', (revision) => {
    expect(revisionQuerySchema.safeParse({ revision }).success).toBe(false)
  })

  it('refuses a missing revision', () => {
    expect(revisionQuerySchema.safeParse({}).success).toBe(false)
  })

  it('is what both authoring DELETE routes use', () => {
    expect(deleteSessionRequestSchema).toBe(revisionQuerySchema)
    expect(deleteTicketTypeRequestSchema).toBe(revisionQuerySchema)
  })
})

describe('a ticket type request carries the shape; the route decides coherence', () => {
  const tier = { revision: 1, name: 'General', priceCents: 3500 }

  it('lets the near-limit values through, so the route can refuse them with 422 and a sentence', () => {
    // The stored limits (500-character description, 1-50 per order, 120-character
    // name) are checked against the whole row by the route, which answers 422
    // naming the field rather than a schema path.
    expect(
      authorTicketTypeRequestSchema.safeParse({
        ...tier,
        description: 'd'.repeat(501),
        minPerOrder: 51,
        maxPerOrder: 60,
        name: 'n'.repeat(121),
      }).success,
    ).toBe(true)
  })

  it('refuses a body too big to be a tier at all', () => {
    expect(
      issuePaths(
        authorTicketTypeRequestSchema.safeParse({ ...tier, description: 'd'.repeat(5001) }),
      ),
    ).toEqual(['description'])
    expect(
      issuePaths(authorTicketTypeRequestSchema.safeParse({ ...tier, maxPerOrder: 1001 })),
    ).toEqual(['maxPerOrder'])
    expect(
      issuePaths(authorTicketTypeRequestSchema.safeParse({ ...tier, minPerOrder: 0 })),
    ).toEqual(['minPerOrder'])
    expect(
      issuePaths(authorTicketTypeRequestSchema.safeParse({ ...tier, name: 'n'.repeat(501) })),
    ).toEqual(['name'])
  })

  it('stores a blank description as none', () => {
    expect(authorTicketTypeRequestSchema.parse({ ...tier, description: '' }).description).toBeNull()
    expect(
      authorTicketTypeRequestSchema.parse({ ...tier, description: '   ' }).description,
    ).toBeNull()
  })

  it('refuses an unknown visibility and status', () => {
    expect(
      issuePaths(authorTicketTypeRequestSchema.safeParse({ ...tier, visibility: 'SECRET' })),
    ).toEqual(['visibility'])
    expect(
      issuePaths(authorTicketTypeRequestSchema.safeParse({ ...tier, status: 'SOLD_OUT' })),
    ).toEqual(['status'])
  })

  it('makes a partial update change something', () => {
    expect(issuePaths(updateAuthorTicketTypeRequestSchema.safeParse({ revision: 1 }))).toEqual([''])
    expect(
      updateAuthorTicketTypeRequestSchema.parse({ revision: 1, name: ' Early bird ' }),
    ).toEqual({ revision: 1, name: 'Early bird' })
    expect(
      updateAuthorTicketTypeRequestSchema.parse({ revision: 1, visibility: 'HIDDEN' }),
    ).toEqual({ revision: 1, visibility: 'HIDDEN' })
    expect(
      issuePaths(updateAuthorTicketTypeRequestSchema.safeParse({ revision: 1, maxPerOrder: 1001 })),
    ).toEqual(['maxPerOrder'])
  })
})

describe('a session edit on a live event', () => {
  it('carries a confirmation and a reason', () => {
    expect(
      updateSessionRequestSchema.parse({
        revision: 4,
        startsAt: '2027-03-01T19:00:00Z',
        confirmMaterialChange: true,
        changeReason: 'The band is delayed.',
      }),
    ).toMatchObject({ confirmMaterialChange: true, changeReason: 'The band is delayed.' })
  })

  it('refuses a 2,001-character reason and a body with nothing to change', () => {
    expect(
      issuePaths(
        updateSessionRequestSchema.safeParse({
          revision: 4,
          capacity: 10,
          changeReason: 'r'.repeat(2001),
        }),
      ),
    ).toEqual(['changeReason'])
    expect(
      issuePaths(
        updateSessionRequestSchema.safeParse({ revision: 4, confirmMaterialChange: true }),
      ),
    ).toEqual([''])
  })
})

describe('rescheduling a postponed event', () => {
  const body = {
    revision: 7,
    startsAt: '2027-05-01T18:00:00Z',
    endsAt: '2027-05-01T22:00:00Z',
    sessions: [{ id: ID, startsAt: '2027-05-01T18:00:00Z', endsAt: '2027-05-01T22:00:00Z' }],
    resume: 'ON_SALE',
    confirm: true,
    reason: 'The venue is ready again.',
  }

  it('accepts a coherent body', () => {
    expect(rescheduleEventRequestSchema.parse(body)).toMatchObject({ resume: 'ON_SALE' })
    expect(rescheduleEventRequestSchema.parse({ ...body, sessions: undefined }).sessions).toEqual(
      [],
    )
  })

  it('refuses an end at or before the start, for the event and for a session', () => {
    expect(
      issuePaths(rescheduleEventRequestSchema.safeParse({ ...body, endsAt: body.startsAt })),
    ).toEqual(['endsAt'])
    expect(
      issuePaths(
        rescheduleEventRequestSchema.safeParse({
          ...body,
          sessions: [{ ...body.sessions[0], endsAt: body.sessions[0].startsAt }],
        }),
      ),
    ).toEqual(['sessions.0.endsAt'])
  })

  it('refuses a session named twice', () => {
    expect(
      issuePaths(
        rescheduleEventRequestSchema.safeParse({
          ...body,
          sessions: [body.sessions[0], { ...body.sessions[0] }],
        }),
      ),
    ).toEqual(['sessions.1.id'])
    expect(
      rescheduleEventRequestSchema.safeParse({
        ...body,
        sessions: [body.sessions[0], { ...body.sessions[0], id: OTHER_ID }],
      }).success,
    ).toBe(true)
  })

  it('refuses no confirmation, a false one, a return to draft and a blank reason', () => {
    const { confirm: _confirm, ...unconfirmed } = body

    expect(rescheduleEventRequestSchema.safeParse(unconfirmed).success).toBe(false)
    expect(rescheduleEventRequestSchema.safeParse({ ...body, confirm: false }).success).toBe(false)
    expect(rescheduleEventRequestSchema.safeParse({ ...body, resume: 'DRAFT' }).success).toBe(false)
    expect(rescheduleEventRequestSchema.safeParse({ ...body, reason: '  ' }).success).toBe(false)
  })
})

describe('session material fields', () => {
  it('names the four fields of a night', () => {
    expect(SESSION_MATERIAL_FIELDS).toEqual(['startsAt', 'endsAt', 'timezone', 'doorsOpenAt'])
    expect(Object.isFrozen(SESSION_MATERIAL_FIELDS)).toBe(true)
  })

  it('keeps declaration order and ignores unknown keys', () => {
    expect(
      sessionMaterialChanges({ doorsOpenAt: 1, capacity: 2, startsAt: 3, colour: 'red' }),
    ).toEqual(['startsAt', 'doorsOpenAt'])
    expect(sessionMaterialChanges(null)).toEqual([])
    expect(sessionMaterialChanges({ salesEndAt: 1 })).toEqual([])
  })

  it('leaves the event-level list and the live list as they were', () => {
    expect(MATERIAL_FIELDS).toContain('startsAt')
    expect([...LIVE_STATUSES].sort()).toEqual([
      'ON_SALE',
      'POSTPONED',
      'PUBLISHED',
      'SALES_PAUSED',
      'SOLD_OUT',
    ])
  })
})

describe('the organiser reads a tier tolerantly', () => {
  const legacy = {
    id: ID,
    eventId: OTHER_ID,
    name: 'Old tier',
    description: 'd'.repeat(900),
    priceCents: 1000,
    currency: 'USD',
    quantityTotal: 100,
    quantitySold: 3,
    minPerOrder: 60,
    maxPerOrder: 100,
    salesStartAt: null,
    salesEndAt: null,
    status: 'ON_SALE',
    sortOrder: 0,
    eventSessionId: null,
    priceZoneId: null,
    reserved: false,
    complimentary: false,
    visibility: 'PUBLIC',
    heldQuantity: 0,
    hasOrders: true,
    removable: false,
  }

  it('parses a legacy row the public shape would refuse', () => {
    expect(authorTicketTypeSchema.safeParse(legacy).success).toBe(true)
    expect(
      authorTicketTypeResponseSchema.safeParse({ data: legacy, meta: { revision: 3 } }).success,
    ).toBe(true)
    expect(
      authorTicketTypeListResponseSchema.safeParse({ data: [legacy], meta: { revision: 3 } })
        .success,
    ).toBe(true)
  })

  it('still insists on a known visibility', () => {
    expect(authorTicketTypeSchema.safeParse({ ...legacy, visibility: 'SECRET' }).success).toBe(
      false,
    )
  })
})

describe('the public event payload', () => {
  const event = {
    id: ID,
    organizationId: OTHER_ID,
    title: 'Navratri Nights',
    slug: 'navratri-nights',
    summary: 'Nine nights of garba',
    description: 'Live dhol.',
    category: 'GARBA_DANDIYA',
    startsAt: '2027-10-01T13:00:00Z',
    endsAt: '2027-10-01T18:30:00Z',
  }

  it('accepts the new content fields', () => {
    const parsed = eventWithRelationsSchema.parse({
      ...event,
      faq: [{ question: 'Parking?', answer: 'Yes.' }],
      performers: [{ name: 'Asha', role: null, bio: 'Trained in Pune.' }],
      runningOrder: [{ time: '19:30', title: 'Doors', note: null }],
      sponsors: [{ name: 'Chai Co', url: 'https://chai.example', level: null }],
      socialLinks: { instagram: 'https://instagram.com/desi' },
      dressCode: 'Festive.',
      directions: 'East gate.',
      publicEmail: 'box@example.com',
      publicPhone: '+1 555 010 2000',
    })

    expect(parsed.performers[0].bio).toBe('Trained in Pune.')
    expect(parsed.socialLinks.instagram).toBe('https://instagram.com/desi')
  })

  it('still refuses a tier with 60 per order: the presenter is the guard', () => {
    const tier = {
      id: ID,
      eventId: ID,
      name: 'General',
      priceCents: 100,
      quantityTotal: 10,
      maxPerOrder: 60,
    }

    expect(eventWithRelationsSchema.safeParse({ ...event, ticketTypes: [tier] }).success).toBe(
      false,
    )
    expect(
      eventWithRelationsSchema.safeParse({ ...event, ticketTypes: [{ ...tier, maxPerOrder: 50 }] })
        .success,
    ).toBe(true)
  })
})

describe('the session and inventory shapes', () => {
  it('carries zones, usage and removability for every session', () => {
    const session = {
      id: ID,
      eventId: OTHER_ID,
      startsAt: '2027-10-01T13:00:00.000Z',
      endsAt: '2027-10-01T18:00:00.000Z',
      doorsOpenAt: null,
      timezone: 'America/Chicago',
      salesStartAt: null,
      salesEndAt: null,
      status: 'SCHEDULED',
      venueMapVersionId: null,
      capacity: 200,
      sortOrder: 0,
      priceZones: [],
      usage: { sold: 4, held: 1 },
      removable: false,
    }

    expect(eventSessionSchema.safeParse(session).success).toBe(true)
    expect(eventSessionSchema.safeParse({ ...session, usage: undefined }).success).toBe(false)
  })

  it('reports how many seats were assigned to tiers', () => {
    expect(
      inventoryPreparationResponseSchema.safeParse({
        data: {
          sessionId: ID,
          kind: 'reserved',
          expected: 6,
          prepared: 6,
          created: 6,
          assigned: 4,
        },
      }).success,
    ).toBe(true)
  })
})

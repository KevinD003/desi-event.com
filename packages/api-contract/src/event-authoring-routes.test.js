/**
 * The authoring routes' places in the contract, their step-up declarations,
 * and the DELETE precondition's wire format.
 */

import { describe, expect, it } from 'vitest'

import { apiRoutes, routeById, routeKey } from './routes.js'

describe('event authoring routes', () => {
  it('places the new routes at the agreed method and path', () => {
    const expected = {
      'events.ticketTypes': 'GET /v1/events/:id/tiers',
      'events.reschedule': 'POST /v1/events/:id/reschedule',
      'events.rework': 'POST /v1/events/:id/rework',
      'events.removeSession': 'DELETE /v1/events/:id/sessions/:sessionId',
      'events.removeTicketType': 'DELETE /v1/events/:id/tiers/:tierId',
      // A night with sales is cancelled rather than removed (SPEC2-XI X-6).
      'events.sessionCancellationPreview': 'GET /v1/events/:id/sessions/:sessionId/cancellation',
      'events.cancelSession': 'POST /v1/events/:id/sessions/:sessionId/cancel',
    }

    for (const [id, key] of Object.entries(expected)) {
      expect(routeKey(routeById(id)), id).toBe(key)
    }
  })

  it('asks for a publish step-up to bring an event back, and none to rework one', () => {
    expect(routeById('events.reschedule').stepUp).toBe('EVENT_PUBLISH')
    expect(routeById('events.rework').stepUp).toBeUndefined()
    expect(routeById('events.ticketTypes').stepUp).toBeUndefined()
  })

  it('keeps the ticket-types read beside the other tier routes', () => {
    expect(routeById('events.ticketTypes').tags).toEqual(['ticket-types'])
    expect(routeById('events.rework').tags).toEqual(['events'])
    expect(routeById('events.reschedule').tags).toEqual(['events'])
  })

  it('accepts the revision a query string carries on every DELETE that takes one', () => {
    const withRevision = apiRoutes.filter(
      (route) =>
        route.method === 'DELETE' && route.query && 'revision' in (route.query.shape ?? {}),
    )

    // Media's, the session's and the tier's: at least these three.
    expect(withRevision.map((route) => route.id)).toEqual(
      expect.arrayContaining(['events.removeSession', 'events.removeTicketType']),
    )

    for (const route of withRevision) {
      expect(route.query.safeParse({ revision: '7' }), route.id).toMatchObject({
        success: true,
        data: { revision: 7 },
      })
      expect(route.query.safeParse({ revision: '' }).success, route.id).toBe(false)
    }
  })
})

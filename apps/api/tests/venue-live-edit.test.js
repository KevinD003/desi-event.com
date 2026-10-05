/**
 * A venue record edited while an event there is live (SPEC2 §6, P-19).
 *
 * Disclosed, not reviewed: any member holding `venue:manage` (event manager
 * and above) can change the organisation's venue records at any time, and
 * platform reviewers holding `venue:manage` can change a shared one. Every
 * event there, live ones included, shows the new name and address at once —
 * with no review, no change of status and no notice to ticket holders.
 *
 * This test pins that behaviour so a change to it is a decision somebody makes
 * on purpose, with the limitations page and the security notes updated to
 * match, rather than a side effect nobody noticed.
 *
 * @module @desi-event/api/tests/venue-live-edit
 */

import { describe, expect, it } from 'vitest'

import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const EVENT_MANAGER = 'events@rangoli.example'
const PLATFORM_ADMINISTRATOR = 'anil@desi-event.example'

/**
 * A world whose live event is at a venue its organisation owns, with tickets
 * sold and an event manager on the team.
 *
 * @returns {Promise<object>} The harness.
 */
async function liveEventAtOwnVenue() {
  const world = await makeWorld()
  const { seed, ids } = world
  const hash = seed.user.find((user) => user.email === 'priya@example.com').passwordHash
  const managerId = cuid()

  seed.user.push({
    id: managerId,
    email: EVENT_MANAGER,
    passwordHash: hash,
    displayName: 'Event Manager',
    locale: 'en-IN',
    role: 'ORGANIZER',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  seed.membership.push({
    id: cuid(),
    userId: managerId,
    organizationId: ids.organization.id,
    role: 'EVENT_MANAGER',
    createdAt: new Date(),
  })

  // The organisation's own venue record, not a shared one.
  seed.venue.find((row) => row.id === ids.venue.id).organizationId = ids.organization.id

  const harness = await createTestApp({ seed, ids })
  const bought = await harness.app.inject({
    method: 'POST',
    url: '/v1/orders',
    payload: {
      eventId: ids.publishedEvent.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    },
  })

  expect(bought.statusCode, bought.body).toBe(201)

  return harness
}

/**
 * The public event page's venue, as a stranger reads it.
 *
 * @param {object} app The instance.
 * @returns {Promise<object>} The event's public data.
 */
async function publicEvent(app) {
  const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

  expect(response.statusCode).toBe(200)

  return response.json().data
}

describe('editing a venue record while an event there is live', () => {
  it('changes the live event page at once, with no review, no status change and no notice', async () => {
    const { app, prisma, ids } = await liveEventAtOwnVenue()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)
    const before = {
      status: event.status,
      revision: event.revision,
      moderation: prisma._store.eventModerationAction.length,
      outbox: prisma._store.notificationOutbox.length,
    }

    expect((await publicEvent(app)).venue.name).toBe('Nehru Centre')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${ids.venue.id}`,
      headers: bearer(await signIn(app, EVENT_MANAGER)),
      payload: { name: 'Nehru Centre Auditorium', addressLine1: '2 Worli Sea Face' },
    })

    expect(response.statusCode, response.body).toBe(200)

    const after = await publicEvent(app)

    expect(after.venue).toMatchObject({
      name: 'Nehru Centre Auditorium',
      addressLine1: '2 Worli Sea Face',
    })

    // No review: the event is exactly as live as it was, and nobody was asked.
    expect(event.status).toBe(before.status)
    expect(event.revision).toBe(before.revision)
    expect(prisma._store.eventModerationAction).toHaveLength(before.moderation)
    // No notice to the ticket holders.
    expect(prisma._store.notificationOutbox).toHaveLength(before.outbox)
    // Recorded, as every venue edit is.
    expect(prisma._store.auditLog).toContainEqual(
      expect.objectContaining({ action: 'venue.updated', entityId: ids.venue.id }),
    )

    await app.close()
  })

  it('lets a platform reviewer holding venue:manage change a shared venue the same way', async () => {
    const { app, prisma, ids } = await liveEventAtOwnVenue()
    const shared = prisma._store.venue.find((row) => row.id === ids.otherVenue.id)

    expect(shared.organizationId).toBeNull()

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/venues/${shared.id}`,
      headers: bearer(await signIn(app, PLATFORM_ADMINISTRATOR)),
      payload: { name: 'Phoenix Hall East' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(shared.name).toBe('Phoenix Hall East')

    await app.close()
  })

  it('is still refused to a member without venue:manage, and to another organisation', async () => {
    const { app, prisma, ids } = await liveEventAtOwnVenue()

    for (const email of ['door@rangoli.example', 'rival@dhol.example']) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/venues/${ids.venue.id}`,
        headers: bearer(await signIn(app, email)),
        payload: { name: 'Taken Over' },
      })

      expect(response.statusCode, email).toBe(403)
    }

    expect(prisma._store.venue.find((row) => row.id === ids.venue.id).name).toBe('Nehru Centre')

    await app.close()
  })
})

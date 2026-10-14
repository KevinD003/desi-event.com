/**
 * The platform administrator (ADMIN), through the routes.
 *
 * ADMIN is the working role of the team at The Desi Events: it invites organisers, reviews
 * events and pictures, reads every organisation's reports and manages venues.
 * It is not a super administrator. These tests pin both halves: what it can do
 * is answered, and every super-administrator power — platform roles, direct
 * memberships, account search, organisation search, venue merges — and the door
 * and the money answer 403 or are withheld.
 *
 * @module @desi-event/api/tests/platform-admin-role
 */

import { describe, expect, it } from 'vitest'

import { PASSWORD } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'

const ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'

/**
 * Sign in as the platform administrator with a fresh second factor.
 *
 * @param {object} app The instance.
 * @param {string} [email] Who.
 * @returns {Promise<object>} Headers.
 */
async function steppedUp(app, email = ADMIN) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

describe('what a platform administrator may not do', () => {
  it('cannot change a platform role, grant a membership, search accounts or organisations, or merge venues', async () => {
    const { app, prisma, ids } = await createTestApp()
    // A fresh second factor, so the only thing standing in the way is the role.
    const headers = await steppedUp(app)
    const attempts = [
      {
        name: 'platform.setUserRole',
        method: 'POST',
        url: `/v1/platform/users/${ids.attendee.id}/role`,
        payload: { role: 'ADMIN', reason: 'Joining the team.' },
      },
      {
        name: 'platform.grantMembership',
        method: 'POST',
        url: `/v1/platform/organizations/${ids.organization.id}/members`,
        payload: { userId: ids.attendee.id, role: 'OWNER', reason: 'Their only owner left.' },
      },
      {
        name: 'platform.searchUsers',
        method: 'POST',
        url: '/v1/platform/users/search',
        payload: { q: 'priya' },
      },
      {
        name: 'platform.searchOrganizations',
        method: 'GET',
        url: '/v1/platform/organizations?q=rangoli',
      },
      {
        name: 'venues.merge',
        method: 'POST',
        url: `/v1/venues/${ids.otherVenue.id}/merge`,
        payload: { intoVenueId: ids.venue.id, reason: 'Same hall, entered twice.' },
      },
    ]

    for (const { name, ...request } of attempts) {
      const response = await app.inject({ ...request, headers })

      expect(response.statusCode, name).toBe(403)
      expect(response.json().error.code, name).toBe('FORBIDDEN')
    }

    expect(prisma._store.user.find((row) => row.id === ids.attendee.id).role).toBe('ATTENDEE')
    expect(
      prisma._store.membership.some(
        (row) => row.userId === ids.attendee.id && row.organizationId === ids.organization.id,
      ),
    ).toBe(false)
    expect(
      prisma._store.venue.find((row) => row.id === ids.otherVenue.id).mergedIntoVenueId,
    ).toBeNull()

    await app.close()
  })

  it('cannot admit anybody at a door: it is offered no events', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets/admission/events',
      headers: bearer(await signIn(app, ADMIN)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([])
    expect(response.json().meta).toEqual({
      scope: 'MEMBERSHIPS',
      organizations: [],
      truncated: false,
    })

    await app.close()
  })

  it('is refused at the door with a real ticket, and the attempt is audited', async () => {
    const { app, prisma, ids } = await createTestApp()
    const bought = await app.inject({
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

    const [ticket] = bought.json().data.tickets
    const response = await app.inject({
      method: 'POST',
      url: '/v1/tickets/admission/preview',
      headers: bearer(await signIn(app, ADMIN)),
      payload: { code: ticket.code },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.auditLog).toContainEqual(
      expect.objectContaining({
        action: 'ticket.admission_refused',
        entityType: 'User',
        entityId: ids.platformAdministrator.id,
        metadata: expect.objectContaining({
          reason: 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY',
          platformRole: 'ADMIN',
        }),
      }),
    )
    expect(prisma._store.checkIn ?? []).toHaveLength(0)

    await app.close()
  })

  it("reads an organisation's report with the money withheld: it holds no finance capability", async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await steppedUp(app),
    })

    expect(response.statusCode).toBe(200)

    const view = response.json().data

    expect(view.moneyVisible).toBe(false)
    expect(view.moneyWithheld).toBe('CAPABILITY')
    expect(view.money).toBeNull()

    await app.close()
  })

  it('needs a second factor like every staff account (NF-12)', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.mfaFactor = prisma._store.mfaFactor.filter(
      (row) => row.userId !== ids.platformAdministrator.id,
    )

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: ADMIN, password: PASSWORD },
    })

    expect(login.statusCode).toBe(200)

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/events',
      headers: bearer(login.json().token),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })
})

describe('what a platform administrator does', () => {
  it('reads the review queue and the organiser invitation queue', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, ADMIN))

    for (const url of ['/v1/moderation/events', '/v1/platform/organizer-invitations']) {
      const response = await app.inject({ method: 'GET', url, headers })

      expect(response.statusCode, url).toBe(200)
    }

    await app.close()
  })

  it('approves an event it is independent of', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${event.id}/decision`,
      headers: await steppedUp(app),
      payload: { decision: 'approve', revision: event.revision },
    })

    expect(response.statusCode).toBe(200)
    expect(event.status).toBe('APPROVED')

    await app.close()
  })
})

describe('making a platform administrator', () => {
  it('is a super administrator’s decision, recorded with its reason', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/users/${ids.attendee.id}/role`,
      headers: await steppedUp(app, SUPER_ADMIN),
      payload: { role: 'ADMIN', reason: 'Joining the review team.' },
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.user.find((row) => row.id === ids.attendee.id).role).toBe('ADMIN')

    await app.close()
  })
})

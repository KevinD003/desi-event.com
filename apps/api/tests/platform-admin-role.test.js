/**
 * The platform administrator (ADMIN), through the routes.
 *
 * Under the owner's decision of 2026-10-16 (ADR 0018) ADMIN does everything a
 * super administrator does — every event, organisation, report, refund and
 * door, account search, direct memberships and venue merges — except change
 * anybody's platform role. These tests pin both halves: what it now does is
 * answered, and changing a platform role answers 403 for every account and
 * every role, its own and a super administrator's included, with nothing
 * written. A direct grant on a super administrator's account is refused too,
 * because it ends every session that account holds.
 *
 * @module @desi-event/api/tests/platform-admin-role
 */

import { describe, expect, it } from 'vitest'

import { PASSWORD } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'

const ADMIN = 'anil@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const MODERATOR = 'maya@desi-event.example'

/** Every platform role `platform.setUserRole` takes. */
const PLATFORM_ROLES = [
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'ADMIN',
  'SUPER_ADMIN',
]

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

/**
 * A fixture account's row.
 *
 * @param {object} prisma The stub.
 * @param {string} email The address.
 * @returns {object} The user row.
 */
function userOf(prisma, email) {
  return prisma._store.user.find((row) => row.email === email)
}

/**
 * Buy one ticket for the published event, as an attendee.
 *
 * @param {object} app The instance.
 * @param {object} ids The fixture ids.
 * @returns {Promise<object>} The ticket, with its printed code.
 */
async function boughtTicket(app, ids) {
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

  return bought.json().data.tickets[0]
}

describe('what a platform administrator may not do (ADR 0018)', () => {
  it('cannot change any platform role, for any account — its own and a super administrator’s included', async () => {
    const { app, prisma } = await createTestApp()
    // A fresh second factor, so the only thing standing in the way is the role.
    const headers = await steppedUp(app)
    const targets = [
      userOf(prisma, 'priya@example.com'),
      userOf(prisma, SUPER_ADMIN),
      userOf(prisma, MODERATOR),
      userOf(prisma, ADMIN),
    ]
    const before = new Map(targets.map((row) => [row.id, row.role]))

    for (const target of targets) {
      for (const role of PLATFORM_ROLES) {
        const response = await app.inject({
          method: 'POST',
          url: `/v1/platform/users/${target.id}/role`,
          headers,
          payload: { role, reason: 'Trying to change a platform role as ADMIN.' },
        })

        expect(response.statusCode, `${target.email} → ${role}`).toBe(403)
        expect(response.json().error.code, `${target.email} → ${role}`).toBe('FORBIDDEN')
      }
    }

    for (const target of targets) {
      expect(userOf(prisma, target.email).role, target.email).toBe(before.get(target.id))
    }

    expect(
      prisma._store.auditLog.filter((row) => row.action === 'platform.role_changed'),
    ).toHaveLength(0)

    await app.close()
  })

  it('cannot make itself a super administrator', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/users/${ids.platformAdministrator.id}/role`,
      headers: await steppedUp(app),
      payload: { role: 'SUPER_ADMIN', reason: 'Promoting myself.' },
    })

    expect(response.statusCode).toBe(403)
    expect(userOf(prisma, ADMIN).role).toBe('ADMIN')

    await app.close()
  })

  it('cannot use the direct grant on a super administrator’s account, which would sign them out', async () => {
    const { app, prisma, ids } = await createTestApp()
    const root = userOf(prisma, SUPER_ADMIN)
    const sessionsBefore = prisma._store.session.filter(
      (row) => row.userId === root.id && !row.revokedAt,
    ).length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${ids.organization.id}/members`,
      headers: await steppedUp(app),
      payload: { userId: root.id, role: 'VIEWER', reason: 'Trying to sign them out.' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.message).toMatch(/Only a super administrator/u)
    expect(
      prisma._store.membership.some(
        (row) => row.userId === root.id && row.organizationId === ids.organization.id,
      ),
    ).toBe(false)
    expect(
      prisma._store.session.filter((row) => row.userId === root.id && !row.revokedAt).length,
    ).toBe(sessionsBefore)

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

describe('what a platform administrator does (ADR 0018)', () => {
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

  it('searches accounts and organisations, grants a membership and merges venues', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)

    const accounts = await app.inject({
      method: 'POST',
      url: '/v1/platform/users/search',
      headers,
      payload: { q: 'priya' },
    })

    expect(accounts.statusCode, accounts.body).toBe(200)
    expect(accounts.json().data.map((row) => row.email)).toContain('priya@example.com')

    const organizations = await app.inject({
      method: 'GET',
      url: '/v1/platform/organizations?q=rangoli',
      headers,
    })

    expect(organizations.statusCode, organizations.body).toBe(200)
    expect(organizations.json().data.map((row) => row.id)).toContain(ids.organization.id)
    expect(organizations.json().data.every((row) => row.platformHeld === false)).toBe(true)

    const granted = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${ids.organization.id}/members`,
      headers,
      payload: { userId: ids.attendee.id, role: 'OWNER', reason: 'Their only owner left.' },
    })

    expect(granted.statusCode, granted.body).toBe(200)
    expect(granted.json().data).toMatchObject({ role: 'OWNER', created: true })
    // An organisation role, never a platform one.
    expect(userOf(prisma, 'priya@example.com').role).toBe('ATTENDEE')
    expect(prisma._store.auditLog).toContainEqual(
      expect.objectContaining({
        action: 'platform.membership_granted',
        actorId: ids.platformAdministrator.id,
      }),
    )

    const merged = await app.inject({
      method: 'POST',
      url: `/v1/venues/${ids.otherVenue.id}/merge`,
      headers,
      payload: { intoVenueId: ids.venue.id, reason: 'Same hall, entered twice.' },
    })

    expect(merged.statusCode, merged.body).toBe(200)
    expect(prisma._store.venue.find((row) => row.id === ids.otherVenue.id).mergedIntoVenueId).toBe(
      ids.venue.id,
    )

    await app.close()
  })

  it('is offered every door on the platform, on platform authority recorded as ADMIN', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/tickets/admission/events',
      headers: bearer(await signIn(app, ADMIN)),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data, meta } = response.json()

    expect(meta.scope).toBe('PLATFORM')
    expect(data.map((entry) => entry.event.id)).toContain(ids.publishedEvent.id)
    expect(data.every((entry) => entry.authority === 'PLATFORM_ROLE')).toBe(true)
    // Its own role, never a super administrator's.
    expect(data.every((entry) => entry.role === 'ADMIN')).toBe(true)

    await app.close()
  })

  it('admits at a door with a real ticket, and the event’s record names ADMIN', async () => {
    const { app, prisma, ids } = await createTestApp()
    const ticket = await boughtTicket(app, ids)
    const headers = bearer(await signIn(app, ADMIN))

    const looked = await app.inject({
      method: 'POST',
      url: '/v1/tickets/admission/preview',
      headers,
      payload: { code: ticket.code },
    })

    expect(looked.statusCode, looked.body).toBe(200)
    expect(looked.json().data.outcome).toBe('ADMISSIBLE')

    const admitted = await app.inject({
      method: 'POST',
      url: '/v1/tickets/check-in',
      headers,
      payload: { code: ticket.code, previewReference: looked.json().data.previewReference },
    })

    expect(admitted.statusCode, admitted.body).toBe(200)
    expect(admitted.json().data.outcome).toBe('ADMITTED')

    const checkedIn = prisma._store.auditLog.find(
      (row) => row.action === 'ticket.checked_in' && row.actorId === ids.platformAdministrator.id,
    )

    expect(checkedIn.metadata).toMatchObject({ authority: 'PLATFORM_ROLE', role: 'ADMIN' })

    const onTheEvent = prisma._store.auditLog.filter(
      (row) =>
        row.action === 'ticket.admission_platform_authority' &&
        row.entityId === ids.publishedEvent.id,
    )

    expect(onTheEvent.map((row) => row.metadata.operation).sort()).toEqual(['check_in', 'preview'])
    expect(onTheEvent.every((row) => row.metadata.role === 'ADMIN')).toBe(true)
    expect(
      prisma._store.auditLog.some(
        (row) => row.metadata?.reason === 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY',
      ),
    ).toBe(false)

    await app.close()
  })

  it("reads an organisation's report with its money, as a super administrator does", async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await steppedUp(app),
    })

    expect(response.statusCode).toBe(200)

    const view = response.json().data

    expect(view.moneyVisible).toBe(true)
    expect(view.moneyWithheld).toBeNull()
    expect(view.money).not.toBeNull()

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

  it('a super administrator can also revoke one, and the revoked account ends every session', async () => {
    const { app, prisma, ids } = await createTestApp()

    await signIn(app, ADMIN)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/users/${ids.platformAdministrator.id}/role`,
      headers: await steppedUp(app, SUPER_ADMIN),
      payload: { role: 'ATTENDEE', reason: 'Left the team.' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toMatchObject({ from: 'ADMIN', role: 'ATTENDEE' })
    expect(response.json().data.sessionsRevoked).toBeGreaterThan(0)
    expect(userOf(prisma, ADMIN).role).toBe('ATTENDEE')

    await app.close()
  })
})

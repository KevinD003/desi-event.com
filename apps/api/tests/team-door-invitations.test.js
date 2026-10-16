/**
 * Door access given by invitation, for named events (ADR 0019).
 *
 * The owner's decision of 2026-10-16: "Organizer of the event, organizer gives
 * access to anyone to scan the tickets." A team invitation for a door role
 * (STAFF, SCANNER) carries the events it will admit at; accepting it makes
 * them the new member's door scope in the same transaction. These tests try
 * the ways that goes wrong against the stub: events of another organisation,
 * events on a role that does not work a door, a manager reaching a door it is
 * not scoped to, a reissue that loses or widens the events, and the
 * platform-held organisation taking anything but a door scanner. What only
 * PostgreSQL can answer — the triggers, and admitting at the door afterwards —
 * is in `door-grants-integration.test.js`.
 *
 * @module @desi-event/api/tests/team-door-invitations
 */

import { describe, expect, it } from 'vitest'

import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const OWNER = 'owner@rangoli.example'
const MANAGER = 'arun@rangoli.example'
const ADMIN = 'anil@desi-event.example'
const MODERATOR = 'maya@desi-event.example'
const INVITEE = 'priya@example.com'

/**
 * The shared world, with an owner in the first organisation, and the
 * platform-held organisation that holds imported events with one event of its
 * own.
 *
 * @returns {Promise<object>} The harness, plus `owner`, `held` and `heldEvent`.
 */
async function createDoorApp() {
  const { seed, ids } = await makeWorld()
  const hash = seed.user.find((user) => user.email === INVITEE).passwordHash
  const ownerId = cuid()

  seed.user.push({
    id: ownerId,
    email: OWNER,
    passwordHash: hash,
    displayName: 'Rangoli Owner',
    locale: 'en-IN',
    role: 'ORGANIZER',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  seed.membership.push({
    id: cuid(),
    userId: ownerId,
    organizationId: ids.organization.id,
    role: 'OWNER',
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  const held = {
    ...ids.otherOrganization,
    id: cuid(),
    name: 'The Desi Events',
    slug: 'the-desi-events',
    platformHeldSource: 'SULEKHA',
  }
  const heldEvent = {
    ...ids.publishedEvent,
    id: cuid(),
    organizationId: held.id,
    title: 'Toronto Garba',
    slug: `toronto-garba-${cuid()}`,
  }

  seed.organization.push(held)
  seed.event.push(heldEvent)

  const harness = await createTestApp({ seed, ids })

  return { ...harness, ownerId, held, heldEvent }
}

/**
 * Invite somebody.
 *
 * @param {object} app The instance.
 * @param {string} organizationId Where.
 * @param {string} as Who invites.
 * @param {object} payload The body.
 * @returns {Promise<object>} The inject result.
 */
async function invite(app, organizationId, as, payload) {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/invitations`,
    headers: bearer(await signIn(app, as)),
    payload: { email: INVITEE, ...payload },
  })
}

/**
 * Accept an invitation as the invitee.
 *
 * @param {object} app The instance.
 * @param {string} code The invitation code.
 * @returns {Promise<object>} The inject result.
 */
async function accept(app, code) {
  return app.inject({
    method: 'POST',
    url: '/v1/invitations/accept',
    headers: bearer(await signIn(app, INVITEE)),
    payload: { token: code },
  })
}

/**
 * The invitations of an organisation, as stored.
 *
 * @param {object} prisma The stub.
 * @param {string} organizationId Which organisation.
 * @returns {object[]} The rows.
 */
function invitationsOf(prisma, organizationId) {
  return prisma._store.invitation.filter((row) => row.organizationId === organizationId)
}

describe('an organiser gives door access for chosen events by invitation', () => {
  it('stores the events with the invitation, shows them, and records them', async () => {
    const { app, prisma, ids } = await createDoorApp()

    const response = await invite(app, ids.organization.id, OWNER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id, ids.publishedEvent.id],
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.events).toEqual([
      { id: ids.publishedEvent.id, title: ids.publishedEvent.title },
    ])

    const invitationId = response.json().data.id

    expect(
      prisma._store.invitationScope
        .filter((row) => row.invitationId === invitationId)
        .map((row) => row.eventId),
    ).toEqual([ids.publishedEvent.id])

    const audit = prisma._store.auditLog.find(
      (row) => row.action === 'team.invited' && row.entityId === invitationId,
    )

    expect(audit.metadata).toMatchObject({ role: 'SCANNER', eventIds: [ids.publishedEvent.id] })
    expect(JSON.stringify(audit.metadata)).not.toContain(
      response.json().data.delivery.invitationCode,
    )

    const team = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/members`,
      headers: bearer(await signIn(app, OWNER)),
    })

    expect(team.statusCode).toBe(200)
    expect(team.json().data.invitations.find((row) => row.id === invitationId).events).toEqual([
      { id: ids.publishedEvent.id, title: ids.publishedEvent.title },
    ])

    await app.close()
  })

  it('makes the events the new member’s door scope when they accept, and says which', async () => {
    const { app, prisma, ids } = await createDoorApp()
    const issued = await invite(app, ids.organization.id, OWNER, {
      role: 'STAFF',
      eventIds: [ids.publishedEvent.id],
    })

    const accepted = await accept(app, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({
      role: 'STAFF',
      joined: true,
      events: [{ id: ids.publishedEvent.id, title: ids.publishedEvent.title }],
    })

    const membership = prisma._store.membership.find(
      (row) => row.userId === ids.attendee.id && row.organizationId === ids.organization.id,
    )

    expect(
      prisma._store.scannerScope
        .filter((row) => row.membershipId === membership.id)
        .map((row) => row.eventId),
    ).toEqual([ids.publishedEvent.id])
    expect(
      prisma._store.auditLog.find((row) => row.action === 'team.invitation_accepted').metadata,
    ).toMatchObject({ role: 'STAFF', scopedEventIds: [ids.publishedEvent.id] })

    await app.close()
  })

  it('an invitation without events still admits nobody until its events are chosen', async () => {
    const { app, prisma, ids } = await createDoorApp()
    const issued = await invite(app, ids.organization.id, OWNER, { role: 'SCANNER' })

    expect(issued.statusCode).toBe(201)
    expect(issued.json().data.events).toEqual([])

    const accepted = await accept(app, issued.json().data.delivery.invitationCode)

    expect(accepted.json().data.events).toEqual([])

    const membership = prisma._store.membership.find(
      (row) => row.userId === ids.attendee.id && row.organizationId === ids.organization.id,
    )

    expect(prisma._store.scannerScope.filter((row) => row.membershipId === membership.id)).toEqual(
      [],
    )

    await app.close()
  })

  it.each(['VIEWER', 'FINANCE'])(
    'refuses events on an invitation for %s, writing nothing',
    async (role) => {
      const { app, prisma, ids } = await createDoorApp()
      const before = invitationsOf(prisma, ids.organization.id).length

      const response = await invite(app, ids.organization.id, OWNER, {
        role,
        eventIds: [ids.publishedEvent.id],
      })

      expect(response.statusCode).toBe(422)
      expect(response.json().error.message).toMatch(/Only a door role/u)
      expect(invitationsOf(prisma, ids.organization.id)).toHaveLength(before)
      expect(prisma._store.invitationScope).toHaveLength(0)

      await app.close()
    },
  )

  it('refuses another organisation’s event, or one that does not exist, writing nothing', async () => {
    const { app, prisma, ids } = await createDoorApp()
    const before = invitationsOf(prisma, ids.organization.id).length

    for (const eventId of [ids.onlineEvent.id, cuid()]) {
      const response = await invite(app, ids.organization.id, OWNER, {
        role: 'SCANNER',
        eventIds: [ids.publishedEvent.id, eventId],
      })

      expect(response.statusCode, eventId).toBe(422)
      // The refusal names no event, so it says nothing of another organisation's.
      expect(response.body).not.toContain(ids.onlineEvent.title)
    }

    expect(invitationsOf(prisma, ids.organization.id)).toHaveLength(before)
    expect(prisma._store.invitationScope).toHaveLength(0)

    await app.close()
  })

  it('lets a manager give door access only for the events it is scoped to itself', async () => {
    const { app, prisma, ids } = await createDoorApp()

    // Scoped nowhere: no event is the manager's to give.
    const unscoped = await invite(app, ids.organization.id, MANAGER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id],
    })

    expect(unscoped.statusCode).toBe(403)
    expect(unscoped.json().error.message).toMatch(/only for the events you are scoped to/u)

    const manager = prisma._store.membership.find(
      (row) => row.userId === ids.manager.id && row.organizationId === ids.organization.id,
    )

    prisma._store.scannerScope.push({
      id: cuid(),
      membershipId: manager.id,
      eventId: ids.publishedEvent.id,
      createdAt: new Date(),
    })

    const beyond = await invite(app, ids.organization.id, MANAGER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id, ids.draftEvent.id],
    })

    expect(beyond.statusCode).toBe(403)

    const own = await invite(app, ids.organization.id, MANAGER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id],
    })

    expect(own.statusCode, own.body).toBe(201)
    expect(own.json().data.events.map((event) => event.id)).toEqual([ids.publishedEvent.id])

    // Without events a manager invites as it always did.
    const none = await invite(app, ids.organization.id, MANAGER, { role: 'STAFF' })

    expect(none.statusCode).toBe(201)

    await app.close()
  })

  it('keeps the events on a new code, and refuses a manager a code for events it is not scoped to', async () => {
    const { app, prisma, ids } = await createDoorApp()
    const issued = await invite(app, ids.organization.id, OWNER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id, ids.draftEvent.id],
    })
    const invitationId = issued.json().data.id

    // A manager reissuing it would be holding a door it cannot open.
    const refused = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/invitations/${invitationId}/reissue`,
      headers: bearer(await signIn(app, MANAGER)),
    })

    expect(refused.statusCode).toBe(403)

    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/invitations/${invitationId}/reissue`,
      headers: bearer(await signIn(app, OWNER)),
    })

    expect(reissued.statusCode, reissued.body).toBe(201)

    const replacement = reissued.json().data

    expect(replacement.events.map((event) => event.id).sort()).toEqual(
      [ids.publishedEvent.id, ids.draftEvent.id].sort(),
    )
    expect(
      prisma._store.invitationScope
        .filter((row) => row.invitationId === replacement.id)
        .map((row) => row.eventId)
        .sort(),
    ).toEqual([ids.publishedEvent.id, ids.draftEvent.id].sort())

    await app.close()
  })

  it('leaves an existing membership and its scopes alone when its holder accepts', async () => {
    const { app, prisma, ids } = await createDoorApp()
    const issued = await invite(app, ids.organization.id, OWNER, {
      role: 'SCANNER',
      eventIds: [ids.publishedEvent.id],
    })
    const existing = {
      id: cuid(),
      userId: ids.attendee.id,
      organizationId: ids.organization.id,
      role: 'VIEWER',
      createdAt: new Date(),
    }

    prisma._store.membership.push(existing)

    const accepted = await accept(app, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({ role: 'VIEWER', joined: false, events: [] })
    expect(prisma._store.scannerScope.filter((row) => row.membershipId === existing.id)).toEqual([])

    await app.close()
  })
})

describe('door scanners for imported events, invited by a platform administrator', () => {
  it('lets a platform ADMIN invite a door scanner for an imported event, and nothing else', async () => {
    const { app, prisma, held, heldEvent } = await createDoorApp()

    const team = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${held.id}/members`,
      headers: bearer(await signIn(app, ADMIN)),
    })

    expect(team.statusCode, team.body).toBe(200)
    expect(team.json().data.assignableRoles).toEqual(['SCANNER'])

    for (const role of ['STAFF', 'VIEWER', 'FINANCE']) {
      const refused = await invite(app, held.id, ADMIN, { role })

      expect(refused.statusCode, role).toBe(403)
      expect(refused.json().error.message, role).toMatch(/only members are door scanners/u)
    }

    for (const role of ['MANAGER', 'ADMIN', 'EVENT_MANAGER']) {
      const refused = await invite(app, held.id, ADMIN, { role })

      expect(refused.statusCode, role).toBe(403)
      expect(refused.json().error.code, role).toBe('POSTING_ROLE_NEEDS_PLATFORM')
    }

    const issued = await invite(app, held.id, ADMIN, {
      role: 'SCANNER',
      eventIds: [heldEvent.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)
    expect(issued.json().data.events).toEqual([{ id: heldEvent.id, title: 'Toronto Garba' }])

    const accepted = await accept(app, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({
      organizationId: held.id,
      role: 'SCANNER',
      events: [{ id: heldEvent.id, title: 'Toronto Garba' }],
    })

    const membership = prisma._store.membership.find((row) => row.organizationId === held.id)

    expect(membership.role).toBe('SCANNER')
    expect(
      prisma._store.scannerScope
        .filter((row) => row.membershipId === membership.id)
        .map((row) => row.eventId),
    ).toEqual([heldEvent.id])

    await app.close()
  })

  it('lets a super administrator do the same', async () => {
    const { app, held, heldEvent } = await createDoorApp()

    const issued = await invite(app, held.id, 'ops@desi-event.example', {
      role: 'SCANNER',
      eventIds: [heldEvent.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)

    await app.close()
  })

  it('refuses a moderator and an organiser of another organisation', async () => {
    const { app, held, heldEvent } = await createDoorApp()

    for (const who of [MODERATOR, OWNER]) {
      const refused = await invite(app, held.id, who, {
        role: 'SCANNER',
        eventIds: [heldEvent.id],
      })

      expect(refused.statusCode, who).toBe(403)
    }

    await app.close()
  })

  it('lets a platform ADMIN change a scanner’s events and remove it, and never move it to another role', async () => {
    const { app, prisma, held, heldEvent, ids } = await createDoorApp()
    const issued = await invite(app, held.id, ADMIN, { role: 'SCANNER' })

    await accept(app, issued.json().data.delivery.invitationCode)

    const membership = prisma._store.membership.find((row) => row.organizationId === held.id)
    const headers = bearer(await signIn(app, ADMIN))
    const url = `/v1/organizations/${held.id}/members/${membership.id}`

    const team = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${held.id}/members`,
      headers,
    })

    expect(team.json().data.members.find((row) => row.id === membership.id).roleChoices).toEqual([
      'SCANNER',
    ])

    const rescoped = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { role: 'SCANNER', eventIds: [heldEvent.id] },
    })

    expect(rescoped.statusCode, rescoped.body).toBe(200)
    expect(
      prisma._store.scannerScope
        .filter((row) => row.membershipId === membership.id)
        .map((row) => row.eventId),
    ).toEqual([heldEvent.id])

    // An organiser's event is not the platform-held organisation's.
    const foreign = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { role: 'SCANNER', eventIds: [ids.publishedEvent.id] },
    })

    expect(foreign.statusCode).toBe(422)

    const moved = await app.inject({
      method: 'PATCH',
      url,
      headers,
      payload: { role: 'STAFF', eventIds: [heldEvent.id] },
    })

    expect(moved.statusCode).toBe(403)
    expect(membership.role).toBe('SCANNER')

    const removed = await app.inject({
      method: 'POST',
      url: `${url}/remove`,
      headers,
      payload: { reason: 'The festival is over.' },
    })

    expect(removed.statusCode, removed.body).toBe(200)
    expect(prisma._store.membership.some((row) => row.id === membership.id)).toBe(false)

    await app.close()
  })
})

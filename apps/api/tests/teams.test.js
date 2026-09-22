/**
 * Team management, attacked.
 *
 * Almost every test here is somebody trying to get a power they were not given.
 * The four attacks the routes are built against — self-escalation, escalation
 * through a third party, last-owner removal, and invitation replay or forwarding
 * — each get a section, and each section tries the attack rather than asserting
 * that a guard function was called.
 *
 * The fifth, cross-tenant access, is tested throughout: a member of one
 * organisation acting on another's rows must see 404, not 403, because 403
 * confirms the id exists.
 *
 * @module @desi-event/api/tests/teams
 */

import { describe, expect, it } from 'vitest'

import { makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * A harness with a team whose roles are worth attacking.
 *
 * The shared world has one organisation with a manager, staff and viewer. This
 * adds an owner, a second admin, a finance member and an event manager, because
 * the interesting refusals are between peers rather than between a manager and a
 * viewer.
 *
 * @returns {Promise<object>} The harness plus the ids the tests use.
 */
async function createTeamApp() {
  const world = await makeWorld()
  const { seed, ids } = world
  const hash = seed.user.find((user) => user.email === 'priya@example.com').passwordHash

  /**
   * Add a user and a membership in the main organisation.
   *
   * @param {string} email The address.
   * @param {string} role The organisation role.
   * @returns {{userId: string, membershipId: string}} The new ids.
   */
  const member = (email, role) => {
    const userId = cuid()
    const membershipId = cuid()

    seed.user.push({
      id: userId,
      email,
      passwordHash: hash,
      displayName: email.split('@')[0],
      locale: 'en-IN',
      role: 'ORGANIZER',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    seed.membership.push({
      id: membershipId,
      userId,
      organizationId: ids.organization.id,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    return { userId, membershipId }
  }

  const owner = member('owner@rangoli.example', 'OWNER')
  const admin = member('admin@rangoli.example', 'ADMIN')
  const finance = member('money@rangoli.example', 'FINANCE')
  const eventManager = member('events@rangoli.example', 'EVENT_MANAGER')
  const scanner = member('scanner@rangoli.example', 'SCANNER')

  const harness = await createTestApp({ seed, ids })

  return { ...harness, team: { owner, admin, finance, eventManager, scanner } }
}

/** The organisation every test acts in. */
const org = (ids) => ids.organization.id

describe('GET /v1/organizations/:id/members', () => {
  it('lists the team with each role and the roles the caller may grant', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()
    expect(data.members.length).toBeGreaterThanOrEqual(6)
    expect(data.members.find((member) => member.role === 'OWNER').self).toBe(true)
    // OWNER can grant everything except OWNER, which transfers separately.
    expect(data.assignableRoles).not.toContain('OWNER')
    expect(data.assignableRoles).toContain('ADMIN')

    await app.close()
  })

  it('tells each caller only the roles their own role can grant', async () => {
    const { app, ids } = await createTeamApp()

    const asAdmin = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(await signIn(app, 'admin@rangoli.example')),
    })
    const asManager = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(await signIn(app, 'arun@rangoli.example')),
    })

    const adminRoles = asAdmin.json().data.assignableRoles
    const managerRoles = asManager.json().data.assignableRoles

    expect(adminRoles.length).toBeGreaterThan(managerRoles.length)
    expect(managerRoles).not.toContain('ADMIN')

    await app.close()
  })

  it('refuses a member of another organisation with 403', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('answers 403, not 404, for an organisation the caller does not manage', async () => {
    const { app } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${cuid()}/members`,
      headers: bearer(token),
    })

    // The capability check runs before the row is loaded, so an organiser gets
    // the same answer for an organisation that does not exist and one that
    // belongs to somebody else. That is the more private of the two orders:
    // 404-then-403 would turn this route into an organisation-id oracle.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('answers 404 for a platform admin, who may view any organisation', async () => {
    const { app } = await createTeamApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${cuid()}/members`,
      headers: bearer(token),
    })

    // Their capability is not scoped, so they reach the handler and get the
    // honest answer.
    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('carries no more of a colleague than a team list needs', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(token),
    })

    expect(response.body).not.toContain('passwordHash')
    expect(response.body).not.toContain('scrypt$')

    await app.close()
  })
})

describe('escalation through an invitation', () => {
  it('lets an owner invite an admin', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(token),
      payload: { email: 'new-admin@example.com', role: 'ADMIN' },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.role).toBe('ADMIN')
    // The secret is never in the response: an invitation is delivered, not
    // handed back to the person who created it.
    expect(response.body).not.toContain(prisma._store.invitation[0].tokenHash)

    await app.close()
  })

  it('refuses a manager inviting an admin', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(token),
      payload: { email: 'accomplice@example.com', role: 'ADMIN' },
    })

    // The attack: invite an accomplice above yourself, then ask them for what
    // you could not grant yourself.
    expect(response.statusCode).toBe(403)
    expect(prisma._store.invitation).toHaveLength(0)

    await app.close()
  })

  it('refuses an OWNER invitation from anybody, including an owner', async () => {
    const { app, ids } = await createTeamApp()

    for (const email of ['owner@rangoli.example', 'admin@rangoli.example']) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/organizations/${org(ids)}/invitations`,
        headers: bearer(await signIn(app, email)),
        payload: { email: 'new-owner@example.com', role: 'OWNER' },
      })

      // Refused by schema: ownership transfers through its own route, because
      // "make them an owner" and "stop being the owner" are one action.
      expect(response.statusCode).toBe(400)
    }

    await app.close()
  })

  it('refuses a role a peer holds but the caller does not', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'events@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(token),
      payload: { email: 'money@example.com', role: 'FINANCE' },
    })

    // EVENT_MANAGER and FINANCE are peers with disjoint powers. Neither may
    // grant the other, which a seniority number would get wrong.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a viewer inviting anybody at all', async () => {
    const { app, ids } = await createTeamApp()
    // The shared world's VIEWER, whose address is a historical accident.
    const token = await signIn(app, 'finance@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(token),
      payload: { email: 'anybody@example.com', role: 'VIEWER' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses inviting somebody who is already a member', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(token),
      payload: { email: 'admin@rangoli.example', role: 'STAFF' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses inviting into another organisation', async () => {
    const { app, ids } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.otherOrganization.id}/invitations`,
      headers: bearer(token),
      payload: { email: 'anybody@example.com', role: 'STAFF' },
    })

    // Holding team:invite in one organisation is not holding it in another.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('supersedes an earlier invitation to the same address', async () => {
    const delivered = []
    const world = await makeWorld()
    const { app, ids, prisma } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      deliver: async (message) => delivered.push(message),
    })
    const token = await signIn(app, 'arun@rangoli.example')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/organizations/${org(ids)}/invitations`,
        headers: bearer(token),
        payload: { email: 'twice@example.com', role: 'STAFF' },
      })
      expect(response.statusCode).toBe(201)
    }

    const pending = prisma._store.invitation.filter((invitation) => invitation.status === 'PENDING')

    // Exactly one live link. Two would mean revoking one leaves a way in.
    expect(pending).toHaveLength(1)
    expect(delivered).toHaveLength(2)

    await app.close()
  })
})

describe('accepting an invitation', () => {
  /**
   * Invite an address and return the delivered token.
   *
   * @param {object} options Options.
   * @param {string} options.email Who to invite.
   * @param {string} [options.role] What role.
   * @returns {Promise<object>} The harness plus the token.
   */
  async function invite({ email, role = 'STAFF' }) {
    const delivered = []
    const world = await makeWorld()
    const harness = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      deliver: async (message) => delivered.push(message),
    })
    const token = await signIn(harness.app, 'arun@rangoli.example')

    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(harness.ids)}/invitations`,
      headers: bearer(token),
      payload: { email, role },
    })

    expect(response.statusCode).toBe(201)

    return { ...harness, invitationToken: delivered.at(-1).token }
  }

  it('adds the invited person to the organisation', async () => {
    const { app, ids, invitationToken, prisma } = await invite({ email: 'priya@example.com' })
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(token),
      payload: { token: invitationToken },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ organizationId: org(ids), role: 'STAFF' })

    const membership = prisma._store.membership.find(
      (row) => row.organizationId === org(ids) && row.role === 'STAFF',
    )
    expect(membership).toBeTruthy()

    await app.close()
  })

  it('refuses a link forwarded to somebody else', async () => {
    const { app, invitationToken, prisma } = await invite({ email: 'priya@example.com' })
    const before = prisma._store.membership.length

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'door@rangoli.example')),
      payload: { token: invitationToken },
    })

    // The forwarding attack. An invitation is addressed to a person, not
    // bearer-payable to whoever holds the link.
    expect(response.statusCode).toBe(403)
    // Masked: the holder of a forwarded link is not the person it was sent to.
    // It used to name the address in full.
    expect(response.json().error.message).toContain('p***a@example.com')
    expect(response.json().error.message).not.toContain('priya@example.com')
    expect(prisma._store.membership).toHaveLength(before)

    await app.close()
  })

  it('refuses an anonymous caller, so a link alone is not a way in', async () => {
    const { app, invitationToken } = await invite({ email: 'priya@example.com' })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      payload: { token: invitationToken },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses the same link twice', async () => {
    const { app, invitationToken } = await invite({ email: 'priya@example.com' })
    const token = await signIn(app, 'priya@example.com')
    const payload = { token: invitationToken }

    const first = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(token),
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(token),
      payload,
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(403)

    await app.close()
  })

  it('lets only one of two simultaneous acceptances create a membership', async () => {
    const { app, ids, invitationToken, prisma } = await invite({ email: 'priya@example.com' })
    const token = await signIn(app, 'priya@example.com')
    const payload = { token: invitationToken }

    const results = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: bearer(token),
        payload,
      }),
      app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: bearer(token),
        payload,
      }),
    ])

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1)
    expect(
      prisma._store.membership.filter(
        (row) =>
          row.organizationId === org(ids) &&
          row.userId === prisma._store.user.find((u) => u.email === 'priya@example.com').id,
      ),
    ).toHaveLength(1)

    await app.close()
  })

  it('refuses an expired invitation', async () => {
    const { app, invitationToken, prisma } = await invite({ email: 'priya@example.com' })

    for (const invitation of prisma._store.invitation) {
      invitation.expiresAt = minutesFromNow(-1)
    }

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: invitationToken },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses a revoked invitation', async () => {
    const { app, ids, invitationToken, prisma } = await invite({ email: 'priya@example.com' })
    const manager = await signIn(app, 'arun@rangoli.example')

    const revoked = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations/${prisma._store.invitation[0].id}/revoke`,
      headers: bearer(manager),
    })
    expect(revoked.statusCode).toBe(200)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: invitationToken },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it.each([
    ['a token that was never issued', 'a'.repeat(43)],
    ['a token from another system', 'not-a-real-invitation-token-at-all-abcdef'],
  ])('refuses %s', async (_label, invalid) => {
    const { app } = await invite({ email: 'priya@example.com' })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: invalid },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('answers 404 when revoking an invitation from another organisation', async () => {
    const { app, ids, prisma } = await invite({ email: 'priya@example.com' })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.otherOrganization.id}/invitations/${prisma._store.invitation[0].id}/revoke`,
      headers: bearer(await signIn(app, 'rival@dhol.example')),
    })

    // Scoped by organisation in the same query that finds it, so an id from
    // elsewhere is not found rather than found-and-refused.
    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('changing a role', () => {
  it('lets an owner change a member role', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${team.finance.membershipId}`,
      headers: bearer(token),
      payload: { role: 'EVENT_MANAGER' },
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.membership.find((row) => row.id === team.finance.membershipId).role).toBe(
      'EVENT_MANAGER',
    )

    await app.close()
  })

  it('refuses a caller changing their own role', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${team.admin.membershipId}`,
      headers: bearer(token),
      payload: { role: 'STAFF' },
    })

    // Self-escalation, in its plainest form. An ADMIN who can change roles must
    // not be able to change their own — in either direction, because a demotion
    // followed by a promotion is a promotion.
    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === team.admin.membershipId).role).toBe(
      'ADMIN',
    )

    await app.close()
  })

  it('refuses a manager promoting somebody to admin', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${team.finance.membershipId}`,
      headers: bearer(token),
      payload: { role: 'ADMIN' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === team.finance.membershipId).role).toBe(
      'FINANCE',
    )

    await app.close()
  })

  it('refuses acting on somebody the caller has no power over', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${team.admin.membershipId}`,
      headers: bearer(token),
      payload: { role: 'STAFF' },
    })

    // Granting STAFF is a power a MANAGER might have; using it to demote the
    // organisation's ADMIN is not. Without this check the manager demotes the
    // admin and then grants themselves anything.
    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === team.admin.membershipId).role).toBe(
      'ADMIN',
    )

    await app.close()
  })

  it('refuses demoting the only owner', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${team.owner.membershipId}`,
      headers: bearer(token),
      payload: { role: 'STAFF' },
    })

    // An organisation with no owner is one whose record nobody can change.
    expect([403, 422]).toContain(response.statusCode)
    expect(prisma._store.membership.find((row) => row.id === team.owner.membershipId).role).toBe(
      'OWNER',
    )

    await app.close()
  })

  it('answers 404 for a membership in another organisation', async () => {
    const { app, ids, team } = await createTeamApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${ids.otherOrganization.id}/members/${team.finance.membershipId}`,
      headers: bearer(token),
      payload: { role: 'STAFF' },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('scopes a scanner to events, and only to its own organisation events', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const url = `/v1/organizations/${org(ids)}/members/${team.scanner.membershipId}`
    const scopesNow = () =>
      prisma._store.scannerScope
        .filter((scope) => scope.membershipId === team.scanner.membershipId)
        .map((scope) => scope.eventId)

    const own = await app.inject({
      method: 'PATCH',
      url,
      headers: bearer(token),
      payload: { role: 'SCANNER', eventIds: [ids.publishedEvent.id] },
    })

    expect(own.statusCode).toBe(200)
    expect(scopesNow()).toEqual([ids.publishedEvent.id])

    // Another organisation's event, alongside one of ours. It used to be
    // dropped without a word and the route answered 200, so an administrator
    // could believe a scanner was scoped somewhere it was not and find out at
    // the door. Now the whole request is refused and nothing changes.
    const foreign = await app.inject({
      method: 'PATCH',
      url,
      headers: bearer(token),
      payload: { role: 'SCANNER', eventIds: [ids.publishedEvent.id, ids.onlineEvent.id] },
    })

    expect(foreign.statusCode).toBe(422)
    expect(foreign.body).not.toContain(ids.onlineEvent.title)
    expect(scopesNow()).toEqual([ids.publishedEvent.id])

    await app.close()
  })

  it('keeps scopes for every event-scoped door role, and none for a role that cannot use them', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const url = `/v1/organizations/${org(ids)}/members/${team.scanner.membershipId}`
    const scopesNow = () =>
      prisma._store.scannerScope.filter((scope) => scope.membershipId === team.scanner.membershipId)

    // MANAGER, STAFF and SCANNER admit only where a scope says so, so a scope
    // given to any of them is kept.
    for (const role of ['MANAGER', 'STAFF', 'SCANNER']) {
      const response = await app.inject({
        method: 'PATCH',
        url,
        headers: bearer(token),
        payload: { role, eventIds: [ids.publishedEvent.id] },
      })

      expect(response.statusCode, role).toBe(200)
      expect(scopesNow(), role).toHaveLength(1)
    }

    // ADMIN admits everywhere and VIEWER nowhere; a scope would mean nothing
    // for either, and left behind it would be re-inherited on a later demotion.
    for (const role of ['ADMIN', 'VIEWER']) {
      await app.inject({
        method: 'PATCH',
        url,
        headers: bearer(token),
        payload: { role: 'SCANNER', eventIds: [ids.publishedEvent.id] },
      })

      const response = await app.inject({
        method: 'PATCH',
        url,
        headers: bearer(token),
        payload: { role, eventIds: [ids.publishedEvent.id] },
      })

      expect(response.statusCode, role).toBe(200)
      expect(scopesNow(), role).toHaveLength(0)
    }

    await app.close()
  })

  it('replaces the scopes on every role change, so a change that names none leaves none', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const url = `/v1/organizations/${org(ids)}/members/${team.scanner.membershipId}`

    await app.inject({
      method: 'PATCH',
      url,
      headers: bearer(token),
      payload: { role: 'SCANNER', eventIds: [ids.publishedEvent.id] },
    })
    await app.inject({
      method: 'PATCH',
      url,
      headers: bearer(token),
      payload: { role: 'STAFF' },
    })

    // A role change states the whole door assignment: role and scopes together.
    // Otherwise a change leaves scopes lying around that nobody chose this time.
    expect(
      prisma._store.scannerScope.filter(
        (scope) => scope.membershipId === team.scanner.membershipId,
      ),
    ).toHaveLength(0)

    await app.close()
  })
})

describe('removing a member', () => {
  it('lets an admin remove a member and takes their scopes with them', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    await prisma.scannerScope.create({
      data: { membershipId: team.scanner.membershipId, eventId: ids.publishedEvent.id },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.scanner.membershipId}/remove`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(
      prisma._store.membership.find((row) => row.id === team.scanner.membershipId),
    ).toBeUndefined()
    expect(
      prisma._store.scannerScope.filter(
        (scope) => scope.membershipId === team.scanner.membershipId,
      ),
    ).toHaveLength(0)

    await app.close()
  })

  it('refuses removing yourself', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.admin.membershipId}/remove`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === team.admin.membershipId)).toBeTruthy()

    await app.close()
  })

  it('refuses removing the only owner', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.owner.membershipId}/remove`,
      headers: bearer(token),
      payload: {},
    })

    expect([403, 422]).toContain(response.statusCode)
    expect(prisma._store.membership.find((row) => row.id === team.owner.membershipId)).toBeTruthy()

    await app.close()
  })

  it('refuses a manager removing an admin', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.admin.membershipId}/remove`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === team.admin.membershipId)).toBeTruthy()

    await app.close()
  })

  it('takes effect on the removed person next request, without ending their session', async () => {
    const { app, ids, team } = await createTeamApp()
    const removedToken = await signIn(app, 'money@rangoli.example')
    const adminToken = await signIn(app, 'admin@rangoli.example')

    const before = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(removedToken),
    })
    expect(before.json().data.memberships).toHaveLength(1)

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.finance.membershipId}/remove`,
      headers: bearer(adminToken),
      payload: {},
    })

    const after = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(removedToken),
    })

    // They still have an account and a session; they are simply no longer in this
    // organisation. Capabilities are resolved per request, so it takes effect now
    // rather than when their session happens to lapse.
    expect(after.statusCode).toBe(200)
    expect(after.json().data.memberships).toHaveLength(0)

    await app.close()
  })

  it('records who removed whom, and why', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.finance.membershipId}/remove`,
      headers: bearer(token),
      payload: { reason: 'left the company' },
    })

    const entry = prisma._store.auditLog.find((row) => row.action === 'team.member_removed')

    expect(entry).toBeTruthy()
    expect(entry.metadata).toMatchObject({
      organizationId: org(ids),
      role: 'FINANCE',
      reason: 'left the company',
    })

    await app.close()
  })
})

describe('every team route requires a credential', () => {
  it.each([
    ['GET', '/v1/organizations/ID/members', null],
    ['POST', '/v1/organizations/ID/invitations', { email: 'x@example.com', role: 'STAFF' }],
    ['POST', '/v1/invitations/accept', { token: 'a'.repeat(43) }],
    ['POST', '/v1/organizations/ID/invitations/MEMBER/revoke', null],
    ['PATCH', '/v1/organizations/ID/members/MEMBER', { role: 'STAFF' }],
    ['POST', '/v1/organizations/ID/members/MEMBER/remove', {}],
  ])('refuses an anonymous %s %s', async (method, path, payload) => {
    const { app, ids, team } = await createTeamApp()

    const response = await app.inject({
      method,
      url: path.replace('ID', org(ids)).replace('MEMBER', team.finance.membershipId),
      ...(payload ? { payload } : {}),
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

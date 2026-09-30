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

import { hashToken } from '@desi-event/auth'
import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { PASSWORD, makeWorld, minutesFromNow } from './helpers/fixtures.js'
import { bearer, createTestApp, mfaCodeFor, signIn, stepUp } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/** The shape `issueToken` mints: 43 url-safe characters. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/u

/** The origin the test environment serves, for the CSRF origin check. */
const ORIGIN = 'https://desi-event.test'

/**
 * Sign in the way a browser does, and keep what a browser keeps.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email The account.
 * @returns {Promise<{token: string, headers: object}>} The session secret and the headers a browser sends back.
 */
async function signInAsBrowser(app, email) {
  const code = mfaCodeFor(app, email)
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: ORIGIN },
    payload: { email, password: PASSWORD, ...(code ? { code } : {}) },
  })

  expect(response.statusCode).toBe(200)

  const body = response.json()

  return {
    token: body.token,
    headers: {
      origin: ORIGIN,
      cookie: (response.cookies ?? []).map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
      'x-desi-csrf': body.csrfToken ?? '',
    },
  }
}

/**
 * An in-memory pino destination.
 *
 * @returns {{write: function(string): void, raw: function(): string}} The stream and its reader.
 */
function captureStream() {
  const chunks = []

  return {
    write(chunk) {
      chunks.push(String(chunk))
    },
    raw() {
      return chunks.join('')
    },
  }
}

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

    // With no delivery provider (MANUAL, this build) the code is handed back
    // to the person who created it, exactly once, because nobody else can
    // give it to the invitee. Only its digest is stored, and the digest is
    // never in the response.
    const { delivery } = response.json().data

    expect(delivery.mode).toBe('MANUAL')
    expect(delivery.invitationCode).toMatch(CODE_SHAPE)
    expect(hashToken(delivery.invitationCode)).toBe(prisma._store.invitation[0].tokenHash)
    expect(response.body).not.toContain(prisma._store.invitation[0].tokenHash)
    expect(response.body).not.toContain('tokenHash')
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['cache-control']).toContain('private')
    expect(response.headers.pragma).toBe('no-cache')

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
    expect(response.json().data).toMatchObject({
      organizationId: org(ids),
      role: 'STAFF',
      joined: true,
    })

    const membership = prisma._store.membership.find(
      (row) => row.organizationId === org(ids) && row.role === 'STAFF',
    )
    expect(membership).toBeTruthy()

    await app.close()
  })

  it('says nothing was joined, and ends no session, for somebody who already belongs', async () => {
    const { app, ids, invitationToken, prisma } = await invite({ email: 'priya@example.com' })
    const other = await signIn(app, 'priya@example.com')
    const token = await signIn(app, 'priya@example.com')
    const priya = prisma._store.user.find((row) => row.email === 'priya@example.com')

    // Added another way between the invitation and its acceptance — a
    // platform administrator's direct grant, say.
    prisma._store.membership.push({
      id: cuid(),
      userId: priya.id,
      organizationId: org(ids),
      role: 'VIEWER',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(token),
      payload: { token: invitationToken },
    })

    expect(response.statusCode).toBe(200)
    // The role already held, unchanged, and a flag the screen reads so it
    // never claims other sessions ended.
    expect(response.json().data).toMatchObject({ role: 'VIEWER', joined: false })
    expect(
      prisma._store.membership.filter(
        (row) => row.userId === priya.id && row.organizationId === org(ids),
      ),
    ).toHaveLength(1)

    const stillIn = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(other),
    })

    expect(stillIn.statusCode).toBe(200)

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
    // No part of the address: the holder of a forwarded link is not the person
    // it was sent to. It once named the address in full, and then masked, with
    // the first and last characters and the length still showing.
    const said = response.body

    expect(said).not.toContain('priya')
    expect(said).not.toContain('example.com')
    expect(said).not.toContain('@')
    expect(said).not.toMatch(/p\*+a/u)
    expect(response.json().error.message).toMatch(/sent to a different address/u)
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

  it('records a withdrawal once, and nothing for withdrawing what is no longer outstanding', async () => {
    const { app, ids, prisma } = await invite({ email: 'priya@example.com' })
    const manager = await signIn(app, 'arun@rangoli.example')
    const invitationId = prisma._store.invitation[0].id

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/organizations/${org(ids)}/invitations/${invitationId}/revoke`,
        headers: bearer(manager),
      })

      // Idempotent: the second press answers the same.
      expect(response.statusCode).toBe(200)
    }

    const rows = prisma._store.auditLog.filter(
      (entry) => entry.action === 'team.invitation_revoked' && entry.entityId === invitationId,
    )

    // The second changed nothing, so the audit trail does not say it did.
    expect(rows).toHaveLength(1)

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

  it('refuses an administrator removing an owner, whom an administrator cannot act on', async () => {
    const { app, ids, prisma, team } = await createTeamApp()
    const token = await signIn(app, 'admin@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/members/${team.owner.membershipId}/remove`,
      headers: bearer(token),
      payload: {},
    })

    // The role bound, not the last-owner rule: one request at a time, an owner
    // is only ever removed by another owner, so there is always one left. The
    // last-owner rule on removal matters only when two owners remove each
    // other at once, and platform-roles-integration.test.js races exactly that.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.message).toBe(
      'Your role in this organisation cannot act on a OWNER.',
    )
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
    ['POST', '/v1/organizations/ID/invitations/MEMBER/reissue', null],
    ['POST', '/v1/organizations/ID/ownership', { toMemberId: 'ckl1a2b3c4d5e6f7g8h9i0ja' }],
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

describe('how an invitation code reaches the invitee', () => {
  /**
   * Invite somebody as the owner and return the response.
   *
   * @param {object} app The instance.
   * @param {object} ids The fixture ids.
   * @param {object} [payload] The invitation.
   * @returns {Promise<object>} The inject result.
   */
  async function inviteAsOwner(app, ids, payload = { email: 'new@example.com', role: 'STAFF' }) {
    return app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
      payload,
    })
  }

  it('hands the code to nobody in EMAIL mode, where the provider sends it', async () => {
    const delivered = []
    const world = await makeWorld()
    const { app, ids, prisma } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      deliver: async (message) => delivered.push(message),
    })

    const response = await inviteAsOwner(app, ids)

    expect(response.statusCode).toBe(201)
    expect(app.deliveryMode).toBe('EMAIL')
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })
    expect(delivered).toHaveLength(1)
    expect(response.body).not.toContain(delivered.at(-1).token)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(prisma._store.invitation[0].deliveryMode).toBe('EMAIL')

    await app.close()
  })

  it('never writes the code or its digest to a log line or an audit row', async () => {
    const stream = captureStream()
    const world = await makeWorld()
    const { app, ids, prisma } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      logger: createLogger({ name: 'teams-test', level: 'trace', destination: stream }),
    })

    const invited = await inviteAsOwner(app, ids, { email: 'priya@example.com', role: 'STAFF' })
    const first = invited.json().data

    const owner = await signIn(app, 'owner@rangoli.example')
    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations/${first.id}/reissue`,
      headers: bearer(owner),
    })

    expect(reissued.statusCode).toBe(201)

    const second = reissued.json().data

    await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(owner),
    })

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: second.delivery.invitationCode },
    })

    expect(accepted.statusCode).toBe(200)

    const secrets = [
      first.delivery.invitationCode,
      second.delivery.invitationCode,
      ...prisma._store.invitation.map((row) => row.tokenHash),
    ]
    const logged = stream.raw()
    const audited = JSON.stringify(prisma._store.auditLog.map((row) => row.metadata))

    // Something was logged and audited, so the absence below means something.
    expect(logged).toContain('issued a team invitation')
    expect(audited).toContain('MANUAL')

    for (const secret of secrets) {
      expect(logged).not.toContain(secret)
      expect(audited).not.toContain(secret)
    }

    for (const action of ['team.invited', 'team.invitation_reissued']) {
      const row = prisma._store.auditLog.find((entry) => entry.action === action)

      expect(row.metadata.deliveryMode, action).toBe('MANUAL')
    }

    await app.close()
  })

  it('never carries a code on the team list, and says how each one went out', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const invited = await inviteAsOwner(app, ids)
    const code = invited.json().data.delivery.invitationCode

    // An invitation issued before delivery modes existed: nobody ever got a code.
    prisma._store.invitation.push({
      ...prisma._store.invitation[0],
      id: cuid(),
      email: 'legacy@example.com',
      tokenHash: 'f'.repeat(64),
      deliveryMode: null,
    })

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/members`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.body).not.toContain(code)
    expect(listed.body).not.toContain('f'.repeat(64))
    expect(listed.body).not.toContain('invitationCode')

    const modes = Object.fromEntries(
      listed.json().data.invitations.map((row) => [row.id, row.deliveryMode]),
    )

    expect(modes[invited.json().data.id]).toBe('MANUAL')
    expect(Object.values(modes)).toContain(null)
    expect(
      prisma._store.invitation.find((row) => row.id === invited.json().data.id).deliveryMode,
    ).toBe('MANUAL')

    await app.close()
  })

  it('answers 409, not 500, when the database refuses a second live invitation', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const create = prisma.invitation.create

    // What PostgreSQL does to the loser of two invitations issued at once:
    // `Invitation_one_pending_per_address` refuses the second insert.
    prisma.invitation.create = async () => {
      const error = new Error('Unique constraint failed on Invitation_one_pending_per_address')
      error.code = 'P2002'
      throw error
    }

    const response = await inviteAsOwner(app, ids)

    prisma.invitation.create = create

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/at the same moment/u)
    expect(response.body).not.toContain('invitationCode')
    expect(prisma._store.auditLog.filter((row) => row.action === 'team.invited')).toHaveLength(0)

    await app.close()
  })

  it('supersedes a live invitation whose address differs only in case', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const first = await inviteAsOwner(app, ids)

    prisma._store.invitation[0].email = 'New@Example.com'

    const second = await inviteAsOwner(app, ids)

    expect(second.statusCode).toBe(201)
    expect(prisma._store.invitation.find((row) => row.id === first.json().data.id).status).toBe(
      'REVOKED',
    )
    expect(prisma._store.invitation.filter((row) => row.status === 'PENDING')).toHaveLength(1)

    await app.close()
  })
})

describe('issuing a new code for an invitation', () => {
  /**
   * Invite as the owner and return the invitation and its code.
   *
   * @param {object} app The instance.
   * @param {object} ids The fixture ids.
   * @param {string} role The role.
   * @returns {Promise<{id: string, code: string}>} The invitation.
   */
  async function issued(app, ids, role = 'STAFF') {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
      payload: { email: 'priya@example.com', role },
    })

    expect(response.statusCode).toBe(201)

    return { id: response.json().data.id, code: response.json().data.delivery.invitationCode }
  }

  /**
   * Ask for a new code.
   *
   * @param {object} app The instance.
   * @param {object} ids The fixture ids.
   * @param {string} invitationId Which invitation.
   * @param {string} email Who asks.
   * @returns {Promise<object>} The inject result.
   */
  async function reissue(app, ids, invitationId, email = 'owner@rangoli.example') {
    return app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/invitations/${invitationId}/reissue`,
      headers: bearer(await signIn(app, email)),
    })
  }

  it('replaces the code: the old one stops working and the new one works', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const original = await issued(app, ids)

    const response = await reissue(app, ids, original.id)

    expect(response.statusCode).toBe(201)

    const replacement = response.json().data

    expect(replacement.delivery.mode).toBe('MANUAL')
    expect(replacement.delivery.invitationCode).toMatch(CODE_SHAPE)
    expect(replacement.delivery.invitationCode).not.toBe(original.code)
    expect(response.headers['cache-control']).toContain('no-store')

    const old = prisma._store.invitation.find((row) => row.id === original.id)
    const fresh = prisma._store.invitation.find((row) => row.id === replacement.id)

    expect(old.status).toBe('REVOKED')
    expect(fresh.status).toBe('PENDING')
    expect(fresh.tokenHash).not.toBe(old.tokenHash)
    expect(fresh.email).toBe(old.email)
    expect(fresh.role).toBe(old.role)

    const audit = prisma._store.auditLog.find((row) => row.action === 'team.invitation_reissued')

    expect(audit.metadata).toMatchObject({ supersedes: original.id, deliveryMode: 'MANUAL' })

    const invitee = await signIn(app, 'priya@example.com')
    const withOld = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(invitee),
      payload: { token: original.code },
    })

    expect(withOld.statusCode).toBe(403)

    const withNew = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(invitee),
      payload: { token: replacement.delivery.invitationCode },
    })

    expect(withNew.statusCode).toBe(200)

    await app.close()
  })

  it('refuses a manager a code for an invitation to a role they cannot grant', async () => {
    const { app, ids, prisma } = await createTeamApp()
    const original = await issued(app, ids, 'ADMIN')
    const before = JSON.stringify(prisma._store.invitation)

    const response = await reissue(app, ids, original.id, 'arun@rangoli.example')

    // Holding the code is holding the invitation, so the bound is the same one
    // that stops a MANAGER inviting an ADMIN.
    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain('invitationCode')
    expect(JSON.stringify(prisma._store.invitation)).toBe(before)

    await app.close()
  })

  it('tells a caller who may not see addresses the code, and not who it is for', async () => {
    const { app, ids } = await createTeamApp()
    const original = await issued(app, ids, 'STAFF')

    const response = await reissue(app, ids, original.id, 'arun@rangoli.example')

    expect(response.statusCode).toBe(201)
    expect(response.json().data.delivery.invitationCode).toMatch(CODE_SHAPE)
    expect(response.json().data).not.toHaveProperty('email')
    expect(response.body).not.toContain('priya@example.com')

    await app.close()
  })

  it('refuses an invitation that is no longer outstanding', async () => {
    const { app, ids } = await createTeamApp()
    const original = await issued(app, ids)

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: original.code },
    })

    expect(accepted.statusCode).toBe(200)

    const response = await reissue(app, ids, original.id)

    expect(response.statusCode).toBe(409)
    expect(response.body).not.toContain('invitationCode')

    await app.close()
  })

  it.each([
    ['a viewer', 'finance@rangoli.example'],
    ['a staff member', 'door@rangoli.example'],
    ['a finance member', 'money@rangoli.example'],
    ['an event manager', 'events@rangoli.example'],
    ['an owner of another organisation', 'rival@dhol.example'],
  ])('refuses %s a new code, and replaces nothing', async (_who, email) => {
    const { app, ids, prisma } = await createTeamApp()
    // The lowest role, which every one of these callers could grant were
    // granting the question: the refusal is the capability's, team:invite.
    const original = await issued(app, ids, 'VIEWER')
    const before = JSON.stringify(prisma._store.invitation)

    const response = await reissue(app, ids, original.id, email)

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')
    expect(response.body).not.toContain('invitationCode')
    // The live code is untouched: same row, same digest, still PENDING.
    expect(JSON.stringify(prisma._store.invitation)).toBe(before)
    expect(prisma._store.auditLog.some((row) => row.action === 'team.invitation_reissued')).toBe(
      false,
    )

    await app.close()
  })

  it("answers 404 for another organisation's invitation", async () => {
    const { app, ids } = await createTeamApp()
    const original = await issued(app, ids)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.otherOrganization.id}/invitations/${original.id}/reissue`,
      headers: bearer(await signIn(app, 'rival@dhol.example')),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('accepting an invitation changes the session, finding NF-10', () => {
  /**
   * Invite priya with a role, in MANUAL mode, and return the code.
   *
   * @param {string} role The role.
   * @returns {Promise<object>} The harness and the code.
   */
  async function invitedAs(role) {
    const harness = await createTeamApp()
    const response = await harness.app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(harness.ids)}/invitations`,
      headers: bearer(await signIn(harness.app, 'owner@rangoli.example')),
      payload: { email: 'priya@example.com', role },
    })

    expect(response.statusCode).toBe(201)

    return { ...harness, code: response.json().data.delivery.invitationCode }
  }

  it.each([
    ['ADMIN', true],
    ['VIEWER', false],
  ])('says whether a %s needs a second factor now', async (role, mfaRequired) => {
    const { app, code } = await invitedAs(role)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(await signIn(app, 'priya@example.com')),
      payload: { token: code },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.session).toEqual({ mfaRequired, mfaEnrolled: false })

    await app.close()
  })

  it("ends the invitee's other sessions, with the reason recorded", async () => {
    const { app, prisma, code } = await invitedAs('STAFF')
    const keeping = await signIn(app, 'priya@example.com')
    const losing = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(keeping),
      payload: { token: code },
    })

    expect(response.statusCode).toBe(200)

    const other = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(losing) })

    expect(other.statusCode).toBe(401)

    const still = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(keeping) })

    expect(still.statusCode).toBe(200)

    const priya = prisma._store.user.find((row) => row.email === 'priya@example.com')
    const revoked = prisma._store.session.filter(
      (row) => row.userId === priya.id && row.revokedAt !== null,
    )

    expect(revoked).toHaveLength(1)
    expect(revoked[0].revokedReason).toBe('role_changed')
    expect(
      prisma._store.auditLog.find((row) => row.action === 'team.invitation_accepted').metadata,
    ).toMatchObject({ siblingsRevoked: 1 })

    await app.close()
  })

  it('gives a cookie session a new secret, and the old one stops working', async () => {
    const { app, code } = await invitedAs('STAFF')
    const browser = await signInAsBrowser(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: browser.headers,
      payload: { token: code },
    })

    expect(response.statusCode).toBe(200)

    const rotated = (response.cookies ?? []).find((c) => c.name === '__Host-desi_session')

    expect(rotated?.value).toBeTruthy()
    expect(rotated.value).not.toBe(browser.token)

    const withOld = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(browser.token),
    })

    expect(withOld.statusCode).toBe(401)

    await app.close()
  })

  it('shortens the session to the privileged lifetime when the new role is privileged', async () => {
    const { app, prisma, code } = await invitedAs('ADMIN')
    const token = await signIn(app, 'priya@example.com')
    const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))

    // An attendee session is given thirty days.
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: bearer(token),
      payload: { token: code },
    })

    expect(response.statusCode).toBe(200)

    const after = prisma._store.session.find((row) => row.id === session.id)

    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 12 * 60 * 60 * 1000)
    // A bearer caller cannot be told a new secret, so it keeps the one it has.
    expect(after.tokenHash).toBe(hashToken(token))

    await app.close()
  })
})

describe('handing ownership on', () => {
  /**
   * The shared world, whose single owner is owner@rangoli.example, plus an
   * administrator to hand it to.
   *
   * @returns {Promise<object>} The harness and the ids the tests need.
   */
  async function createOwnershipApp() {
    const world = await makeWorld()
    const { seed, ids } = world
    const hash = seed.user.find((user) => user.email === 'priya@example.com').passwordHash
    const adminId = cuid()
    const adminMembershipId = cuid()

    seed.user.push({
      id: adminId,
      email: 'second@rangoli.example',
      passwordHash: hash,
      displayName: 'Second',
      locale: 'en-IN',
      role: 'ORGANIZER',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    seed.membership.push({
      id: adminMembershipId,
      userId: adminId,
      organizationId: ids.organization.id,
      role: 'ADMIN',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const harness = await createTestApp({ seed, ids })
    const ownerUser = harness.prisma._store.user.find(
      (row) => row.email === 'owner@rangoli.example',
    )
    const ownerMembership = harness.prisma._store.membership.find(
      (row) => row.userId === ownerUser.id && row.organizationId === ids.organization.id,
    )

    return { ...harness, adminId, adminMembershipId, ownerMembership }
  }

  /**
   * Ask to hand ownership on.
   *
   * @param {object} app The instance.
   * @param {object} ids The fixture ids.
   * @param {object} headers The caller's headers.
   * @param {string} toMemberId The membership to hand it to.
   * @returns {Promise<object>} The inject result.
   */
  function transfer(app, ids, headers, toMemberId) {
    return app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/ownership`,
      headers,
      payload: { toMemberId },
    })
  }

  it('swaps the owner and the administrator in one step, and records it', async () => {
    const { app, ids, prisma, adminMembershipId, ownerMembership } = await createOwnershipApp()
    const targetToken = await signIn(app, 'second@rangoli.example')
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))

    const response = await transfer(app, ids, headers, adminMembershipId)

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({
      organizationId: org(ids),
      ownerMembershipId: adminMembershipId,
      previousOwnerMembershipId: ownerMembership.id,
      previousOwnerRole: 'ADMIN',
    })

    const roleOf = (id) => prisma._store.membership.find((row) => row.id === id).role

    expect(roleOf(adminMembershipId)).toBe('OWNER')
    expect(roleOf(ownerMembership.id)).toBe('ADMIN')
    expect(
      prisma._store.membership.filter(
        (row) => row.organizationId === org(ids) && row.role === 'OWNER',
      ),
    ).toHaveLength(1)

    // The new owner signs in again under the role they now hold.
    const target = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: bearer(targetToken),
    })

    expect(target.statusCode).toBe(401)

    const audit = prisma._store.auditLog.find((row) => row.action === 'team.ownership_transferred')

    expect(audit.metadata).toMatchObject({
      organizationId: org(ids),
      toMembershipId: adminMembershipId,
    })

    await app.close()
  })

  it('refuses an administrator, who is not an owner', async () => {
    const { app, ids, prisma, ownerMembership } = await createOwnershipApp()
    const headers = bearer(await signIn(app, 'second@rangoli.example'))

    const response = await transfer(app, ids, headers, ownerMembership.id)

    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === ownerMembership.id).role).toBe('OWNER')

    await app.close()
  })

  it('refuses a platform super administrator who is not a member', async () => {
    const { app, ids, prisma, adminMembershipId } = await createOwnershipApp()
    const headers = bearer(await signIn(app, 'ops@desi-event.example'))

    const response = await transfer(app, ids, headers, adminMembershipId)

    // Their capability reaches the handler; the organiser path still refuses
    // them. The audited direct grant is theirs instead.
    expect(response.statusCode).toBe(403)
    expect(prisma._store.membership.find((row) => row.id === adminMembershipId).role).toBe('ADMIN')

    await app.close()
  })

  it('refuses handing it to yourself', async () => {
    const { app, ids, ownerMembership } = await createOwnershipApp()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))

    const response = await transfer(app, ids, headers, ownerMembership.id)

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('answers 404 for a member of another organisation', async () => {
    const { app, ids, prisma } = await createOwnershipApp()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))
    const foreign = prisma._store.membership.find(
      (row) => row.organizationId === ids.otherOrganization.id,
    )

    const response = await transfer(app, ids, headers, foreign.id)

    expect(response.statusCode).toBe(404)
    expect(prisma._store.membership.find((row) => row.id === foreign.id).role).toBe('OWNER')

    await app.close()
  })

  it('needs a second factor from the last two minutes, and changes nothing without one', async () => {
    const { app, ids, prisma, adminMembershipId, ownerMembership } = await createOwnershipApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))

    session.mfaSatisfiedAt = new Date(Date.now() - 10 * 60 * 1000)

    const stale = await transfer(app, ids, bearer(token), adminMembershipId)

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.membership.find((row) => row.id === ownerMembership.id).role).toBe('OWNER')
    expect(prisma._store.membership.find((row) => row.id === adminMembershipId).role).toBe('ADMIN')

    await stepUp(app, 'owner@rangoli.example', bearer(token))

    const fresh = await transfer(app, ids, bearer(token), adminMembershipId)

    expect(fresh.statusCode).toBe(200)

    await app.close()
  })

  it('still keeps OWNER out of an ordinary role change', async () => {
    const { app, ids, adminMembershipId } = await createOwnershipApp()

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${org(ids)}/members/${adminMembershipId}`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
      payload: { role: 'OWNER' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })
})

describe('the invitation budget', () => {
  it('is kept per account, not per the one address every browser request shares', async () => {
    // Every inject arrives from one address, as every browser request does
    // through the web app's proxy. Keyed by address, the owner's ten
    // invitations spent the administrator's budget too — and everybody's.
    const { app, ids } = await createTeamApp()
    const owner = await signIn(app, 'owner@rangoli.example')
    const admin = await signIn(app, 'admin@rangoli.example')

    /**
     * Invite a fresh address.
     *
     * @param {string} token Who invites.
     * @param {number} index Makes the address unique.
     * @returns {Promise<object>} The inject result.
     */
    const invite = (token, index) =>
      app.inject({
        method: 'POST',
        url: `/v1/organizations/${org(ids)}/invitations`,
        headers: bearer(token),
        payload: { email: `budget${index}@example.com`, role: 'STAFF' },
      })

    for (let index = 0; index < 10; index += 1) {
      expect((await invite(owner, index)).statusCode, `invitation ${index}`).toBe(201)
    }

    const spent = await invite(owner, 10)

    expect(spent.statusCode).toBe(429)
    expect(Number(spent.headers['retry-after'])).toBeGreaterThan(0)
    expect(spent.body).not.toContain('invitationCode')
    // Same address, another account: its own budget is untouched.
    expect((await invite(admin, 11)).statusCode).toBe(201)

    await app.close()
  })
})

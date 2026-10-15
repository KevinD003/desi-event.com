/**
 * Platform staff administration, attacked.
 *
 * Every write here can make somebody powerful, so the tests are mostly the
 * ways that goes wrong: somebody other than a super administrator tries, a
 * super administrator tries on themselves, a stale second factor tries, and
 * the change leaves an old session carrying the new authority.
 *
 * @module @desi-event/api/tests/platform
 */

import { hashToken } from '@desi-event/auth'
import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const SUPER = 'ops@desi-event.example'

/**
 * Find a fixture account's row.
 *
 * @param {object} prisma The stub.
 * @param {string} email The address.
 * @returns {object} The user row.
 */
function userOf(prisma, email) {
  return prisma._store.user.find((row) => row.email === email)
}

/**
 * Make a session's second factor older than the SECURITY_ROLE window.
 *
 * @param {object} prisma The stub.
 * @param {string} token The session's bearer secret.
 * @returns {void}
 */
function staleStepUp(prisma, token) {
  const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))

  session.mfaSatisfiedAt = new Date(Date.now() - 10 * 60 * 1000)
}

describe('POST /v1/platform/users/search', () => {
  it('refuses a moderator and an organisation owner', async () => {
    const { app } = await createTestApp()

    for (const email of ['maya@desi-event.example', 'owner@rangoli.example']) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/platform/users/search',
        headers: bearer(await signIn(app, email)),
        payload: { q: 'priya' },
      })

      expect(response.statusCode, email).toBe(403)
    }

    await app.close()
  })

  it('matches what was typed: an underscore or a percent sign is a character, not a wildcard', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, SUPER))
    const search = async (q) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/platform/users/search',
          headers,
          payload: { q },
        })
      ).json().data

    // `arun@rangoli.example` exists; as a pattern, `_` would match its `@`
    // and `%` would match every account there is.
    expect((await search('arun@rangoli')).map((row) => row.email)).toEqual(['arun@rangoli.example'])
    expect(await search('arun_rangoli')).toEqual([])
    expect(await search('%%%')).toEqual([])

    await app.close()
  })

  it('needs three characters', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/users/search',
      headers: bearer(await signIn(app, SUPER)),
      payload: { q: 'pr' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('is not a GET, so an address never rides in a URL', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/users/search?q=priya%40example.com',
      headers: bearer(await signIn(app, SUPER)),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('finds accounts with their memberships and marks the caller, uncached', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/users/search',
      headers: bearer(await signIn(app, SUPER)),
      payload: { q: 'EXAMPLE' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')

    const { data } = response.json()
    const arun = data.find((row) => row.email === 'arun@rangoli.example')
    const me = data.find((row) => row.email === SUPER)

    expect(arun.memberships).toEqual([
      {
        organizationId: ids.organization.id,
        organizationName: 'Rangoli Collective',
        role: 'MANAGER',
      },
    ])
    expect(arun.self).toBe(false)
    expect(arun.mfaEnrolled).toBe(true)
    expect(me.self).toBe(true)
    expect(response.body).not.toContain('passwordHash')
    expect(response.body).not.toContain('secretSealed')

    await app.close()
  })

  it('finds an account by its exact id, and filters by role', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)
    const priya = userOf(prisma, 'priya@example.com')

    const byId = await app.inject({
      method: 'POST',
      url: '/v1/platform/users/search',
      headers: bearer(token),
      payload: { q: priya.id },
    })

    expect(byId.json().data.map((row) => row.id)).toEqual([priya.id])

    const moderators = await app.inject({
      method: 'POST',
      url: '/v1/platform/users/search',
      headers: bearer(token),
      payload: { q: 'example', role: 'MODERATOR' },
    })

    expect(moderators.json().data.map((row) => row.email)).toEqual(['maya@desi-event.example'])

    await app.close()
  })
})

describe('POST /v1/platform/users/:id/role', () => {
  /**
   * Change a platform role.
   *
   * @param {object} app The instance.
   * @param {string} token The caller's token.
   * @param {string} userId The account.
   * @param {object} payload The body.
   * @returns {Promise<object>} The inject result.
   */
  function setRole(app, token, userId, payload) {
    return app.inject({
      method: 'POST',
      url: `/v1/platform/users/${userId}/role`,
      headers: bearer(token),
      payload,
    })
  }

  it('promotes an account, ends every session it holds, and records why', async () => {
    const { app, prisma } = await createTestApp()
    const priya = userOf(prisma, 'priya@example.com')
    const priyaToken = await signIn(app, 'priya@example.com')
    const second = await signIn(app, 'priya@example.com')
    const token = await signIn(app, SUPER)

    const response = await setRole(app, token, priya.id, {
      role: 'MODERATOR',
      reason: 'Joined the trust and safety team',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual({
      userId: priya.id,
      from: 'ATTENDEE',
      role: 'MODERATOR',
      sessionsRevoked: 2,
    })
    expect(userOf(prisma, 'priya@example.com').role).toBe('MODERATOR')

    for (const old of [priyaToken, second]) {
      const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(old) })

      expect(me.statusCode).toBe(401)
    }

    expect(
      prisma._store.session
        .filter((row) => row.userId === priya.id)
        .every((row) => row.revokedReason === 'role_changed'),
    ).toBe(true)

    const audit = prisma._store.auditLog.find((row) => row.action === 'platform.role_changed')

    expect(audit.metadata).toMatchObject({
      from: 'ATTENDEE',
      to: 'MODERATOR',
      reason: 'Joined the trust and safety team',
    })

    await app.close()
  })

  it('refuses the caller’s own account', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)

    const response = await setRole(app, token, userOf(prisma, SUPER).id, {
      role: 'ATTENDEE',
      reason: 'Stepping down',
    })

    expect(response.statusCode).toBe(403)
    expect(userOf(prisma, SUPER).role).toBe('SUPER_ADMIN')

    await app.close()
  })

  it('refuses a second factor older than two minutes, and changes nothing', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)

    staleStepUp(prisma, token)

    const response = await setRole(app, token, userOf(prisma, 'priya@example.com').id, {
      role: 'SUPER_ADMIN',
      reason: 'Needs everything',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(userOf(prisma, 'priya@example.com').role).toBe('ATTENDEE')

    await app.close()
  })

  it('refuses everybody but a super administrator', async () => {
    const { app, prisma } = await createTestApp()

    const response = await setRole(
      app,
      await signIn(app, 'maya@desi-event.example'),
      userOf(prisma, 'priya@example.com').id,
      { role: 'MODERATOR', reason: 'A moderator cannot make another' },
    )

    expect(response.statusCode).toBe(403)
    expect(userOf(prisma, 'priya@example.com').role).toBe('ATTENDEE')

    await app.close()
  })

  it('answers 404 for an unknown account, 409 for an unchanged role, 400 without a reason', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)
    const priya = userOf(prisma, 'priya@example.com')

    expect(
      (await setRole(app, token, cuid(), { role: 'MODERATOR', reason: 'why' })).statusCode,
    ).toBe(404)
    expect(
      (await setRole(app, token, priya.id, { role: 'ATTENDEE', reason: 'no change' })).statusCode,
    ).toBe(409)
    expect((await setRole(app, token, priya.id, { role: 'MODERATOR' })).statusCode).toBe(400)
    expect(
      (await setRole(app, token, priya.id, { role: 'MODERATOR', reason: '  ' })).statusCode,
    ).toBe(400)

    await app.close()
  })

  it('lets one super administrator demote another while two exist', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)
    const maya = userOf(prisma, 'maya@desi-event.example')

    maya.role = 'SUPER_ADMIN'

    const response = await setRole(app, token, maya.id, {
      role: 'MODERATOR',
      reason: 'Back to moderation only',
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.user.filter((row) => row.role === 'SUPER_ADMIN')).toHaveLength(1)

    await app.close()
  })

  it('refuses a change that would leave no super administrator, behind the locks', async () => {
    // Reachable only when two administrators race each other, which the real
    // PostgreSQL suite exercises. Here the count is made to say what the
    // loser of such a race would see.
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)
    const maya = userOf(prisma, 'maya@desi-event.example')
    const count = prisma.user.count

    maya.role = 'SUPER_ADMIN'
    prisma.user.count = async () => 1

    const response = await setRole(app, token, maya.id, { role: 'ATTENDEE', reason: 'Race' })

    prisma.user.count = count

    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('LAST_SUPER_ADMIN')
    expect(maya.role).toBe('SUPER_ADMIN')

    await app.close()
  })
})

describe('GET /v1/platform/organizations', () => {
  it('finds an organisation by name, with its members and owners counted', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/organizations?q=rangoli',
      headers: bearer(await signIn(app, SUPER)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([
      expect.objectContaining({
        id: ids.organization.id,
        name: 'Rangoli Collective',
        ownerCount: 1,
        suspended: false,
      }),
    ])
    expect(response.json().data[0].memberCount).toBeGreaterThan(1)

    await app.close()
  })

  it('matches the name or web address as typed, never as a pattern', async () => {
    const { app } = await createTestApp()
    const headers = bearer(await signIn(app, SUPER))
    const search = async (q) =>
      (
        await app.inject({
          method: 'GET',
          url: `/v1/platform/organizations?q=${encodeURIComponent(q)}`,
          headers,
        })
      ).json().data

    expect((await search('rangoli')).map((row) => row.name)).toEqual(['Rangoli Collective'])
    // As patterns, `rangol_` would find Rangoli and `%%%` every organisation.
    expect(await search('rangol_')).toEqual([])
    expect(await search('%%%')).toEqual([])

    await app.close()
  })

  it('refuses everybody but a super administrator', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/organizations?q=rangoli',
      headers: bearer(await signIn(app, 'maya@desi-event.example')),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('POST /v1/platform/organizations/:id/members', () => {
  /**
   * Grant a membership.
   *
   * @param {object} app The instance.
   * @param {string} token The caller's token.
   * @param {string} organizationId The organisation.
   * @param {object} payload The body.
   * @returns {Promise<object>} The inject result.
   */
  function grant(app, token, organizationId, payload) {
    return app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${organizationId}/members`,
      headers: bearer(token),
      payload,
    })
  }

  it('makes a non-member an OWNER, ends their sessions, and records why', async () => {
    const { app, ids, prisma } = await createTestApp()
    const priya = userOf(prisma, 'priya@example.com')
    const priyaToken = await signIn(app, 'priya@example.com')
    const token = await signIn(app, SUPER)

    const response = await grant(app, token, ids.otherOrganization.id, {
      userId: priya.id,
      role: 'OWNER',
      reason: 'The only owner left the company',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      organizationId: ids.otherOrganization.id,
      userId: priya.id,
      role: 'OWNER',
      previousRole: null,
      created: true,
      sessionsRevoked: 1,
    })
    expect(
      prisma._store.membership.find(
        (row) => row.userId === priya.id && row.organizationId === ids.otherOrganization.id,
      ).role,
    ).toBe('OWNER')
    expect(prisma._store.invitation).toHaveLength(0)

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(priyaToken) })

    expect(me.statusCode).toBe(401)

    const audit = prisma._store.auditLog.find((row) => row.action === 'platform.membership_granted')

    expect(audit.metadata).toMatchObject({
      organizationId: ids.otherOrganization.id,
      userId: priya.id,
      role: 'OWNER',
      previousRole: null,
      reason: 'The only owner left the company',
    })

    await app.close()
  })

  it('changes the role of somebody already in the organisation', async () => {
    const { app, ids, prisma } = await createTestApp()
    const arun = userOf(prisma, 'arun@rangoli.example')

    const response = await grant(app, await signIn(app, SUPER), ids.organization.id, {
      userId: arun.id,
      role: 'ADMIN',
      reason: 'Runs the team now',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      role: 'ADMIN',
      previousRole: 'MANAGER',
      created: false,
    })

    await app.close()
  })

  it('refuses to demote the only owner', async () => {
    const { app, ids, prisma } = await createTestApp()
    const owner = userOf(prisma, 'owner@rangoli.example')

    const response = await grant(app, await signIn(app, SUPER), ids.organization.id, {
      userId: owner.id,
      role: 'ADMIN',
      reason: 'Oops',
    })

    expect(response.statusCode).toBe(422)
    expect(
      prisma._store.membership.find(
        (row) => row.userId === owner.id && row.organizationId === ids.organization.id,
      ).role,
    ).toBe('OWNER')

    await app.close()
  })

  it('refuses the caller’s own account, an unknown account and an unknown organisation', async () => {
    const { app, ids, prisma } = await createTestApp()
    const token = await signIn(app, SUPER)

    expect(
      (
        await grant(app, token, ids.organization.id, {
          userId: userOf(prisma, SUPER).id,
          role: 'OWNER',
          reason: 'Myself, please',
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await grant(app, token, ids.organization.id, {
          userId: cuid(),
          role: 'VIEWER',
          reason: 'x y',
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await grant(app, token, cuid(), {
          userId: userOf(prisma, 'priya@example.com').id,
          role: 'VIEWER',
          reason: 'x y',
        })
      ).statusCode,
    ).toBe(404)

    await app.close()
  })

  it('refuses a suspended account', async () => {
    const { app, ids, prisma } = await createTestApp()
    const priya = userOf(prisma, 'priya@example.com')

    priya.suspendedAt = new Date()

    const response = await grant(app, await signIn(app, SUPER), ids.organization.id, {
      userId: priya.id,
      role: 'VIEWER',
      reason: 'Helping out',
    })

    expect(response.statusCode).toBe(422)

    await app.close()
  })

  it('refuses a stale second factor and anybody but a super administrator', async () => {
    const { app, ids, prisma } = await createTestApp()
    const priya = userOf(prisma, 'priya@example.com')
    const token = await signIn(app, SUPER)

    staleStepUp(prisma, token)

    const stale = await grant(app, token, ids.organization.id, {
      userId: priya.id,
      role: 'OWNER',
      reason: 'Needs it',
    })

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')

    const owner = await grant(
      app,
      await signIn(app, 'owner@rangoli.example'),
      ids.organization.id,
      {
        userId: priya.id,
        role: 'VIEWER',
        reason: 'Owners use invitations',
      },
    )

    expect(owner.statusCode).toBe(403)
    expect(prisma._store.membership.some((row) => row.userId === priya.id)).toBe(false)

    await app.close()
  })
})

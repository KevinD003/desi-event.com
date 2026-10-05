/**
 * Creating an organisation, which nobody can do any more, and reading its
 * profile.
 *
 * Organisations come from organiser invitations sent by the Desi-Event team
 * (`organizer-invitations.test.js`). `POST /v1/organizations` stays in the
 * contract and answers 403 to everybody, whatever the body says: the old
 * refusals — a forged verification state, an anonymous caller — still hold,
 * and nothing is written for anyone.
 *
 * @module @desi-event/api/tests/organizations
 */

import { hashToken } from '@desi-event/auth'
import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * Try to create an organisation as a caller.
 *
 * @param {object} app The instance.
 * @param {string} token The caller's bearer token.
 * @param {object} payload The body.
 * @returns {Promise<object>} The inject result.
 */
function create(app, token, payload) {
  return app.inject({ method: 'POST', url: '/v1/organizations', headers: bearer(token), payload })
}

/**
 * The rows a creation would have written, counted.
 *
 * @param {object} prisma The stub.
 * @returns {{organizations: number, memberships: number, audits: number, revokedSessions: number}} The counts.
 */
function written(prisma) {
  return {
    organizations: prisma._store.organization.length,
    memberships: prisma._store.membership.length,
    audits: prisma._store.auditLog.filter((row) => row.action === 'organization.created').length,
    revokedSessions: prisma._store.session.filter((row) => row.revokedAt).length,
  }
}

const SELF_SERVICE_REFUSAL =
  'Organisations are not created from an account here. Organisers join Desi-Event by invitation from the Desi-Event team; if they have sent you an organiser invitation code, enter it at Your account → Accept an organiser invitation (/account/organizations/new).'

describe('POST /v1/organizations', () => {
  it.each([
    ['an attendee', 'priya@example.com'],
    ['an organiser-labelled account that owns an organisation', 'owner@rangoli.example'],
    ['a platform administrator', 'anil@desi-event.example'],
    ['a super administrator', 'ops@desi-event.example'],
  ])('refuses %s with the invitation sentence and writes nothing', async (_who, email) => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, email)
    const before = written(prisma)

    const response = await create(app, token, {
      name: 'Bay Lights Garba Co.',
      timezone: 'America/Los_Angeles',
      description: 'Four nights of garba every October.',
      websiteUrl: 'https://baylights.example',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error).toMatchObject({
      code: 'ORGANIZER_INVITATION_REQUIRED',
      message: SELF_SERVICE_REFUSAL,
    })
    // No organisation, no membership, no audit row, and no session ended.
    expect(written(prisma)).toEqual(before)
    expect(prisma._store.organization.some((row) => row.name === 'Bay Lights Garba Co.')).toBe(
      false,
    )

    const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))

    expect(session.revokedAt ?? null).toBeNull()

    await app.close()
  })

  it('still refuses a body that forges the verification state, the owner or the contact', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')
    const before = written(prisma)

    const response = await create(app, token, {
      name: 'Forged',
      verificationStatus: 'VERIFIED',
      verified: true,
      payoutCurrency: 'INR',
      contactEmail: 'attacker@example.com',
      createdById: cuid(),
      role: 'OWNER',
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('ORGANIZER_INVITATION_REQUIRED')
    expect(written(prisma)).toEqual(before)
    expect(prisma._store.organization.some((row) => row.name === 'Forged')).toBe(false)

    await app.close()
  })

  it('refuses with no body at all, and with a JSON body that is not an object', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    for (const payload of [undefined, ['x'], {}]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: bearer(token),
        ...(payload === undefined ? {} : { payload }),
      })

      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('ORGANIZER_INVITATION_REQUIRED')
    }

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      payload: { name: 'Nobody' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('logs the refusal with the account and none of the body', async () => {
    const lines = []
    const logger = createLogger({
      name: 'api',
      level: 'info',
      destination: { write: (chunk) => lines.push(String(chunk)) },
    })
    const { app } = await createTestApp({ logger })
    const token = await signIn(app, 'priya@example.com')

    await create(app, token, { name: 'Logged Body', contactEmail: 'secret-contact@example.com' })

    const refusal = lines.find((line) => line.includes('refused a self-service organisation'))

    expect(refusal).toBeDefined()
    expect(lines.join('\n')).not.toContain('secret-contact@example.com')
    expect(lines.join('\n')).not.toContain('Logged Body')

    await app.close()
  })
})

describe('GET /v1/organizations/:id', () => {
  it('gives a member the profile and the slug for the public page', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}`,
      headers: bearer(await signIn(app, 'arun@rangoli.example')),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      id: ids.organization.id,
      slug: 'rangoli-collective',
      verificationStatus: 'VERIFIED',
      eligible: true,
    })
    expect(response.body).not.toContain('contactEmail')
    expect(response.body).not.toContain('hello@rangoli.example')

    await app.close()
  })

  it('refuses a member of another organisation, and answers 404 for one that does not exist', async () => {
    const { app, ids } = await createTestApp()

    const other = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}`,
      headers: bearer(await signIn(app, 'rival@dhol.example')),
    })

    expect(other.statusCode).toBe(403)

    const unknown = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${cuid()}`,
      headers: bearer(await signIn(app, 'ops@desi-event.example')),
    })

    expect(unknown.statusCode).toBe(404)

    await app.close()
  })
})

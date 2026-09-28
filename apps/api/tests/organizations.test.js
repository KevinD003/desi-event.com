/**
 * Creating an organisation, and reading its profile.
 *
 * The attack on creation is the body: somebody sends the fields a moderator
 * decides, the address the platform writes to or the currency it pays in, and
 * hopes the server takes them. Every such field is sent here, and the stored
 * row is checked rather than the response.
 *
 * @module @desi-event/api/tests/organizations
 */

import { hashToken } from '@desi-event/auth'
import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * Create an organisation as a caller.
 *
 * @param {object} app The instance.
 * @param {string} token The caller's bearer token.
 * @param {object} payload The body.
 * @returns {Promise<object>} The inject result.
 */
function create(app, token, payload) {
  return app.inject({ method: 'POST', url: '/v1/organizations', headers: bearer(token), payload })
}

describe('POST /v1/organizations', () => {
  it('makes the caller its owner, unverified, paid in USD, reachable at their own address', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')
    const priya = prisma._store.user.find((row) => row.email === 'priya@example.com')

    const response = await create(app, token, {
      name: 'Bay Lights Garba Co.',
      timezone: 'America/Los_Angeles',
      description: 'Four nights of garba every October.',
      websiteUrl: 'https://baylights.example',
    })

    expect(response.statusCode).toBe(201)

    const { data } = response.json()

    expect(data).toMatchObject({
      name: 'Bay Lights Garba Co.',
      slug: 'bay-lights-garba-co',
      timezone: 'America/Los_Angeles',
      verificationStatus: 'UNVERIFIED',
      eligible: false,
      role: 'OWNER',
      // OWNER is privileged, and Priya has no second factor yet.
      session: { mfaRequired: true, mfaEnrolled: false },
    })

    const row = prisma._store.organization.find((candidate) => candidate.id === data.id)

    expect(row).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      verified: false,
      payoutCurrency: 'USD',
      contactEmail: 'priya@example.com',
      createdById: priya.id,
    })

    const membership = prisma._store.membership.find(
      (candidate) => candidate.organizationId === data.id,
    )

    expect(membership).toMatchObject({ userId: priya.id, role: 'OWNER' })
    // The platform role is untouched: the authority is in the membership.
    expect(prisma._store.user.find((candidate) => candidate.id === priya.id).role).toBe('ATTENDEE')

    const audit = prisma._store.auditLog.find((entry) => entry.action === 'organization.created')

    expect(audit).toMatchObject({ entityId: data.id, actorId: priya.id })
    expect(JSON.stringify(audit.metadata)).not.toContain('priya@example.com')

    await app.close()
  })

  it('ignores every field the server sets, whatever the body says', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await create(app, token, {
      name: 'Sneaky Events',
      verificationStatus: 'VERIFIED',
      verified: true,
      payoutCurrency: 'INR',
      contactEmail: 'attacker@example.com',
      suspendedAt: null,
      createdById: cuid(),
    })

    expect(response.statusCode).toBe(201)

    const row = prisma._store.organization.find(
      (candidate) => candidate.id === response.json().data.id,
    )

    expect(row).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      verified: false,
      payoutCurrency: 'USD',
      contactEmail: 'priya@example.com',
    })

    await app.close()
  })

  it('never answers with the contact address or the payout currency', async () => {
    const { app } = await createTestApp()

    const response = await create(app, await signIn(app, 'priya@example.com'), {
      name: 'Quiet Events',
    })

    expect(response.statusCode).toBe(201)
    expect(response.body).not.toContain('contactEmail')
    expect(response.body).not.toContain('priya@example.com')
    expect(response.body).not.toContain('payoutCurrency')
    expect(response.body).not.toContain('createdById')

    await app.close()
  })

  it('refuses a web address that is taken, and makes a derived one unique', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const taken = await create(app, token, { name: 'Anything', slug: 'rangoli-collective' })

    expect(taken.statusCode).toBe(409)

    // The derived slug of this name is already the fixture organisation's.
    const derived = await create(app, token, { name: 'Rangoli Collective' })

    expect(derived.statusCode).toBe(201)
    expect(derived.json().data.slug).toMatch(/^rangoli-collective-[a-z0-9]{4}$/u)
    expect(
      prisma._store.organization.filter((row) => row.slug === 'rangoli-collective'),
    ).toHaveLength(1)

    await app.close()
  })

  it('asks for a web address when the name cannot make one', async () => {
    const { app } = await createTestApp()

    const response = await create(app, await signIn(app, 'priya@example.com'), {
      name: 'गरबा रात',
    })

    expect(response.statusCode).toBe(422)
    // About the name and the field to supply, not a "title" nobody sent.
    expect(response.json().error.message).toMatch(/name makes no web address/u)
    expect(response.json().error.message).not.toMatch(/title/u)

    await app.close()
  })

  it('refuses a name that is an email address', async () => {
    const { app } = await createTestApp()

    const response = await create(app, await signIn(app, 'priya@example.com'), {
      name: 'priya@example.com',
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('allows three a day per account, then answers 429 with Retry-After', async () => {
    const { app, prisma } = await createTestApp()
    // An account with a second factor: after its first organisation, an
    // account without one is refused by every guarded route until it enrols.
    const token = await signIn(app, 'owner@rangoli.example')

    for (const name of ['First Nights', 'Second Nights', 'Third Nights']) {
      const response = await create(app, token, { name })

      expect(response.statusCode, name).toBe(201)
    }

    const fourth = await create(app, token, { name: 'Fourth Nights' })

    expect(fourth.statusCode).toBe(429)
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThan(0)
    expect(prisma._store.organization.filter((row) => row.name === 'Fourth Nights')).toHaveLength(0)

    await app.close()
  })

  it('keys the hourly budget on the account, not the one address every browser shares', async () => {
    // Every browser request reaches the API through the web app's proxy, so
    // every account arrives from the same address — as every inject here does.
    // Keyed by address, six people creating one organisation each got
    // [201, 201, 201, 201, 201, 429]: the whole site shared five an hour.
    const { app } = await createTestApp()
    const statuses = []

    for (let index = 0; index < 6; index += 1) {
      const registered = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          email: `organiser${index}@example.com`,
          password: 'a-long-enough-password',
          displayName: `Organiser ${index}`,
        },
      })

      expect(registered.statusCode).toBe(201)

      const created = await create(app, registered.json().token, {
        name: `Garba Group ${index}`,
        timezone: 'America/Chicago',
      })

      statuses.push(created.statusCode)
    }

    expect(statuses).toEqual([201, 201, 201, 201, 201, 201])

    await app.close()
  })

  it("spends one account's hourly budget on that account alone", async () => {
    const { app } = await createTestApp({
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        organizationCreate: { max: 1 },
      },
    })
    // A second factor, so its first organisation does not leave it refused by
    // the enrolment guard before the budget is reached.
    const owner = await signIn(app, 'owner@rangoli.example')
    const priya = await signIn(app, 'priya@example.com')

    expect((await create(app, owner, { name: 'Budget One' })).statusCode).toBe(201)

    const again = await create(app, owner, { name: 'Budget Two' })

    expect(again.statusCode).toBe(429)
    expect(Number(again.headers['retry-after'])).toBeGreaterThan(0)
    // Another account, same address: its own budget is untouched.
    expect((await create(app, priya, { name: 'Budget Three' })).statusCode).toBe(201)

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

  it('leaves a new owner without a second factor refused by the workspace until they enrol', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const created = await create(app, token, { name: 'Needs A Factor' })

    expect(created.statusCode).toBe(201)

    const team = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${created.json().data.id}/members`,
      headers: bearer(token),
    })

    expect(team.statusCode).toBe(403)
    expect(team.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })

  it('shortens the caller session to the privileged lifetime and keeps a bearer secret', async () => {
    const { app, prisma } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    await create(app, token, { name: 'Short Session' })

    const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))

    expect(session.revokedAt ?? null).toBeNull()
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 12 * 60 * 60 * 1000)

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

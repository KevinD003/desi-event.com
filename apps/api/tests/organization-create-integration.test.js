/**
 * Organisations are not created from an account, and the verification path
 * still works for the ones that were, against PostgreSQL.
 *
 * `POST /v1/organizations` answers 403 `ORGANIZER_INVITATION_REQUIRED` to every
 * signed-in caller, platform staff included, and writes nothing — checked here
 * on real rows, and with requests racing, because the old route's per-account
 * cap was a race this suite used to prove. Organisers now join by invitation
 * (`organizer-invitation-integration.test.js`).
 *
 * The verification flow is kept, on a grandfathered organisation inserted
 * directly — one made before invitations, still UNVERIFIED — from the owner's
 * submission to a moderator's decision, including the audit action the
 * decision writes.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/organization-create-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the organisation creation suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `create-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`org-create-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A user with a confirmed second factor.
 *
 * A factor, because an organisation's owner is privileged, and every guarded
 * request of an owner without one is refused.
 *
 * @param {string} local The address's local part.
 * @param {string} [role] The platform role.
 * @returns {Promise<object>} The user row.
 */
async function user(local, role = 'ATTENDEE') {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@${DOMAIN}`,
      displayName: local,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      id: id(`factor-${local}`),
      userId: row.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  return row
}

/**
 * A real session with a second factor confirmed just now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} Bearer headers.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'org-create-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

let app

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

const describeWhen = when()

/**
 * A grandfathered organisation: made before invitations, still UNVERIFIED,
 * with its owner. Inserted directly, as the rows already in a database are.
 *
 * @param {object} owner The owner.
 * @param {string} name The organisation's name.
 * @returns {Promise<object>} The organisation row.
 */
async function grandfathered(owner, name) {
  const organization = await prisma.organization.create({
    data: {
      id: id('organization'),
      name,
      slug: `grandfathered-${id('slug').slice(1, 13)}`,
      timezone: 'America/Chicago',
      contactEmail: owner.email,
      payoutCurrency: 'USD',
      verificationStatus: 'UNVERIFIED',
      verified: false,
      createdById: owner.id,
    },
  })

  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  return organization
}

describeWhen('creating an organisation, against PostgreSQL', () => {
  it('refuses every signed-in caller, platform staff included, and writes nothing', async () => {
    const callers = [
      await user('bay.attendee'),
      await user('bay.organiser', 'ORGANIZER'),
      await user('bay.administrator', 'ADMIN'),
      await user('bay.super', 'SUPER_ADMIN'),
    ]

    for (const caller of callers) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/organizations',
        headers: await sessionFor(caller),
        payload: {
          name: `Bay Lights ${RUN}`,
          timezone: 'America/Los_Angeles',
          payoutCurrency: 'INR',
          contactEmail: `attacker.${RUN}@${DOMAIN}`,
          verificationStatus: 'VERIFIED',
        },
      })

      expect(response.statusCode, caller.role).toBe(403)
      expect(response.json().error.code, caller.role).toBe('ORGANIZER_INVITATION_REQUIRED')
    }

    const ids = callers.map((caller) => caller.id)

    expect(await prisma.organization.count({ where: { createdById: { in: ids } } })).toBe(0)
    expect(await prisma.membership.count({ where: { userId: { in: ids } } })).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { action: 'organization.created', actorId: { in: ids } },
      }),
    ).toBe(0)
  })

  it('refuses requests that race, every one of them', async () => {
    const creator = await user('racing.creator')
    const headers = await sessionFor(creator)

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        app.inject({
          method: 'POST',
          url: '/v1/organizations',
          headers,
          payload: { name: `Race ${index} ${RUN}` },
        }),
      ),
    )

    expect(results.map((response) => response.statusCode)).toEqual(Array(6).fill(403))
    expect(await prisma.organization.count({ where: { createdById: creator.id } })).toBe(0)
  })

  it('takes a grandfathered organisation from submission to a moderator’s decision, and records it', async () => {
    const owner = await user('verified.owner', 'ORGANIZER')
    const moderator = await user('queue.moderator', 'MODERATOR')
    const organization = await grandfathered(owner, `Verified Path ${RUN}`)
    const organizationId = organization.id
    const ownerHeaders = await sessionFor(owner)

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/verification`,
      headers: ownerHeaders,
      payload: { note: `We have run four nights a year since 2019 ${RUN}` },
    })

    expect(submitted.statusCode).toBe(200)
    expect(submitted.json().data.status).toBe('PENDING')

    const moderatorHeaders = await sessionFor(moderator)
    const queue = await app.inject({
      method: 'GET',
      url: '/v1/moderation/organizations?perPage=100',
      headers: moderatorHeaders,
    })

    expect(queue.statusCode).toBe(200)

    const entry = queue.json().data.find((row) => row.organizationId === organizationId)

    expect(entry).toMatchObject({
      status: 'PENDING',
      memberCount: 1,
      eventCount: 0,
      organiserNote: `We have run four nights a year since 2019 ${RUN}`,
    })
    expect(queue.body).not.toContain(owner.email)

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/verification/decision`,
      headers: moderatorHeaders,
      payload: { decision: 'VERIFIED', reason: 'Registry and web presence checked' },
    })

    expect(decided.statusCode).toBe(200)
    expect(decided.json().data).toMatchObject({ status: 'VERIFIED', eligible: true })

    const profile = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organizationId}`,
      headers: ownerHeaders,
    })

    expect(profile.json().data).toMatchObject({ verificationStatus: 'VERIFIED', eligible: true })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organization.verification_decided', entityId: organizationId },
    })

    expect(audit).not.toBeNull()
    expect(audit.actorId).toBe(moderator.id)
  })

  it('refuses a moderator who belongs to the organisation, on real rows', async () => {
    const owner = await user('conflicted.owner', 'ORGANIZER')
    const moderator = await user('conflicted.moderator', 'MODERATOR')
    const organization = await grandfathered(owner, `Conflicted ${RUN}`)

    await prisma.organization.update({
      where: { id: organization.id },
      data: { verificationStatus: 'PENDING' },
    })
    await prisma.membership.create({
      data: {
        id: id('membership'),
        userId: moderator.id,
        organizationId: organization.id,
        role: 'VIEWER',
      },
    })

    const decided = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organization.id}/verification/decision`,
      headers: await sessionFor(moderator),
      payload: { decision: 'VERIFIED', reason: 'Looks fine to me' },
    })

    expect(decided.statusCode).toBe(403)
    expect(decided.json().error.code).toBe('CONFLICT_OF_INTEREST')
    expect(
      (await prisma.organization.findUnique({ where: { id: organization.id } })).verificationStatus,
    ).toBe('PENDING')
  })
})

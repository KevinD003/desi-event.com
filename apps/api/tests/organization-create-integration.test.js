/**
 * Creating an organisation and having it verified, against PostgreSQL.
 *
 * What only the real database can answer: that the rows are written as the
 * route says (including the provenance foreign key), that the per-account cap
 * holds when several creations race — the creator's user row is locked so they
 * count one after another — and that the whole path from creation to a
 * moderator's decision works on real rows, including the audit action the
 * decision writes, which went unrecorded for two phases because no suite
 * covered it against PostgreSQL.
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
 * A factor, because creating an organisation makes the account an OWNER, and
 * every later guarded request of an owner without one is refused.
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
    // The per-address budget is not what these tests are about, and every
    // request here comes from one address.
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      organizationCreate: { max: 1000 },
    },
  })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

const describeWhen = when()

describeWhen('creating an organisation, against PostgreSQL', () => {
  it('writes the organisation, its owner and its provenance as the route says', async () => {
    const creator = await user('bay.creator')
    const headers = await sessionFor(creator)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers,
      payload: {
        name: `Bay Lights ${RUN}`,
        timezone: 'America/Los_Angeles',
        payoutCurrency: 'INR',
        contactEmail: `attacker.${RUN}@${DOMAIN}`,
        verificationStatus: 'VERIFIED',
      },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.session).toEqual({ mfaRequired: true, mfaEnrolled: true })

    const [row] = await prisma.$queryRaw`
      SELECT o."verificationStatus", o."verified", o."payoutCurrency", o."contactEmail",
             o."createdById", o."timezone", u."id" AS "creatorId"
        FROM "Organization" o
        JOIN "User" u ON u."id" = o."createdById"
       WHERE o."id" = ${response.json().data.id}`

    expect(row).toMatchObject({
      verificationStatus: 'UNVERIFIED',
      verified: false,
      payoutCurrency: 'USD',
      contactEmail: creator.email,
      createdById: creator.id,
      creatorId: creator.id,
      timezone: 'America/Los_Angeles',
    })

    const membership = await prisma.membership.findFirst({
      where: { organizationId: response.json().data.id },
    })

    expect(membership).toMatchObject({ userId: creator.id, role: 'OWNER' })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organization.created', entityId: response.json().data.id },
    })

    expect(audit.actorId).toBe(creator.id)
    expect(JSON.stringify(audit.metadata)).not.toContain(creator.email)
  })

  it('never lets one account past three a day, however many requests race', async () => {
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

    const statuses = results.map((response) => response.statusCode)

    for (const status of statuses) expect([201, 429]).toContain(status)
    expect(statuses.filter((status) => status === 201)).toHaveLength(3)

    for (const refused of results.filter((response) => response.statusCode === 429)) {
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    }

    expect(await prisma.organization.count({ where: { createdById: creator.id } })).toBe(3)
  })

  it('goes from creation to a moderator’s decision, and records the decision', async () => {
    const creator = await user('verified.creator')
    const moderator = await user('queue.moderator', 'MODERATOR')
    const creatorHeaders = await sessionFor(creator)

    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: creatorHeaders,
      payload: { name: `Verified Path ${RUN}` },
    })

    expect(created.statusCode).toBe(201)

    const organizationId = created.json().data.id

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${organizationId}/verification`,
      headers: creatorHeaders,
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
    expect(queue.body).not.toContain(creator.email)

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
      headers: creatorHeaders,
    })

    expect(profile.json().data).toMatchObject({ verificationStatus: 'VERIFIED', eligible: true })

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'organization.verification_decided', entityId: organizationId },
    })

    expect(audit).not.toBeNull()
    expect(audit.actorId).toBe(moderator.id)
  })
})

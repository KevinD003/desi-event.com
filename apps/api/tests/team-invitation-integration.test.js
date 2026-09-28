/**
 * Invitation codes handed over by hand, against PostgreSQL.
 *
 * `teams.test.js` proves the rules against the stub. What is here is what only
 * the real database can answer: what the stored row actually holds, what the
 * audit table actually holds, whether the partial unique index behind "one live
 * invitation per address" exists and bites, what two invitations issued at the
 * same moment produce, and whether accepting one really ends the invitee's
 * other sessions.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/team-invitation-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the team invitation suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `invite-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`team-invite-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * SHA-256, hex: what `hashToken` stores.
 *
 * @param {string} value The code.
 * @returns {string} Its digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * A user.
 *
 * @param {string} local The address's local part.
 * @param {object} [options] Options.
 * @param {boolean} [options.secondFactor] Whether they have a confirmed second factor.
 * @returns {Promise<object>} The user row.
 */
async function user(local, { secondFactor = false } = {}) {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@${DOMAIN}`,
      displayName: local,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role: 'ATTENDEE',
      emailVerified: true,
    },
  })

  if (secondFactor) {
    await prisma.mfaFactor.create({
      data: {
        id: id(`factor-${local}`),
        userId: row.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  return row
}

/**
 * A real session, and the bearer header for it.
 *
 * @param {object} who The user.
 * @returns {Promise<{headers: object, session: object}>} Bearer headers and the row.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { session, secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'team-invitation-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { headers: { authorization: `Bearer ${secret}` }, session }
}

let app
let world

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, auth: { max: 1000 } },
  })
  await app.ready()

  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Invite Home ${RUN}`,
      slug: `invite-home-${RUN}`,
      contactEmail: `hello.${RUN}@${DOMAIN}`,
    },
  })

  const owner = await user('meera.owner', { secondFactor: true })

  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  world = { organization, owner, ownerSession: await sessionFor(owner) }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * Invite an address as the owner.
 *
 * @param {string} email Who.
 * @param {string} [role] What role.
 * @returns {Promise<object>} The inject result.
 */
function invite(email, role = 'STAFF') {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${world.organization.id}/invitations`,
    headers: world.ownerSession.headers,
    payload: { email, role },
  })
}

/**
 * The live invitations to an address, compared as the index compares them.
 *
 * @param {string} email The address.
 * @returns {Promise<object[]>} The rows.
 */
function pendingTo(email) {
  return prisma.$queryRaw`
    SELECT "id" FROM "Invitation"
     WHERE "organizationId" = ${world.organization.id}
       AND lower("email") = lower(${email})
       AND "status" = 'PENDING'`
}

const describeWhen = when()

describeWhen('an invitation code, in the database', () => {
  it('stores only the digest, and neither the log nor the audit row holds the code', async () => {
    const email = `first.${RUN}@${DOMAIN}`
    const response = await invite(email)

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers.pragma).toBe('no-cache')

    const { id: invitationId, delivery } = response.json().data

    expect(delivery.mode).toBe('MANUAL')

    const code = delivery.invitationCode
    const [row] = await prisma.$queryRaw`SELECT * FROM "Invitation" WHERE "id" = ${invitationId}`

    expect(row.tokenHash).toBe(sha256(code))
    expect(row.deliveryMode).toBe('MANUAL')
    // No column of the stored row carries the code itself.
    expect(Object.values(row).map((value) => String(value))).not.toContain(code)
    expect(JSON.stringify(row)).not.toContain(code)

    const audits = await prisma.$queryRaw`
      SELECT "action", "metadata"::text AS "metadata" FROM "AuditLog" WHERE "entityId" = ${invitationId}`

    expect(audits.map((entry) => entry.action)).toEqual(['team.invited'])

    for (const entry of audits) {
      expect(entry.metadata).not.toContain(code)
      expect(entry.metadata).not.toContain(row.tokenHash)
      expect(entry.metadata).toContain('MANUAL')
    }
  })

  it('refuses a second live invitation to the same address, whatever its case', async () => {
    const email = `index.${RUN}@${DOMAIN}`

    expect((await invite(email)).statusCode).toBe(201)

    await expect(
      prisma.$executeRaw`
        INSERT INTO "Invitation" ("id", "organizationId", "email", "role", "tokenHash", "invitedById", "status", "expiresAt")
        VALUES (${id('raw')}, ${world.organization.id}, ${email.toUpperCase()}, 'STAFF', ${sha256(id('raw-hash'))},
                ${world.owner.id}, 'PENDING', now() + interval '1 day')`,
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Invitation_one_pending_per_address|unique/iu),
    })

    expect(await pendingTo(email)).toHaveLength(1)
  })

  it('leaves exactly one live invitation when two are issued at the same moment', async () => {
    for (let round = 0; round < 4; round += 1) {
      const email = `race${round}.${RUN}@${DOMAIN}`
      const results = await Promise.all([invite(email), invite(email)])
      const statuses = results.map((response) => response.statusCode)

      // Either the second waited for the first and superseded it, or the index
      // refused it: never a server error, never two live codes.
      for (const status of statuses) expect([201, 409]).toContain(status)
      expect(statuses).toContain(201)
      expect(await pendingTo(email)).toHaveLength(1)

      for (const response of results.filter((candidate) => candidate.statusCode === 409)) {
        expect(response.json().error.message).toMatch(/at the same moment/u)
        expect(response.body).not.toContain('invitationCode')
      }
    }
  })

  it('leaves one live invitation after a new code is issued, and the old code dead', async () => {
    const email = `reissue.${RUN}@${DOMAIN}`
    const first = (await invite(email)).json().data

    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/invitations/${first.id}/reissue`,
      headers: world.ownerSession.headers,
    })

    expect(reissued.statusCode).toBe(201)
    expect(await pendingTo(email)).toHaveLength(1)

    const [old] = await prisma.$queryRaw`SELECT "status" FROM "Invitation" WHERE "id" = ${first.id}`

    expect(old.status).toBe('REVOKED')

    const [fresh] = await prisma.$queryRaw`
      SELECT "tokenHash" FROM "Invitation" WHERE "id" = ${reissued.json().data.id}`

    expect(fresh.tokenHash).toBe(sha256(reissued.json().data.delivery.invitationCode))
  })

  it("ends the invitee's other sessions when they accept, with the reason recorded", async () => {
    const invitee = await user('priya.invitee')
    const invited = await invite(invitee.email)
    const keeping = await sessionFor(invitee)
    const losing = await sessionFor(invitee)

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/invitations/accept',
      headers: keeping.headers,
      payload: { token: invited.json().data.delivery.invitationCode },
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data).toMatchObject({ role: 'STAFF' })

    const ended = await prisma.session.findUnique({ where: { id: losing.session.id } })
    const kept = await prisma.session.findUnique({ where: { id: keeping.session.id } })

    expect(ended.revokedAt).not.toBeNull()
    expect(ended.revokedReason).toBe('role_changed')
    expect(kept.revokedAt).toBeNull()

    const other = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: losing.headers })

    expect(other.statusCode).toBe(401)
  })

  it('leaves one membership, and never a server error, when a direct grant races an acceptance', async () => {
    const admin = await prisma.user.update({
      where: { id: (await user('grant.racer', { secondFactor: true })).id },
      data: { role: 'SUPER_ADMIN' },
    })
    const adminSession = await sessionFor(admin)

    for (let round = 0; round < 4; round += 1) {
      const invitee = await user(`raced.invitee.${round}`)
      const code = (await invite(invitee.email)).json().data.delivery.invitationCode
      const inviteeSession = await sessionFor(invitee)

      const [accepted, granted] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/v1/invitations/accept',
          headers: inviteeSession.headers,
          payload: { token: code },
        }),
        app.inject({
          method: 'POST',
          url: `/v1/platform/organizations/${world.organization.id}/members`,
          headers: adminSession.headers,
          payload: { userId: invitee.id, role: 'VIEWER', reason: `Race round ${round}` },
        }),
      ])

      // Whichever lands second either finds the first's membership, or is
      // refused by the database's unique index and says so; an acceptance can
      // also find its session ended by the grant (401). Never a 500.
      expect([200, 401, 409]).toContain(accepted.statusCode)
      expect([200, 409]).toContain(granted.statusCode)
      expect([accepted.statusCode, granted.statusCode]).toContain(200)
      expect(
        await prisma.membership.count({
          where: { organizationId: world.organization.id, userId: invitee.id },
        }),
      ).toBe(1)
    }
  })
})

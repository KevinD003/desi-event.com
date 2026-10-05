/**
 * Organiser invitations, against PostgreSQL.
 *
 * `organizer-invitations.test.js` proves the rules against the stub. What is
 * here is what only the real database can answer: what the stored rows and
 * the audit table actually hold, whether the partial unique index behind "one
 * waiting invitation per address" exists and bites (whatever the case of the
 * address), what two invitations issued at the same moment produce, whether
 * two acceptances at the same moment make one organisation, and whether the
 * organisation, its verification event and its owner's membership are written
 * together with the foreign keys the schema promises.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/organizer-invitation-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the organiser invitation suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `onboard-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`organiser-${RUN}-${kind}-${sequence}`).digest('hex')
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
 * A user, with a confirmed second factor when they need one.
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
 * @returns {Promise<{headers: object, session: object}>} Bearer headers and the row.
 */
async function sessionFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { session, secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'organiser-invitation-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { headers: { authorization: `Bearer ${secret}` }, session }
}

let app
let administrator

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      auth: { max: 1000 },
      organizerInvite: { max: 1000 },
    },
  })
  await app.ready()

  const admin = await user('anil.admin', 'ADMIN')

  administrator = { user: admin, ...(await sessionFor(admin)) }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * Issue an organiser invitation as the administrator.
 *
 * @param {string} email Who.
 * @param {object} [extra] More of the body.
 * @returns {Promise<object>} The inject result.
 */
function issue(email, extra = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/platform/organizer-invitations',
    headers: administrator.headers,
    payload: { email, organizationName: `Garba Collective ${RUN}`, ...extra },
  })
}

/**
 * The waiting invitations to an address, compared as the index compares them.
 *
 * @param {string} email The address.
 * @returns {Promise<object[]>} The rows.
 */
function waitingTo(email) {
  return prisma.$queryRaw`
    SELECT "id" FROM "OrganizerInvitation"
     WHERE lower("email") = lower(${email}) AND "status" = 'PENDING'`
}

const describeWhen = when()

describeWhen('an organiser invitation, in the database', () => {
  it('stores only the digest, and neither the row nor the audit holds the code or the address', async () => {
    const email = `stored.${RUN}@${DOMAIN}`
    const response = await issue(email, { note: `A private note ${RUN}` })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')

    const { id: invitationId, delivery } = response.json().data
    const code = delivery.invitationCode

    expect(delivery.mode).toBe('MANUAL')

    const [row] = await prisma.$queryRaw`
      SELECT * FROM "OrganizerInvitation" WHERE "id" = ${invitationId}`

    expect(row.tokenHash).toBe(sha256(code))
    expect(row.invitedById).toBe(administrator.user.id)
    expect(row.status).toBe('PENDING')
    expect(JSON.stringify(row)).not.toContain(code)

    const audits = await prisma.$queryRaw`
      SELECT "action", "metadata"::text AS "metadata" FROM "AuditLog" WHERE "entityId" = ${invitationId}`

    expect(audits.map((entry) => entry.action)).toEqual(['organizer_invitation.issued'])

    for (const entry of audits) {
      expect(entry.metadata).not.toContain(code)
      expect(entry.metadata).not.toContain(row.tokenHash)
      expect(entry.metadata).not.toContain(email)
      expect(entry.metadata).not.toContain('A private note')
    }
  })

  it('refuses a second waiting invitation to the same address, whatever its case', async () => {
    const email = `index.${RUN}@${DOMAIN}`

    expect((await issue(email)).statusCode).toBe(201)

    const again = await issue(email.toUpperCase())

    expect(again.statusCode).toBe(409)
    expect(again.json().error.code).toBe('INVITATION_OUTSTANDING')

    // And the index itself, beneath the route: addresses are stored in lower
    // case (a check constraint), and one waiting row per address.
    const raw = (address) => prisma.$executeRaw`
      INSERT INTO "OrganizerInvitation" ("id", "email", "organizationName", "tokenHash", "invitedById", "status", "deliveryMode", "expiresAt")
      VALUES (${id('raw')}, ${address}, 'Raw', ${sha256(id('raw-hash'))},
              ${administrator.user.id}, 'PENDING', 'MANUAL', now() + interval '1 day')`

    await expect(raw(email)).rejects.toMatchObject({
      message: expect.stringMatching(/unique|one_pending/iu),
    })
    await expect(raw(email.toUpperCase())).rejects.toMatchObject({
      message: expect.stringMatching(/organizer_invitation_email_lower/u),
    })

    expect(await waitingTo(email)).toHaveLength(1)
  })

  it('leaves exactly one waiting invitation when two are issued at the same moment', async () => {
    for (let round = 0; round < 4; round += 1) {
      const email = `race${round}.${RUN}@${DOMAIN}`
      const results = await Promise.all([issue(email), issue(email)])
      const statuses = results.map((response) => response.statusCode).sort()

      expect(statuses).toEqual([201, 409])
      expect(await waitingTo(email)).toHaveLength(1)

      const refused = results.find((response) => response.statusCode === 409)

      expect(refused.json().error.code).toBe('INVITATION_OUTSTANDING')
      expect(refused.body).not.toContain('invitationCode')
    }
  })

  it('kills the old code in the transaction that makes the new one', async () => {
    const email = `reissue.${RUN}@${DOMAIN}`
    const first = (await issue(email)).json().data

    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizer-invitations/${first.id}/reissue`,
      headers: administrator.headers,
    })

    expect(reissued.statusCode).toBe(201)

    const second = reissued.json().data
    const rows = await prisma.organizerInvitation.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { createdAt: 'asc' },
    })

    expect(rows.map((row) => row.status)).toEqual(['REVOKED', 'PENDING'])
    expect(rows[1].supersedesId).toBe(first.id)
    expect(rows[1].tokenHash).toBe(sha256(second.delivery.invitationCode))
    expect(await waitingTo(email)).toHaveLength(1)
  })
})

describeWhen('accepting an organiser invitation, in the database', () => {
  it('writes the organisation, its verification and its owner together, and ends the other sessions', async () => {
    const recipient = await user('priya.recipient')
    const issued = (
      await issue(recipient.email, {
        organizationName: `Priya Presents ${RUN}`,
        organizationDescription: 'Bollywood nights in Austin.',
        organizationWebsiteUrl: 'https://priya-presents.example',
      })
    ).json().data
    const other = await sessionFor(recipient)
    const current = await sessionFor(recipient)

    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: current.headers,
      payload: { token: issued.delivery.invitationCode, timezone: 'America/Chicago' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data).toMatchObject({
      role: 'OWNER',
      session: { mfaRequired: true, mfaEnrolled: true },
    })

    const organizationId = response.json().data.organization.id
    const [row] = await prisma.$queryRaw`
      SELECT o."name", o."description", o."websiteUrl", o."timezone", o."verificationStatus"::text AS "verificationStatus",
             o."verified", o."payoutCurrency", o."contactEmail", o."createdById",
             m."role"::text AS "role", m."userId", m."organizerInvitationId",
             v."actorId" AS "verifiedBy", v."toStatus"::text AS "verifiedTo",
             i."status"::text AS "invitationStatus", i."organizationId" AS "invitationOrganization",
             i."acceptedByUserId"
        FROM "Organization" o
        JOIN "Membership" m ON m."organizationId" = o."id"
        JOIN "OrganizationVerificationEvent" v ON v."organizationId" = o."id"
        JOIN "OrganizerInvitation" i ON i."id" = m."organizerInvitationId"
       WHERE o."id" = ${organizationId}`

    expect(row).toMatchObject({
      name: `Priya Presents ${RUN}`,
      description: 'Bollywood nights in Austin.',
      timezone: 'America/Chicago',
      verificationStatus: 'VERIFIED',
      verified: true,
      payoutCurrency: 'USD',
      contactEmail: recipient.email,
      createdById: recipient.id,
      role: 'OWNER',
      userId: recipient.id,
      organizerInvitationId: issued.id,
      verifiedBy: administrator.user.id,
      verifiedTo: 'VERIFIED',
      invitationStatus: 'ACCEPTED',
      invitationOrganization: organizationId,
      acceptedByUserId: recipient.id,
    })
    expect(row.websiteUrl).toMatch(/^https:\/\/priya-presents\.example/u)

    const actions = await prisma.auditLog.findMany({
      where: {
        OR: [{ entityId: issued.id }, { entityId: organizationId }],
        action: {
          in: [
            'organizer_invitation.accepted',
            'organization.created',
            'organization.verified_by_invitation',
          ],
        },
      },
      select: { action: true, actorId: true, metadata: true },
    })

    expect(actions.map((entry) => entry.action).sort()).toEqual([
      'organization.created',
      'organization.verified_by_invitation',
      'organizer_invitation.accepted',
    ])
    expect(
      actions.find((entry) => entry.action === 'organization.verified_by_invitation').actorId,
    ).toBe(administrator.user.id)
    expect(JSON.stringify(actions)).not.toContain(issued.delivery.invitationCode)
    expect(JSON.stringify(actions)).not.toContain(recipient.email)

    const ended = await prisma.session.findUnique({ where: { id: other.session.id } })

    expect(ended.revokedAt).not.toBeNull()
    expect(ended.revokedReason).toBe('role_changed')
  })

  it('makes one organisation when the same code is accepted twice at once', async () => {
    const recipient = await user('twice.recipient')
    const issued = (await issue(recipient.email, { organizationName: `Twice ${RUN}` })).json().data
    const sessions = [await sessionFor(recipient), await sessionFor(recipient)]

    const results = await Promise.all(
      sessions.map((session) =>
        app.inject({
          method: 'POST',
          url: '/v1/organizer-invitations/accept',
          headers: session.headers,
          payload: { token: issued.delivery.invitationCode },
        }),
      ),
    )
    const statuses = results.map((response) => response.statusCode).sort()

    // One wins. The other either queued behind it and found it spent (409),
    // read it after it was spent (403), or lost its session to the winner's
    // privilege change (401). Never a server error, never two organisations.
    expect(statuses[0]).toBe(200)
    expect([401, 403, 409]).toContain(statuses[1])
    expect(await prisma.organization.count({ where: { createdById: recipient.id } })).toBe(1)
    expect(await prisma.membership.count({ where: { organizerInvitationId: issued.id } })).toBe(1)
  })

  it('refuses a web address that is taken when asked for, and makes a derived one unique', async () => {
    const first = await user('slug.first')
    const second = await user('slug.second')
    const name = `Same Name ${RUN}`
    const one = (await issue(first.email, { organizationName: name })).json().data
    const two = (await issue(second.email, { organizationName: name })).json().data

    const created = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: (await sessionFor(first)).headers,
      payload: { token: one.delivery.invitationCode },
    })

    expect(created.statusCode).toBe(200)

    const taken = created.json().data.organization.slug
    const secondSession = await sessionFor(second)

    const asked = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: secondSession.headers,
      payload: { token: two.delivery.invitationCode, slug: taken },
    })

    expect(asked.statusCode).toBe(409)
    expect((await prisma.organizerInvitation.findUnique({ where: { id: two.id } })).status).toBe(
      'PENDING',
    )

    const derived = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: secondSession.headers,
      payload: { token: two.delivery.invitationCode },
    })

    expect(derived.statusCode).toBe(200)
    expect(derived.json().data.organization.slug).not.toBe(taken)
    expect(derived.json().data.organization.slug.startsWith(`${taken}-`)).toBe(true)
  })

  it('refuses a staff account at acceptance, and spends nothing', async () => {
    const staff = await user('maya.staff', 'MODERATOR')
    const code = `Abcdefghijklmnopqrstuvwxyz0123456789-${RUN}`.slice(0, 43)
    const invitationId = id('planted')

    // Planted, because issuing refuses a staff address: this is the second
    // line, at acceptance.
    await prisma.organizerInvitation.create({
      data: {
        id: invitationId,
        email: staff.email,
        organizationName: `Staff Org ${RUN}`,
        tokenHash: sha256(code),
        invitedById: administrator.user.id,
        deliveryMode: 'MANUAL',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: (await sessionFor(staff)).headers,
      payload: { token: code },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STAFF_ACCOUNT')
    expect(
      (await prisma.organizerInvitation.findUnique({ where: { id: invitationId } })).status,
    ).toBe('PENDING')
    expect(await prisma.membership.count({ where: { userId: staff.id } })).toBe(0)
  })
})

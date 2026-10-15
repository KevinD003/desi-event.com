/**
 * Organiser invitations, attacked.
 *
 * The only way anybody comes to post events is an invitation from the
 * team at The Desi Events, so every test here is somebody trying to get an
 * organisation they were not offered, or a member of the team trying to hand
 * one to themselves:
 *
 *   - issuing: who may, to whom, how often, and what is written down;
 *   - the code: shown once or emailed, never stored, logged or audited;
 *   - the shared queue: list, withdraw and reissue;
 *   - accepting: what the new organisation is, and every way a code that is
 *     not yours, not live or not this kind is refused without being spent.
 *
 * @module @desi-event/api/tests/organizer-invitations
 */

import { hashToken } from '@desi-event/auth'
import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { ORGANIZER_INVITATION_SENTENCES } from '../src/routes/organizer-invitations.js'
import { makeWorld, organizerInvitationFixture } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { expectNoSecret } from './helpers/payloads.js'

/** The shape `issueToken` mints: 43 url-safe characters. */
const CODE_SHAPE = /^[A-Za-z0-9_-]{43}$/u

/** Fourteen days, the life of an organiser invitation. */
const LIFETIME_MS = 14 * 24 * 60 * 60 * 1000

const ADMIN_EMAIL = 'anil@desi-event.example'
const SUPER_ADMIN_EMAIL = 'ops@desi-event.example'
const MODERATOR_EMAIL = 'maya@desi-event.example'

const INVITATIONS = '/v1/platform/organizer-invitations'
const ACCEPT = '/v1/organizer-invitations/accept'

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
 * Sign in and present a second factor, as issuing needs.
 *
 * @param {object} app The instance.
 * @param {string} [email] The staff account.
 * @returns {Promise<object>} Headers for the session.
 */
async function steppedUp(app, email = ADMIN_EMAIL) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Issue an organiser invitation.
 *
 * @param {object} app The instance.
 * @param {object} headers Whose session.
 * @param {object} [payload] The invitation.
 * @returns {Promise<object>} The inject result.
 */
function issue(app, headers, payload = {}) {
  return app.inject({
    method: 'POST',
    url: INVITATIONS,
    headers,
    payload: {
      email: 'new-organiser@example.com',
      organizationName: 'Kathiawar Folk Nights',
      ...payload,
    },
  })
}

/**
 * Accept an organiser invitation.
 *
 * @param {object} app The instance.
 * @param {string} email Who is signed in.
 * @param {object} payload The body.
 * @returns {Promise<object>} The inject result.
 */
async function accept(app, email, payload) {
  return app.inject({
    method: 'POST',
    url: ACCEPT,
    headers: bearer(await signIn(app, email)),
    payload,
  })
}

/**
 * The audit rows written with one action.
 *
 * @param {object} prisma The stub.
 * @param {string} action The action.
 * @returns {object[]} The rows.
 */
function audits(prisma, action) {
  return prisma._store.auditLog.filter((row) => row.action === action)
}

/**
 * The user row for an address.
 *
 * @param {object} prisma The stub.
 * @param {string} email The address.
 * @returns {object} The row.
 */
function userByEmail(prisma, email) {
  return prisma._store.user.find((row) => row.email === email)
}

/**
 * Make every session's second factor three minutes old: past the two-minute
 * SECURITY_ROLE window. Signing in with a code is itself a confirmation, so a
 * route straight after sign-in would otherwise go through.
 *
 * @param {object} prisma The stub.
 * @returns {void} Nothing.
 */
function staleSecondFactor(prisma) {
  for (const session of prisma._store.session) {
    session.mfaSatisfiedAt = new Date(Date.now() - 3 * 60 * 1000)
  }
}

/**
 * Put an invitation straight into the store, as one issued earlier.
 *
 * @param {object} prisma The stub.
 * @param {object} ids The fixture ids.
 * @param {object} [overrides] Columns to set.
 * @returns {{row: object, code: string}} The row and its code.
 */
function plant(prisma, ids, overrides = {}) {
  const invitation = organizerInvitationFixture({
    invitedById: ids.platformAdministrator.id,
    ...overrides,
  })

  prisma._store.organizerInvitation.push(invitation.row)

  return invitation
}

describe('issuing an organiser invitation', () => {
  it('shows the code once to a platform administrator, stores only its digest, and audits how it went', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)

    const response = await issue(app, headers, {
      email: 'New-Organiser@Example.com',
      organizationDescription: 'Folk music from Saurashtra, twice a year.',
      organizationWebsiteUrl: 'https://kathiawar-folk.example',
      note: 'As we discussed on the phone.',
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')

    const { data } = response.json()

    expect(data.delivery.mode).toBe('MANUAL')
    expect(data.delivery.invitationCode).toMatch(CODE_SHAPE)
    expect(data).toMatchObject({
      email: 'new-organiser@example.com',
      organizationName: 'Kathiawar Folk Nights',
      organizationDescription: 'Folk music from Saurashtra, twice a year.',
      note: 'As we discussed on the phone.',
      status: 'PENDING',
      deliveryMode: 'MANUAL',
      invitedByName: 'Anil Administrator',
      organization: null,
      supersedesId: null,
    })
    expect(Date.parse(data.expiresAt) - Date.parse(data.createdAt)).toBe(LIFETIME_MS)

    const code = data.delivery.invitationCode
    const [row] = prisma._store.organizerInvitation

    expect(prisma._store.organizerInvitation).toHaveLength(1)
    expect(row).toMatchObject({
      email: 'new-organiser@example.com',
      invitedById: ids.platformAdministrator.id,
      status: 'PENDING',
      deliveryMode: 'MANUAL',
      tokenHash: hashToken(code),
    })
    expectNoSecret(expect, row, code)

    const [issued] = audits(prisma, 'organizer_invitation.issued')

    expect(issued).toMatchObject({
      actorId: ids.platformAdministrator.id,
      entityType: 'OrganizerInvitation',
      entityId: row.id,
    })
    // How it went out, and nothing that identifies the person or opens it.
    expect(issued.metadata).toEqual({ role: 'OWNER', deliveryMode: 'MANUAL' })
    expectNoSecret(expect, prisma._store.auditLog, code)
    expectNoSecret(expect, prisma._store.auditLog, row.tokenHash)
    expectNoSecret(expect, prisma._store.auditLog, 'new-organiser@example.com')

    await app.close()
  })

  it('lets a super administrator issue one too', async () => {
    const { app } = await createTestApp()

    const response = await issue(app, await steppedUp(app, SUPER_ADMIN_EMAIL))

    expect(response.statusCode).toBe(201)
    expect(response.json().data.invitedByName).toBe('Platform Ops')

    await app.close()
  })

  it('refuses everybody without organizer:invite, and writes nothing', async () => {
    const { app, prisma } = await createTestApp()

    for (const email of [
      MODERATOR_EMAIL,
      'owner@rangoli.example',
      'arun@rangoli.example',
      'priya@example.com',
    ]) {
      const response = await issue(app, bearer(await signIn(app, email)))

      expect(response.statusCode, email).toBe(403)
      expect(response.json().error.code, email).toBe('FORBIDDEN')
    }

    const anonymous = await app.inject({
      method: 'POST',
      url: INVITATIONS,
      payload: { email: 'x@example.com', organizationName: 'Anyone' },
    })

    expect(anonymous.statusCode).toBe(401)
    expect(prisma._store.organizerInvitation).toHaveLength(0)
    expect(audits(prisma, 'organizer_invitation.issued')).toHaveLength(0)

    await app.close()
  })

  it('asks for a recent second factor before minting a code', async () => {
    const { app, prisma } = await createTestApp()
    const headers = bearer(await signIn(app, ADMIN_EMAIL))

    staleSecondFactor(prisma)

    const response = await issue(app, headers)

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.organizerInvitation).toHaveLength(0)

    await app.close()
  })

  it('refuses an administrator inviting their own address, whatever its case', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await steppedUp(app)

    for (const email of [ADMIN_EMAIL, 'Anil@Desi-Event.Example']) {
      const response = await issue(app, headers, { email })

      expect(response.statusCode).toBe(403)
      expect(response.json().error).toMatchObject({
        code: 'SELF_INVITATION',
        message: ORGANIZER_INVITATION_SENTENCES.SELF_INVITATION,
      })
    }

    expect(prisma._store.organizerInvitation).toHaveLength(0)

    await app.close()
  })

  it('refuses an address that belongs to a staff account: reviewers do not run organisations', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await steppedUp(app)

    for (const email of [MODERATOR_EMAIL, 'OPS@desi-event.example']) {
      const response = await issue(app, headers, { email })

      expect(response.statusCode, email).toBe(422)
      expect(response.json().error).toMatchObject({
        code: 'STAFF_ACCOUNT',
        message: ORGANIZER_INVITATION_SENTENCES.STAFF_ACCOUNT,
      })
    }

    expect(prisma._store.organizerInvitation).toHaveLength(0)

    await app.close()
  })

  it('keeps one waiting invitation per address, whatever its case', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await steppedUp(app)

    expect((await issue(app, headers)).statusCode).toBe(201)

    const again = await issue(app, headers, {
      email: 'NEW-ORGANISER@example.com',
      organizationName: 'Another Name',
    })

    expect(again.statusCode).toBe(409)
    expect(again.json().error).toMatchObject({
      code: 'INVITATION_OUTSTANDING',
      message: ORGANIZER_INVITATION_SENTENCES.INVITATION_OUTSTANDING,
    })
    expect(prisma._store.organizerInvitation).toHaveLength(1)
    expect(audits(prisma, 'organizer_invitation.issued')).toHaveLength(1)

    await app.close()
  })

  it('moves a waiting invitation that has run out to EXPIRED, so the address can be invited again', async () => {
    const { app, prisma, ids } = await createTestApp()
    const stale = plant(prisma, ids, {
      expiresAt: new Date(Date.now() - 60_000),
      createdAt: new Date(Date.now() - LIFETIME_MS - 60_000),
    })

    const response = await issue(app, await steppedUp(app))

    expect(response.statusCode).toBe(201)
    expect(prisma._store.organizerInvitation.find((row) => row.id === stale.row.id).status).toBe(
      'EXPIRED',
    )

    await app.close()
  })

  it('ignores whatever else the body claims: the role, the status, the inviter, the organisation', async () => {
    const { app, prisma, ids } = await createTestApp()

    const response = await issue(app, await steppedUp(app), {
      role: 'ADMIN',
      status: 'ACCEPTED',
      invitedById: ids.manager.id,
      organizationId: ids.organization.id,
      tokenHash: 'a'.repeat(64),
      deliveryMode: 'EMAIL',
      expiresAt: '2099-01-01T00:00:00.000Z',
    })

    expect(response.statusCode).toBe(201)

    const [row] = prisma._store.organizerInvitation

    expect(row).toMatchObject({
      status: 'PENDING',
      invitedById: ids.platformAdministrator.id,
      organizationId: null,
      deliveryMode: 'MANUAL',
    })
    expect(row).not.toHaveProperty('role')
    expect(row.tokenHash).not.toBe('a'.repeat(64))
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now() + LIFETIME_MS + 60_000)

    await app.close()
  })

  it('refuses a body that is not an invitation, precisely', async () => {
    const { app, prisma } = await createTestApp()
    const headers = await steppedUp(app)

    for (const payload of [
      { organizationName: undefined },
      { email: 'not-an-address' },
      { organizationName: '' },
      { note: 'Ring me\u0007 tomorrow' },
      { organizationWebsiteUrl: 'javascript:alert(1)' },
    ]) {
      const response = await issue(app, headers, payload)

      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
      expect(response.json().error.code).toBe('VALIDATION_ERROR')
    }

    expect(prisma._store.organizerInvitation).toHaveLength(0)

    await app.close()
  })

  it('never writes the code to a log line, and logs no address or note', async () => {
    const stream = captureStream()
    const world = await makeWorld()
    const { app } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      logger: createLogger({
        name: 'organizer-invitations-test',
        level: 'trace',
        destination: stream,
      }),
    })

    const issued = await issue(app, await steppedUp(app), {
      email: 'priya@example.com',
      note: 'A private word for Priya.',
    })
    const code = issued.json().data.delivery.invitationCode

    expect((await accept(app, 'priya@example.com', { token: code })).statusCode).toBe(200)

    const raw = stream.raw()

    expect(raw).toContain('issued an organiser invitation')
    expect(raw).toContain('accepted an organiser invitation')
    expectNoSecret(expect, raw, code)
    expectNoSecret(expect, raw, hashToken(code))
    expectNoSecret(expect, raw, 'A private word for Priya.')

    await app.close()
  })
})

describe('emailing an organiser invitation (EMAIL mode)', () => {
  /**
   * A harness whose codes go to a provider hook.
   *
   * @param {function(object): Promise<void>} deliver The hook.
   * @returns {Promise<object>} The harness.
   */
  async function emailing(deliver) {
    const world = await makeWorld()

    return createTestApp({ seed: world.seed, ids: world.ids, deliver })
  }

  it('hands the code to the mailer with what the letter needs, and shows it to nobody', async () => {
    const delivered = []
    const { app, prisma } = await emailing(async (message) => delivered.push(message))

    const response = await issue(app, await steppedUp(app), { note: 'See you in Houston.' })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })
    expect(delivered).toHaveLength(1)

    const [message] = delivered
    const [row] = prisma._store.organizerInvitation

    expect(message).toMatchObject({
      purpose: 'ORGANIZER_INVITATION',
      email: 'new-organiser@example.com',
      organizationName: 'Kathiawar Folk Nights',
      note: 'See you in Houston.',
      inviterName: 'Anil Administrator',
      expiresAt: row.expiresAt.toISOString(),
    })
    expect(message.token).toMatch(CODE_SHAPE)
    expect(hashToken(message.token)).toBe(row.tokenHash)
    expect(row.deliveryMode).toBe('EMAIL')
    expectNoSecret(expect, response.body, message.token)
    expect(audits(prisma, 'organizer_invitation.issued')[0].metadata).toEqual({
      role: 'OWNER',
      deliveryMode: 'EMAIL',
    })

    await app.close()
  })

  it('withdraws the invitation and answers 503 when the mail server refuses it', async () => {
    const { app, prisma, ids } = await emailing(async () => {
      throw Object.assign(new Error('The mail server did not accept the message'), {
        code: 'SEND_FAILED',
      })
    })
    const headers = await steppedUp(app)

    const response = await issue(app, headers)

    expect(response.statusCode).toBe(503)
    expect(response.json().error).toMatchObject({
      code: 'DELIVERY_FAILED',
      message:
        'The email could not be sent, so the invitation was withdrawn and nothing reached them. Try again in a few minutes.',
    })

    const [row] = prisma._store.organizerInvitation

    expect(row).toMatchObject({ status: 'REVOKED', revokedById: ids.platformAdministrator.id })
    expect(row.revokedAt).toBeInstanceOf(Date)

    const [failure] = audits(prisma, 'organizer_invitation.delivery_failed')

    expect(failure).toMatchObject({
      actorId: ids.platformAdministrator.id,
      entityType: 'OrganizerInvitation',
      entityId: row.id,
    })
    expect(failure.metadata).toEqual({ deliveryMode: 'EMAIL' })

    // Nothing is left waiting, so the address can be invited again.
    expect((await issue(app, headers)).statusCode).toBe(503)
    expect(prisma._store.organizerInvitation.every((r) => r.status === 'REVOKED')).toBe(true)

    await app.close()
  })

  it('withdraws a reissued code the mail server refused, after the old one has gone', async () => {
    let fail = false
    const { app, prisma, ids } = await emailing(async () => {
      if (fail) throw new Error('The mail server did not accept the message')
    })
    const headers = await steppedUp(app)
    const first = (await issue(app, headers)).json().data

    fail = true

    const response = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${first.id}/reissue`,
      headers,
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('DELIVERY_FAILED')
    expect(prisma._store.organizerInvitation).toHaveLength(2)
    expect(prisma._store.organizerInvitation.map((row) => row.status)).toEqual([
      'REVOKED',
      'REVOKED',
    ])
    expect(audits(prisma, 'organizer_invitation.delivery_failed')).toHaveLength(1)
    expect(audits(prisma, 'organizer_invitation.delivery_failed')[0].actorId).toBe(
      ids.platformAdministrator.id,
    )

    await app.close()
  })
})

describe('the shared queue: listing', () => {
  it('shows waiting invitations by default, newest first, with no code and no-store', async () => {
    const { app, prisma, ids } = await createTestApp()
    const older = plant(prisma, ids, {
      email: 'older@example.com',
      organizationName: 'Older Garba',
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    const newer = plant(prisma, ids, {
      email: 'newer@example.com',
      organizationName: 'Newer Dandiya',
    })

    plant(prisma, ids, { email: 'gone@example.com', status: 'REVOKED', revokedAt: new Date() })

    const response = await app.inject({
      method: 'GET',
      url: INVITATIONS,
      headers: bearer(await signIn(app, ADMIN_EMAIL)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')

    const body = response.json()

    expect(body.data.map((row) => row.email)).toEqual(['newer@example.com', 'older@example.com'])
    expect(body.meta).toEqual({ deliveryMode: 'MANUAL' })
    expect(body.pagination).toMatchObject({ page: 1, total: 2 })
    expect(body.data[0]).not.toHaveProperty('tokenHash')
    expect(body.data[0]).not.toHaveProperty('delivery')

    for (const { code, row } of [older, newer]) {
      expectNoSecret(expect, response.body, code)
      expectNoSecret(expect, response.body, row.tokenHash)
    }

    await app.close()
  })

  it('reports a waiting invitation past its expiry as EXPIRED, and filters by state', async () => {
    const { app, prisma, ids } = await createTestApp()

    plant(prisma, ids, { email: 'live@example.com' })
    plant(prisma, ids, {
      email: 'lapsed@example.com',
      expiresAt: new Date(Date.now() - 1000),
    })
    plant(prisma, ids, { email: 'marked@example.com', status: 'EXPIRED' })

    const headers = bearer(await signIn(app, ADMIN_EMAIL))
    const list = async (query) =>
      (await app.inject({ method: 'GET', url: `${INVITATIONS}?${query}`, headers })).json().data

    expect((await list('status=PENDING')).map((row) => row.email)).toEqual(['live@example.com'])

    const expired = await list('status=EXPIRED')

    expect(expired.map((row) => row.email).sort()).toEqual([
      'lapsed@example.com',
      'marked@example.com',
    ])
    expect(expired.every((row) => row.status === 'EXPIRED')).toBe(true)
    expect(await list('status=ALL')).toHaveLength(3)

    await app.close()
  })

  it('searches organisation names, without regard to case, and not addresses', async () => {
    const { app, prisma, ids } = await createTestApp()

    plant(prisma, ids, { email: 'a@example.com', organizationName: 'Navratri Nights Houston' })
    plant(prisma, ids, { email: 'b@example.com', organizationName: 'Diwali Mela Dallas' })

    const headers = bearer(await signIn(app, ADMIN_EMAIL))
    const search = (q) =>
      app.inject({
        method: 'GET',
        url: `${INVITATIONS}?q=${encodeURIComponent(q)}`,
        headers,
      })

    expect((await search('NAVRATRI')).json().data.map((row) => row.email)).toEqual([
      'a@example.com',
    ])
    expect((await search('b@example')).json().data).toEqual([])
    // As typed: `_` and `%` are characters here, never wildcards that would
    // find every invitation, or one whose name only looks like the search.
    expect((await search('NAVRATR_')).json().data).toEqual([])
    expect((await search('%%')).json().data).toEqual([])

    for (const q of ['x', 'nav\u0000ratri']) {
      const refused = await search(q)

      expect(refused.statusCode, JSON.stringify(q)).toBe(400)
    }

    await app.close()
  })

  it('is for holders of organizer:invite only', async () => {
    const { app } = await createTestApp()

    for (const email of [MODERATOR_EMAIL, 'owner@rangoli.example', 'priya@example.com']) {
      const response = await app.inject({
        method: 'GET',
        url: INVITATIONS,
        headers: bearer(await signIn(app, email)),
      })

      expect(response.statusCode, email).toBe(403)
    }

    const superAdmin = await app.inject({
      method: 'GET',
      url: INVITATIONS,
      headers: bearer(await signIn(app, SUPER_ADMIN_EMAIL)),
    })

    expect(superAdmin.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: INVITATIONS })).statusCode).toBe(401)

    await app.close()
  })
})

describe('withdrawing an organiser invitation', () => {
  it('withdraws a waiting one once, audits it once, and needs no second factor', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })
    // Any holder of organizer:invite: one shared queue.
    const headers = bearer(await signIn(app, SUPER_ADMIN_EMAIL))
    const revoke = () =>
      app.inject({
        method: 'POST',
        url: `${INVITATIONS}/${invitation.row.id}/revoke`,
        headers,
      })

    const first = await revoke()

    expect(first.statusCode).toBe(200)
    expect(first.headers['cache-control']).toContain('no-store')
    expect(first.json().data).toMatchObject({ status: 'REVOKED', revokedByName: 'Platform Ops' })

    const second = await revoke()

    expect(second.statusCode).toBe(200)
    expect(second.json().data.status).toBe('REVOKED')
    expect(audits(prisma, 'organizer_invitation.revoked')).toHaveLength(1)
    expect(audits(prisma, 'organizer_invitation.revoked')[0]).toMatchObject({
      actorId: ids.platformAdmin.id,
      entityId: invitation.row.id,
      metadata: {},
    })

    const refused = await accept(app, 'priya@example.com', { token: invitation.code })

    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('INVITATION_UNUSABLE')

    await app.close()
  })

  it('changes nothing and records nothing for an invitation that was already accepted', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    })

    const response = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${invitation.row.id}/revoke`,
      headers: bearer(await signIn(app, ADMIN_EMAIL)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('ACCEPTED')
    expect(audits(prisma, 'organizer_invitation.revoked')).toHaveLength(0)

    await app.close()
  })

  it('answers 404 for an unknown invitation and 403 for a moderator', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids)

    const unknown = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/cunknown0000000000000000000/revoke`,
      headers: bearer(await signIn(app, ADMIN_EMAIL)),
    })

    expect(unknown.statusCode).toBe(404)

    const moderator = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${invitation.row.id}/revoke`,
      headers: bearer(await signIn(app, MODERATOR_EMAIL)),
    })

    expect(moderator.statusCode).toBe(403)
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    await app.close()
  })
})

describe('reissuing an organiser invitation', () => {
  it('kills the old code in the moment the new one exists, and links the two', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)
    const first = (await issue(app, headers, { email: 'priya@example.com', note: 'Hello.' })).json()
      .data

    const response = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${first.id}/reissue`,
      headers,
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toContain('no-store')

    const second = response.json().data

    expect(second.delivery.invitationCode).toMatch(CODE_SHAPE)
    expect(second.delivery.invitationCode).not.toBe(first.delivery.invitationCode)
    expect(second).toMatchObject({
      email: 'priya@example.com',
      organizationName: first.organizationName,
      note: 'Hello.',
      status: 'PENDING',
      supersedesId: first.id,
    })

    const old = prisma._store.organizerInvitation.find((row) => row.id === first.id)

    expect(old).toMatchObject({ status: 'REVOKED', revokedById: ids.platformAdministrator.id })

    const [reissued] = audits(prisma, 'organizer_invitation.reissued')

    expect(reissued).toMatchObject({ entityId: second.id })
    expect(reissued.metadata).toEqual({ supersedes: first.id, deliveryMode: 'MANUAL' })
    expectNoSecret(expect, prisma._store.auditLog, second.delivery.invitationCode)

    const stale = await accept(app, 'priya@example.com', {
      token: first.delivery.invitationCode,
    })

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('INVITATION_UNUSABLE')

    const fresh = await accept(app, 'priya@example.com', {
      token: second.delivery.invitationCode,
    })

    expect(fresh.statusCode).toBe(200)

    await app.close()
  })

  it('reissues one that ran out', async () => {
    const { app, prisma, ids } = await createTestApp()
    const lapsed = plant(prisma, ids, { expiresAt: new Date(Date.now() - 1000) })

    const response = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${lapsed.row.id}/reissue`,
      headers: await steppedUp(app),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.supersedesId).toBe(lapsed.row.id)

    await app.close()
  })

  it('refuses to reissue one that was accepted or withdrawn', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await steppedUp(app)

    for (const status of ['ACCEPTED', 'REVOKED']) {
      const invitation = plant(prisma, ids, {
        email: `${status.toLowerCase()}@example.com`,
        status,
      })

      const response = await app.inject({
        method: 'POST',
        url: `${INVITATIONS}/${invitation.row.id}/reissue`,
        headers,
      })

      expect(response.statusCode, status).toBe(409)
      expect(response.json().error).toMatchObject({
        code: 'NOT_OUTSTANDING',
        message: ORGANIZER_INVITATION_SENTENCES.NOT_OUTSTANDING,
      })
    }

    expect(prisma._store.organizerInvitation).toHaveLength(2)

    await app.close()
  })

  it('asks for a second factor, and refuses an address that has become a staff account', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })
    const url = `${INVITATIONS}/${invitation.row.id}/reissue`

    const signedIn = bearer(await signIn(app, ADMIN_EMAIL))

    staleSecondFactor(prisma)

    const unstepped = await app.inject({ method: 'POST', url, headers: signedIn })

    expect(unstepped.statusCode).toBe(403)
    expect(unstepped.json().error.code).toBe('STEP_UP_REQUIRED')

    const headers = await steppedUp(app)

    userByEmail(prisma, 'priya@example.com').role = 'SUPPORT'

    const staff = await app.inject({ method: 'POST', url, headers })

    expect(staff.statusCode).toBe(422)
    expect(staff.json().error.code).toBe('STAFF_ACCOUNT')
    expect(prisma._store.organizerInvitation).toHaveLength(1)
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    await app.close()
  })
})

describe('the issuing budget', () => {
  it('is one budget for issuing and reissuing, kept per administrator', async () => {
    const world = await makeWorld()
    const { app } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        organizerInvite: { max: 2, timeWindow: '1 hour' },
      },
    })
    const headers = await steppedUp(app)

    const first = await issue(app, headers, { email: 'one@example.com' })

    expect(first.statusCode).toBe(201)

    const reissued = await app.inject({
      method: 'POST',
      url: `${INVITATIONS}/${first.json().data.id}/reissue`,
      headers,
    })

    expect(reissued.statusCode).toBe(201)

    const third = await issue(app, headers, { email: 'three@example.com' })

    expect(third.statusCode).toBe(429)
    expect(third.json().error.code).toBe('RATE_LIMITED')
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0)
    expect(Number(third.headers['retry-after'])).toBeLessThanOrEqual(60 * 60)

    // Another administrator has a budget of their own.
    const other = await issue(app, await steppedUp(app, SUPER_ADMIN_EMAIL), {
      email: 'three@example.com',
    })

    expect(other.statusCode).toBe(201)

    await app.close()
  })
})

describe('accepting an organiser invitation', () => {
  it('creates the organisation the team vouched for: verified, in USD, with the caller as its owner', async () => {
    const { app, prisma, ids } = await createTestApp()
    const priya = userByEmail(prisma, 'priya@example.com')
    const invitation = plant(prisma, ids, {
      email: 'priya@example.com',
      organizationName: 'Priya Presents',
      organizationDescription: 'Bollywood nights in Austin.',
      organizationWebsiteUrl: 'https://priya-presents.example/',
    })

    const response = await accept(app, 'Priya@Example.com', {
      token: invitation.code,
      timezone: 'America/Chicago',
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()

    expect(data.role).toBe('OWNER')
    expect(data.organization).toMatchObject({
      name: 'Priya Presents',
      slug: 'priya-presents',
      description: 'Bollywood nights in Austin.',
      websiteUrl: 'https://priya-presents.example/',
      timezone: 'America/Chicago',
      verificationStatus: 'VERIFIED',
    })
    expect(data.organization).not.toHaveProperty('contactEmail')
    expect(data.session).toEqual({
      mfaRequired: expect.any(Boolean),
      mfaEnrolled: expect.any(Boolean),
    })

    const organization = prisma._store.organization.find((row) => row.id === data.organization.id)

    expect(organization).toMatchObject({
      contactEmail: 'priya@example.com',
      payoutCurrency: 'USD',
      verificationStatus: 'VERIFIED',
      verified: true,
      createdById: priya.id,
    })

    const verification = prisma._store.organizationVerificationEvent.find(
      (row) => row.organizationId === organization.id,
    )

    expect(verification).toMatchObject({
      fromStatus: null,
      toStatus: 'VERIFIED',
      actorId: ids.platformAdministrator.id,
    })

    const membership = prisma._store.membership.find(
      (row) => row.organizationId === organization.id,
    )

    expect(membership).toMatchObject({
      userId: priya.id,
      role: 'OWNER',
      organizerInvitationId: invitation.row.id,
    })

    const row = prisma._store.organizerInvitation.find((r) => r.id === invitation.row.id)

    expect(row).toMatchObject({
      status: 'ACCEPTED',
      acceptedByUserId: priya.id,
      organizationId: organization.id,
    })
    expect(row.acceptedAt).toBeInstanceOf(Date)

    const [accepted] = audits(prisma, 'organizer_invitation.accepted')
    const [created] = audits(prisma, 'organization.created')
    const [vouched] = audits(prisma, 'organization.verified_by_invitation')

    expect(accepted).toMatchObject({ actorId: priya.id, entityId: invitation.row.id })
    expect(accepted.metadata).toMatchObject({
      organizationId: organization.id,
      membershipId: membership.id,
      invitedById: ids.platformAdministrator.id,
    })
    expect(created).toMatchObject({ actorId: priya.id, entityId: organization.id })
    expect(created.metadata).toMatchObject({
      slug: 'priya-presents',
      role: 'OWNER',
      via: 'ORGANIZER_INVITATION',
      invitationId: invitation.row.id,
    })
    expect(vouched).toMatchObject({
      actorId: ids.platformAdministrator.id,
      entityId: organization.id,
      metadata: { invitationId: invitation.row.id, acceptedByUserId: priya.id },
    })
    expectNoSecret(expect, prisma._store.auditLog, invitation.code)
    expectNoSecret(expect, prisma._store.auditLog, 'priya@example.com')

    // An owner is privileged (NF-12): the workspace waits for a second factor,
    // and the answer said so.
    expect(data.session).toEqual({ mfaRequired: true, mfaEnrolled: false })

    const profile = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${organization.id}`,
      headers: bearer(await signIn(app, 'priya@example.com')),
    })

    expect(profile.statusCode).toBe(403)
    expect(profile.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })

  it('takes only the web address and time zone from the caller; everything else in the body is ignored', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, {
      email: 'priya@example.com',
      organizationName: 'Priya Presents',
    })

    const response = await accept(app, 'priya@example.com', {
      token: invitation.code,
      slug: 'priya-live',
      name: 'Something Else Entirely',
      description: '<script>alert(1)</script>',
      websiteUrl: 'https://phish.example',
      verificationStatus: 'SUSPENDED',
      contactEmail: 'attacker@example.com',
      payoutCurrency: 'INR',
      role: 'ADMIN',
    })

    expect(response.statusCode).toBe(200)

    const organization = prisma._store.organization.find(
      (row) => row.id === response.json().data.organization.id,
    )

    expect(organization).toMatchObject({
      name: 'Priya Presents',
      slug: 'priya-live',
      description: null,
      websiteUrl: null,
      timezone: 'America/New_York',
      contactEmail: 'priya@example.com',
      payoutCurrency: 'USD',
      verificationStatus: 'VERIFIED',
    })

    await app.close()
  })

  it('refuses a code sent to another address, without naming it, and leaves it unspent', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })

    const response = await accept(app, 'owner@rangoli.example', { token: invitation.code })

    expect(response.statusCode).toBe(403)
    expect(response.json().error).toMatchObject({
      code: 'INVITATION_UNUSABLE',
      message: ORGANIZER_INVITATION_SENTENCES.INVITATION_UNUSABLE,
    })
    expect(response.body).not.toContain('priya')
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    // The right account can still use it.
    expect((await accept(app, 'priya@example.com', { token: invitation.code })).statusCode).toBe(
      200,
    )

    await app.close()
  })

  it('answers one sentence for every code that is not live: expired, withdrawn, used or unknown', async () => {
    const { app, prisma, ids } = await createTestApp()
    const cases = [
      plant(prisma, ids, { email: 'priya@example.com', expiresAt: new Date(Date.now() - 1000) }),
      plant(prisma, ids, { email: 'priya@example.com', status: 'REVOKED' }),
      plant(prisma, ids, { email: 'priya@example.com', status: 'ACCEPTED' }),
      plant(prisma, ids, { email: 'priya@example.com', status: 'EXPIRED' }),
    ]
    const before = prisma._store.organization.length

    for (const { code } of cases) {
      const response = await accept(app, 'priya@example.com', { token: code })

      expect(response.statusCode).toBe(403)
      expect(response.json().error).toMatchObject({
        code: 'INVITATION_UNUSABLE',
        message: ORGANIZER_INVITATION_SENTENCES.INVITATION_UNUSABLE,
      })
    }

    const unknown = await accept(app, 'priya@example.com', {
      token: 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE',
    })

    expect(unknown.statusCode).toBe(403)
    expect(unknown.json().error.code).toBe('INVITATION_UNUSABLE')
    expect(prisma._store.organization).toHaveLength(before)
    expect(audits(prisma, 'organizer_invitation.accepted')).toHaveLength(0)

    await app.close()
  })

  it('points a team invitation code to the right page, and does not spend it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invited = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/invitations`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
      payload: { email: 'priya@example.com', role: 'STAFF' },
    })

    expect(invited.statusCode).toBe(201)

    const response = await accept(app, 'priya@example.com', {
      token: invited.json().data.delivery.invitationCode,
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error).toMatchObject({
      code: 'WRONG_INVITATION_KIND',
      message: ORGANIZER_INVITATION_SENTENCES.WRONG_INVITATION_KIND,
    })
    expect(prisma._store.invitation[0].status).toBe('PENDING')

    await app.close()
  })

  it('makes one organisation when the same code is accepted twice at once', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })
    const headers = bearer(await signIn(app, 'priya@example.com'))
    const before = prisma._store.organization.length

    const responses = await Promise.all(
      [0, 1].map(() =>
        app.inject({ method: 'POST', url: ACCEPT, headers, payload: { token: invitation.code } }),
      ),
    )
    const statuses = responses.map((response) => response.statusCode).sort()

    expect(statuses[0]).toBe(200)
    expect([403, 409]).toContain(statuses[1])
    expect(prisma._store.organization).toHaveLength(before + 1)
    expect(prisma._store.membership.filter((row) => row.organizerInvitationId)).toHaveLength(1)
    expect(audits(prisma, 'organizer_invitation.accepted')).toHaveLength(1)

    await app.close()
  })

  it('refuses a web address that is taken when it was asked for, and makes a derived one unique', async () => {
    const { app, prisma, ids } = await createTestApp()
    const taken = prisma._store.organization.find((row) => row.id === ids.organization.id).slug
    const asked = plant(prisma, ids, { email: 'priya@example.com', organizationName: 'Anything' })

    const refused = await accept(app, 'priya@example.com', { token: asked.code, slug: taken })

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.message).toBe(
      'That web address is taken by another organisation. Choose another.',
    )
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    // The same name as an existing organisation makes the same slug; the
    // server, which derived it, makes it unique.
    const existing = prisma._store.organization.find((row) => row.id === ids.organization.id)

    prisma._store.organizerInvitation[0].organizationName = existing.name

    const derived = await accept(app, 'priya@example.com', { token: asked.code })

    expect(derived.statusCode).toBe(200)
    expect(derived.json().data.organization.slug).not.toBe(taken)
    expect(derived.json().data.organization.slug.startsWith(`${taken}-`)).toBe(true)

    await app.close()
  })

  it('asks for a web address when the name makes none, and keeps the name in its own script', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, {
      email: 'priya@example.com',
      organizationName: 'સંગીત સંધ્યા',
    })

    const refused = await accept(app, 'priya@example.com', { token: invitation.code })

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error).toMatchObject({
      code: 'UNPROCESSABLE',
      message:
        'That name makes no web address, because it has no letters from A to Z or digits. Supply "slug".',
    })
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    const accepted = await accept(app, 'priya@example.com', {
      token: invitation.code,
      slug: 'sangeet-sandhya',
    })

    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data.organization).toMatchObject({
      name: 'સંગીત સંધ્યા',
      slug: 'sangeet-sandhya',
    })

    await app.close()
  })

  it('refuses a staff account, and the inviter, and spends nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    // Planted, because issuing refuses these addresses: what is tested here
    // is the second line, at acceptance.
    const moderator = plant(prisma, ids, { email: MODERATOR_EMAIL })
    const own = plant(prisma, ids, { email: ADMIN_EMAIL })

    const staff = await accept(app, MODERATOR_EMAIL, { token: moderator.code })

    expect(staff.statusCode).toBe(403)
    expect(staff.json().error).toMatchObject({
      code: 'STAFF_ACCOUNT',
      message: ORGANIZER_INVITATION_SENTENCES.STAFF_ACCOUNT_ACCEPT,
    })

    const self = await accept(app, ADMIN_EMAIL, { token: own.code })

    expect(self.statusCode).toBe(403)
    expect(self.json().error).toMatchObject({
      code: 'SELF_INVITATION',
      message: ORGANIZER_INVITATION_SENTENCES.SELF_ACCEPT,
    })

    expect(prisma._store.organizerInvitation.map((row) => row.status)).toEqual([
      'PENDING',
      'PENDING',
    ])
    expect(audits(prisma, 'organizer_invitation.accepted')).toHaveLength(0)

    await app.close()
  })

  it('refuses an account given a staff role after it signed in, and spends nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })
    const headers = bearer(await signIn(app, 'priya@example.com'))

    userByEmail(prisma, 'priya@example.com').role = 'MODERATOR'

    const response = await app.inject({
      method: 'POST',
      url: ACCEPT,
      headers,
      payload: { token: invitation.code },
    })

    // The role is read from the database on every request, not from the
    // session. With no second factor yet, the privileged-account guard answers
    // before the route does; the route's own STAFF_ACCOUNT line is the case
    // above, for an enrolled staff account.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    await app.close()
  })

  it('keeps a bearer session alive and shortens it to the privileged lifetime', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })
    const token = await signIn(app, 'priya@example.com')
    const session = prisma._store.session.find((row) => row.tokenHash === hashToken(token))
    const privilegedCeiling = () => Date.now() + 12 * 60 * 60 * 1000

    // An attendee's session outlives the twelve hours an owner's may last, so
    // the shortening below is something acceptance did.
    expect(session.expiresAt.getTime()).toBeGreaterThan(privilegedCeiling())

    const response = await app.inject({
      method: 'POST',
      url: ACCEPT,
      headers: bearer(token),
      payload: { token: invitation.code },
    })

    expect(response.statusCode).toBe(200)
    // A bearer secret is not rotated: the caller holds no cookie to receive a
    // new one in, so it is kept, and only its lifetime changes.
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(session.revokedAt ?? null).toBeNull()
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(privilegedCeiling())

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: bearer(token) })

    expect(me.statusCode).toBe(200)

    await app.close()
  })

  it('rations acceptance per account, and a refused attempt spends nothing', async () => {
    const { app, prisma, ids } = await createTestApp({
      rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, auth: { max: 2 } },
    })
    const priyas = plant(prisma, ids, { email: 'priya@example.com' })
    const doors = plant(prisma, ids, { email: 'door@rangoli.example' })
    // Two sign-ins from the one address every inject shares: the sign-in
    // budget is the same credential limit, so both are spent here, before it.
    const priya = bearer(await signIn(app, 'priya@example.com'))
    const door = bearer(await signIn(app, 'door@rangoli.example'))
    const attempt = (headers, token) =>
      app.inject({ method: 'POST', url: ACCEPT, headers, payload: { token } })

    // Two guesses use up this account's budget...
    for (const guess of ['a'.repeat(43), 'b'.repeat(43)]) {
      const refused = await attempt(priya, guess)

      expect(refused.statusCode).toBe(403)
      expect(refused.json().error.code).toBe('INVITATION_UNUSABLE')
    }

    // ...so even the right code is turned away, and is not spent.
    const limited = await attempt(priya, priyas.code)

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('RATE_LIMITED')
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect(prisma._store.organizerInvitation.find((row) => row.id === priyas.row.id).status).toBe(
      'PENDING',
    )
    expect(
      prisma._store.organization.filter((row) => row.name === priyas.row.organizationName),
    ).toHaveLength(0)

    // Another account behind the same address has a budget of its own.
    const other = await attempt(door, doors.code)

    expect(other.statusCode).toBe(200)

    await app.close()
  })

  it('needs a signed-in caller and a code', async () => {
    const { app, prisma, ids } = await createTestApp()
    const invitation = plant(prisma, ids, { email: 'priya@example.com' })

    const anonymous = await app.inject({
      method: 'POST',
      url: ACCEPT,
      payload: { token: invitation.code },
    })

    expect(anonymous.statusCode).toBe(401)

    const empty = await accept(app, 'priya@example.com', {})

    expect(empty.statusCode).toBe(400)
    expect(prisma._store.organizerInvitation[0].status).toBe('PENDING')

    await app.close()
  })
})

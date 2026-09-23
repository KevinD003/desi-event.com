/**
 * Who sees a colleague's address on the team list, against PostgreSQL.
 *
 * `team-email-visibility.test.js` proves the rule against the stub. What is
 * here is what only the real database can answer. The request goes through the
 * real app: the session is looked up by its digest, the actor's memberships are
 * read from their rows, the second-factor enrolment gate counts real factors,
 * and the step-up window is read from the session's own `mfaSatisfiedAt`.
 * Nothing about who the caller is comes from a fixture object.
 *
 * The rule, as the owner set it:
 *
 * - OWNER and ADMIN get full addresses only with a second factor confirmed
 *   inside the `MEMBER_EMAIL_VIEW` window, and none outside it.
 * - STAFF, VIEWER, and every other organisation role get no address.
 * - SCANNER gets no member list at all.
 * - A platform super-administrator who is not a member gets no address.
 * - A member of another organisation gets nothing.
 *
 * Every case without addresses searches the whole body for every address, for
 * the distinctive local parts, and for any `@` at all. The response itself is
 * safe; nothing relies on a page hiding a column.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/team-email-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the team email suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares, so a search for it means something. */
const DOMAIN = `team-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`team-email-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A user.
 *
 * @param {string} local The address's local part, distinctive on purpose.
 * @param {object} [options] Options.
 * @param {string} [options.displayName] The name they gave.
 * @param {string} [options.role] Their platform role.
 * @param {boolean} [options.secondFactor] Whether they have a confirmed second factor.
 * @returns {Promise<object>} The user row.
 */
async function user(local, { displayName, role = 'ORGANIZER', secondFactor = false } = {}) {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@${DOMAIN}`,
      displayName: displayName ?? local.split('.')[0],
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  // The enrolment gate counts confirmed factors of any kind but a recovery
  // code; it never reads the secret, so a placeholder is enough to be counted.
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
 * An organisation.
 *
 * @param {string} label Its name.
 * @returns {Promise<object>} The row.
 */
function organisation(label) {
  return prisma.organization.create({
    data: {
      id: id(`org-${label}`),
      name: `${label} ${RUN}`,
      slug: `team-email-${label.toLowerCase()}-${RUN}`,
      contactEmail: `hello.${label.toLowerCase()}.${RUN}@${DOMAIN}`,
    },
  })
}

/**
 * A membership.
 *
 * @param {object} who The user.
 * @param {object} organization The organisation.
 * @param {string} role The role.
 * @returns {Promise<object>} The row.
 */
function member(who, organization, role) {
  return prisma.membership.create({
    data: { id: id('membership'), userId: who.id, organizationId: organization.id, role },
  })
}

/**
 * A real session, and the bearer secret for it.
 *
 * Started the way sign-in starts one. With `stepUpMinutesAgo` the session's
 * last second-factor confirmation is moved back, which is the only way a
 * session comes to be outside the window.
 *
 * @param {object} who The user.
 * @param {object} [options] Options.
 * @param {number|null} [options.stepUpMinutesAgo] When the second factor was confirmed; null for never.
 * @returns {Promise<object>} Bearer headers.
 */
async function sessionFor(who, { stepUpMinutesAgo = 0 } = {}) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { session, secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'team-email-suite-pseudonymisation-key',
    mfaSatisfied: stepUpMinutesAgo !== null,
  })

  if (stepUpMinutesAgo) {
    await prisma.session.update({
      where: { id: session.id },
      data: { mfaSatisfiedAt: new Date(Date.now() - stepUpMinutesAgo * 60 * 1000) },
    })
  }

  return { authorization: `Bearer ${secret}` }
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
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' } },
  })
  await app.ready()

  const home = await organisation('Home')
  const rival = await organisation('Rival')

  const cast = {
    owner: await user('meera.owner', { secondFactor: true }),
    admin: await user('anjali.admin', { secondFactor: true }),
    manager: await user('arun.manager', { secondFactor: true }),
    eventManager: await user('devika.events', { secondFactor: true }),
    finance: await user('kiran.money', { secondFactor: true }),
    staff: await user('dinesh.door'),
    viewer: await user('vani.viewer'),
    scanner: await user('sunil.scan'),
    // Somebody who typed their address as their name.
    typed: await user('typed.name', { displayName: `typed.name.${RUN}@${DOMAIN}` }),
    rivalOwner: await user('ravi.rival', { secondFactor: true }),
    platform: await user('ops.platform', { role: 'SUPER_ADMIN', secondFactor: true }),
  }

  await member(cast.owner, home, 'OWNER')
  await member(cast.admin, home, 'ADMIN')
  await member(cast.manager, home, 'MANAGER')
  await member(cast.eventManager, home, 'EVENT_MANAGER')
  await member(cast.finance, home, 'FINANCE')
  await member(cast.staff, home, 'STAFF')
  await member(cast.viewer, home, 'VIEWER')
  await member(cast.scanner, home, 'SCANNER')
  await member(cast.typed, home, 'VIEWER')
  await member(cast.rivalOwner, rival, 'OWNER')

  const invitee = `new.colleague.${RUN}@${DOMAIN}`

  await prisma.invitation.create({
    data: {
      id: id('invitation'),
      organizationId: home.id,
      email: invitee,
      role: 'STAFF',
      tokenHash: createHash('sha256').update(`invitation-${RUN}`).digest('hex'),
      invitedById: cast.owner.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })

  const memberAddresses = [
    cast.owner,
    cast.admin,
    cast.manager,
    cast.eventManager,
    cast.finance,
    cast.staff,
    cast.viewer,
    cast.scanner,
    cast.typed,
  ].map((row) => row.email)

  world = { home, rival, cast, invitee, memberAddresses }
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * The home organisation's team list, as one session.
 *
 * @param {object} headers From {@link sessionFor}.
 * @param {object} [organization] Which organisation's list.
 * @returns {Promise<object>} The response.
 */
function list(headers, organization = world.home) {
  return app.inject({
    method: 'GET',
    url: `/v1/organizations/${organization.id}/members`,
    headers,
  })
}

/**
 * Assert that a body carries no address and nothing of one.
 *
 * @param {object} response The response.
 * @returns {void}
 */
function expectNoAddress(response) {
  for (const address of [...world.memberAddresses, world.invitee]) {
    expect(response.body, address).not.toContain(address)
    expect(response.body, address).not.toContain(address.split('@')[0])
  }

  expect(response.body).not.toContain(DOMAIN)
  expect(response.body).not.toContain('@')
  expect(response.body).not.toContain('emailMasked')
  expect(response.body).not.toMatch(/"email"/u)
}

when()('the team list, against PostgreSQL', () => {
  it.each([['owner'], ['admin']])(
    'gives the %s every address, with a second factor confirmed just now',
    async (who) => {
      const response = await list(await sessionFor(world.cast[who]))
      const { data } = response.json()

      expect(response.statusCode, response.body).toBe(200)
      expect(data.emailVisibility).toBe('FULL')
      expect(data.members.map((row) => row.email).sort()).toEqual([...world.memberAddresses].sort())
      expect(data.invitations.map((row) => row.email)).toEqual([world.invitee])
    },
  )

  it.each([['owner'], ['admin']])(
    'gives the %s no address once the confirmation is eleven minutes old',
    async (who) => {
      const response = await list(await sessionFor(world.cast[who], { stepUpMinutesAgo: 11 }))

      expect(response.statusCode, response.body).toBe(200)
      expect(response.json().data.emailVisibility).toBe('STEP_UP_REQUIRED')
      expectNoAddress(response)
    },
  )

  it('gives the owner no address from a session that never confirmed a second factor', async () => {
    const response = await list(await sessionFor(world.cast.owner, { stepUpMinutesAgo: null }))

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.emailVisibility).toBe('STEP_UP_REQUIRED')
    expectNoAddress(response)
  })

  it.each([
    ['manager', 'MANAGER'],
    ['eventManager', 'EVENT_MANAGER'],
    ['finance', 'FINANCE'],
    ['staff', 'STAFF'],
    ['viewer', 'VIEWER'],
  ])('gives the %s no address at all, stepped up or not', async (who) => {
    const response = await list(await sessionFor(world.cast[who]))
    const { data } = response.json()

    expect(response.statusCode, response.body).toBe(200)
    expect(data.emailVisibility).toBe('HIDDEN')
    expectNoAddress(response)
    // Still the list: the people and their roles.
    expect(data.members).toHaveLength(world.memberAddresses.length)
    expect(data.invitations).toHaveLength(1)
  })

  it('replaces the address somebody typed as their name, where addresses are hidden', async () => {
    const response = await list(await sessionFor(world.cast.viewer))
    const typed = response.json().data.members.find((row) => row.userId === world.cast.typed.id)

    expect(typed.displayName).toBe('Hidden email')
    expectNoAddress(response)
  })

  it('gives a SCANNER no member list at all', async () => {
    const response = await list(await sessionFor(world.cast.scanner))

    expect(response.statusCode).toBe(403)
    expectNoAddress(response)
  })

  it('gives a platform super-administrator who is not a member no address, even stepped up', async () => {
    const response = await list(await sessionFor(world.cast.platform))

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.emailVisibility).toBe('HIDDEN')
    expectNoAddress(response)
  })

  it("gives another organisation's owner nothing, however recently they confirmed", async () => {
    const response = await list(await sessionFor(world.cast.rivalOwner))

    expect(response.statusCode).toBe(403)
    expectNoAddress(response)
  })

  it("gives the home owner no address from another organisation's list either", async () => {
    // Authority is per organisation. Being an owner, stepped up, somewhere
    // else is not being one here.
    const response = await list(await sessionFor(world.cast.owner), world.rival)

    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain('@')
  })
})

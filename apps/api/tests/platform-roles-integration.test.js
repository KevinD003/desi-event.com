/**
 * The last of something, against PostgreSQL.
 *
 * Rules only the real database can prove, because each is about two
 * transactions at once under READ COMMITTED — which the stub, whose
 * transactions run one after another, cannot reproduce:
 *
 *   - two super administrators demoting each other at the same moment leave at
 *     least one super administrator;
 *   - two owners demoting each other at the same moment leave at least one
 *     owner. Before the owner rows were locked, both counted two owners and
 *     both proceeded, leaving none;
 *   - two owners removing each other at the same moment leave one, because
 *     the second removal meets the last-owner rule once it holds the locks;
 *   - an owner demoted while their hand-on of ownership waited hands nothing
 *     on, because the swap is conditional on the caller still being an owner.
 *
 * Plus the direct membership grant and the session revocation that goes with
 * every role change, on real rows.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/platform-roles-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { startSession } from '../src/lib/sessions.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'
import { holdRow, untilWaiting as untilWaitingOn } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the platform roles suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `roles-${RUN}.example`

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256')
    .update(`platform-roles-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A user with a confirmed second factor, as every privileged account needs.
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
      slug: `roles-${label.toLowerCase()}-${RUN}`,
      contactEmail: `hello.${label.toLowerCase()}.${RUN}@${DOMAIN}`,
    },
  })
}

/**
 * A real session with a second factor confirmed just now, and its headers.
 *
 * @param {object} who The user.
 * @returns {Promise<{headers: object, session: object}>} Bearer headers and the row.
 */
async function sessionFor(who) {
  const fresh = await prisma.user.findUnique({ where: { id: who.id } })
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { session, secret } = await startSession(prisma, {
    actor: { id: who.id, role: fresh.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'platform-roles-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { headers: { authorization: `Bearer ${secret}` }, session }
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

describeWhen('platform roles and the last of something, against PostgreSQL', () => {
  it('leaves a super administrator when two demote each other at the same moment', async () => {
    const first = await user('first.admin', 'SUPER_ADMIN')
    const second = await user('second.admin', 'SUPER_ADMIN')
    const [a, b] = await Promise.all([sessionFor(first), sessionFor(second)])

    const results = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/platform/users/${second.id}/role`,
        headers: a.headers,
        payload: { role: 'MODERATOR', reason: 'Race one' },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/platform/users/${first.id}/role`,
        headers: b.headers,
        payload: { role: 'MODERATOR', reason: 'Race two' },
      }),
    ])

    const statuses = results.map((response) => response.statusCode)

    // One wins. The loser either waited on the locks and then found it was no
    // longer a super administrator (403), or arrived after its session had
    // been ended by the winner's change (401). Never both demoted.
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    for (const status of statuses) expect([200, 401, 403]).toContain(status)

    const roles = await prisma.user.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { role: true },
    })

    expect(roles.filter((row) => row.role === 'SUPER_ADMIN')).toHaveLength(1)
  })

  it('ends every session of the account whose role changed, in the same transaction', async () => {
    const admin = await user('granting.admin', 'SUPER_ADMIN')
    const target = await user('promoted.person')
    const { headers } = await sessionFor(admin)
    const one = await sessionFor(target)
    const two = await sessionFor(target)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/users/${target.id}/role`,
      headers,
      payload: { role: 'FINANCE_ADMIN', reason: 'Joined finance' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.sessionsRevoked).toBe(2)

    const sessions = await prisma.session.findMany({
      where: { id: { in: [one.session.id, two.session.id] } },
    })

    expect(sessions.every((row) => row.revokedReason === 'role_changed')).toBe(true)

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'platform.role_changed', entityId: target.id },
    })

    expect(audit.metadata).toMatchObject({
      from: 'ATTENDEE',
      to: 'FINANCE_ADMIN',
      reason: 'Joined finance',
      sessionsRevoked: 2,
    })
  })

  it('grants an organisation with no owner an OWNER, and then refuses to leave it with none', async () => {
    const admin = await user('rescuing.admin', 'SUPER_ADMIN')
    const rescuer = await user('new.owner')
    const orphan = await organisation('Orphan')
    const { headers } = await sessionFor(admin)

    const granted = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${orphan.id}/members`,
      headers,
      payload: { userId: rescuer.id, role: 'OWNER', reason: 'The only owner left the company' },
    })

    expect(granted.statusCode).toBe(200)
    expect(granted.json().data).toMatchObject({ role: 'OWNER', created: true })

    const demoted = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${orphan.id}/members`,
      headers,
      payload: { userId: rescuer.id, role: 'ADMIN', reason: 'Changed my mind' },
    })

    expect(demoted.statusCode).toBe(422)

    const owners = await prisma.membership.count({
      where: { organizationId: orphan.id, role: 'OWNER' },
    })

    expect(owners).toBe(1)
  })

  it('leaves an owner when two owners demote each other at the same moment', async () => {
    const organization = await organisation('TwoOwners')
    const one = await user('owner.one')
    const two = await user('owner.two')
    const oneMembership = await prisma.membership.create({
      data: {
        id: id('membership'),
        userId: one.id,
        organizationId: organization.id,
        role: 'OWNER',
      },
    })
    const twoMembership = await prisma.membership.create({
      data: {
        id: id('membership'),
        userId: two.id,
        organizationId: organization.id,
        role: 'OWNER',
      },
    })
    const [a, b] = await Promise.all([sessionFor(one), sessionFor(two)])

    const results = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/v1/organizations/${organization.id}/members/${twoMembership.id}`,
        headers: a.headers,
        payload: { role: 'ADMIN' },
      }),
      app.inject({
        method: 'PATCH',
        url: `/v1/organizations/${organization.id}/members/${oneMembership.id}`,
        headers: b.headers,
        payload: { role: 'ADMIN' },
      }),
    ])

    const statuses = results.map((response) => response.statusCode).sort()

    // The READ COMMITTED race the owner lock closes: without it both counted
    // two owners and both proceeded.
    expect(statuses).toEqual([200, 422])

    const owners = await prisma.membership.count({
      where: { organizationId: organization.id, role: 'OWNER' },
    })

    expect(owners).toBe(1)
  })
})

/**
 * A membership, created directly.
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
 * Hold one membership row locked until told to let go. See `helpers/row-locks.js`.
 *
 * @param {string} membershipId The row to hold.
 * @returns {Promise<{release: function(): void, done: Promise<void>, pid: number}>} Resolves once held.
 */
function holdingMembership(membershipId) {
  return holdRow(prisma, 'Membership', membershipId)
}

/**
 * Wait until `count` backends are waiting on the given ones. See `helpers/row-locks.js`.
 *
 * @param {function(): number[]} pids The blocking backends, re-read each poll.
 * @param {number} count How many waiters to wait for.
 * @param {string} what What is being waited for, for the failure message.
 * @returns {Promise<number[]>} The waiters.
 */
function untilWaiting(pids, count, what) {
  return untilWaitingOn(prisma, pids, count, what)
}

/**
 * Two owners, and the membership that sorts first: the owner row every
 * owner-changing request locks first, so holding it queues them all.
 *
 * @param {string} label Distinguishes the organisation.
 * @returns {Promise<object>} The organisation, both owners' memberships and sessions, and the first row.
 */
async function twoOwners(label) {
  const organization = await organisation(label)
  const one = await user(`${label.toLowerCase()}.one`)
  const two = await user(`${label.toLowerCase()}.two`)
  const oneMembership = await member(one, organization, 'OWNER')
  const twoMembership = await member(two, organization, 'OWNER')
  const [oneSession, twoSession] = await Promise.all([sessionFor(one), sessionFor(two)])
  const first = [oneMembership, twoMembership].sort((a, b) => (a.id < b.id ? -1 : 1))[0]

  return { organization, oneMembership, twoMembership, oneSession, twoSession, first }
}

/**
 * Start `first`, wait until it queues behind a held owner row, then start
 * `second` and wait until it queues too, then let the row go.
 *
 * Both requests have authenticated and read their target before either
 * reaches a lock, so the second decides from what the first committed.
 *
 * @param {object} held The membership row to hold.
 * @param {function(): Promise<object>} first The request that goes first.
 * @param {function(): Promise<object>} second The request that goes second.
 * @returns {Promise<object[]>} Both responses, in that order.
 */
async function oneAfterTheOther(held, first, second) {
  const holder = await holdingMembership(held.id)
  const firstResponse = first()
  const [firstPid] = await untilWaiting(() => [holder.pid], 1, 'the first request')
  const secondResponse = second()

  await untilWaiting(() => [holder.pid, firstPid], 2, 'the second request')
  holder.release()
  await holder.done

  return [await firstResponse, await secondResponse]
}

describeWhen('two owners at once, against PostgreSQL', () => {
  it('leaves an owner when two owners remove each other at the same moment', async () => {
    const world = await twoOwners('RemoveEachOther')

    const [first, second] = await oneAfterTheOther(
      world.first,
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/organizations/${world.organization.id}/members/${world.twoMembership.id}/remove`,
          headers: world.oneSession.headers,
          payload: { reason: 'Racing the other owner' },
        }),
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/organizations/${world.organization.id}/members/${world.oneMembership.id}/remove`,
          headers: world.twoSession.headers,
          payload: { reason: 'Racing the other owner' },
        }),
    )

    expect(first.statusCode).toBe(200)
    // Both were authorised as owners before either locked anything. The second
    // finds, once it holds the owner rows, that its target is now the only
    // owner. Without the last-owner rule it removed them too, leaving none.
    expect(second.statusCode).toBe(422)
    expect(second.json().error).toMatchObject({
      code: 'UNPROCESSABLE',
      message: 'This is the only owner of the organisation. Make somebody else an owner first.',
    })

    const left = await prisma.membership.findMany({
      where: { organizationId: world.organization.id },
    })

    expect(left.map((row) => [row.id, row.role])).toEqual([[world.oneMembership.id, 'OWNER']])
    expect(
      await prisma.auditLog.count({
        where: { action: 'team.member_removed', entityId: world.oneMembership.id },
      }),
    ).toBe(0)
  })

  it('refuses to hand ownership on for an owner demoted while the hand-on waited', async () => {
    const world = await twoOwners('DemotedWhileWaiting')
    const heir = await user('demotedwhilewaiting.heir')
    // An heir who posts events, as ownership now requires (422
    // HEIR_MUST_POST_EVENTS otherwise), so what is tried is the race.
    const heirMembership = await member(heir, world.organization, 'EVENT_MANAGER')

    const [demoted, handedOn] = await oneAfterTheOther(
      world.first,
      // The second owner demotes the first...
      () =>
        app.inject({
          method: 'PATCH',
          url: `/v1/organizations/${world.organization.id}/members/${world.oneMembership.id}`,
          headers: world.twoSession.headers,
          payload: { role: 'MANAGER' },
        }),
      // ...while the first, still an owner when it was authorised, hands on.
      () =>
        app.inject({
          method: 'POST',
          url: `/v1/organizations/${world.organization.id}/ownership`,
          headers: world.oneSession.headers,
          payload: { toMemberId: heirMembership.id },
        }),
    )

    expect(demoted.statusCode).toBe(200)
    // The swap is conditional on the caller still being an owner. Without the
    // condition the heir became an owner and the demoted caller was raised
    // from manager to administrator.
    expect(handedOn.statusCode).toBe(409)
    expect(handedOn.json().error).toMatchObject({
      code: 'CONFLICT',
      message: 'You are no longer an owner of this organisation. Reload and try again.',
    })

    const roles = Object.fromEntries(
      (await prisma.membership.findMany({ where: { organizationId: world.organization.id } })).map(
        (row) => [row.id, row.role],
      ),
    )

    expect(roles).toEqual({
      [world.oneMembership.id]: 'MANAGER',
      [world.twoMembership.id]: 'OWNER',
      [heirMembership.id]: 'EVENT_MANAGER',
    })
    expect(
      await prisma.auditLog.count({
        where: { action: 'team.ownership_transferred', entityId: heirMembership.id },
      }),
    ).toBe(0)
  })
})

describeWhen('a role read before the lock is never the one decided on, against PostgreSQL', () => {
  /**
   * An owner, a manager about to become the owner, and an administrator.
   *
   * @param {string} label Distinguishes the organisation.
   * @returns {Promise<object>} The cast, their memberships and sessions.
   */
  async function cast(label) {
    const organization = await organisation(label)
    const owner = await user(`${label.toLowerCase()}.owner`)
    const heir = await user(`${label.toLowerCase()}.heir`)
    const admin = await user(`${label.toLowerCase()}.admin`)
    const ownerMembership = await member(owner, organization, 'OWNER')
    const heirMembership = await member(heir, organization, 'MANAGER')

    await member(admin, organization, 'ADMIN')

    const [ownerSession, adminSession] = await Promise.all([sessionFor(owner), sessionFor(admin)])

    return { organization, ownerMembership, heirMembership, ownerSession, adminSession }
  }

  /**
   * The organisation's owners and roles, after the race.
   *
   * @param {object} organization The organisation.
   * @returns {Promise<{owners: number, roles: string[]}>} What is left.
   */
  async function after(organization) {
    const rows = await prisma.membership.findMany({
      where: { organizationId: organization.id },
      select: { role: true },
    })

    return {
      owners: rows.filter((row) => row.role === 'OWNER').length,
      roles: rows.map((row) => row.role).sort(),
    }
  }

  /**
   * Hand ownership to the heir while `other` acts on the heir, the transfer
   * reaching its locks first; `other` reads the heir's role (MANAGER) before
   * the transfer commits.
   *
   * @param {object} world From {@link cast}.
   * @param {function(): Promise<object>} other The racing request.
   * @returns {Promise<{transfer: object, raced: object}>} Both responses.
   */
  async function transferFirst(world, other) {
    const holder = await holdingMembership(world.heirMembership.id)
    const transfer = app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/ownership`,
      headers: world.ownerSession.headers,
      payload: { toMemberId: world.heirMembership.id },
    })

    // The transfer holds the owner rows and waits on the heir's.
    const [transferPid] = await untilWaiting(() => [holder.pid], 1, 'the transfer')
    const raced = other()

    // The racing request has read MANAGER and is now waiting too.
    await untilWaiting(() => [holder.pid, transferPid], 2, 'the racing request')
    holder.release()
    await holder.done

    return { transfer: await transfer, raced: await raced }
  }

  it('refuses to remove a member who became the only owner while the removal waited', async () => {
    const world = await cast('RemoveRace')

    const { transfer, raced } = await transferFirst(world, () =>
      app.inject({
        method: 'POST',
        url: `/v1/organizations/${world.organization.id}/members/${world.heirMembership.id}/remove`,
        headers: world.adminSession.headers,
        payload: { reason: 'Racing the transfer' },
      }),
    )

    expect(transfer.statusCode).toBe(200)
    // Decided from the heir as locked: an OWNER, which an ADMIN cannot act on.
    // Decided from the read before the lock, the removal deleted the only owner.
    expect(raced.statusCode).toBe(403)
    expect(await after(world.organization)).toEqual({
      owners: 1,
      roles: ['ADMIN', 'ADMIN', 'OWNER'],
    })
  })

  it('refuses to demote a member who became the only owner while the change waited', async () => {
    const world = await cast('DemoteRace')

    const { transfer, raced } = await transferFirst(world, () =>
      app.inject({
        method: 'PATCH',
        url: `/v1/organizations/${world.organization.id}/members/${world.heirMembership.id}`,
        headers: world.adminSession.headers,
        payload: { role: 'STAFF' },
      }),
    )

    expect(transfer.statusCode).toBe(200)
    expect(raced.statusCode).toBe(403)
    expect(await after(world.organization)).toEqual({
      owners: 1,
      roles: ['ADMIN', 'ADMIN', 'OWNER'],
    })

    const audits = await prisma.auditLog.count({
      where: { action: 'team.role_changed', entityId: world.heirMembership.id },
    })

    expect(audits).toBe(0)
  })

  it('answers 404 and changes nothing when the heir is removed while the transfer waited', async () => {
    const world = await cast('HeirGone')
    const holder = await holdingMembership(world.heirMembership.id)

    // This time the removal reaches its locks first.
    const removal = app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/members/${world.heirMembership.id}/remove`,
      headers: world.adminSession.headers,
      payload: { reason: 'Leaving before the transfer lands' },
    })
    const [removalPid] = await untilWaiting(() => [holder.pid], 1, 'the removal')
    const transfer = app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/ownership`,
      headers: world.ownerSession.headers,
      payload: { toMemberId: world.heirMembership.id },
    })

    await untilWaiting(() => [holder.pid, removalPid], 2, 'the transfer')
    holder.release()
    await holder.done

    const [removed, transferred] = await Promise.all([removal, transfer])

    expect(removed.statusCode).toBe(200)
    // Not a 500 from a write to a row that is gone, and the owner is still one.
    expect(transferred.statusCode).toBe(404)
    expect(transferred.json().error.code).toBe('NOT_FOUND')
    expect(await after(world.organization)).toEqual({ owners: 1, roles: ['ADMIN', 'OWNER'] })

    const owner = await prisma.membership.findUnique({ where: { id: world.ownerMembership.id } })

    expect(owner.role).toBe('OWNER')
  })

  it('answers two simultaneous grants to the same newcomer with one membership and a 409', async () => {
    const [first, second] = await Promise.all([
      user('grant.race.first', 'SUPER_ADMIN'),
      user('grant.race.second', 'SUPER_ADMIN'),
    ])
    const [a, b] = await Promise.all([sessionFor(first), sessionFor(second)])

    // Several rounds, because which of the two ways the loser loses — the
    // database's unique index, or finding the winner's row once it may look —
    // is up to the scheduler. Neither is ever a server error.
    for (let round = 0; round < 3; round += 1) {
      // No owners, so there are no owner rows to queue on and both grants
      // really do try to create the membership at once.
      const organization = await organisation(`GrantRace${round}`)
      const newcomer = await user(`grant.race.newcomer.${round}`)

      const results = await Promise.all(
        [a, b].map((session, index) =>
          app.inject({
            method: 'POST',
            url: `/v1/platform/organizations/${organization.id}/members`,
            headers: session.headers,
            payload: { userId: newcomer.id, role: 'ADMIN', reason: `Race ${round}.${index}` },
          }),
        ),
      )

      const statuses = results.map((response) => response.statusCode).sort()

      expect(statuses).toEqual([200, 409])
      expect(results.find((response) => response.statusCode === 409).json().error.code).toBe(
        'CONFLICT',
      )
      expect(
        await prisma.membership.count({
          where: { organizationId: organization.id, userId: newcomer.id },
        }),
      ).toBe(1)
    }
  })
})

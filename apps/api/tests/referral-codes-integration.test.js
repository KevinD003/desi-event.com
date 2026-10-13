/**
 * Referral codes against a real database (SPEC3 §14.3, as SPEC3-XI §3 §14.3
 * amends it): the last use under concurrency, an edit racing a checkout, a
 * declined card giving its use back, the foreign key and the CHECK behind the
 * lock, a used-up code's return racing a checkout (R8), and settlement taking
 * its tiers before its order (SPEC3-XI §2.3.3).
 *
 * The stub serialises every write, so none of this can be proven there. Each
 * race is arranged with a row held by the suite (`row-locks.js`): the racing
 * requests queue behind it in the order they are started, and are let go
 * together. A race whose lock is removed fails here — see the stage report for
 * the mutation runs.
 *
 * SPEC3's case 3 ("a refund keeps the use") changed rule and moved to B1-V's
 * `referral-returns-integration.test.js` (R1/R6), and case 4's deletion half
 * with it (R3); this file keeps case 4's declined card.
 *
 * Collected by the API suite and run with `REQUIRE_DATABASE=1` in CI, where an
 * unreachable database is a failure rather than a skip.
 *
 * @module @desi-event/api/tests/referral-codes-integration
 */

import { createHash } from 'node:crypto'

import { createLogger } from '@desi-event/logger'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { buildApp } from '../src/app.js'
import { CAPTURE_OUTCOMES, settleCheckout } from '../src/lib/checkout.js'
import { OUT_OF_TIME_RETRY_AFTER_SECONDS, PAYMENT_TERMS_SENTENCES } from '../src/lib/errors.js'
import { settleReferralUsesIfEnded } from '../src/lib/referral-uses.js'
import { startSession } from '../src/lib/sessions.js'
import { LOCK_WAIT_MS } from '../src/lib/transaction-budget.js'
import { testEnv } from './helpers/app.js'
import { connectTestDatabase } from './helpers/database.js'
import { createFeeEvent, pendingZeroTotalOrder, referralCodeFixture } from './helpers/fee-orders.js'
import { holdRow, waitingOn } from './helpers/row-locks.js'

/**
 * A lever on `evaluateReferral`, for the one case that needs a path which
 * forgot the code's lock: with `codeId` set, that code is answered as
 * applicable without being locked or read again, so the order's use goes past
 * the limit and only the CHECK stands in the way.
 */
const forced = vi.hoisted(() => ({ codeId: null }))

vi.mock('../src/lib/referral-codes.js', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    async evaluateReferral(db, params) {
      if (forced.codeId) {
        const row = await db.referralCode.findUnique({ where: { id: forced.codeId } })

        return { row, applicable: true, reason: null }
      }

      return actual.evaluateReferral(db, params)
    },
  }
})

const { prisma, reachable, when } = await connectTestDatabase('the referral codes suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** A card total the in-memory provider declines: a tier priced at it, waived. */
const DECLINE_CENTS = 7_313

/** Long enough for the pass deriver, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

/** Generous budgets: these races are about locks, not rate limits. */
const RATE_LIMIT = Object.freeze({
  global: { max: 10_000, timeWindow: '1 minute' },
  quote: { max: 10_000, timeWindow: '1 minute' },
  referralAdmin: { max: 10_000, timeWindow: '1 minute' },
  referralAttempt: { actorMax: 10_000, addressMax: 10_000, sharedMax: 10_000 },
})

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
    .update(`referral-codes-${RUN}-${kind}-${sequence}`)
    .digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A tag unique to this run and this call, for slugs and references.
 *
 * @param {string} label What it is for.
 * @returns {string} Lower-case letters and digits.
 */
function tag(label) {
  sequence += 1

  return `${label}${RUN}${sequence.toString(36)}`.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Wait until `count` backends queue behind a held row, directly or behind one
 * another. PostgreSQL queues the second waiter for a row on the first (the
 * tuple lock), not on the holder, so the queue is followed link by link.
 *
 * @param {number} holderPid The holder's backend.
 * @param {number} count How many waiters to wait for.
 * @param {string} what What is being waited for, for the failure message.
 * @returns {Promise<number[]>} The waiters, in the order they were seen.
 * @throws {Error} After ten seconds without them.
 */
async function untilQueued(holderPid, count, what) {
  const deadline = Date.now() + 10_000
  const queue = []

  while (Date.now() < deadline) {
    const waiting = await waitingOn(prisma, [holderPid, ...queue])

    for (const pid of waiting) if (!queue.includes(pid)) queue.push(pid)

    if (queue.length >= count) return queue

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }

  throw new Error(`Never saw ${what} queued behind the held row within ten seconds.`)
}

let app
let admin

/**
 * A user with a session, as sign-in leaves one.
 *
 * @param {string} label Distinguishes it.
 * @param {string} [role] The platform role.
 * @returns {Promise<{user: object, headers: object}>} The account and its request headers.
 */
async function account(label, role = 'ATTENDEE') {
  const user = await prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${RUN}@referral-race.example`,
      displayName: `${label} ${RUN}`,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (role !== 'ATTENDEE') {
    await prisma.mfaFactor.create({
      data: {
        id: id('factor'),
        userId: user.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  const { secret } = await startSession(prisma, {
    actor: { id: user.id, role: user.role, memberships: [] },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'referral-codes-suite-pseudonymisation-key',
    mfaSatisfied: role !== 'ATTENDEE',
  })

  return { user, headers: { authorization: `Bearer ${secret}` } }
}

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    // Payment ids carry the run: `Payment.provider + providerRef` is unique,
    // and other suites on this database mint ids from the same counter.
    providers: createInMemoryProviderRegistry({
      payments: { idPrefix: `pirefc${RUN}`, declineAmountCents: DECLINE_CENTS },
    }),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: RATE_LIMIT,
  })
  await app.ready()

  admin = await account('admin', 'ADMIN')
})

afterAll(async () => {
  await app?.close()
  await prisma.$disconnect()
})

/**
 * Place an order through `orders.create`.
 *
 * @param {object} buyer From {@link account}.
 * @param {object} world From `createFeeEvent`.
 * @param {object} [options] Options.
 * @param {string} [options.tierId] The tier; the balcony unless told.
 * @param {number} [options.quantity] How many.
 * @param {object} [options.body] Extra order fields.
 * @param {object} [options.on] The app; the suite's unless told.
 * @returns {Promise<object>} The inject result.
 */
function order(
  buyer,
  world,
  { tierId = world.tiers.balcony.id, quantity = 1, body = {}, on = app } = {},
) {
  sequence += 1

  return on.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: buyer.headers,
    payload: {
      eventId: world.event.id,
      buyerEmail: buyer.user.email,
      buyerName: buyer.user.displayName,
      items: [{ ticketTypeId: tierId, quantity }],
      ...body,
    },
  })
}

/**
 * A code's use count as committed.
 *
 * @param {string} codeId The code.
 * @returns {Promise<number>} `useCount`.
 */
async function usesOf(codeId) {
  const row = await prisma.referralCode.findUnique({ where: { id: codeId } })

  return row.useCount
}

/**
 * Everything a refused checkout could have left behind for a buyer.
 *
 * @param {string} userId The buyer.
 * @returns {Promise<{orders: number, holds: number}>} Counts.
 */
async function leftBehind(userId) {
  const [orders, holds] = await Promise.all([
    prisma.order.count({ where: { userId } }),
    prisma.ticketHold.count({ where: { userId } }),
  ])

  return { orders, holds }
}

/**
 * Whether an outcome is PostgreSQL's deadlock refusal, however it was carried.
 *
 * @param {PromiseSettledResult<unknown>|object} outcome A settled promise or a response.
 * @returns {boolean} True for a 40P01.
 */
function isDeadlock(outcome) {
  const text =
    outcome?.status === 'rejected'
      ? `${outcome.reason?.code ?? ''} ${outcome.reason?.message ?? ''}`
      : String(outcome?.body ?? '')

  return /40P01|deadlock|P2034/iu.test(text)
}

when()('a referral code’s last use', () => {
  it('goes to exactly one of two buyers who reach it at once; the other is refused and nothing is written for them', async () => {
    // Two events, so the buyers share no tier and no night: the code's row is
    // the only thing they both lock.
    const first = await createFeeEvent(prisma, { tag: tag('lastusea') })
    const second = await createFeeEvent(prisma, { tag: tag('lastuseb') })
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 1,
    })
    const buyers = [await account('lastusea'), await account('lastuseb')]

    const held = await holdRow(prisma, 'ReferralCode', row.id)
    const racing = [
      order(buyers[0], first, { body: { referralCode } }),
      order(buyers[1], second, { body: { referralCode } }),
    ]

    await untilQueued(held.pid, 2, 'both checkouts')
    held.release()
    await held.done

    const responses = await Promise.all(racing)
    const statuses = responses.map((response) => response.statusCode)

    expect([...statuses].sort()).toEqual([201, 409])

    const placed = responses.find((response) => response.statusCode === 201)
    const refused = responses.find((response) => response.statusCode === 409)
    const refusedBuyer = buyers[responses.indexOf(refused)]

    expect(refused.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')

    const stored = await prisma.order.findUnique({ where: { id: placed.json().data.id } })

    expect(stored).toMatchObject({ status: 'PAID', referralCodeId: row.id, feesCents: 0 })
    expect(stored.feeWaivedCents).toBe(stored.feeGrossCents)
    expect(stored.feeWaivedCents).toBeGreaterThan(0)
    expect(await usesOf(row.id)).toBe(1)
    expect(await prisma.order.count({ where: { referralCodeId: row.id } })).toBe(1)
    expect(await leftBehind(refusedBuyer.user.id)).toEqual({ orders: 0, holds: 0 })
  })

  it('gives a code with two uses left to exactly two of six buyers racing on six events', async () => {
    const worlds = []
    const buyers = []

    for (let index = 0; index < 6; index += 1) {
      worlds.push(await createFeeEvent(prisma, { tag: tag(`six${index}`) }))
      buyers.push(await account(`six${index}`))
    }

    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 2,
    })

    const responses = await Promise.all(
      buyers.map((buyer, index) => order(buyer, worlds[index], { body: { referralCode } })),
    )

    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(2)
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(4)

    for (const response of responses.filter((each) => each.statusCode === 409)) {
      expect(response.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')
    }

    expect(await usesOf(row.id)).toBe(2)
    expect(await prisma.order.count({ where: { referralCodeId: row.id } })).toBe(2)
  })
})

when()('an edit of a code racing a checkout that uses it', () => {
  /**
   * Lower a code's limit to 1 through `referralCodes.update`.
   *
   * @param {object} row The code as read.
   * @returns {Promise<object>} The inject result.
   */
  function lowerToOne(row) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/platform/referral-codes/${row.id}`,
      headers: admin.headers,
      payload: { maxUses: 1, expectedUpdatedAt: row.updatedAt.toISOString() },
    })
  }

  it('takes turns with the checkout first: the use is taken and the lower limit refused, never the CHECK', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('editafter') })
    const buyer = await account('editafter')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 5,
      useCount: 1,
    })

    const held = await holdRow(prisma, 'ReferralCode', row.id)
    const placing = order(buyer, world, { body: { referralCode } })

    await untilQueued(held.pid, 1, 'the checkout')

    const editing = lowerToOne(row)

    await untilQueued(held.pid, 2, 'the checkout and the edit')
    held.release()
    await held.done

    const [placed, edited] = await Promise.all([placing, editing])

    expect(placed.statusCode, placed.body).toBe(201)
    expect(edited.statusCode, edited.body).toBe(422)
    expect(edited.json().error.code).toBe('REFERRAL_LIMIT_BELOW_USES')

    const after = await prisma.referralCode.findUnique({ where: { id: row.id } })

    expect(after).toMatchObject({ useCount: 2, maxUses: 5 })
  })

  it('takes turns with the edit first: the limit is lowered and the checkout refused, never the CHECK', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('editbefore') })
    const buyer = await account('editbefore')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 5,
      useCount: 1,
    })

    const held = await holdRow(prisma, 'ReferralCode', row.id)
    const editing = lowerToOne(row)

    await untilQueued(held.pid, 1, 'the edit')

    const placing = order(buyer, world, { body: { referralCode } })

    await untilQueued(held.pid, 2, 'the edit and the checkout')
    held.release()
    await held.done

    const [edited, placed] = await Promise.all([editing, placing])

    expect(edited.statusCode, edited.body).toBe(200)
    expect(placed.statusCode, placed.body).toBe(409)
    expect(placed.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')

    const after = await prisma.referralCode.findUnique({ where: { id: row.id } })

    expect(after).toMatchObject({ useCount: 1, maxUses: 1 })
    expect(await leftBehind(buyer.user.id)).toEqual({ orders: 0, holds: 0 })
  })
})

when()('a declined card on a waived order', () => {
  it('gives the use back once, marked PAYMENT_FAILED, with one audit row', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('declined') })
    const tier = await prisma.ticketType.create({
      data: {
        id: id('tier'),
        eventId: world.event.id,
        eventSessionId: world.session.id,
        name: `Declined ${RUN}`,
        priceCents: DECLINE_CENTS,
        currency: 'USD',
        quantityTotal: 50,
        maxPerOrder: 10,
        status: 'ON_SALE',
      },
    })
    const buyer = await account('declined')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 10,
      useCount: 2,
    })

    const response = await order(buyer, world, { tierId: tier.id, body: { referralCode } })

    expect(response.statusCode, response.body).toBe(402)
    expect(response.json().error.code).toBe('PAYMENT_DECLINED')

    const declined = await prisma.order.findFirst({ where: { userId: buyer.user.id } })

    expect(declined).toMatchObject({
      status: 'CANCELLED',
      referralCodeId: row.id,
      referralUseReturnCause: 'PAYMENT_FAILED',
      totalCents: DECLINE_CENTS,
    })
    expect(declined.referralUseReturnedAt).toBeInstanceOf(Date)
    // Taken once when the order was placed, given back once: where it began.
    expect(await usesOf(row.id)).toBe(2)
    expect(
      await prisma.auditLog.count({
        where: { action: 'referral_code.use_returned', entityId: row.id },
      }),
    ).toBe(1)

    // A second return finds the marker set and gives nothing back.
    const again = await prisma.$transaction((tx) =>
      settleReferralUsesIfEnded(tx, {
        entries: [{ orderId: declined.id, cause: 'PAYMENT_FAILED' }],
      }),
    )

    expect(again).toEqual([])
    expect(await usesOf(row.id)).toBe(2)
  })
})

when()('the database behind the code', () => {
  it('refuses to delete a code an order names', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('fk') })
    const buyer = await account('fk')
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
    })

    const placed = await order(buyer, world, { body: { referralCode } })

    expect(placed.statusCode, placed.body).toBe(201)

    await expect(prisma.referralCode.delete({ where: { id: row.id } })).rejects.toThrow(
      /foreign key|Foreign key|P2003/u,
    )
    expect(await prisma.referralCode.findUnique({ where: { id: row.id } })).not.toBeNull()
  })

  it('answers a use past the limit with 409, never 500, and logs neither the code nor the refused row', async () => {
    const lines = []
    const capture = {
      write(chunk) {
        lines.push(String(chunk))
      },
    }
    const logged = await buildApp({
      prisma,
      providers: createInMemoryProviderRegistry({ payments: { idPrefix: `pireff${RUN}` } }),
      env: testEnv(),
      logger: createLogger({ name: 'api', level: 'debug', destination: capture }),
      docs: false,
      processEnv: {},
      rateLimit: RATE_LIMIT,
    })

    await logged.ready()

    try {
      const world = await createFeeEvent(prisma, { tag: tag('forced') })
      const buyer = await account('forced')
      const { row, referralCode } = await referralCodeFixture(prisma, {
        createdById: admin.user.id,
        maxUses: 1,
        useCount: 1,
      })

      // A path that forgot the lock: the code is taken as applicable, so the
      // order's use is past its limit and only the CHECK refuses it.
      forced.codeId = row.id

      let response

      try {
        response = await order(buyer, world, { body: { referralCode }, on: logged })
      } finally {
        forced.codeId = null
      }

      expect(response.statusCode, response.body).toBe(409)
      expect(response.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')
      expect(response.body).not.toMatch(/referral_code_use_within_limit|SQL|23514|Failing row/u)
      expect(await usesOf(row.id)).toBe(1)
      expect(await leftBehind(buyer.user.id)).toEqual({ orders: 0, holds: 0 })

      const text = lines.join('')

      expect(text).toMatch(/request rejected/u)
      expect(text).not.toContain(referralCode)
      expect(text).not.toMatch(/Failing row/u)
    } finally {
      await logged.close()
    }
  })
})

when()('a used-up code’s return racing a checkout that names it (R8)', () => {
  /**
   * A code at its limit, whose one use belongs to a booking that ended
   * without being used and has not given it back yet.
   *
   * @param {string} label Distinguishes the run.
   * @returns {Promise<object>} `{ row, referralCode, ended }`.
   */
  async function usedUpByAnEndedBooking(label) {
    const world = await createFeeEvent(prisma, { tag: tag(`${label}w`) })
    const { row, referralCode } = await referralCodeFixture(prisma, {
      createdById: admin.user.id,
      maxUses: 1,
    })
    const owner = await account(`${label}o`)
    const ended = await prisma.$transaction((tx) =>
      pendingZeroTotalOrder(tx, {
        world,
        referralCode: row,
        tag: tag(label),
        userId: owner.user.id,
        lines: [{ ticketTypeId: world.tiers.balcony.id, quantity: 1, unitPriceCents: 2_000 }],
      }),
    )

    await prisma.order.update({
      where: { id: ended.order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    })
    expect(await usesOf(row.id)).toBe(1)

    return { row, referralCode, ended: ended.order }
  }

  /**
   * The return, as a single-order path runs it: the order locked, then the
   * batch entry point.
   *
   * @param {string} orderId The ended order.
   * @returns {Promise<Array<object>>} The uses given back.
   */
  function giveBack(orderId) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`

      return settleReferralUsesIfEnded(tx, {
        entries: [{ orderId, cause: 'NOT_COMPLETED' }],
      })
    })
  }

  /**
   * What must hold whichever way the race went.
   *
   * @param {object} params The code, the ended order and the checkout's answer.
   * @param {object} params.row The code.
   * @param {object} params.ended The booking that gave its use back.
   * @param {object} params.placed The checkout's response.
   * @returns {Promise<boolean>} Whether the checkout took the use.
   */
  async function holdsEitherWay({ row, ended, placed }) {
    expect([201, 409]).toContain(placed.statusCode)

    const applied = placed.statusCode === 201

    if (!applied) expect(placed.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')

    const marked = await prisma.order.findUnique({ where: { id: ended.id } })

    expect(marked.referralUseReturnCause).toBe('NOT_COMPLETED')
    expect(await usesOf(row.id)).toBe(applied ? 1 : 0)
    expect(await prisma.order.count({ where: { referralCodeId: row.id } })).toBe(applied ? 2 : 1)
    expect(
      await prisma.auditLog.count({
        where: { action: 'referral_code.use_returned', entityId: row.id },
      }),
    ).toBe(1)

    return applied
  }

  it('refuses a checkout that reads the code while its use is still being given back', async () => {
    const setup = await usedUpByAnEndedBooking('r8inflight')
    const buyer = await account('r8inflighta')
    const world = await createFeeEvent(prisma, { tag: tag('r8inflightb') })

    // The return marks the order, then waits for the code (its last lock).
    const held = await holdRow(prisma, 'ReferralCode', setup.row.id)
    const returning = giveBack(setup.ended.id)

    await untilQueued(held.pid, 1, 'the return')

    // The checkout reads the committed count, 1 of 1: used up, refused.
    const placed = await order(buyer, world, { body: { referralCode: setup.referralCode } })

    held.release()
    await held.done
    expect(await returning).toHaveLength(1)
    expect(await holdsEitherWay({ ...setup, placed })).toBe(false)
  })

  it('lets a checkout after the return take the use back up', async () => {
    const setup = await usedUpByAnEndedBooking('r8after')
    const buyer = await account('r8aftera')
    const world = await createFeeEvent(prisma, { tag: tag('r8afterb') })

    expect(await giveBack(setup.ended.id)).toHaveLength(1)

    const placed = await order(buyer, world, { body: { referralCode: setup.referralCode } })

    expect(await holdsEitherWay({ ...setup, placed })).toBe(true)
  })

  it('holds the limit and the count whichever commits first, ten times over', async () => {
    const outcomes = { applied: 0, refused: 0 }

    for (let round = 0; round < 10; round += 1) {
      const setup = await usedUpByAnEndedBooking(`r8race${round}`)
      const buyer = await account(`r8race${round}a`)
      const world = await createFeeEvent(prisma, { tag: tag(`r8race${round}b`) })

      const [returned, placed] = await Promise.all([
        giveBack(setup.ended.id),
        order(buyer, world, { body: { referralCode: setup.referralCode } }),
      ])

      expect(returned).toHaveLength(1)

      if (await holdsEitherWay({ ...setup, placed })) outcomes.applied += 1
      else outcomes.refused += 1
    }

    expect(outcomes.applied + outcomes.refused).toBe(10)
  })
})

when()('settlement takes its tiers before its order (SPEC3-XI §2.3.3)', () => {
  /**
   * A transaction of the suite's own standing in for a deletion or a night's
   * cancellation: it locks a tier, and later, on cue, cancels a PENDING order
   * with the conditional update those paths use.
   *
   * @param {string} tierId The tier to hold.
   * @returns {Promise<object>} `{ pid, cancel(orderId), release(), done }`.
   */
  async function tierHolder(tierId) {
    const steps = []
    let wake = null
    let held

    const heldPromise = new Promise((resolve) => {
      held = resolve
    })

    const next = () =>
      new Promise((resolve) => {
        if (steps.length > 0) resolve(steps.shift())
        else wake = resolve
      })

    const push = (step) => {
      if (wake) {
        const resolve = wake

        wake = null
        resolve(step)
      } else {
        steps.push(step)
      }
    }

    const done = prisma.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        await tx.$queryRaw`SELECT "id" FROM "TicketType" WHERE "id" = ${tierId} FOR UPDATE`
        held(pid)

        for (;;) {
          const step = await next()

          if (step.kind === 'release') return

          try {
            step.resolve(
              await tx.$executeRaw`UPDATE "Order" SET "status" = 'CANCELLED', "cancelledAt" = now() WHERE "id" = ${step.orderId} AND "status" = 'PENDING'`,
            )
          } catch (error) {
            step.reject(error)
            throw error
          }
        }
      },
      { timeout: 20_000, maxWait: 10_000 },
    )

    return {
      pid: await heldPromise,
      cancel: (orderId) =>
        new Promise((resolve, reject) => {
          push({ kind: 'cancel', orderId, resolve, reject })
        }),
      release: () => push({ kind: 'release' }),
      done,
    }
  }

  let codes = 0

  /**
   * Settle a zero-total booking the way the charge's third phase does.
   *
   * @param {object} pending The PENDING order.
   * @returns {Promise<object>} What `settleCheckout` returned.
   */
  function settle(pending) {
    return prisma.$transaction(
      (tx) =>
        settleCheckout(tx, {
          order: pending,
          payment: null,
          result: {
            outcome: CAPTURE_OUTCOMES.SUCCEEDED,
            intent: null,
            failureCode: null,
            rawStatus: 'ZERO_TOTAL',
          },
          now: new Date(),
          generateTicketCode: () => {
            codes += 1

            return `DET-RT${RUN}${codes}`.toUpperCase()
          },
          credentialSecret: SECRET,
        }),
      { timeout: 15_000, maxWait: 10_000 },
    )
  }

  it('lets a tier holder cancel a booking two settlements are waiting on, with no deadlock, five times over', async () => {
    const world = await createFeeEvent(prisma, { tag: tag('tiersfirst') })
    const tier = world.tiers.balcony
    const { row } = await referralCodeFixture(prisma, { createdById: admin.user.id })

    for (let round = 0; round < 5; round += 1) {
      const owner = await account(`tiersfirst${round}`)
      const booking = () =>
        prisma.$transaction((tx) =>
          pendingZeroTotalOrder(tx, {
            world,
            referralCode: row,
            tag: tag(`tf${round}`),
            userId: owner.user.id,
            lines: [{ ticketTypeId: tier.id, quantity: 1, unitPriceCents: 2_000 }],
          }),
        )
      const cancelled = await booking()
      const kept = await booking()
      const soldBefore = (await prisma.ticketType.findUnique({ where: { id: tier.id } }))
        .quantitySold

      const holder = await tierHolder(tier.id)
      const settling = [settle(cancelled.order), settle(kept.order)].map((promise) =>
        promise.then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason }),
        ),
      )

      await untilQueued(holder.pid, 2, 'both settlements')

      // Settlement holds no order yet: the conditional update goes straight
      // through. Before the fix it waited on the settlement, which waited on
      // the tier: 40P01.
      const changed = await holder.cancel(cancelled.order.id)

      expect(changed).toBe(1)
      holder.release()

      const [held, ...outcomes] = await Promise.allSettled([holder.done, ...settling])

      expect(held.status, String(held.reason ?? '')).toBe('fulfilled')

      const results = outcomes.map((outcome) => outcome.value)

      for (const result of results) {
        expect(isDeadlock(result), String(result.reason ?? '')).toBe(false)
        expect(result.status, String(result.reason ?? '')).toBe('fulfilled')
      }

      expect(results.map((result) => result.value?.settled ?? true)).toEqual([false, true])

      const [first, second] = await Promise.all([
        prisma.order.findUnique({ where: { id: cancelled.order.id } }),
        prisma.order.findUnique({ where: { id: kept.order.id } }),
      ])

      expect(first.status).toBe('CANCELLED')
      expect(second.status).toBe('PAID')
      expect(
        await prisma.ticket.count({ where: { orderItem: { orderId: cancelled.order.id } } }),
      ).toBe(0)

      const issued = await prisma.ticket.findMany({
        where: { orderItem: { orderId: kept.order.id } },
      })

      expect(issued.map((ticket) => ticket.venueDueCents)).toEqual([2_000])
      expect((await prisma.ticketType.findUnique({ where: { id: tier.id } })).quantitySold).toBe(
        soldBefore + 1,
      )
    }
  })
})

when()(
  'an edit or a switch of a code that cannot wait behind another change to it (final door review, finding 2)',
  () => {
    it(
      'answers 503 with its own sentence and Retry-After after its lock wait, while the code is still held, and changes nothing',
      { timeout: 90_000 },
      async () => {
        const { row } = await referralCodeFixture(prisma, {
          createdById: admin.user.id,
          maxUses: 5,
        })
        const { row: off } = await referralCodeFixture(prisma, {
          createdById: admin.user.id,
          active: false,
        })

        const holders = []
        let answers = null
        const started = Date.now()

        // Held from outside for longer than any of them may wait: a checkout or
        // a returner would let go within moments; this one does not.
        for (const codeId of [row.id, off.id]) {
          let open
          const gate = new Promise((resolve) => {
            open = resolve
          })
          let ready
          const locked = new Promise((resolve) => {
            ready = resolve
          })
          const done = prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "ReferralCode" WHERE "id" = ${codeId} FOR UPDATE`
              ready()
              await gate
            },
            { timeout: 60_000, maxWait: 10_000 },
          )

          await locked
          holders.push({ open, done })
        }

        try {
          const timed = (request) =>
            request.then((response) => ({ response, ms: Date.now() - started }))

          answers = await Promise.race([
            Promise.all([
              timed(
                app.inject({
                  method: 'POST',
                  url: `/v1/platform/referral-codes/${row.id}/switch-off`,
                  headers: admin.headers,
                  payload: {},
                }),
              ),
              timed(
                app.inject({
                  method: 'PATCH',
                  url: `/v1/platform/referral-codes/${row.id}`,
                  headers: admin.headers,
                  payload: { maxUses: 9, expectedUpdatedAt: row.updatedAt.toISOString() },
                }),
              ),
              timed(
                app.inject({
                  method: 'POST',
                  url: `/v1/platform/referral-codes/${off.id}/switch-on`,
                  headers: admin.headers,
                }),
              ),
            ]),
            new Promise((resolve) => {
              setTimeout(() => resolve(null), LOCK_WAIT_MS + 25_000)
            }),
          ])
        } finally {
          for (const holder of holders) holder.open()
          await Promise.all(holders.map((holder) => holder.done))
        }

        expect(answers, 'they were still waiting on the codes').not.toBeNull()

        for (const { response, ms } of answers) {
          expect(response.statusCode, response.body).toBe(503)
          expect(ms).toBeGreaterThanOrEqual(LOCK_WAIT_MS - 250)
          expect(response.headers['retry-after']).toBe(String(OUT_OF_TIME_RETRY_AFTER_SECONDS))
          expect(response.json().error).toMatchObject({
            code: 'SERVICE_UNAVAILABLE',
            message: PAYMENT_TERMS_SENTENCES.referralCodeTryAgain,
          })
          expect(response.body).not.toMatch(/P20\d\d|55P03|57014|lock timeout|expired transaction/)
        }

        expect(await prisma.referralCode.findUnique({ where: { id: row.id } })).toMatchObject({
          active: true,
          maxUses: 5,
        })
        expect((await prisma.referralCode.findUnique({ where: { id: off.id } })).active).toBe(false)
      },
    )
  },
)

import { describe, expect, it } from 'vitest'

import {
  OUT_OF_TIME_RETRY_AFTER_SECONDS,
  exposedServerError,
  httpError,
  normaliseError,
} from '../src/lib/errors.js'
import { CANCELLATION_BUDGET } from '../src/lib/event-cancellation.js'
import {
  DELETION_OUT_OF_TIME_SENTENCE,
  RESTORE_OUT_OF_TIME_SENTENCE,
} from '../src/lib/event-deletion.js'
import { IMPORT_ROW_OUT_OF_TIME_SENTENCE, rowRefusal } from '../src/lib/event-import.js'
import { NIGHT_OUT_OF_TIME_SENTENCE } from '../src/lib/session-cancellation.js'
import {
  LOCK_WAIT_MS,
  TRANSACTION_BUDGETS,
  boundLockWait,
  budgetOptions,
  budgetedTransaction,
  isBudgetRefusal,
  outOfTimeRefusal,
} from '../src/lib/transaction-budget.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  addRows,
  deletedEventFixture,
  makeWorld,
  threeNightEventFixture,
} from './helpers/fixtures.js'

/**
 * The budget of every transaction that can wait behind another (SPEC2-XI X,
 * the importer, the website link, a picture's decision), and what its caller
 * is told when it runs out: a 503 to try again, never a 500.
 *
 * The real waits — a statement queued behind a row another transaction holds
 * past `lock_timeout` — are in `event-full-control-integration.test.js`; the
 * stub serialises its transactions and has no locks, so here the database's
 * errors are thrown where PostgreSQL would throw them.
 *
 * @file @desi-event/api/tests/transaction-budget
 */

/** What Prisma throws when an interactive transaction outlived its timeout. */
function expired() {
  return Object.assign(
    new Error('Transaction API error: A query cannot be executed on an expired transaction.'),
    { name: 'PrismaClientKnownRequestError', code: 'P2028' },
  )
}

/**
 * What Prisma throws for a statement PostgreSQL cancelled at its
 * `lock_timeout` (`55P03`), or at its `statement_timeout` (`57014`).
 *
 * @param {string} [sqlState] Which.
 * @returns {Error} The error.
 */
function lockTimedOut(sqlState = '55P03') {
  return Object.assign(new Error(`Database error. Code: \`${sqlState}\`. canceling statement`), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    meta: {
      driverAdapterError: {
        cause: { originalCode: sqlState, code: sqlState, kind: 'postgres' },
      },
    },
  })
}

/**
 * The statement {@link boundLockWait} sends for a budget, as the stub records
 * it: each lock waited for at most {@link LOCK_WAIT_MS}, each statement at
 * most the budget.
 *
 * @param {{timeout: number}} options The budget's transaction options.
 * @returns {{sql: string, values: string[]}} The statement.
 */
function bounds({ timeout }) {
  return {
    sql: "SELECT set_config('lock_timeout', ?, true), set_config('statement_timeout', ?, true)",
    values: [`${LOCK_WAIT_MS}ms`, `${timeout}ms`],
  }
}

describe('the budgets', () => {
  it('wait out the longest ordinary holder of an event’s row, and fit their work after that wait', () => {
    // A deletion's or a night's cancellation's base: the longest anybody
    // ordinarily holds an event's row. A request queued behind one is served
    // when it lets go, not refused.
    expect(LOCK_WAIT_MS).toBeGreaterThan(CANCELLATION_BUDGET.baseMs)

    for (const [name, budget] of Object.entries(TRANSACTION_BUDGETS)) {
      const { timeout, maxWait } = budgetOptions(budget)

      expect(timeout, name).toBe(LOCK_WAIT_MS + budget.workMs)
      expect(timeout - LOCK_WAIT_MS, name).toBeGreaterThanOrEqual(5_000)
      expect(maxWait, name).toBe(CANCELLATION_BUDGET.maxWaitMs)
    }
  })

  it('size a command that reserves refunds to its orders, as the cancellation measured', () => {
    expect(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders: 12 })).toEqual({
      timeout: LOCK_WAIT_MS + CANCELLATION_BUDGET.baseMs + 12 * CANCELLATION_BUDGET.perOrderMs,
      maxWait: CANCELLATION_BUDGET.maxWaitMs,
    })

    // A count that is not one is no count.
    for (const orders of [-3, 1.5, Number.NaN, null, '12']) {
      expect(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders }).timeout).toBe(
        LOCK_WAIT_MS + CANCELLATION_BUDGET.baseMs,
      )
    }

    // Per order only where the work is per order.
    expect(budgetOptions(TRANSACTION_BUDGETS.ROW, { orders: 12 })).toEqual(
      budgetOptions(TRANSACTION_BUDGETS.ROW),
    )
  })

  it('bound each lock wait and each statement of the transaction they run in, and of nothing after it', async () => {
    const sent = []
    const tx = {
      $queryRaw: async (strings, ...values) => {
        sent.push({ sql: Array.from(strings).join('?'), values })

        return []
      },
    }
    const row = budgetOptions(TRANSACTION_BUDGETS.ROW)

    await boundLockWait(tx, { statementMs: row.timeout })
    await boundLockWait(tx, { statementMs: 9_000.4, lockMs: 2_500.7 })

    // `set_config(..., true)` is SET LOCAL: it ends with the transaction.
    expect(sent).toEqual([bounds(row), { sql: bounds(row).sql, values: ['2500ms', '9000ms'] }])
  })
})

describe('budgetedTransaction', () => {
  /**
   * A client whose `$transaction` records its options and every call made in
   * it, in order.
   *
   * @returns {object} `{ prisma, calls, options }`.
   */
  function recordingClient() {
    const calls = []
    const options = []
    const tx = {
      $queryRaw: async (strings, ...values) => {
        calls.push({ sql: Array.from(strings).join('?'), values })

        return []
      },
      event: {
        update: async () => {
          calls.push('event.update')

          return { id: 'e1' }
        },
      },
    }

    return {
      calls,
      options,
      prisma: {
        $transaction: async (fn, given) => {
          options.push(given)

          return fn(tx)
        },
      },
    }
  }

  it('bounds the lock wait first, then does the work, inside the budget', async () => {
    const { prisma, calls, options } = recordingClient()

    const result = await budgetedTransaction(
      prisma,
      { budget: TRANSACTION_BUDGETS.ORDERS, orders: 3, refusal: 'Not saved.' },
      async (tx) => tx.event.update(),
    )

    expect(result).toEqual({ id: 'e1' })
    expect(calls).toEqual([
      bounds(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders: 3 })),
      'event.update',
    ])
    expect(options).toEqual([budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders: 3 })])
  })

  it('answers running out of time with a 503 that says what was not done, and Retry-After', async () => {
    for (const error of [expired(), lockTimedOut(), lockTimedOut('57014')]) {
      const { prisma } = recordingClient()
      const refused = await budgetedTransaction(
        prisma,
        { budget: TRANSACTION_BUDGETS.ROW, refusal: 'Nothing was changed. Try again in a moment.' },
        async () => {
          throw error
        },
      ).catch((thrown) => thrown)

      expect(refused).toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'Nothing was changed. Try again in a moment.',
        expose: true,
        retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS,
      })
      expect(normaliseError(refused, { exposeInternals: false })).toMatchObject({
        statusCode: 503,
        message: 'Nothing was changed. Try again in a moment.',
      })
      expect(isBudgetRefusal(refused)).toBe(true)
      expect(isBudgetRefusal(error)).toBe(true)
    }
  })

  it('passes every other error through untouched', async () => {
    const { prisma } = recordingClient()
    const stale = httpError(409, 'STALE_REVISION', 'Changed.')
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })

    for (const error of [stale, deadlock, new Error('a bug')]) {
      const thrown = await budgetedTransaction(
        prisma,
        { budget: TRANSACTION_BUDGETS.ROW, refusal: 'Not saved.' },
        async () => {
          throw error
        },
      ).catch((caught) => caught)

      expect(thrown).toBe(error)
      expect(isBudgetRefusal(error)).toBe(false)
      expect(outOfTimeRefusal(error, 'Not saved.')).toBe(error)
    }

    // Another 503 is not one of these: a mail server down is not a lock wait.
    expect(isBudgetRefusal(exposedServerError(503, 'DELIVERY_FAILED', 'Not sent.'))).toBe(false)
    expect(isBudgetRefusal(exposedServerError(503, 'SERVICE_UNAVAILABLE', 'Down.'))).toBe(false)
  })

  it('answers a failure on what an operation that outlived the budget handed back with the same 503', async () => {
    // Prisma 7 resolves a `create` with an `include` to null when its insert
    // finished after the transaction's timeout; the work then fails on that
    // null before any statement could say P2028. The expired transaction says
    // it when asked.
    for (const live of [false, true]) {
      const sent = []
      const tx = {
        $queryRaw: async (strings) => {
          const sql = Array.from(strings).join('?')

          sent.push(sql)

          if (sql === 'SELECT 1' && !live) throw expired()

          return []
        },
      }
      const prisma = { $transaction: async (fn) => fn(tx) }
      const thrown = await budgetedTransaction(
        prisma,
        { budget: TRANSACTION_BUDGETS.ROW, refusal: 'No invitation was issued.' },
        async () => {
          const created = null

          return created.id
        },
      ).catch((caught) => caught)

      expect(sent).toEqual([bounds(budgetOptions(TRANSACTION_BUDGETS.ROW)).sql, 'SELECT 1'])

      if (live) {
        // A live transaction: the failure is the code's own, a 500 as before.
        expect(thrown).toBeInstanceOf(TypeError)
      } else {
        expect(thrown).toMatchObject({
          statusCode: 503,
          code: 'SERVICE_UNAVAILABLE',
          message: 'No invitation was issued.',
          retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS,
        })
      }
    }

    // A refusal or a database error explains itself: nothing is asked.
    for (const error of [httpError(409, 'CONFLICT', 'Taken.'), lockTimedOut('23505')]) {
      const sent = []
      const tx = {
        $queryRaw: async (strings) => {
          const sql = Array.from(strings).join('?')

          sent.push(sql)

          // Expired, were it asked: it is not.
          if (sql === 'SELECT 1') throw expired()

          return []
        },
      }
      const thrown = await budgetedTransaction(
        { $transaction: async (fn) => fn(tx) },
        { budget: TRANSACTION_BUDGETS.ROW, refusal: 'Not saved.' },
        async () => {
          throw error
        },
      ).catch((caught) => caught)

      expect(thrown).toBe(error)
      expect(sent).toEqual([bounds(budgetOptions(TRANSACTION_BUDGETS.ROW)).sql])
    }
  })

  it('refuses one imported listing that ran out, for the run to carry on with the rest', () => {
    for (const error of [
      expired(),
      lockTimedOut(),
      lockTimedOut('57014'),
      outOfTimeRefusal(expired(), IMPORT_ROW_OUT_OF_TIME_SENTENCE),
    ]) {
      expect(rowRefusal(error)).toEqual({
        code: 'TRY_AGAIN',
        message: IMPORT_ROW_OUT_OF_TIME_SENTENCE,
      })
    }
  })
})

/**
 * Sign in and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Make every transaction from here on run out of time at its audit row, as
 * one does whose budget passes part-way through its work; and record each
 * transaction's options.
 *
 * @param {object} prisma The stub.
 * @returns {object[]} The options each transaction was given, as they come.
 */
function runOutAtTheAudit(prisma) {
  const budgets = []
  const original = prisma.$transaction

  prisma.$transaction = (fn, options) => {
    budgets.push(options)

    return original(
      typeof fn === 'function'
        ? (tx) =>
            fn(
              new Proxy(tx, {
                get: (target, property) =>
                  property === 'auditLog'
                    ? {
                        ...target.auditLog,
                        create: async () => {
                          throw expired()
                        },
                      }
                    : target[property],
              }),
            )
        : fn,
      options,
    )
  }

  return budgets
}

/**
 * What a refusal for running out of time looks like over HTTP.
 *
 * @param {object} response The response.
 * @param {string|RegExp} sentence What it says was not done.
 */
function expectOutOfTime(response, sentence) {
  expect(response.statusCode, response.body).toBe(503)
  expect(response.headers['retry-after']).toBe(String(OUT_OF_TIME_RETRY_AFTER_SECONDS))
  expect(response.json().error.code).toBe('SERVICE_UNAVAILABLE')

  if (typeof sentence === 'string') expect(response.json().error.message).toBe(sentence)
  else expect(response.json().error.message).toMatch(sentence)

  expect(response.body).not.toMatch(/P2028|55P03|57014|expired transaction|lock timeout/)
}

describe('the commands that wait behind another, running out of time over HTTP', () => {
  it('a night’s cancellation answers 503, the night still on, inside a budget for its orders', async () => {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids)

    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'owner@rangoli.example')
    const night = fixture.nights[1]
    const orders = prisma._store.order.filter(
      (order) => order.eventId === fixture.event.id && ['PENDING', 'PAID'].includes(order.status),
    ).length
    const audits = prisma._store.auditLog.length
    const refunds = prisma._store.refund.length
    const raws = prisma._rawQueries.length
    const budgets = runOutAtTheAudit(prisma)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/sessions/${night.id}/cancel`,
      headers,
      payload: {
        revision: 0,
        reason: 'The band cannot travel that night.',
        confirm: true,
        expectedOrders: 2,
      },
    })

    expectOutOfTime(response, NIGHT_OUT_OF_TIME_SENTENCE)
    expect(orders).toBeGreaterThan(0)
    expect(budgets).toContainEqual(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders }))
    expect(prisma._rawQueries.slice(raws)).toContainEqual(
      bounds(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders })),
    )
    expect(prisma._store.eventSession.find((row) => row.id === night.id).status).toBe('SCHEDULED')
    expect(prisma._store.event.find((row) => row.id === fixture.event.id).revision).toBe(
      fixture.event.revision ?? 0,
    )
    expect(prisma._store.auditLog).toHaveLength(audits)
    expect(prisma._store.refund).toHaveLength(refunds)

    await app.close()
  })

  it('a deletion answers 503, the event as it was', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'arun@rangoli.example')
    const before = { ...prisma._store.event.find((row) => row.id === ids.draftEvent.id) }
    const audits = prisma._store.auditLog.length
    const budgets = runOutAtTheAudit(prisma)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/delete`,
      headers,
      payload: {
        revision: before.revision ?? 0,
        reason: 'The organiser called the whole season off.',
        confirmSlug: before.slug,
        expectedOutcome: 'REMOVE',
      },
    })

    expectOutOfTime(response, DELETION_OUT_OF_TIME_SENTENCE)
    expect(budgets).toContainEqual(budgetOptions(TRANSACTION_BUDGETS.ORDERS, { orders: 0 }))
    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id)).toEqual(before)
    expect(prisma._store.auditLog).toHaveLength(audits)

    await app.close()
  })

  it('a restore answers 503, the event still deleted', async () => {
    const world = await makeWorld()
    const fixture = deletedEventFixture(world.ids)

    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const headers = await as(app, 'anil@desi-event.example')
    const before = { ...prisma._store.event.find((row) => row.id === fixture.event.id) }
    const budgets = runOutAtTheAudit(prisma)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${fixture.event.id}/restore`,
      headers,
      payload: {
        revision: fixture.event.revision,
        reason: 'Deleted by mistake; the organiser asked for it back.',
      },
    })

    expectOutOfTime(response, RESTORE_OUT_OF_TIME_SENTENCE)
    expect(budgets).toContainEqual(budgetOptions(TRANSACTION_BUDGETS.ROW))
    expect(prisma._store.event.find((row) => row.id === fixture.event.id)).toEqual(before)
    expect(
      prisma._store.eventModerationAction.filter((row) => row.eventId === fixture.event.id),
    ).toEqual([])

    await app.close()
  })

  it('opening and closing an editing sitting answer 503, the sitting as it was', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const reason = 'The organiser asked us to fix the title.'

    const opened = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit`,
      headers,
      payload: { reason },
    })

    expect(opened.statusCode, opened.body).toBe(201)

    const sittings = prisma._store.eventPlatformEdit.map((row) => ({ ...row }))
    const budgets = runOutAtTheAudit(prisma)

    const reopened = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit`,
      headers,
      payload: { reason },
    })
    const closed = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit/close`,
      headers,
    })

    expectOutOfTime(reopened, /opening your editing sitting could not wait for it/)
    expectOutOfTime(closed, /closing your editing sitting could not wait for it/)
    expect(budgets).toEqual([
      budgetOptions(TRANSACTION_BUDGETS.ROW),
      budgetOptions(TRANSACTION_BUDGETS.ROW),
    ])
    expect(prisma._store.eventPlatformEdit).toEqual(sittings)

    await app.close()
  })
})

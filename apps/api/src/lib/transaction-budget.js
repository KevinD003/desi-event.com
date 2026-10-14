/**
 * How long a transaction that can wait behind another may take, and what its
 * caller is told when it runs out.
 *
 * ## Why this exists
 *
 * Deleting an event, cancelling one of its nights, restoring it, opening or
 * closing an administrator's editing sitting, switching its website link,
 * deciding a replacement cover, importing it and approving an import each
 * take the event's row first (or an order's, or a sitting's) and then work
 * under that lock. Each can therefore queue behind another that holds the same
 * row — a deletion behind a night's cancellation, a refund behind a checkout —
 * and each used to run on Prisma's default interactive transaction: five
 * seconds, from `BEGIN`.
 *
 * Two facts made that a 500. Prisma's timeout does not interrupt a statement
 * that is waiting on a row lock: the statement keeps waiting, as long as the
 * other transaction holds the row, and only the *next* statement learns that
 * the transaction expired (`P2028`), which the error handler did not know. And
 * five seconds is less than the other transaction may legitimately hold the
 * row: a cancellation's own budget is ten seconds and more. A night's
 * cancellation queued behind a deletion, under load, answered 500 after
 * thirteen seconds (`P2028` at its first write after the wait).
 *
 * Worse, an operation Prisma runs as more than one statement — a `create`
 * with an `include`, which inserts and then reads the row back — does not
 * fail when the timeout passes while its insert waits: once the insert is
 * let through, the read-back finds the transaction already gone and the
 * operation resolves to `null`. The caller then fails on that null (a team
 * invitation read `created.id` and answered 500 "Cannot read properties of
 * null") before any statement could say `P2028`.
 *
 * ## What it does
 *
 * - **A bounded wait.** Every such transaction first sets `lock_timeout` for
 *   itself ({@link LOCK_WAIT_MS}): no statement in it waits longer than that
 *   for a lock another transaction holds. Past it PostgreSQL cancels the
 *   statement (`55P03`), the transaction ends, and every lock it had taken is
 *   let go at once — nothing is left queued behind a request that has already
 *   been answered. `lock_timeout` counts each lock a statement waits for
 *   afresh, and the second request queued on a row waits for two (the row's
 *   tuple lock, held by the first waiter, then the holder itself), so it also
 *   sets `statement_timeout` to its budget: no statement outlives the
 *   transaction it is in (`57014`), however long the queue in front of it.
 * - **A budget sized to the work and to that wait.** Its timeout is the lock
 *   wait plus its own work ({@link TRANSACTION_BUDGETS}), plus, for a command
 *   that reserves a refund per paid order, that much per order: the figures
 *   `event-cancellation.js` measured for a cancellation (`CANCELLATION_BUDGET`).
 * - **A precise 503.** One that runs out anyway — past its budget (`P2028`),
 *   past its lock wait (`55P03`), a statement past the budget (`57014`),
 *   unable to start (`P2028` from `maxWait`), or failing on what an operation
 *   that outlived the budget handed back (asked of the transaction itself,
 *   which answers `P2028` once it has expired) — was rolled back whole. Its caller is told so, as a 503 with the code the
 *   contract documents for one (`SERVICE_UNAVAILABLE`, `API_ERRORS.unavailable`),
 *   a sentence saying what was not done, and `Retry-After`; never as a 500
 *   carrying the driver's message.
 *
 * The figures are a judgement, written down. The longest anybody ordinarily
 * holds an event's row is a cancellation's or a deletion's base budget, ten
 * seconds; {@link LOCK_WAIT_MS} waits that out with a margin, so a request
 * queued behind one is served when it finishes rather than refused. Longer
 * than that, and the caller is better told to try again: by then the other
 * change has usually landed, and the retry meets its documented refusal
 * (`STALE_REVISION`, `ALREADY_DELETED`, ...) rather than a wait.
 *
 * @module @desi-event/api/lib/transaction-budget
 */

import {
  OUT_OF_TIME_RETRY_AFTER_SECONDS,
  databaseErrorCode,
  exposedServerError,
  isOutOfTime,
} from './errors.js'
import { CANCELLATION_BUDGET } from './event-cancellation.js'

/**
 * The longest one statement of a budgeted transaction waits for a row lock
 * another transaction holds, in milliseconds (`lock_timeout`).
 *
 * @type {number}
 */
export const LOCK_WAIT_MS = 15_000

/** How long a budgeted transaction waits for a connection to start on. */
export const CONNECTION_WAIT_MS = CANCELLATION_BUDGET.maxWaitMs

/**
 * The work of each kind of transaction, on top of {@link LOCK_WAIT_MS}.
 *
 * - `ROW`: a row or two and an audit row (a restore, a sitting, the website
 *   link, a picture's decision, one imported listing, a team invitation or a
 *   new code for one): Prisma's own default.
 * - `PICTURE`: the same, with a picture's bytes written in it.
 * - `ORDERS`: a command that reserves a refund for every paid order, under
 *   each order's lock (a deletion, a night's cancellation): the
 *   cancellation's measured figures, per order.
 * - `REFUND`: one refund approved, repaired or replaced by the refund driver.
 *
 * @type {Readonly<Record<'ROW'|'PICTURE'|'ORDERS'|'REFUND', Readonly<{workMs: number, perOrderMs: number}>>>}
 */
export const TRANSACTION_BUDGETS = Object.freeze({
  ROW: Object.freeze({ workMs: 5_000, perOrderMs: 0 }),
  PICTURE: Object.freeze({ workMs: 10_000, perOrderMs: 0 }),
  ORDERS: Object.freeze({
    workMs: CANCELLATION_BUDGET.baseMs,
    perOrderMs: CANCELLATION_BUDGET.perOrderMs,
  }),
  REFUND: Object.freeze({ workMs: 5_000, perOrderMs: 0 }),
})

/**
 * The `prisma.$transaction` options for a budget.
 *
 * @param {{workMs: number, perOrderMs: number}} budget One of {@link TRANSACTION_BUDGETS}.
 * @param {object} [options] Options.
 * @param {number} [options.orders] How many orders the work touches, counted before it starts.
 * @returns {{timeout: number, maxWait: number}} For `prisma.$transaction`.
 */
export function budgetOptions(budget, { orders = 0 } = {}) {
  const count = Number.isInteger(orders) && orders > 0 ? orders : 0

  return {
    timeout: LOCK_WAIT_MS + budget.workMs + budget.perOrderMs * count,
    maxWait: CONNECTION_WAIT_MS,
  }
}

/**
 * Bound every wait of the transaction it runs in: each lock a statement waits
 * for, and each statement as a whole.
 *
 * `set_config(..., true)` is `SET LOCAL`: it lasts until this transaction ends,
 * and never reaches the next one to use the connection. It is the first
 * statement, so it bounds every wait that follows. The statement bound is the
 * transaction's own budget: Prisma's `timeout` does not interrupt a statement
 * that is waiting, and this does.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} bounds The bounds, in milliseconds.
 * @param {number} bounds.statementMs The longest one statement may take: the transaction's `timeout`.
 * @param {number} [bounds.lockMs] The longest one statement waits for one lock.
 * @returns {Promise<void>} Resolves once set.
 */
export async function boundLockWait(tx, { statementMs, lockMs = LOCK_WAIT_MS }) {
  const lock = `${Math.trunc(lockMs)}ms`
  const statement = `${Math.trunc(statementMs)}ms`

  await tx.$queryRaw`SELECT set_config('lock_timeout', ${lock}, true), set_config('statement_timeout', ${statement}, true)`
}

/**
 * The 503 for a budgeted transaction that ran out of time, or the error itself
 * when it is anything else.
 *
 * @param {unknown} error Whatever the transaction threw.
 * @param {string} sentence What was not done, said to the caller: it ends by
 *   saying that nothing was changed and when to try again.
 * @returns {unknown} The error to throw.
 */
export function outOfTimeRefusal(error, sentence) {
  if (!isOutOfTime(error)) return error

  return Object.assign(exposedServerError(503, 'SERVICE_UNAVAILABLE', sentence), {
    retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS,
  })
}

/**
 * Whether a thrown value is a budgeted transaction's 503, or the database
 * error behind one: for a batch that refuses one item and carries on.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
export function isBudgetRefusal(error) {
  if (isOutOfTime(error)) return true

  const raw = /** @type {{statusCode?: unknown, code?: unknown, retryAfterSeconds?: unknown}} */ (
    error
  )

  return (
    raw?.statusCode === 503 &&
    raw?.code === 'SERVICE_UNAVAILABLE' &&
    raw?.retryAfterSeconds === OUT_OF_TIME_RETRY_AFTER_SECONDS
  )
}

/**
 * Run a transaction that can wait behind another: its lock waits bounded, its
 * timeout its budget, and its running out answered as a 503.
 *
 * The body comes last, so a call reads as `$transaction` does.
 *
 * @param {object} prisma A Prisma client (not a transaction client).
 * @param {object} options Options.
 * @param {{workMs: number, perOrderMs: number}} options.budget One of {@link TRANSACTION_BUDGETS}.
 * @param {number} [options.orders] How many orders the work touches.
 * @param {string} options.refusal What the caller is told when it runs out (see {@link outOfTimeRefusal}).
 * @param {function(object): Promise<*>} work The transaction body, given the transaction client.
 * @returns {Promise<*>} What `work` resolved with.
 * @throws {Error} A 503 `SERVICE_UNAVAILABLE` when it ran out of time; otherwise whatever `work` threw.
 */
export async function budgetedTransaction(prisma, { budget, orders = 0, refusal }, work) {
  const options = budgetOptions(budget, { orders })

  try {
    return await prisma.$transaction(async (tx) => {
      await boundLockWait(tx, { statementMs: options.timeout })

      try {
        return await work(tx)
      } catch (error) {
        throw await explainedFailure(tx, error)
      }
    }, options)
  } catch (error) {
    throw outOfTimeRefusal(error, refusal)
  }
}

/**
 * What a failure inside a budgeted transaction was: itself, or the
 * transaction having run out of time underneath it.
 *
 * An error the code raised for itself — a `TypeError` on a `null` that Prisma
 * handed back from an operation that outlived the budget (see the module
 * note) — is not a database error and says nothing about the time. The
 * transaction is asked: one that has expired refuses any statement with
 * `P2028`, without reaching the database, and that refusal is the failure.
 * A live one answers, and the error stands. An HTTP refusal and a database
 * error explain themselves and are not asked about.
 *
 * @param {object} tx The transaction client.
 * @param {unknown} error What the work threw.
 * @returns {Promise<unknown>} What to throw: the expiry, or the error itself.
 */
async function explainedFailure(tx, error) {
  const raw = /** @type {{statusCode?: unknown}} */ (error)

  if (typeof raw?.statusCode === 'number' || databaseErrorCode(error) !== null) return error

  try {
    await tx.$queryRaw`SELECT 1`
  } catch (probe) {
    if (isOutOfTime(probe)) return probe
  }

  return error
}

/**
 * How many orders a command on this event can touch: every order still
 * pending or paid. Counted before the transaction starts, so its budget can
 * be sized; an order placed in between is covered by the base.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} eventId The event.
 * @returns {Promise<number>} The count.
 */
export async function liveOrderCount(prisma, eventId) {
  return prisma.order.count({ where: { eventId, status: { in: ['PENDING', 'PAID'] } } })
}

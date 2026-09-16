/**
 * Fakes shared by the unit suites.
 *
 * These are not mocks. `createFakePrisma` keeps real rows in memory and
 * enforces the parts of Prisma's behaviour the processors actually depend on —
 * that `updateMany` honours its `where` clause, that `createMany` reports a
 * count, that `$transaction` hands back a client. Asserting against stored rows
 * instead of against call logs means a test keeps passing when the
 * implementation is refactored and starts failing when the behaviour changes.
 *
 * @module @desi-event/worker/tests/helpers/fakes
 */

/** A valid CUID for tests; `cuidSchema` requires `^[a-z][a-z0-9]{7,31}$`. */
export const ORDER_ID = 'clorder000000000000001a'

/** A second valid CUID, for tests that need two entities. */
export const EVENT_ID = 'clevent000000000000001a'

/** A valid ticket type CUID. */
export const TICKET_TYPE_ID = 'cltype0000000000000001a'

/**
 * Build a logger that records every line instead of writing one.
 *
 * @returns {object} A logger with `lines`, a `child()` that shares the array, and every pino level.
 */
export function createFakeLogger() {
  /** @type {Array<{level: string, fields: object, message: unknown}>} */
  const lines = []

  /**
   * Build a level method that appends to `lines`.
   *
   * @param {string} level The pino level name.
   * @returns {Function} The level method.
   */
  const at = (level) => (fields, message) =>
    lines.push(
      typeof fields === 'string'
        ? { level, fields: {}, message: fields }
        : { level, fields, message },
    )

  /** @type {object} */
  const logger = {
    lines,
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: () => logger,
    /**
     * Messages logged at one level.
     *
     * @param {string} level The level to filter by.
     * @returns {Array<object>} Matching lines.
     */
    at: (level) => lines.filter((line) => line.level === level),
  }

  return logger
}

/**
 * Compare a row field against one Prisma `where` clause value.
 *
 * Supports the operators the worker actually uses: equality, `{ in: [...] }`
 * and `{ lte: date }`.
 *
 * @param {unknown} value The row's value.
 * @param {unknown} clause The clause from the `where` object.
 * @returns {boolean} Whether the row matches.
 */
function matchesClause(value, clause) {
  if (clause !== null && typeof clause === 'object') {
    const criteria = /** @type {Record<string, unknown>} */ (clause)
    if (Array.isArray(criteria.in)) return criteria.in.includes(value)
    if (criteria.lte !== undefined)
      return new Date(value).getTime() <= new Date(criteria.lte).getTime()
    if (criteria.gt !== undefined)
      return new Date(value).getTime() > new Date(criteria.gt).getTime()
  }
  return value === clause
}

/**
 * Filter rows by a Prisma-style `where` object.
 *
 * @param {Array<object>} rows Candidate rows.
 * @param {object} [where] The `where` clause.
 * @returns {Array<object>} Matching rows.
 */
function applyWhere(rows, where = {}) {
  return rows.filter((row) =>
    Object.entries(where).every(([key, clause]) => matchesClause(row[key], clause)),
  )
}

/**
 * @typedef {object} FakePrismaSeed
 * @property {Array<object>} [holds] `TicketHold` rows.
 * @property {Array<object>} [orders] `Order` rows, each with an `items` array.
 * @property {Array<object>} [tickets] `Ticket` rows.
 */

/**
 * Build an in-memory stand-in for the Prisma client.
 *
 * @param {FakePrismaSeed} [seed] Initial rows.
 * @returns {object} A client exposing the members the processors use, plus the `rows` store and a `calls` log.
 */
export function createFakePrisma(seed = {}) {
  const rows = {
    holds: (seed.holds ?? []).map((hold) => ({ ...hold })),
    orders: (seed.orders ?? []).map((order) => ({ ...order })),
    tickets: (seed.tickets ?? []).map((ticket) => ({ ...ticket })),
  }

  /** @type {Array<object>} */
  const calls = []
  let nextTicketId = rows.tickets.length + 1

  const client = {
    rows,
    calls,

    ticketHold: {
      /**
       * @param {object} args Prisma `findMany` arguments.
       * @returns {Promise<Array<object>>} Matching holds, ordered and limited.
       */
      findMany: async (args = {}) => {
        calls.push({ model: 'ticketHold', method: 'findMany', args })
        let found = applyWhere(rows.holds, args.where)

        if (args.orderBy?.expiresAt === 'asc') {
          found = [...found].sort(
            (a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
          )
        }

        const page = typeof args.take === 'number' ? found.slice(0, args.take) : found

        // Prisma returns detached snapshots, not live rows. Copying matters:
        // it is what lets a test mutate the store mid-sweep to simulate a
        // concurrent writer without retroactively changing what was read.
        return page.map((row) => ({ ...row }))
      },

      /**
       * @param {object} args Prisma `updateMany` arguments.
       * @returns {Promise<{count: number}>} How many rows the `where` clause actually matched.
       */
      updateMany: async (args = {}) => {
        calls.push({ model: 'ticketHold', method: 'updateMany', args })
        const matched = applyWhere(rows.holds, args.where)
        for (const row of matched) Object.assign(row, args.data)
        return { count: matched.length }
      },
    },

    order: {
      /**
       * @param {object} args Prisma `findUnique` arguments.
       * @returns {Promise<(object|null)>} The order with its items and their tickets, or `null`.
       */
      findUnique: async (args = {}) => {
        calls.push({ model: 'order', method: 'findUnique', args })
        const order = rows.orders.find((candidate) => candidate.id === args.where?.id)
        if (!order) return null

        return {
          ...order,
          items: (order.items ?? []).map((item) => ({
            ...item,
            tickets: rows.tickets.filter((ticket) => ticket.orderItemId === item.id),
          })),
        }
      },
    },

    ticket: {
      /**
       * @param {object} args Prisma `createMany` arguments.
       * @returns {Promise<{count: number}>} How many rows were inserted.
       */
      createMany: async (args = {}) => {
        calls.push({ model: 'ticket', method: 'createMany', args })
        for (const row of args.data ?? []) {
          rows.tickets.push({ id: `ticket-${nextTicketId}`, ...row })
          nextTicketId += 1
        }
        return { count: (args.data ?? []).length }
      },
    },

    /**
     * @param {Array<unknown>} strings Tagged template parts.
     * @param {...unknown} values Bound parameters.
     * @returns {Promise<Array<object>>} An empty result set; the call is recorded for ordering assertions.
     */
    $queryRaw: async (strings, ...values) => {
      calls.push({
        method: '$queryRaw',
        sql: Array.isArray(strings) ? strings.join('?') : strings,
        values,
      })
      return []
    },

    /**
     * @param {Function} run The transaction body.
     * @returns {Promise<unknown>} Whatever the body returns.
     */
    $transaction: async (run) => {
      calls.push({ method: '$transaction' })
      return run(client)
    },

    /**
     * @returns {Promise<void>} Resolves immediately.
     */
    $disconnect: async () => {},
  }

  return client
}

/**
 * Build an order with one item, for the ticket issuance suite.
 *
 * @param {object} [overrides] Fields to override on the order.
 * @param {number} [overrides.quantity] Tickets the single item sells.
 * @returns {object} An `Order` row shaped as the processor expects.
 */
export function buildOrder(overrides = {}) {
  const { quantity = 2, ...rest } = overrides

  return {
    id: ORDER_ID,
    reference: 'DE-8F3K2QRT',
    status: 'PAID',
    buyerEmail: 'buyer@example.com',
    buyerName: 'Priya Sharma',
    eventId: EVENT_ID,
    items: [{ id: 'item-1', orderId: ORDER_ID, ticketTypeId: TICKET_TYPE_ID, quantity }],
    ...rest,
  }
}

/**
 * Build a `TicketHold` row.
 *
 * @param {object} overrides Fields to override.
 * @returns {object} A hold row.
 */
export function buildHold(overrides = {}) {
  return {
    id: 'hold-1',
    ticketTypeId: TICKET_TYPE_ID,
    orderId: null,
    quantity: 2,
    status: 'ACTIVE',
    expiresAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

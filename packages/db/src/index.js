/**
 * Shared PostgreSQL access for Desi-Event.
 *
 * Prisma 7 requires an explicit driver adapter, so the client is always built
 * through {@link createPrismaClient}. A lazily-initialised process singleton is
 * exposed as {@link getPrisma} so that importing this module never opens a
 * connection — important for unit tests and for build steps that only need the
 * exported enums.
 *
 * @module @desi-event/db
 */

import { PrismaClient, Prisma, $Enums } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

export { Prisma, $Enums }

export {
  UserRole,
  OrgRole,
  EventCategory,
  EventStatus,
  TicketTypeStatus,
  HoldStatus,
  OrderStatus,
  TicketStatus,
  PaymentStatus,
  PromoType,
} from '@prisma/client'

/**
 * @typedef {object} PrismaClientOptions
 * @property {string} [connectionString] PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`.
 * @property {Array<string>} [log] Prisma log levels, e.g. `['query', 'warn']`.
 */

/**
 * Create a new Prisma client bound to a PostgreSQL driver adapter.
 *
 * Callers that create their own client own its lifecycle and must call
 * `$disconnect()` when finished.
 *
 * @param {PrismaClientOptions} [options] Client options.
 * @returns {PrismaClient} A connected-on-demand Prisma client.
 * @throws {Error} If no connection string is available.
 */
export function createPrismaClient(options = {}) {
  const connectionString = options.connectionString ?? process.env.DATABASE_URL

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and point it at your PostgreSQL instance.',
    )
  }

  const adapter = new PrismaPg({ connectionString })

  return new PrismaClient({
    adapter,
    log: options.log ?? (process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']),
  })
}

/** @type {PrismaClient | null} */
let singleton = null

/**
 * Return the process-wide Prisma client, creating it on first use.
 *
 * Next.js development servers re-evaluate modules on every hot reload, so the
 * instance is cached on `globalThis` to avoid exhausting the connection pool.
 *
 * @param {PrismaClientOptions} [options] Options used only on first creation.
 * @returns {PrismaClient} The shared Prisma client.
 */
export function getPrisma(options = {}) {
  const globalKey = Symbol.for('desi-event.prisma')
  const store = /** @type {Record<symbol, unknown>} */ (globalThis)

  if (store[globalKey]) {
    return /** @type {PrismaClient} */ (store[globalKey])
  }

  if (!singleton) {
    singleton = createPrismaClient(options)
    store[globalKey] = singleton
  }

  return singleton
}

/**
 * Disconnect and clear the shared client. Intended for test teardown and for
 * graceful shutdown handlers.
 *
 * @returns {Promise<void>} Resolves once the connection pool is closed.
 */
export async function disconnectPrisma() {
  const globalKey = Symbol.for('desi-event.prisma')
  const store = /** @type {Record<symbol, unknown>} */ (globalThis)
  const client = /** @type {PrismaClient | null} */ (store[globalKey] ?? singleton)

  // Clear both references before awaiting. A concurrent getPrisma() must not be
  // handed a client that is already mid-disconnect.
  singleton = null
  delete store[globalKey]

  if (client) {
    await client.$disconnect()
  }
}

/**
 * Check that the database is reachable. Used by the API health endpoint.
 *
 * @param {PrismaClient} client Prisma client to probe.
 * @returns {Promise<boolean>} True when a trivial query succeeds.
 */
export async function isDatabaseReachable(client) {
  try {
    await client.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

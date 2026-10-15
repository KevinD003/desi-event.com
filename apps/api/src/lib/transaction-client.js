/**
 * Telling a Prisma client from an interactive transaction's client.
 *
 * Some helpers decide something that only holds inside the transaction that
 * writes what they decided about: a lock taken outside it is released before
 * the write, and a count read outside it is stale by the time the row lands.
 * They take the transaction client and check that they were given one.
 *
 * @module @desi-event/api/lib/transaction-client
 */

/**
 * Whether a Prisma client is an interactive transaction's.
 *
 * Not by `$transaction`: since Prisma 7 a transaction client has one too (it
 * opens a savepoint). A transaction client has no connection of its own to
 * manage, so it lacks `$disconnect`; a full client always has it.
 *
 * @param {object} db A Prisma client or transaction client.
 * @returns {boolean} True for a transaction client.
 */
export function isTransactionClient(db) {
  return typeof db.$disconnect !== 'function'
}

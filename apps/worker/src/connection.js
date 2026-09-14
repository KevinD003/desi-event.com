/**
 * The single Redis connection the whole worker process shares.
 *
 * BullMQ opens its own blocking connections internally by duplicating the one
 * it is handed, so passing a single `ioredis` instance to every queue and
 * worker is both supported and much cheaper than one client per queue.
 *
 * @module @desi-event/worker/connection
 */

import IORedis from 'ioredis'

/**
 * Connection options BullMQ requires, and why.
 *
 * `maxRetriesPerRequest: null` is not optional: a `Worker` issues a blocking
 * `BZPOPMIN` that can legitimately sit idle for seconds, and ioredis' default
 * of 20 retries makes it abort those long polls with
 * `MaxRetriesPerRequestError`. BullMQ refuses to start a worker without this.
 *
 * `enableReadyCheck: true` makes ioredis wait for Redis to report itself ready
 * before sending commands, so a worker started while Redis is still loading a
 * dump does not fail its first job on `LOADING Redis is loading the dataset`.
 *
 * @type {Readonly<Record<string, unknown>>}
 */
export const REQUIRED_CONNECTION_OPTIONS = Object.freeze({
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
})

/**
 * @typedef {object} RedisConnection
 * @property {Function} quit Close the connection after pending commands finish.
 * @property {Function} disconnect Drop the socket immediately.
 * @property {Function} duplicate Clone the connection; BullMQ calls this internally.
 * @property {Function} on Subscribe to connection events.
 * @property {string} status Current connection state, e.g. `ready` or `end`.
 */

/**
 * Open the shared Redis connection.
 *
 * @param {object} options Connection options.
 * @param {string} options.url A `redis://` or `rediss://` connection string.
 * @param {object} [options.logger] Logger used to report connection trouble.
 * @param {Record<string, unknown>} [options.redisOptions] Extra ioredis options, merged last except for the required ones.
 * @returns {RedisConnection} A connected-on-demand ioredis client.
 * @throws {TypeError} When `url` is not a non-empty string.
 */
export function createRedisConnection({ url, logger, redisOptions = {} }) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new TypeError('createRedisConnection requires a redis:// connection string')
  }

  const connection = new IORedis(url, { ...redisOptions, ...REQUIRED_CONNECTION_OPTIONS })

  // ioredis emits `error` on every failed reconnect attempt. Without a
  // listener Node treats it as an unhandled 'error' event and kills the
  // process, which would turn a two-second Redis restart into an outage.
  connection.on('error', (error) => {
    logger?.error?.({ err: error }, 'redis connection error')
  })

  connection.on('end', () => {
    logger?.warn?.('redis connection closed')
  })

  return connection
}

/**
 * Close a Redis connection, preferring a graceful `QUIT`.
 *
 * `quit()` waits for in-flight commands and can hang if the socket is already
 * gone, so a failure falls back to dropping it. Shutdown must always finish.
 *
 * @param {RedisConnection} connection The connection to close.
 * @returns {Promise<void>} Resolves once the socket is closed.
 */
export async function closeRedisConnection(connection) {
  if (!connection) return

  try {
    await connection.quit()
  } catch {
    connection.disconnect?.()
  }
}

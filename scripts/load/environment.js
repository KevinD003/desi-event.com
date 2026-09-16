/**
 * The machine a run happened on, recorded with the run.
 *
 * A latency figure with no machine attached is a figure nobody can reproduce or
 * argue with. "p95 340ms" on eight cores and on two cores are different claims,
 * and a report that does not say which is a report that will eventually be read
 * as whichever is more convenient.
 *
 * Deliberately not recorded: hostname, username, network addresses, or anything
 * that identifies the person. What matters is what the machine could do, not
 * whose it was.
 *
 * @module scripts/load/environment
 */

import os from 'node:os'

/**
 * What the run has to work with.
 *
 * @returns {object} Cores, memory, platform and versions.
 */
export function describeMachine() {
  const cpus = os.cpus()

  return {
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpuModel: cpus[0]?.model?.trim() ?? 'unknown',
    cpuCount: cpus.length,
    // Total rather than free: free memory at the instant a run starts says more
    // about what else was open than about the machine.
    totalMemoryBytes: os.totalmem(),
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
    nodeVersion: process.version,
    // Whether this is somebody's laptop or a runner, because the answer changes
    // how the numbers should be read and is otherwise unknowable afterwards.
    continuousIntegration: Boolean(process.env.CI),
  }
}

/**
 * What the services say about themselves.
 *
 * @param {object} prisma A Prisma client.
 * @param {object|null} redis An ioredis-compatible client, or null.
 * @returns {Promise<object>} Versions and pool settings.
 */
export async function describeServices(prisma, redis) {
  const services = { postgres: null, redis: null }

  try {
    const [row] = await prisma.$queryRawUnsafe('SELECT version() AS version')

    services.postgres = {
      version: String(row?.version ?? '').split(' on ')[0],
      // What the server will let this process open, which is the ceiling every
      // connection-exhaustion failure is actually about.
      maxConnections: await settingOf(prisma, 'max_connections'),
    }
  } catch (error) {
    services.postgres = { error: String(error?.message ?? error).slice(0, 200) }
  }

  if (redis) {
    try {
      const info = await redis.info('server')
      const version = /redis_version:([^\r\n]+)/u.exec(info)

      services.redis = { version: version?.[1] ?? 'unknown' }
    } catch (error) {
      services.redis = { error: String(error?.message ?? error).slice(0, 200) }
    }
  }

  return services
}

/**
 * One PostgreSQL setting.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} name The setting.
 * @returns {Promise<string|null>} Its value, or null when it cannot be read.
 */
async function settingOf(prisma, name) {
  try {
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT setting FROM pg_settings WHERE name = '${name}'`,
    )

    return row?.setting ?? null
  } catch {
    return null
  }
}

/**
 * How many connections this database currently has, and from where.
 *
 * Sampled during a run rather than after it: a pool that peaked at its limit
 * and drained is invisible afterwards, and it is the peak that caused the
 * timeouts somebody is investigating.
 *
 * @param {object} prisma A Prisma client.
 * @returns {Promise<{total: number, active: number, idle: number}|null>} The counts.
 */
export async function sampleConnections(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT state, count(*)::int AS count FROM pg_stat_activity
       WHERE datname = current_database() GROUP BY state`,
    )

    const byState = new Map(rows.map((row) => [row.state ?? 'unknown', row.count]))
    const total = [...byState.values()].reduce((sum, count) => sum + count, 0)

    return {
      total,
      active: byState.get('active') ?? 0,
      idle: byState.get('idle') ?? 0,
    }
  } catch {
    return null
  }
}

/**
 * How much work is waiting in the worker's queues.
 *
 * A queue that grows through a run is a worker that cannot keep up, which no
 * latency percentile on the API side will ever show.
 *
 * @param {object|null} redis An ioredis-compatible client.
 * @param {ReadonlyArray<string>} queues Queue names.
 * @returns {Promise<Record<string, number>|null>} Depth per queue.
 */
export async function sampleQueueDepth(redis, queues) {
  if (!redis) return null

  const depths = {}

  for (const queue of queues) {
    try {
      // BullMQ keeps waiting jobs in a list and delayed ones in a sorted set.
      // Both are work nobody has done, so both count.
      const [waiting, delayed] = await Promise.all([
        redis.llen(`bull:${queue}:wait`),
        redis.zcard(`bull:${queue}:delayed`),
      ])

      depths[queue] = (waiting ?? 0) + (delayed ?? 0)
    } catch {
      depths[queue] = -1
    }
  }

  return depths
}

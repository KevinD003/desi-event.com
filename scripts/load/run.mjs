#!/usr/bin/env node
/**
 * The load harness.
 *
 * Starts a real API against a real PostgreSQL, drives it with concurrent
 * workers, measures what happened, and then asks the database whether the
 * result was *correct* — which is the part a load test usually skips and the
 * part that matters.
 *
 * ## Usage
 *
 *     pnpm run load                       # steady profile, every scenario
 *     pnpm run load -- --profile spike
 *     pnpm run load -- --scenario ga-hold-contention
 *     LOAD_SCALE=6 pnpm run load -- --profile soak
 *
 * `TEST_DATABASE_URL` must point at a database this may write to. It will not
 * touch `DATABASE_URL`: a load run creates and contends over real rows, and a
 * suite that could do that to a developer's working database is a suite nobody
 * should run twice.
 *
 * ## What the output is, and is not
 *
 * A record of what this code did on this machine at this concurrency. It is not
 * a capacity figure. Nothing here, and nothing citing it, may be read as
 * "supports N users" — see `docs/LOAD_AND_CAPACITY.md` for why that number
 * cannot come from a run like this one.
 *
 * @module scripts/load/run
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import dotenv from 'dotenv'

import { createPrismaClient, disconnectPrisma } from '@desi-event/db'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { createLogger } from '@desi-event/logger'
import { loadApiEnv } from '@desi-event/schemas/env'

import { buildApp } from '../../apps/api/src/app.js'
import { HEALTH_LIMITS, PROFILES, scaleProfile, thresholdsFor } from './config.js'
import {
  describeMachine,
  describeServices,
  sampleConnections,
  sampleQueueDepth,
} from './environment.js'
import { checkInvariants } from './invariants.js'
import { createRecorder, judge, watchProcess } from './metrics.js'
import { SCENARIOS, scenarioByKey } from './scenarios.js'
import { buildWorld } from './world.mjs'

/** Where a run's record is written. */
const RESULTS_DIR = path.join(process.cwd(), 'load-results')

/** The queues whose depth is worth sampling. */
const QUEUES = Object.freeze(['notifications', 'maintenance'])

/**
 * Read the command line.
 *
 * @param {string[]} argv Raw arguments.
 * @returns {{profile: string, scenario: string|null, out: boolean}} What was asked for.
 */
function parseArguments(argv) {
  const options = { profile: 'steady', scenario: null, out: true }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--profile') options.profile = argv[index + 1]
    if (argv[index] === '--scenario') options.scenario = argv[index + 1]
    if (argv[index] === '--no-write') options.out = false
  }

  return options
}

/**
 * How many workers should be running at this point in the window.
 *
 * Linear during a ramp, flat afterwards. Linear rather than stepped because a
 * step is a spike, and a profile that ramps in four jumps is measuring four
 * small spikes.
 *
 * @param {object} profile The profile.
 * @param {number} elapsedMs How far into the window.
 * @returns {number} How many workers should be live.
 */
export function activeWorkers(profile, elapsedMs) {
  if (profile.rampMs <= 0 || elapsedMs >= profile.rampMs) return profile.workers

  return Math.max(1, Math.ceil((elapsedMs / profile.rampMs) * profile.workers))
}

/**
 * Run one scenario for one window.
 *
 * @param {object} params Inputs.
 * @param {object} params.scenario From `SCENARIOS`.
 * @param {object} params.profile The load profile.
 * @param {object} params.world What `buildWorld` made.
 * @param {Function} params.call How to reach the API.
 * @param {object} params.prisma A Prisma client, for sampling and invariants.
 * @param {object|null} params.redis A Redis client, or null.
 * @returns {Promise<object>} The scenario's record.
 */
async function runScenario({ scenario, profile, world, call, prisma, redis }) {
  const recorder = createRecorder()
  const watcher = watchProcess()
  const startedAt = Date.now()
  const deadline = startedAt + profile.durationMs
  const samples = { connections: [], queues: [] }

  /**
   * One worker, looping until the window closes.
   *
   * @param {number} worker Which worker this is.
   * @returns {Promise<void>} Resolves when the window closes.
   */
  async function work(worker) {
    let iteration = 0

    while (Date.now() < deadline) {
      const elapsed = Date.now() - startedAt

      // A ramping worker that is not live yet waits rather than exits: it has
      // to be here when its turn comes.
      if (worker >= activeWorkers(profile, elapsed)) {
        await new Promise((resolve) => {
          setTimeout(resolve, 25)
        })
        continue
      }

      const began = performance.now()
      const outcome = await scenario.run({ world, call, worker, iteration })
      const took = performance.now() - began

      recorder.record(took, outcome.ok)
      if (!outcome.ok) recorder.fail(outcome.reason ?? 'unknown')

      iteration += 1
    }
  }

  /**
   * Sample the services while the window is open.
   *
   * @returns {Promise<void>} Resolves when the window closes.
   */
  async function observe() {
    while (Date.now() < deadline) {
      samples.connections.push(await sampleConnections(prisma))
      samples.queues.push(await sampleQueueDepth(redis, QUEUES))

      await new Promise((resolve) => {
        setTimeout(resolve, 500)
      })
    }
  }

  await Promise.all([
    ...Array.from({ length: profile.workers }, (_, worker) => work(worker)),
    observe(),
  ])

  const elapsedMs = Date.now() - startedAt
  const measured = recorder.finish(elapsedMs)
  const health = watcher.stop()
  const invariants = await checkInvariants(prisma, scenario.scope ? scenario.scope(world) : {})

  const connections = samples.connections.filter(Boolean)
  const queues = samples.queues.filter(Boolean)

  const verdict = judge({
    measured,
    health,
    thresholds: thresholdsFor(scenario.key, profile),
    limits: HEALTH_LIMITS,
    invariants,
  })

  return {
    scenario: scenario.key,
    title: scenario.title,
    asks: scenario.asks,
    profile: profile.label,
    elapsedMs,
    measured,
    health: {
      ...health,
      peakConnections: connections.reduce((peak, sample) => Math.max(peak, sample.total), 0),
      peakActiveConnections: connections.reduce((peak, sample) => Math.max(peak, sample.active), 0),
      peakQueueDepth: queues.reduce(
        (peak, sample) =>
          Math.max(peak, ...Object.values(sample).map((depth) => Math.max(0, depth))),
        0,
      ),
      redisObserved: queues.length > 0,
    },
    invariants,
    verdict,
  }
}

/**
 * Print one scenario's record.
 *
 * @param {object} record From {@link runScenario}.
 * @returns {void}
 */
function report(record) {
  const mark = record.verdict.ok ? 'PASS' : 'FAIL'

  console.log(`\n${mark}  ${record.title} — ${record.profile}`)
  console.log(`      ${record.asks}`)
  console.log(
    `      ${record.measured.attempted} call(s) in ${(record.elapsedMs / 1000).toFixed(1)}s · ` +
      `${record.measured.throughputPerSecond.toFixed(1)}/s · ` +
      `p50 ${record.measured.latencyMs.p50}ms · p95 ${record.measured.latencyMs.p95}ms · ` +
      `p99 ${record.measured.latencyMs.p99}ms`,
  )
  console.log(
    `      loop lag p95 ${record.health.eventLoopLagMs.p95}ms · ` +
      `peak connections ${record.health.peakConnections} · ` +
      `peak queue depth ${record.health.redisObserved ? record.health.peakQueueDepth : 'not observed'}`,
  )

  for (const check of record.verdict.checks) {
    if (!check.ok) console.log(`      ✗ ${check.name}: ${check.detail}`)
  }

  for (const invariant of record.verdict.brokenInvariants) {
    console.log(`      ✗ INVARIANT BROKEN — ${invariant.name}: ${invariant.detail}`)
  }

  if (Object.keys(record.measured.failures).length > 0) {
    console.log(`      failures: ${JSON.stringify(record.measured.failures)}`)
  }
}

/**
 * Run the suite.
 *
 * @returns {Promise<number>} A process exit code.
 */
async function main() {
  // The same seam the server uses, so a developer who has configured one has
  // configured the other.
  dotenv.config({ quiet: true })

  const options = parseArguments(process.argv.slice(2))
  const base = PROFILES[options.profile]

  if (!base) {
    console.error(`Unknown profile "${options.profile}". Try: ${Object.keys(PROFILES).join(', ')}`)

    return 2
  }

  const connectionString = process.env.TEST_DATABASE_URL

  if (!connectionString) {
    console.error(
      'TEST_DATABASE_URL is not set. A load run creates and contends over real rows, so it will\n' +
        'not touch DATABASE_URL: point it at a database you are willing to have written to.',
    )

    return 2
  }

  const profile = scaleProfile(base, Number(process.env.LOAD_SCALE ?? 1))
  const chosen = options.scenario
    ? [scenarioByKey(options.scenario)].filter(Boolean)
    : [...SCENARIOS]

  if (chosen.length === 0) {
    console.error(`Unknown scenario "${options.scenario}".`)

    return 2
  }

  const tag = randomUUID().slice(0, 8)
  const prisma = createPrismaClient({ connectionString })
  const env = loadApiEnv({ ...process.env, DATABASE_URL: connectionString })
  const logger = createLogger({ name: 'load', level: 'error', pretty: false })
  // A per-run id space. The mock provider numbers its intents from one, and a
  // load database outlives a run — so a second run against the same database
  // would hand out `pi_000001` again and collide with the first run's payment
  // on `Payment(provider, providerRef)`. That is an artefact of reusing a
  // database with a provider whose ids restart, not something a real processor
  // does, and the concurrency suites carry the same prefix for the same reason.
  const providers = createInMemoryProviderRegistry({
    payments: { idPrefix: `pi${tag}` },
  })

  const app = await buildApp({
    prisma,
    providers,
    env,
    logger,
    // The limiter is the one thing a load run has to be exempt from: it would
    // otherwise measure the limiter rather than the application, and the
    // limiter's own behaviour is tested where it belongs. The door has its own
    // per-scanner budget on top of the global one, and one load scanner makes
    // every door request, so it is lifted the same way.
    rateLimit: {
      global: { max: 1_000_000, timeWindow: '1 minute' },
      admission: { max: 1_000_000, timeWindow: '1 minute' },
    },
  })

  await app.ready()

  const machine = describeMachine()
  const services = await describeServices(prisma, null)

  console.log(`Load suite — profile "${profile.label}", ${profile.workers} worker(s)`)
  console.log(`  ${profile.description}`)
  console.log(
    `  ${machine.cpuModel} · ${machine.cpuCount} core(s) · ` +
      `${(machine.totalMemoryBytes / 1024 ** 3).toFixed(1)} GiB · ${machine.platform} · ` +
      `Node ${machine.nodeVersion}${machine.continuousIntegration ? ' · CI runner' : ''}`,
  )
  console.log(`  ${services.postgres?.version ?? 'PostgreSQL unavailable'}`)
  console.log(
    '\n  These figures describe this code on this machine at this concurrency. They are not a\n' +
      '  capacity statement, and nothing citing them may be read as one.',
  )

  const world = await buildWorld(prisma, app, tag)

  /**
   * Reach the API in-process.
   *
   * `inject` rather than a socket, deliberately: the question is whether the
   * application's own concurrency is safe, and a local socket would add the
   * kernel's queueing to every measurement without adding any information.
   * What that costs is honest — these numbers exclude network time — and it is
   * said here rather than discovered later.
   *
   * @param {object} request Method, path, body and headers.
   * @returns {Promise<{status: number, body: object|null}>} The answer.
   */
  const call = async (request) => {
    const response = await app.inject({
      method: request.method,
      url: request.path,
      ...(request.body ? { payload: request.body } : {}),
      ...(request.headers ? { headers: request.headers } : {}),
    })

    return { status: response.statusCode, body: response.json?.() ?? null }
  }

  const records = []

  for (const scenario of chosen) {
    // Before each scenario, not once: see `renewStepUp` in world.mjs.
    await world.renewStepUp()

    const record = await runScenario({ scenario, profile, world, call, prisma, redis: null })

    records.push(record)
    report(record)
  }

  const failed = records.filter((record) => !record.verdict.ok)
  const broken = records.filter((record) => record.verdict.brokenInvariants.length > 0)

  console.log(
    `\n${records.length - failed.length}/${records.length} scenario(s) passed` +
      (broken.length > 0 ? ` — ${broken.length} broke a correctness invariant` : ''),
  )

  if (options.out) {
    await mkdir(RESULTS_DIR, { recursive: true })

    const file = path.join(RESULTS_DIR, `${profile.label}-${new Date().toISOString()}.json`)

    await writeFile(
      file,
      `${JSON.stringify({ profile, machine, services, records }, null, 2)}\n`,
      'utf8',
    )
    console.log(`Written to ${path.relative(process.cwd(), file)}`)
  }

  await app.close()
  await disconnectPrisma(prisma)

  return failed.length === 0 ? 0 : 1
}

process.exit(await main())

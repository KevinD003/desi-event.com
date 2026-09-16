/**
 * Measuring a run: latency, errors, throughput, and the health of the process.
 *
 * ## Why the samples are kept rather than summarised
 *
 * A running mean is cheap and useless: the number a load test exists to find is
 * a percentile, and a percentile cannot be computed from a mean. The sample
 * array is bounded — a run that produced a million samples would be a run whose
 * memory use changed the thing it was measuring — and the bound is reported, so
 * "p99 was 240ms" never quietly means "p99 of the first hundred thousand".
 *
 * ## Event-loop lag
 *
 * The measurement nobody takes and the one that predicts failure. A process
 * answering in 50ms with 400ms of loop lag is a process whose next request will
 * take 450ms, and no latency percentile shows that until it already has.
 * `monitorEventLoopDelay` is Node's own histogram and costs almost nothing.
 *
 * @module scripts/load/metrics
 */

import { monitorEventLoopDelay } from 'node:perf_hooks'

/** How many latency samples to keep. Beyond this the run is sampling itself. */
export const MAX_SAMPLES = 200_000

/**
 * A recorder for one scenario run.
 *
 * @returns {object} `record`, `fail`, `finish` and the accumulated state.
 */
export function createRecorder() {
  /** @type {number[]} */
  const samples = []
  const failures = new Map()

  let attempted = 0
  let succeeded = 0
  let errored = 0
  let dropped = 0

  return {
    /**
     * One completed call.
     *
     * @param {number} durationMs How long it took.
     * @param {boolean} ok Whether the scenario counts it as a success.
     * @returns {void}
     */
    record(durationMs, ok) {
      attempted += 1

      if (samples.length < MAX_SAMPLES) samples.push(durationMs)
      else dropped += 1

      if (ok) succeeded += 1
      else errored += 1
    },

    /**
     * One call that failed in a way the scenario did not expect.
     *
     * Kept by reason and counted, because "3% errors" is unactionable and
     * "3% errors, all `ECONNRESET`" is a connection pool.
     *
     * @param {string} reason A short, stable description.
     * @returns {void}
     */
    fail(reason) {
      failures.set(reason, (failures.get(reason) ?? 0) + 1)
    },

    /**
     * What the run produced.
     *
     * @param {number} elapsedMs How long the window was.
     * @returns {object} The scenario's measurements.
     */
    finish(elapsedMs) {
      const sorted = [...samples].sort((left, right) => left - right)

      return {
        attempted,
        succeeded,
        errored,
        droppedSamples: dropped,
        errorRate: attempted === 0 ? 0 : errored / attempted,
        throughputPerSecond: elapsedMs === 0 ? 0 : (attempted / elapsedMs) * 1000,
        latencyMs: {
          p50: percentile(sorted, 50),
          p95: percentile(sorted, 95),
          p99: percentile(sorted, 99),
          max: sorted.at(-1) ?? 0,
        },
        failures: Object.fromEntries(failures),
      }
    },
  }
}

/**
 * One percentile of a sorted array.
 *
 * Nearest-rank, which is the definition that does not invent a value between
 * two samples. An interpolated p99 of a thousand requests is a number no
 * request actually took.
 *
 * @param {number[]} sorted Ascending samples.
 * @param {number} rank Which percentile, 0 to 100.
 * @returns {number} The value, rounded to a tenth of a millisecond.
 */
export function percentile(sorted, rank) {
  if (sorted.length === 0) return 0

  const index = Math.min(sorted.length - 1, Math.ceil((rank / 100) * sorted.length) - 1)

  return Math.round(sorted[Math.max(0, index)] * 10) / 10
}

/**
 * Watch the process while a scenario runs.
 *
 * @returns {{stop: function(): object}} Call `stop` when the window closes.
 */
export function watchProcess() {
  const loop = monitorEventLoopDelay({ resolution: 10 })
  const startedHeap = process.memoryUsage().heapUsed

  loop.enable()

  return {
    /**
     * What the process did while it was watched.
     *
     * @returns {object} Loop lag and heap growth.
     */
    stop() {
      loop.disable()

      const endedHeap = process.memoryUsage().heapUsed

      return {
        eventLoopLagMs: {
          mean: Math.round((loop.mean / 1e6) * 10) / 10,
          p95: Math.round((loop.percentile(95) / 1e6) * 10) / 10,
          max: Math.round((loop.max / 1e6) * 10) / 10,
        },
        heap: {
          startedBytes: startedHeap,
          endedBytes: endedHeap,
          growthRatio: startedHeap === 0 ? 1 : Math.round((endedHeap / startedHeap) * 100) / 100,
        },
      }
    },
  }
}

/**
 * Judge one scenario's measurements against its thresholds.
 *
 * Correctness first, and separately. A run whose latency is excellent and whose
 * inventory oversold is a failed run, and reporting it as "3 of 4 checks
 * passed" would let somebody read the three.
 *
 * @param {object} params Inputs.
 * @param {object} params.measured From `finish`.
 * @param {object} params.health From `stop`.
 * @param {object} params.thresholds From `THRESHOLDS`.
 * @param {object} params.limits From `HEALTH_LIMITS`.
 * @param {Array<{name: string, ok: boolean, detail: string}>} params.invariants What the database says.
 * @returns {{ok: boolean, checks: Array<object>, brokenInvariants: Array<object>}} The verdict.
 */
export function judge({ measured, health, thresholds, limits, invariants }) {
  const checks = [
    {
      name: 'p95 latency',
      ok: measured.latencyMs.p95 <= thresholds.p95Ms,
      detail: `${measured.latencyMs.p95}ms against a ${thresholds.p95Ms}ms limit`,
    },
    {
      name: 'p99 latency',
      ok: measured.latencyMs.p99 <= thresholds.p99Ms,
      detail: `${measured.latencyMs.p99}ms against a ${thresholds.p99Ms}ms limit`,
    },
    {
      name: 'error rate',
      ok: measured.errorRate <= thresholds.maxErrorRate,
      detail: `${(measured.errorRate * 100).toFixed(3)}% against a ${(
        thresholds.maxErrorRate * 100
      ).toFixed(3)}% limit`,
    },
    {
      name: 'throughput',
      ok: measured.throughputPerSecond >= thresholds.minThroughput,
      detail: `${measured.throughputPerSecond.toFixed(1)}/s against a ${thresholds.minThroughput}/s floor`,
    },
    {
      name: 'event-loop lag',
      ok: health.eventLoopLagMs.p95 <= limits.maxEventLoopLagMs,
      detail: `p95 ${health.eventLoopLagMs.p95}ms against a ${limits.maxEventLoopLagMs}ms limit`,
    },
  ]

  const brokenInvariants = invariants.filter((invariant) => !invariant.ok)

  return {
    // Invariants are not one check among five. A single broken one fails the
    // run whatever the latency did, which is the whole point of measuring them.
    ok: brokenInvariants.length === 0 && checks.every((check) => check.ok),
    checks,
    brokenInvariants,
  }
}

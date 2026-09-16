/**
 * What the load suite runs, and what counts as passing.
 *
 * ## Why the thresholds are here rather than in the assertions
 *
 * A threshold written inline next to an assertion is a threshold nobody can
 * review. Put together, they are a document: somebody can read this file and
 * say "that p95 is too generous" without reading a harness. They are also what
 * makes the suite repeatable on a different machine — the profile changes, the
 * definition of passing does not.
 *
 * ## What these numbers are and are not
 *
 * They are **local** thresholds for a developer machine and a CI runner. They
 * are not a capacity statement. A suite that runs 200 virtual users against a
 * laptop tells you the code does not fall over at 200 virtual users on a
 * laptop, and it tells you nothing whatever about 10,000 real people on
 * production hardware behind a real network. Nothing in this suite, in its
 * output, or in any document that cites it may say otherwise — see
 * `docs/LOAD_AND_CAPACITY.md`.
 *
 * ## The four profiles
 *
 * Named after what they are for rather than after their numbers:
 *
 *   - **ramp** — arrivals climb from one worker to the full count. Finds the
 *     point where something starts queueing, which a flat run hides.
 *   - **steady** — the full count for the whole window. The ordinary case.
 *   - **spike** — a short burst well above the steady count, then nothing.
 *     What a listing going viral looks like, and what a cold connection pool
 *     looks like when it happens.
 *   - **soak** — the steady count for much longer. Finds what leaks: a
 *     connection never returned, a queue that grows, a cache that never evicts.
 *
 * ## Why a spike has a different latency budget
 *
 * Because queueing is what a spike *is*. Four times the steady concurrency on
 * the same cores will queue, and a queue is latency; holding a spike to the
 * steady p95 would mean either the threshold is wrong or the burst is, and the
 * burst is the point.
 *
 * So each profile carries a `latencyMultiplier`, and it multiplies **latency
 * and nothing else**. The error rate, the throughput floor, the event-loop lag
 * limit and every correctness invariant are identical in all four profiles. A
 * spike that oversells is a failed spike; a spike that is slow is a spike.
 *
 * That distinction is load-bearing: a multiplier that also relaxed error rates
 * would be a knob for making failures disappear, which is the opposite of what
 * a threshold is for.
 *
 * @module scripts/load/config
 */

/**
 * The load profiles.
 *
 * `durationMs` is deliberately short by default. A soak that takes an hour is
 * a soak nobody runs, and the suite is more useful run often at ten seconds
 * than never at sixty minutes; `LOAD_SCALE` multiplies every duration for the
 * occasions somebody does want the long one.
 *
 * @type {Readonly<Record<string, object>>}
 */
export const PROFILES = Object.freeze({
  ramp: Object.freeze({
    label: 'ramp',
    description: 'Arrivals climb to the full count, so the first queueing point is visible.',
    workers: 16,
    durationMs: 10_000,
    rampMs: 6_000,
    // Slightly generous: the first seconds are deliberately under-loaded, so a
    // ramp's percentiles mix a quiet period with a busy one.
    latencyMultiplier: 1.25,
  }),
  steady: Object.freeze({
    label: 'steady',
    description: 'The full count for the whole window. The ordinary case.',
    workers: 16,
    durationMs: 10_000,
    rampMs: 0,
    latencyMultiplier: 1,
  }),
  spike: Object.freeze({
    label: 'spike',
    description: 'A short burst well above steady. What a listing going viral looks like.',
    workers: 64,
    durationMs: 5_000,
    rampMs: 0,
    // Four times the steady concurrency on the same cores. Queueing is
    // expected and is the thing being observed; overselling is not, and its
    // threshold does not move.
    latencyMultiplier: 4,
  }),
  soak: Object.freeze({
    label: 'soak',
    description: 'Steady, for much longer. Finds what leaks rather than what is slow.',
    workers: 8,
    durationMs: 45_000,
    rampMs: 0,
    latencyMultiplier: 1,
  }),
})

/**
 * What passing means, per scenario.
 *
 * `maxErrorRate` counts responses the scenario did not expect. A scenario whose
 * whole point is contention — two buyers, one seat — expects refusals, and
 * counts them as successes; only a 5xx or a transport failure is an error.
 *
 * @type {Readonly<Record<string, {p95Ms: number, p99Ms: number, maxErrorRate: number, minThroughput: number}>>}
 */
export const THRESHOLDS = Object.freeze({
  'public-browse': Object.freeze({
    p95Ms: 400,
    p99Ms: 900,
    maxErrorRate: 0.001,
    minThroughput: 20,
  }),
  'public-search': Object.freeze({
    p95Ms: 500,
    p99Ms: 1200,
    maxErrorRate: 0.001,
    minThroughput: 15,
  }),
  'inventory-read': Object.freeze({
    p95Ms: 300,
    p99Ms: 800,
    maxErrorRate: 0.001,
    minThroughput: 25,
  }),
  'ga-hold-contention': Object.freeze({
    p95Ms: 800,
    p99Ms: 2000,
    maxErrorRate: 0.001,
    minThroughput: 5,
  }),
  'seat-hold-contention': Object.freeze({
    p95Ms: 900,
    p99Ms: 2500,
    maxErrorRate: 0.001,
    minThroughput: 5,
  }),
  'checkout-create': Object.freeze({
    p95Ms: 1200,
    p99Ms: 3000,
    maxErrorRate: 0.001,
    minThroughput: 3,
  }),
  'webhook-duplicates': Object.freeze({
    p95Ms: 600,
    p99Ms: 1500,
    maxErrorRate: 0.001,
    minThroughput: 10,
  }),
  'check-in-concurrency': Object.freeze({
    p95Ms: 600,
    p99Ms: 1500,
    maxErrorRate: 0.001,
    minThroughput: 10,
  }),
  'notification-throughput': Object.freeze({
    p95Ms: 2000,
    p99Ms: 5000,
    maxErrorRate: 0.001,
    minThroughput: 1,
  }),
  'refund-contention': Object.freeze({
    p95Ms: 900,
    p99Ms: 2500,
    maxErrorRate: 0.001,
    minThroughput: 3,
  }),
  'reconciliation-queue': Object.freeze({
    p95Ms: 900,
    p99Ms: 2500,
    maxErrorRate: 0.001,
    minThroughput: 3,
  }),
})

/**
 * Health limits that apply to every scenario.
 *
 * Event-loop lag is the one that matters most and is the one nobody measures: a
 * process answering in 50ms with 400ms of lag is a process about to fall over,
 * and no latency percentile shows it.
 *
 * @type {Readonly<object>}
 */
export const HEALTH_LIMITS = Object.freeze({
  /** Worst acceptable event-loop lag while under load. */
  maxEventLoopLagMs: 250,
  /** Worst acceptable worker queue depth at the end of a run. */
  maxQueueDepth: 5_000,
  /** How much heap growth over a soak counts as a leak rather than as noise. */
  maxSoakHeapGrowthRatio: 2.5,
})

/**
 * Multiply every duration, for the occasions somebody wants the long run.
 *
 * @param {object} profile One of {@link PROFILES}.
 * @param {number} scale From `LOAD_SCALE`.
 * @returns {object} The profile with its durations scaled.
 */
export function scaleProfile(profile, scale) {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1

  return {
    ...profile,
    durationMs: Math.round(profile.durationMs * factor),
    rampMs: Math.round(profile.rampMs * factor),
  }
}

/**
 * A scenario's thresholds under one profile.
 *
 * The multiplier touches `p95Ms` and `p99Ms` and nothing else. Everything a
 * correctness argument rests on — the error rate, the throughput floor — is the
 * same number in every profile, by construction rather than by discipline.
 *
 * @param {string} key The scenario's threshold key.
 * @param {object} profile The profile being run.
 * @returns {object} The thresholds to judge against.
 */
export function thresholdsFor(key, profile) {
  const base = THRESHOLDS[key]
  const multiplier = profile.latencyMultiplier ?? 1

  return {
    ...base,
    p95Ms: Math.round(base.p95Ms * multiplier),
    p99Ms: Math.round(base.p99Ms * multiplier),
  }
}

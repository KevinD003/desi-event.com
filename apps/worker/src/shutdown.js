/**
 * Graceful shutdown.
 *
 * Order matters here more than anywhere else in the process, and it is the
 * opposite of the startup order:
 *
 *  1. **Workers first.** `worker.close()` stops fetching new jobs and waits for
 *     the ones in flight. Closing Redis before this would tear the connection
 *     out from under a running job, which BullMQ then reports as *stalled* and
 *     hands to another worker — a half-finished ticket issuance re-run for no
 *     reason.
 *  2. **Queues next.** Nothing is producing any more, so their Redis resources
 *     can go.
 *  3. **Database, then Redis.** In-flight jobs have finished with Postgres by
 *     now, and the shared connection is the last thing anything needed.
 *
 * Job *schedulers* are deliberately left registered: they are queue state, not
 * process state, and deleting them on shutdown would stop the hold sweep during
 * every rolling deploy.
 *
 * @module @desi-event/worker/shutdown
 */

/** Signals that mean "stop accepting work and finish what you are doing". */
export const SHUTDOWN_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM'])

/**
 * How long a shutdown may take before the process is killed anyway. Kept under
 * the 30s most orchestrators allow between SIGTERM and SIGKILL, so the timeout
 * that fires is ours, with a log line, rather than the platform's.
 */
export const SHUTDOWN_TIMEOUT_MS = 20_000

/**
 * @typedef {object} ShutdownTargets
 * @property {Array<object>} [workers] BullMQ workers to drain.
 * @property {Record<string, object>} [queues] Queues to close.
 * @property {object} [connection] The shared Redis connection.
 * @property {object} [logger] Logger for progress lines.
 * @property {function(): Promise<void>} [closeWorkers] Override for worker teardown; injected by tests.
 * @property {function(): Promise<void>} [closeQueues] Override for queue teardown.
 * @property {function(): Promise<void>} [closeDatabase] Disconnect the database.
 * @property {function(): Promise<void>} [closeConnection] Close the Redis connection.
 */

/**
 * Build the process's `close()` function.
 *
 * Each step is independently guarded: a failure in one is logged and the rest
 * still run, because a shutdown that gives up halfway leaks exactly the
 * resources it was supposed to release.
 *
 * @param {ShutdownTargets} targets What to close, and how.
 * @returns {function(): Promise<void>} An idempotent close function.
 */
export function createShutdown(targets) {
  const { logger } = targets
  let closed = null

  /**
   * Run one teardown step, logging rather than throwing on failure.
   *
   * @param {string} name The step name, for logs.
   * @param {(function(): Promise<void>|undefined)} run The step, when there is one.
   * @returns {Promise<void>} Always resolves.
   */
  async function runStep(name, run) {
    if (typeof run !== 'function') return
    try {
      await run()
      logger?.debug?.({ step: name }, 'shutdown step complete')
    } catch (error) {
      logger?.error?.({ step: name, err: error }, 'shutdown step failed')
    }
  }

  return async function close() {
    // A second SIGTERM while the first shutdown is in flight must join the
    // shutdown already running, not start a competing one.
    if (closed) return closed

    closed = (async () => {
      logger?.info?.('shutting down')
      await runStep('workers', targets.closeWorkers)
      await runStep('queues', targets.closeQueues)
      await runStep('database', targets.closeDatabase)
      await runStep('redis', targets.closeConnection)
      logger?.info?.('shutdown complete')
    })()

    return closed
  }
}

/**
 * Install signal handlers that shut the process down once, cleanly.
 *
 * A second signal during shutdown exits immediately: an operator pressing
 * Ctrl-C twice means "stop now", not "queue another graceful shutdown".
 *
 * @param {object} options Wiring.
 * @param {function(): Promise<void>} options.close The close function from {@link createShutdown}.
 * @param {object} [options.logger] Logger.
 * @param {string[]} [options.signals] Signals to listen for.
 * @param {number} [options.timeoutMs] Hard deadline before forcing an exit.
 * @param {object} [options.processRef] The process object; injected by tests.
 * @param {function(number): void} [options.exit] Exit function; injected by tests.
 * @returns {function(): void} A function that removes the handlers again.
 */
export function installShutdownHandlers({
  close,
  logger,
  signals = SHUTDOWN_SIGNALS,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  processRef = process,
  exit = (code) => processRef.exit(code),
}) {
  let closing = false
  /** @type {Array<object>} */
  const installed = []

  for (const signal of signals) {
    /**
     * Handle one shutdown signal.
     *
     * @returns {void} Nothing; the process exits.
     */
    const handler = () => {
      if (closing) {
        logger?.warn?.({ signal }, 'second signal during shutdown; exiting now')
        exit(1)
        return
      }

      closing = true
      logger?.info?.({ signal }, 'signal received')

      const timer = setTimeout(() => {
        logger?.error?.({ signal, timeoutMs }, 'shutdown timed out; exiting')
        exit(1)
      }, timeoutMs)

      // An unref'd timer does not itself keep the event loop alive, so a clean
      // shutdown still lets the process exit at its own pace.
      timer.unref?.()

      close()
        .then(() => {
          clearTimeout(timer)
          exit(0)
        })
        .catch((error) => {
          clearTimeout(timer)
          logger?.error?.({ signal, err: error }, 'shutdown failed')
          exit(1)
        })
    }

    processRef.on(signal, handler)
    installed.push({ signal, handler })
  }

  return function uninstall() {
    for (const entry of installed) processRef.off?.(entry.signal, entry.handler)
  }
}

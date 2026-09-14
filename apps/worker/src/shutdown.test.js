import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'

import {
  SHUTDOWN_SIGNALS,
  SHUTDOWN_TIMEOUT_MS,
  createShutdown,
  installShutdownHandlers,
} from './shutdown.js'
import { createFakeLogger } from '../tests/helpers/fakes.js'

/**
 * Build teardown callbacks that append to a shared order log.
 *
 * @returns {{steps: string[], targets: object}} The log and the targets object.
 */
function createTargets() {
  /** @type {string[]} */
  const steps = []

  return {
    steps,
    targets: {
      closeWorkers: async () => steps.push('workers'),
      closeQueues: async () => steps.push('queues'),
      closeDatabase: async () => steps.push('database'),
      closeConnection: async () => steps.push('redis'),
    },
  }
}

describe('createShutdown', () => {
  it('drains workers before closing anything they depend on', async () => {
    const { steps, targets } = createTargets()

    await createShutdown(targets)()

    expect(steps).toEqual(['workers', 'queues', 'database', 'redis'])
  })

  it('runs every remaining step even when one fails', async () => {
    const { steps, targets } = createTargets()
    const logger = createFakeLogger()
    targets.closeQueues = async () => {
      throw new Error('redis gone')
    }

    await expect(createShutdown({ ...targets, logger })()).resolves.toBeUndefined()

    expect(steps).toEqual(['workers', 'database', 'redis'])
    expect(logger.at('error')[0].fields.step).toBe('queues')
  })

  it('is idempotent: a second call joins the shutdown already running', async () => {
    const { steps, targets } = createTargets()
    const close = createShutdown(targets)

    await Promise.all([close(), close(), close()])

    expect(steps).toEqual(['workers', 'queues', 'database', 'redis'])
  })

  it('skips steps that were not supplied', async () => {
    const logger = createFakeLogger()

    await expect(createShutdown({ logger })()).resolves.toBeUndefined()

    expect(logger.at('info').map((line) => line.message)).toEqual([
      'shutting down',
      'shutdown complete',
    ])
  })
})

describe('installShutdownHandlers', () => {
  it('closes cleanly and exits zero on a signal', async () => {
    const processRef = new EventEmitter()
    const { steps, targets } = createTargets()
    /** @type {number[]} */
    const exits = []

    installShutdownHandlers({
      close: createShutdown(targets),
      processRef,
      exit: (code) => exits.push(code),
    })

    processRef.emit('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))

    expect(steps).toEqual(['workers', 'queues', 'database', 'redis'])
    expect(exits).toEqual([0])
  })

  it('exits non-zero immediately on a second signal', async () => {
    const processRef = new EventEmitter()
    const logger = createFakeLogger()
    /** @type {number[]} */
    const exits = []
    let release = () => {}
    const blocked = new Promise((resolve) => {
      release = resolve
    })

    installShutdownHandlers({
      close: () => blocked,
      logger,
      processRef,
      exit: (code) => exits.push(code),
    })

    processRef.emit('SIGINT')
    processRef.emit('SIGINT')

    expect(exits).toEqual([1])
    expect(logger.at('warn')[0].message).toContain('second signal')

    release()
    await blocked
  })

  it('exits non-zero when the shutdown itself rejects', async () => {
    const processRef = new EventEmitter()
    const logger = createFakeLogger()
    /** @type {number[]} */
    const exits = []

    installShutdownHandlers({
      close: async () => {
        throw new Error('stuck')
      },
      logger,
      processRef,
      exit: (code) => exits.push(code),
    })

    processRef.emit('SIGTERM')
    await new Promise((resolve) => setImmediate(resolve))

    expect(exits).toEqual([1])
    expect(logger.at('error')[0].message).toBe('shutdown failed')
  })

  it('forces an exit when the shutdown outlasts its deadline', async () => {
    const processRef = new EventEmitter()
    const logger = createFakeLogger()
    /** @type {number[]} */
    const exits = []

    installShutdownHandlers({
      close: () => new Promise(() => {}),
      logger,
      processRef,
      timeoutMs: 5,
      exit: (code) => exits.push(code),
    })

    processRef.emit('SIGTERM')
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(exits).toEqual([1])
    expect(logger.at('error')[0].message).toContain('timed out')
  })

  it('listens for both SIGINT and SIGTERM, and can remove its handlers again', () => {
    const processRef = new EventEmitter()

    const uninstall = installShutdownHandlers({ close: async () => {}, processRef })

    expect(SHUTDOWN_SIGNALS.map((signal) => processRef.listenerCount(signal))).toEqual([1, 1])
    uninstall()
    expect(SHUTDOWN_SIGNALS.map((signal) => processRef.listenerCount(signal))).toEqual([0, 0])
  })

  it('leaves room under the usual 30s orchestrator grace period', () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBeLessThan(30_000)
  })
})

/**
 * The queues put open work first on real PostgreSQL.
 *
 * The defect this suite exists for is invisible to the in-memory stub: the
 * queues sorted by their status column, and PostgreSQL sorts an enum by the
 * order its values were declared, not by name. `ReconciliationState` declares
 * `ESCALATED` after `RESOLVED`, and `NotificationStatus` declares `SENT` and
 * `CANCELLED` before `FAILED` and `DEAD_LETTER`, so the items each queue exists
 * for sorted behind the ones nobody has to act on. The stub compares strings,
 * which happens to agree for some of those pairs and not others.
 *
 * Every read here goes through `readRankedPage` with the tiers the routes use,
 * against the real enum columns, including a page that straddles the boundary
 * between the tiers.
 *
 * The outbox rows are scheduled in 2100 and none is `QUEUED`, so the worker
 * suite draining the shared database cannot claim one mid-case.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/ranked-page-integration
 */

import { OUTBOX_STATES } from '@desi-event/notifications'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { RETRYABLE_STATES } from '../src/lib/notification-operations.js'
import { readRankedPage } from '../src/lib/ranked-page.js'
import { ACTIVE_STATES } from '../src/lib/reconciliation.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the ranked queue suite')

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Marks this run's rows, so the filter and the cleanup touch nothing else. */
const TAG = `ranked-${RUN}`

/** Minutes after an instant no worker will reach. */
const at = (minutes) => new Date(Date.UTC(2100, 0, 1, 12, minutes))

/** Reconciliation items, oldest first; the open ones are the newest. */
const TASKS = [
  { key: 'resolved-1', state: 'RESOLVED', createdAt: at(1) },
  { key: 'resolved-2', state: 'RESOLVED', createdAt: at(2) },
  { key: 'escalated', state: 'ESCALATED', createdAt: at(3) },
  { key: 'resolved-3', state: 'RESOLVED', createdAt: at(4) },
  { key: 'open', state: 'OPEN', createdAt: at(5) },
]

/** Outbox rows, earliest first; the ones an operator can act on are the latest. */
const MESSAGES = [
  { key: 'sent', status: OUTBOX_STATES.SENT, scheduledFor: at(1) },
  { key: 'cancelled', status: OUTBOX_STATES.CANCELLED, scheduledFor: at(2) },
  { key: 'dead', status: OUTBOX_STATES.DEAD_LETTER, scheduledFor: at(3) },
  { key: 'failed', status: OUTBOX_STATES.FAILED, scheduledFor: at(4) },
]

const taskIds = new Map()
const messageIds = new Map()

beforeAll(async () => {
  if (!(await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false))) return

  for (const task of TASKS) {
    const row = await prisma.reconciliationTask.create({
      data: {
        kind: 'PROVIDER_MISMATCH',
        state: task.state,
        providerRef: `${TAG}-${task.key}`,
        createdAt: task.createdAt,
      },
    })

    taskIds.set(row.id, task.key)
  }

  for (const message of MESSAGES) {
    const row = await prisma.notificationOutbox.create({
      data: {
        template: TAG,
        recipient: `${TAG}@example.test`,
        payload: {},
        status: message.status,
        dedupeKey: `${TAG}-${message.key}`,
        scheduledFor: message.scheduledFor,
      },
    })

    messageIds.set(row.id, message.key)
  }
})

afterAll(async () => {
  await prisma.reconciliationTask
    .deleteMany({ where: { providerRef: { startsWith: TAG } } })
    .catch(() => {})
  await prisma.notificationOutbox.deleteMany({ where: { template: TAG } }).catch(() => {})
  await prisma.$disconnect().catch(() => {})
})

/**
 * A page of this run's reconciliation items, in the route's order.
 *
 * @param {number} skip Rows before the page.
 * @param {number} take Rows on it.
 * @returns {Promise<string[]>} The items' keys.
 */
async function taskPage(skip, take) {
  const rows = await readRankedPage(prisma.reconciliationTask, {
    where: { providerRef: { startsWith: TAG } },
    field: 'state',
    first: ACTIVE_STATES,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip,
    take,
  })

  return rows.map((row) => taskIds.get(row.id))
}

/**
 * A page of this run's outbox rows, in the route's order.
 *
 * @param {number} skip Rows before the page.
 * @param {number} take Rows on it.
 * @returns {Promise<string[]>} The rows' keys.
 */
async function messagePage(skip, take) {
  const rows = await readRankedPage(prisma.notificationOutbox, {
    where: { template: TAG },
    field: 'status',
    first: RETRYABLE_STATES,
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    skip,
    take,
  })

  return rows.map((row) => messageIds.get(row.id))
}

when()('the reconciliation queue', () => {
  it('reads an enum sort the way the defect did, so the case below is the real one', async () => {
    // The old ordering, by the column: ESCALATED is declared after RESOLVED.
    const rows = await prisma.reconciliationTask.findMany({
      where: { providerRef: { startsWith: TAG } },
      orderBy: [{ state: 'asc' }, { createdAt: 'asc' }],
    })

    expect(rows.map((row) => taskIds.get(row.id))).toEqual([
      'open',
      'resolved-1',
      'resolved-2',
      'resolved-3',
      'escalated',
    ])
  })

  it('puts every open item first, oldest first, then the resolved ones', async () => {
    expect(await taskPage(0, 10)).toEqual([
      'escalated',
      'open',
      'resolved-1',
      'resolved-2',
      'resolved-3',
    ])
  })

  it('lays a page across the boundary without losing or repeating a row', async () => {
    const pages = [await taskPage(0, 2), await taskPage(2, 2), await taskPage(4, 2)]

    expect(pages).toEqual([['escalated', 'open'], ['resolved-1', 'resolved-2'], ['resolved-3']])
    expect(await taskPage(1, 2)).toEqual(['open', 'resolved-1'])
  })
})

when()('the notification queue', () => {
  it('puts dead letters and failures ahead of sent and withdrawn messages', async () => {
    expect(await messagePage(0, 10)).toEqual(['dead', 'failed', 'sent', 'cancelled'])
  })

  it('reads the second tier from the right offset', async () => {
    expect(await messagePage(3, 5)).toEqual(['cancelled'])
  })
})

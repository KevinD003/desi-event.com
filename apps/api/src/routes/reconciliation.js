/**
 * The reconciliation queue, and the six things an operator may do to an item.
 *
 * Claim, re-query, resolve, escalate, note, and read. Not: edit a payment, edit
 * an order, set a status, or change an amount. That list is the design — see
 * `../lib/reconciliation.js` for why — and it is enforced here by there being
 * no route that takes a status and no handler that writes one.
 *
 * ## Who sees what
 *
 * Decided by whether the caller names an organisation. With one, they need
 * `finance:view` in it and see only its work items; without one, they need
 * `reconciliation:manage`, which is platform-only, and see everything. Both are
 * asserted in the handler because the branch is here: a contract
 * `capabilityScope` names one field and one capability, and this route has two
 * of each.
 *
 * The actions are platform-only. Applying a verdict completes an order, posts a
 * ledger batch and mints tickets, and an organiser resolving their own
 * organisation's ambiguous charges is a conflict of interest whatever their
 * capability says.
 *
 * @module @desi-event/api/routes/reconciliation
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { conflict, notFound, unprocessable } from '../lib/errors.js'
import { generateTicketCode } from '../lib/identifiers.js'
import { toReconciliationTask } from '../lib/presenters.js'
import {
  ACTIVE_STATES,
  AGING_THRESHOLDS,
  RESOLUTIONS,
  VERDICTS,
  appendNote,
  applyVerdict,
  claimTask,
  compareEvidence,
  escalateTask,
  loadTaskContext,
  requeryOutsideTransaction,
  resolveTask,
} from '../lib/reconciliation.js'
import { defineRoute } from '../lib/register.js'

/**
 * Unresolved first, then oldest.
 *
 * The opposite of the notification queue's ordering, and deliberately: a
 * reconciliation item is money in an unknown state, so the one that has been
 * unknown longest is the most urgent rather than the least interesting.
 *
 * @type {Array<object>}
 */
const QUEUE_ORDER = Object.freeze([{ state: 'asc' }, { createdAt: 'asc' }])

/**
 * Which resolution an operator may record for a verdict.
 *
 * A resolution that does not match what the provider said is refused. An
 * operator marking an item "settled from the provider" when the provider said
 * nothing of the sort is exactly the failure this queue exists to prevent, and
 * it is refused here rather than caught in a report later.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
const RESOLUTIONS_FOR_VERDICT = Object.freeze({
  [VERDICTS.SETTLE]: Object.freeze([RESOLUTIONS.SETTLED_FROM_PROVIDER]),
  [VERDICTS.RELEASE]: Object.freeze([RESOLUTIONS.RELEASED_FROM_PROVIDER]),
  [VERDICTS.ALREADY_DONE]: Object.freeze([
    RESOLUTIONS.ALREADY_CONSISTENT,
    RESOLUTIONS.NO_ACTION_REQUIRED,
  ]),
  [VERDICTS.CONFLICT]: Object.freeze([]),
  [VERDICTS.UNKNOWN]: Object.freeze([]),
})

/**
 * Assert whoever is asking may see this queue, and say how it is scoped.
 *
 * @param {object} request The request.
 * @returns {{organizationId: string|null}} The scope to filter by.
 */
function scopeFor(request) {
  const organizationId = request.query?.organizationId ?? null

  if (organizationId) {
    assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, { organizationId })

    return { organizationId }
  }

  // No organisation named: this is the platform view, and it shows every
  // organisation's work. That is a platform capability, not a generous reading
  // of an organisation one.
  assertCan(request.actor, CAPABILITIES.RECONCILIATION_MANAGE, {})

  return { organizationId: null }
}

/**
 * Whoever may read one task, may read it.
 *
 * A task carries an organisation when the code that opened it knew one. When it
 * does not — a webhook for an intent with no local payment, say — only the
 * platform may read it, because there is nobody else it could belong to.
 *
 * @param {object} request The request.
 * @param {object} task The task.
 * @returns {void} Nothing; throws when refused.
 */
function assertMayRead(request, task) {
  if (task.organizationId) {
    assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, { organizationId: task.organizationId })

    return
  }

  assertCan(request.actor, CAPABILITIES.RECONCILIATION_MANAGE, {})
}

/**
 * Read a task back for a response.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} id Which task.
 * @param {Date} now For the aging band.
 * @returns {Promise<object>} A payload satisfying `reconciliationTaskSchema`.
 */
async function present(prisma, id, now) {
  const row = await prisma.reconciliationTask.findUnique({ where: { id } })

  if (!row) throw notFound('No such reconciliation task.')

  const order = row.orderId ? await prisma.order.findUnique({ where: { id: row.orderId } }) : null

  return toReconciliationTask(row, { now, orderReference: order?.reference ?? null })
}

/**
 * Register the reconciliation routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @param {object} deps.env The parsed API environment.
 * @returns {void} Nothing.
 */
export function registerReconciliationRoutes(app, { prisma, providers, env }) {
  defineRoute(app, 'reconciliation.queue', {
    handler: async (request) => {
      const now = new Date()
      const { page, perPage, state, kind, reference, aging } = request.query
      const { skip, take } = toSkipTake({ page, perPage })
      const { organizationId } = scopeFor(request)

      const openedBefore =
        aging === 'OVERDUE'
          ? new Date(now.getTime() - AGING_THRESHOLDS.CRITICAL_HOURS * 3_600_000)
          : aging === 'AGING'
            ? new Date(now.getTime() - AGING_THRESHOLDS.WARNING_HOURS * 3_600_000)
            : null

      const where = {
        ...(organizationId ? { organizationId } : {}),
        ...(state ? { state } : {}),
        ...(kind ? { kind } : {}),
        ...(openedBefore ? { createdAt: { lte: openedBefore } } : {}),
        // Search is over identifiers rather than prose: an operator arrives
        // here holding a payment id, an order id, a refund id or a provider
        // reference from somebody else's screen, and the useful question is
        // "is there an open item about this?".
        ...(reference
          ? {
              OR: [
                { paymentId: reference },
                { orderId: reference },
                { refundId: reference },
                { providerRef: reference },
              ],
            }
          : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.reconciliationTask.findMany({ where, orderBy: QUEUE_ORDER, skip, take }),
        prisma.reconciliationTask.count({ where }),
      ])

      const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))]
      const orders = orderIds.length
        ? await prisma.order.findMany({ where: { id: { in: orderIds } } })
        : []
      const referenceById = new Map(orders.map((order) => [order.id, order.reference]))

      return {
        data: rows.map((row) =>
          toReconciliationTask(row, {
            now,
            orderReference: referenceById.get(row.orderId) ?? null,
          }),
        ),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'reconciliation.get', {
    handler: async (request) => {
      const now = new Date()
      const task = await prisma.reconciliationTask.findUnique({ where: { id: request.params.id } })

      if (!task) throw notFound('No such reconciliation task.')

      assertMayRead(request, task)

      return { data: await present(prisma, task.id, now) }
    },
  })

  defineRoute(app, 'reconciliation.claim', {
    handler: async (request) => {
      const now = new Date()
      const { task } = await loadTaskContext(prisma, request.params.id)

      const claimed = await prisma.$transaction((tx) =>
        claimTask(tx, { task, actorId: request.actor.id, now }),
      )

      if (!claimed) {
        throw conflict('Somebody else picked that item up. Read it again.', { state: task.state })
      }

      return { data: await present(prisma, task.id, now) }
    },
  })

  defineRoute(app, 'reconciliation.requery', {
    handler: async (request) => {
      const now = new Date()
      const context = await loadTaskContext(prisma, request.params.id)
      const { task, payment, order, refund } = context

      if (!ACTIVE_STATES.includes(task.state)) {
        throw conflict('That item is closed. Re-querying it would change nothing.', {
          state: task.state,
        })
      }

      if (!payment) {
        throw unprocessable('That item names no payment, so there is nothing to ask about.', {
          taskId: task.id,
        })
      }

      // No transaction is open. The provider is a network call, and holding a
      // row lock across one is how a queue becomes a deadlock.
      const observed = await requeryOutsideTransaction(
        providers.payments,
        task.providerRef ?? payment.providerRef,
      )
      const { verdict, why } = compareEvidence({
        kind: task.kind,
        observed,
        payment,
        order,
        refund,
      })

      await prisma.$transaction(async (tx) => {
        await tx.reconciliationTask.update({
          where: { id: task.id },
          data: {
            providerState: observed,
            attempts: { increment: 1 },
            lastError: observed.error,
          },
        })

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_REQUERIED,
          entityType: 'ReconciliationTask',
          entityId: task.id,
          actorId: request.actor.id,
          metadata: {
            requestId: request.id,
            at: now.toISOString(),
            kind: task.kind,
            providerRef: task.providerRef ?? payment.providerRef,
            observedStatus: observed.status,
            found: observed.found,
            verdict,
            why,
          },
        })
      })

      return { data: { task: await present(prisma, task.id, now), observed, verdict, why } }
    },
  })

  defineRoute(app, 'reconciliation.resolve', {
    handler: async (request) => {
      const now = new Date()
      const { resolution, note } = request.body
      const context = await loadTaskContext(prisma, request.params.id)
      const { task, payment, order, refund } = context

      if (!ACTIVE_STATES.includes(task.state)) {
        throw conflict('That item has already been resolved.', { state: task.state })
      }

      if (!payment) {
        throw unprocessable('That item names no payment, so there is nothing to establish.', {
          taskId: task.id,
        })
      }

      // Asked again here rather than trusting whatever the last re-query found.
      // A stored answer is a claim about the past; resolving is a decision
      // about now, and the gap between them is where a settled order gets
      // settled again.
      const observed = await requeryOutsideTransaction(
        providers.payments,
        task.providerRef ?? payment.providerRef,
      )
      const { verdict, why } = compareEvidence({
        kind: task.kind,
        observed,
        payment,
        order,
        refund,
      })

      const allowed = RESOLUTIONS_FOR_VERDICT[verdict] ?? []

      if (allowed.length === 0) {
        throw conflict(
          verdict === VERDICTS.CONFLICT
            ? `The provider and this system still disagree: ${why}. Escalate it rather than closing it.`
            : `The provider still cannot say what happened: ${why}. An unknown state is not a failure, so this item stays open.`,
          { verdict, why },
        )
      }

      if (!allowed.includes(resolution)) {
        throw unprocessable(
          `The provider says ${why}, which does not support closing this as ${resolution}.`,
          { verdict, why, allowed },
        )
      }

      const organizationId =
        task.organizationId ??
        (order
          ? (await prisma.event.findUnique({ where: { id: order.eventId } }))?.organizationId
          : null)
      const event = order ? await prisma.event.findUnique({ where: { id: order.eventId } }) : null

      const applied = await prisma.$transaction(async (tx) => {
        const result = await applyVerdict(tx, {
          context,
          verdict,
          observed,
          actorId: request.actor.id,
          requestId: request.id,
          now,
          generateTicketCode,
          credentialSecret: env.AUTH_SECRET,
          organizationId,
          eventStartsAt: event?.startsAt ?? null,
        })

        const closed = await resolveTask(tx, {
          task,
          resolution,
          note,
          observed,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        })

        return { ...result, closed }
      })

      if (!applied.closed) {
        throw conflict('Somebody else closed that item. Read it again.', { state: task.state })
      }

      return { data: await present(prisma, task.id, now) }
    },
  })

  defineRoute(app, 'reconciliation.escalate', {
    handler: async (request) => {
      const now = new Date()
      const { task } = await loadTaskContext(prisma, request.params.id)

      const escalated = await prisma.$transaction((tx) =>
        escalateTask(tx, {
          task,
          reason: request.body.note,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!escalated) {
        throw conflict('Somebody else moved that item on. Read it again.', { state: task.state })
      }

      return { data: await present(prisma, task.id, now) }
    },
  })

  defineRoute(app, 'reconciliation.note', {
    handler: async (request) => {
      const now = new Date()
      const { task } = await loadTaskContext(prisma, request.params.id)

      await prisma.$transaction(async (tx) => {
        await appendNote(tx, {
          task,
          note: request.body.note,
          actorId: request.actor.id,
          now,
        })

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.RECONCILIATION_NOTED,
          entityType: 'ReconciliationTask',
          entityId: task.id,
          actorId: request.actor.id,
          metadata: {
            requestId: request.id,
            at: now.toISOString(),
            kind: task.kind,
            state: task.state,
            note: request.body.note,
          },
        })
      })

      return { data: await present(prisma, task.id, now) }
    },
  })
}

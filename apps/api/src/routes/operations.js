/**
 * The operations queue: what the machine could not finish on its own.
 *
 * An outbox that nothing can see is a place messages go to be forgotten. These
 * routes are what makes a dead letter a thing somebody is looking at rather
 * than a row nobody queries.
 *
 * ## What an operator is shown, and what they are not
 *
 * Status, attempts, next attempt, failure category, and the sanitised error.
 * Not the payload, and not the full recipient — only a masked form of it. A
 * queue view is read by whoever is on shift, often on a shared screen, and the
 * question it answers is "did this go?", not "what did it say?". An operations
 * tool that incidentally becomes a way to read customers' mail is one nobody
 * should have built.
 *
 * ## What an operator may do, and what they may not
 *
 * Requeue and cancel, both with a reason and both audited. They may not edit a
 * message, change its recipient, or mark it sent: an operator saying a message
 * went is not the same as it having gone, and the only thing allowed to write
 * `SENT` is the code that watched the provider accept it.
 *
 * @module @desi-event/api/routes/operations
 */

import { OUTBOX_STATES, canTransition, leaseHasLapsed } from '@desi-event/notifications'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { conflict, notFound } from '../lib/errors.js'
import { toOperatorNotification } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'

/**
 * Newest trouble first.
 *
 * Dead letters and failures come before anything healthy, because the queue
 * exists for them; within a group, the oldest first, because a message that has
 * been stuck longest is the one somebody is waiting on.
 *
 * @type {Array<object>}
 */
const QUEUE_ORDER = Object.freeze([{ status: 'asc' }, { scheduledFor: 'asc' }])

/**
 * Register the operations routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @returns {void} Nothing.
 */
export function registerOperationsRoutes(app, { prisma }) {
  defineRoute(app, 'notifications.queue', {
    handler: async (request) => {
      const { page, perPage, status, template, failureCategory } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      const where = {
        ...(status ? { status } : {}),
        ...(template ? { template } : {}),
        ...(failureCategory ? { failureCategory } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.notificationOutbox.findMany({ where, orderBy: QUEUE_ORDER, skip, take }),
        prisma.notificationOutbox.count({ where }),
      ])

      return {
        data: rows.map(toOperatorNotification),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'notifications.get', {
    handler: async (request) => {
      const row = await prisma.notificationOutbox.findUnique({ where: { id: request.params.id } })

      if (!row) throw notFound('No such notification.')

      return { data: toOperatorNotification(row) }
    },
  })

  defineRoute(app, 'notifications.retry', {
    handler: async (request) => {
      const now = new Date()

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.notificationOutbox.findUnique({ where: { id: request.params.id } })

        if (!row) throw notFound('No such notification.')

        if (!canTransition(row.status, OUTBOX_STATES.QUEUED)) {
          throw conflict(
            `A ${row.status.toLowerCase().replace('_', ' ')} message cannot be put back in the queue.`,
            { status: row.status },
          )
        }

        // Conditional on the status the check above was made against. Two
        // operators pressing retry at the same moment produce one requeue, and
        // the second is told what the first did.
        const { count } = await tx.notificationOutbox.updateMany({
          where: { id: row.id, status: row.status },
          data: {
            status: OUTBOX_STATES.QUEUED,
            // Due now, and the attempts start again: an operator requeuing a
            // dead letter has decided the cause is fixed, and leaving the
            // counter spent would dead-letter it again on the first hiccup.
            scheduledFor: now,
            attempts: 0,
            failureCategory: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        })

        if (count === 0) {
          throw conflict('Somebody else changed this message while you were looking at it.')
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.NOTIFICATION_REQUEUED,
          entityType: 'NotificationOutbox',
          entityId: row.id,
          actorId: request.actor?.id ?? null,
          metadata: {
            requestId: request.id,
            at: now.toISOString(),
            previousStatus: row.status,
            newStatus: OUTBOX_STATES.QUEUED,
            attemptsBefore: row.attempts,
            template: row.template,
            reason: request.body.reason,
          },
        })

        return tx.notificationOutbox.findUnique({ where: { id: row.id } })
      })

      return { data: toOperatorNotification(updated) }
    },
  })

  defineRoute(app, 'notifications.cancel', {
    handler: async (request) => {
      const now = new Date()

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.notificationOutbox.findUnique({ where: { id: request.params.id } })

        if (!row) throw notFound('No such notification.')

        // A live lease means a worker may be mid-send. Cancelling now would
        // leave the row saying one thing and the provider having done another,
        // which is worse than waiting for the lease to resolve.
        if (row.status === OUTBOX_STATES.CLAIMED && !leaseHasLapsed(row, now)) {
          throw conflict('A worker is sending this message. Try again in a moment.', {
            leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
          })
        }

        const from = row.status === OUTBOX_STATES.CLAIMED ? OUTBOX_STATES.QUEUED : row.status

        if (!canTransition(from, OUTBOX_STATES.CANCELLED)) {
          throw conflict(
            `A ${row.status.toLowerCase().replace('_', ' ')} message cannot be withdrawn.`,
            { status: row.status },
          )
        }

        const { count } = await tx.notificationOutbox.updateMany({
          where: { id: row.id, status: row.status },
          data: {
            status: OUTBOX_STATES.CANCELLED,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        })

        if (count === 0) {
          throw conflict('Somebody else changed this message while you were looking at it.')
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.NOTIFICATION_CANCELLED,
          entityType: 'NotificationOutbox',
          entityId: row.id,
          actorId: request.actor?.id ?? null,
          metadata: {
            requestId: request.id,
            at: now.toISOString(),
            previousStatus: row.status,
            newStatus: OUTBOX_STATES.CANCELLED,
            template: row.template,
            reason: request.body.reason,
          },
        })

        return tx.notificationOutbox.findUnique({ where: { id: row.id } })
      })

      return { data: toOperatorNotification(updated) }
    },
  })
}

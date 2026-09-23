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

import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { notFound } from '../lib/errors.js'
import {
  RETRYABLE_STATES,
  cancelNotification,
  retryNotification,
} from '../lib/notification-operations.js'
import { toOperatorNotification } from '../lib/presenters.js'
import { readRankedPage } from '../lib/ranked-page.js'
import { defineRoute } from '../lib/register.js'

/**
 * Trouble first, then everything else.
 *
 * Dead letters, failures and scheduled retries — the states an operator can
 * act on — come before anything healthy, because the queue exists for them;
 * within each tier, the oldest first, because a message that has been stuck
 * longest is the one somebody is waiting on. The tiers are read by
 * `readRankedPage`, not by sorting the status column: PostgreSQL sorts an enum
 * by declaration order, which put every sent message ahead of every dead one.
 *
 * @type {Array<object>}
 */
const QUEUE_ORDER = Object.freeze([{ scheduledFor: 'asc' }, { id: 'asc' }])

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
        readRankedPage(prisma.notificationOutbox, {
          where,
          field: 'status',
          first: RETRYABLE_STATES,
          orderBy: QUEUE_ORDER,
          skip,
          take,
        }),
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

  // The rules — which states each operation may start from, and why the
  // conditions live in the UPDATE rather than in a check before it — are in
  // ../lib/notification-operations.js.
  defineRoute(app, 'notifications.retry', {
    handler: async (request) => {
      const updated = await retryNotification(prisma, {
        id: request.params.id,
        actorId: request.actor?.id ?? null,
        reason: request.body.reason,
        requestId: request.id,
      })

      return { data: toOperatorNotification(updated) }
    },
  })

  defineRoute(app, 'notifications.cancel', {
    handler: async (request) => {
      const updated = await cancelNotification(prisma, {
        id: request.params.id,
        actorId: request.actor?.id ?? null,
        reason: request.body.reason,
        requestId: request.id,
      })

      return { data: toOperatorNotification(updated) }
    },
  })
}

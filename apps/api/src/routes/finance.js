/**
 * Finance: the balance, and the money that leaves against it.
 *
 * Eight routes, and one thing none of them does: accept a destination. Where an
 * organiser's money goes is a property of their connected account, changed
 * through the onboarding flow with its own step-up. A payout request that could
 * name a bank account would be a request that could send somebody else's money
 * somewhere new, and that is the shape of every marketplace payout fraud there
 * has ever been.
 *
 * The other rule worth stating: every figure comes from the append-only ledger.
 * Not from `Order.totalCents`, not from a cached balance column, not from
 * summing the payouts already made. A column can be wrong and nothing notices;
 * the ledger is balanced by a database check, appended to and never edited, and
 * a figure derived from it can be defended line by line.
 *
 * @module @desi-event/api/routes/finance
 */

import { CAPABILITIES, assertCan } from '@desi-event/permissions'
import { buildPaginationMeta, toSkipTake } from '@desi-event/schemas'

import { AUDIT_ACTIONS, recordAudit } from '../lib/audit.js'
import { conflict, notFound } from '../lib/errors.js'
import {
  MOVEMENT_OUTCOMES,
  availableBalance,
  failPayout,
  holdPayoutForReconciliation,
  loadPayoutContext,
  payOutsideTransaction,
  reversePayout,
  schedulePayout,
  settlePayout,
  transition,
  PAYOUT_TRANSITIONS,
} from '../lib/payouts.js'
import { toDispute, toPayout, toTransfer } from '../lib/presenters.js'
import { defineRoute } from '../lib/register.js'

/** Newest first. A finance list is read from the top. */
const NEWEST_FIRST = Object.freeze([{ createdAt: 'desc' }])

/**
 * Register the finance routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @returns {void} Nothing.
 */
export function registerFinanceRoutes(app, { prisma, providers }) {
  defineRoute(app, 'finance.balance', {
    handler: async (request) => {
      const { organizationId, currency } = request.query
      const balance = await availableBalance(prisma, { organizationId, currency })

      return { data: { organizationId, currency, ...balance } }
    },
  })

  defineRoute(app, 'payouts.list', {
    handler: async (request) => {
      const { page, perPage, organizationId, status } = request.query
      const { skip, take } = toSkipTake({ page, perPage })
      const where = { organizationId, ...(status ? { status } : {}) }

      const [rows, total] = await Promise.all([
        prisma.payout.findMany({ where, orderBy: NEWEST_FIRST, skip, take }),
        prisma.payout.count({ where }),
      ])

      return {
        data: rows.map(toPayout),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'payouts.schedule', {
    handler: async (request, reply) => {
      const { organizationId, amountCents, currency, idempotencyKey } = request.body
      const now = new Date()

      const account = await prisma.connectedAccount.findFirst({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      })

      // The balance is read inside the transaction that creates the row, so a
      // second request racing this one sees this amount in flight.
      const outcome = await prisma.$transaction((tx) =>
        schedulePayout(tx, {
          organizationId,
          connectedAccountId: account?.id ?? null,
          amountCents,
          currency,
          provider: providers.payments.name,
          idempotencyKey,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      reply.code(outcome.created ? 201 : 200)

      return { data: toPayout(outcome.payout) }
    },
  })

  defineRoute(app, 'payouts.get', {
    handler: async (request) => {
      const { payout } = await loadPayoutContext(prisma, request.params.id)

      assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, {
        organizationId: payout.organizationId,
      })

      return { data: toPayout(payout) }
    },
  })

  defineRoute(app, 'payouts.send', {
    handler: async (request) => {
      const now = new Date()
      const { payout, account } = await loadPayoutContext(prisma, request.params.id)

      assertCan(request.actor, CAPABILITIES.PAYOUT_MANAGE, {
        organizationId: payout.organizationId,
      })

      // Step one: SUBMITTED, in its own transaction, before anything is sent.
      const claimed = await prisma.$transaction(async (tx) => {
        const moved = await transition(tx, {
          delegate: tx.payout,
          table: PAYOUT_TRANSITIONS,
          row: payout,
          to: 'SUBMITTED',
          label: 'payout',
        })

        if (moved) {
          await recordAudit(tx, {
            action: AUDIT_ACTIONS.PAYOUT_SUBMITTED,
            entityType: 'Payout',
            entityId: payout.id,
            actorId: request.actor.id,
            metadata: {
              requestId: request.id,
              at: now.toISOString(),
              organizationId: payout.organizationId,
              amountCents: payout.amountCents,
              currency: payout.currency,
              reason: request.body.reason,
            },
          })
        }

        return moved
      })

      if (!claimed) {
        throw conflict('That payout is already being sent. Read it again.', {
          status: payout.status,
        })
      }

      // Step two: the provider, with nothing open.
      const submitted = { ...payout, status: 'SUBMITTED' }
      const result = await payOutsideTransaction(
        providers.payments,
        submitted,
        account?.providerAccountId ?? null,
      )

      // Step three: a short transaction recording what it said.
      await prisma.$transaction(async (tx) => {
        if (result.outcome === MOVEMENT_OUTCOMES.SUCCEEDED) {
          return settlePayout(tx, {
            payout: submitted,
            result,
            actorId: request.actor.id,
            requestId: request.id,
            now: new Date(),
          })
        }

        if (result.outcome === MOVEMENT_OUTCOMES.TIMEOUT) {
          return holdPayoutForReconciliation(tx, {
            payout: submitted,
            result,
            actorId: request.actor.id,
            requestId: request.id,
            now: new Date(),
          })
        }

        return failPayout(tx, {
          payout: submitted,
          result,
          actorId: request.actor.id,
          requestId: request.id,
          now: new Date(),
        })
      })

      const after = await prisma.payout.findUnique({ where: { id: payout.id } })

      if (!after) throw notFound('No such payout.')

      return { data: toPayout(after) }
    },
  })

  defineRoute(app, 'payouts.reverse', {
    handler: async (request) => {
      const now = new Date()
      const { payout } = await loadPayoutContext(prisma, request.params.id)

      assertCan(request.actor, CAPABILITIES.PAYOUT_MANAGE, {
        organizationId: payout.organizationId,
      })

      const { reversed } = await prisma.$transaction((tx) =>
        reversePayout(tx, {
          payout,
          amountCents: request.body.amountCents,
          reason: request.body.reason,
          actorId: request.actor.id,
          requestId: request.id,
          now,
        }),
      )

      if (!reversed) {
        throw conflict('Somebody else moved that payout on. Read it again.', {
          status: payout.status,
        })
      }

      const after = await prisma.payout.findUnique({ where: { id: payout.id } })

      return { data: toPayout(after) }
    },
  })

  defineRoute(app, 'transfers.list', {
    handler: async (request) => {
      const { page, perPage, organizationId, status } = request.query
      const { skip, take } = toSkipTake({ page, perPage })
      const where = { organizationId, ...(status ? { status } : {}) }

      const [rows, total] = await Promise.all([
        prisma.transfer.findMany({ where, orderBy: NEWEST_FIRST, skip, take }),
        prisma.transfer.count({ where }),
      ])

      return {
        data: rows.map(toTransfer),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })

  defineRoute(app, 'disputes.list', {
    handler: async (request) => {
      const { page, perPage, organizationId, status } = request.query
      const { skip, take } = toSkipTake({ page, perPage })

      // A dispute is three hops from an organisation — dispute to payment to
      // order to event — so the filter walks the relations rather than reading
      // a denormalised column that could be stale.
      const where = {
        payment: { order: { event: { organizationId } } },
        ...(status ? { status } : {}),
      }

      const [rows, total] = await Promise.all([
        prisma.dispute.findMany({ where, orderBy: NEWEST_FIRST, skip, take }),
        prisma.dispute.count({ where }),
      ])

      return {
        data: rows.map(toDispute),
        pagination: buildPaginationMeta({ page, perPage, total }),
      }
    },
  })
}

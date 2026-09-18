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
import { csvFilename, toCsv } from '../lib/csv.js'
import { conflict, notFound } from '../lib/errors.js'
import { financeSummary } from '../lib/finance-reporting.js'
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
import { EXPORT_KINDS, recordExport } from '../lib/export-register.js'
import { defineRoute } from '../lib/register.js'

/** Newest first. A finance list is read from the top. */
const NEWEST_FIRST = Object.freeze([{ createdAt: 'desc' }])

/**
 * What a finance export contains, and therefore what it does not.
 *
 * An allow list rather than an object's keys: a schema that grew a field would
 * otherwise start exporting it, and the field most likely to be added to a
 * finance row is the buyer. There is no name here, no address, no card, no
 * provider reference.
 *
 * @type {ReadonlyArray<{key: string, header: string}>}
 */
const EXPORT_COLUMNS = Object.freeze([
  { key: 'section', header: 'Section' },
  { key: 'label', header: 'Item' },
  { key: 'code', header: 'Code' },
  { key: 'debitCents', header: 'Debits (minor units)' },
  { key: 'creditCents', header: 'Credits (minor units)' },
  { key: 'balanceCents', header: 'Balance (minor units)' },
  { key: 'count', header: 'Count' },
  { key: 'currency', header: 'Currency' },
])

/**
 * Assert who may see this view, and say how it is scoped.
 *
 * The same rule the reconciliation queue uses, and for the same reason: with an
 * organisation named it is that organisation's money and `finance:view` is the
 * right question; without one it is everybody's, which is a platform question.
 *
 * @param {object} request The request.
 * @returns {{organizationId: string|null}} The scope.
 */
function summaryScope(request) {
  const organizationId = request.query?.organizationId ?? null

  if (organizationId) {
    assertCan(request.actor, CAPABILITIES.FINANCE_VIEW, { organizationId })

    return { organizationId }
  }

  assertCan(request.actor, CAPABILITIES.RECONCILIATION_MANAGE, {})

  return { organizationId: null }
}

/**
 * Turn a summary into the rows an export carries.
 *
 * @param {object} summary From `financeSummary`.
 * @param {string} currency Which currency.
 * @returns {Array<object>} Rows ready for {@link EXPORT_COLUMNS}.
 */
function exportRows(summary, currency) {
  const rows = []

  for (const [key, value] of Object.entries(summary.totals)) {
    rows.push({ section: 'Totals', label: key, balanceCents: value, currency })
  }

  for (const account of summary.accounts) {
    rows.push({
      section: 'Accounts',
      label: account.label,
      code: account.code,
      debitCents: account.debitCents,
      creditCents: account.creditCents,
      balanceCents: account.balanceCents,
      currency,
    })
  }

  for (const [key, value] of Object.entries(summary.activity)) {
    rows.push({
      section: 'Activity',
      label: key,
      count: value.count,
      balanceCents: value.amountCents,
      currency,
    })
  }

  for (const imbalance of summary.integrity.imbalances) {
    rows.push({
      section: 'Integrity',
      label: imbalance.problem,
      code: imbalance.reference,
      debitCents: imbalance.actualDebitCents,
      creditCents: imbalance.actualCreditCents,
      currency,
    })
  }

  return rows
}

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
  /**
   * Build the summary a screen or an export is asking for.
   *
   * @param {object} request The request.
   * @returns {Promise<object>} The summary, with its window and its mode.
   */
  async function summaryFor(request) {
    const { currency, from, to } = request.query
    const { organizationId } = summaryScope(request)
    const window = {
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
    }

    const summary = await financeSummary(prisma, { organizationId, currency, ...window })

    return {
      organizationId,
      currency,
      from: window.from,
      to: window.to,
      // Said on every finance surface, and said first. A figure from a mock
      // provider is not an accounting record, and a screen that does not say so
      // is one somebody will eventually paste into a return.
      mode: providers.payments.name === 'in-memory-payments' ? 'MOCK' : 'STRIPE_TEST',
      modeNotice:
        providers.payments.name === 'in-memory-payments'
          ? 'DEMO — no money moved. These figures describe a demonstration and are not an accounting record.'
          : "SANDBOX — settled in Stripe's test mode. No real money moved.",
      ...summary,
    }
  }

  defineRoute(app, 'finance.summary', {
    handler: async (request) => ({ data: await summaryFor(request) }),
  })

  defineRoute(app, 'finance.export', {
    handler: async (request, reply) => {
      const summary = await summaryFor(request)
      const stamp = new Date().toISOString()

      // Registered before the body is returned, and a failure here fails the
      // request. An export that happened with no record of it is exactly what
      // the register exists to prevent, and a best-effort register is empty
      // precisely when somebody needs it.
      //
      // A platform-wide export answers `null` — `ExportArtifact.organizationId`
      // is NOT NULL — and is logged rather than silently dropped.
      const registered = await recordExport(prisma, {
        organizationId: summary.organizationId ?? null,
        kind: EXPORT_KINDS.FINANCE,
        requestedById: request.actor?.id ?? null,
      })

      if (!registered) {
        request.log.info(
          { kind: EXPORT_KINDS.FINANCE },
          'platform-wide export not recorded in the export register: it has no organisation and the column is not nullable',
        )
      }

      reply
        .type('text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${csvFilename(
            summary.organizationId ? `finance-${summary.organizationId}` : 'finance-platform',
            stamp,
          )}"`,
        )
        // An export is a snapshot of a moment. Saying so stops a stale file in
        // somebody's downloads folder being read as current.
        .header('cache-control', 'no-store')

      // The mode line is the first row rather than a footer, because a
      // spreadsheet opened at the top is read from the top.
      const header = [
        {
          section: 'Mode',
          label: summary.modeNotice,
          code: summary.mode,
          currency: summary.currency,
        },
      ]

      return toCsv({
        columns: EXPORT_COLUMNS,
        rows: [...header, ...exportRows(summary, summary.currency)],
      })
    },
  })

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

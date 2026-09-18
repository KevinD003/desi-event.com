/**
 * Organiser analytics, and the export of it.
 *
 * ## Two capabilities, one route
 *
 * The route is declared against `report:view`, which reaches every organisation
 * role from VIEWER upward — a door steward or a listings assistant may
 * reasonably see how many tickets went and how many people came in.
 *
 * Money is a different question. `finance:view` is held by FINANCE, ADMIN and
 * OWNER, and the ledger figures are **omitted from the payload** for anybody
 * else rather than hidden by the screen. That distinction is the whole point:
 * a page that rendered the figures behind a conditional would still have sent
 * them, and "the button is not there" has never been an authorisation control.
 *
 * `moneyVisible` says which of the two happened, so the screen can explain the
 * absence instead of drawing a row of zeros.
 *
 * ## Why the step-up is in here rather than on the route
 *
 * A route-level `stepUp` is a *gate*: the guard runs before the handler and the
 * whole request is refused. That is right for an action, and wrong here, because
 * it would refuse the caller who was never going to be shown any money. A
 * VIEWER or a door steward holds `report:view` and no second factor — the
 * system only compels enrolment for privileged roles — so a route-level gate
 * would lock every one of them out of an attendance figure in order to protect
 * a ledger total they were never going to receive.
 *
 * So the window is applied to the *branch* that needs it, using the same
 * server-held policy table the route guard reads. NF-11's property is unchanged:
 * the window comes from `STEP_UP_POLICIES`, the browser cannot see it and cannot
 * ask for a longer one. What changes is the consequence of failing it — the
 * money is withheld rather than the page refused, and `moneyWithheld` says
 * `STEP_UP` so the screen can offer the one thing that would fix it.
 *
 * ## What an export may carry
 *
 * An allow list, as the finance export has, and a stricter one than it looks:
 * there is no buyer name, no email, no address, no card reference, no provider
 * identifier and nothing that belongs to another organisation. The columns are
 * written out rather than derived from the payload's keys, because a payload
 * that grew a field would otherwise start exporting it, and the field most
 * likely to be added to an analytics row is the one identifying a person.
 *
 * @module @desi-event/api/routes/analytics
 */

import { stepUpSatisfied, stepUpWindowFor } from '@desi-event/auth'
import { CAPABILITIES, assertCan, can } from '@desi-event/permissions'

import { organizerAnalytics } from '../lib/analytics.js'
import { csvFilename, toCsv } from '../lib/csv.js'
import { EXPORT_KINDS, recordExport } from '../lib/export-register.js'
import { defineRoute } from '../lib/register.js'

/**
 * What an analytics export contains, and therefore what it does not.
 *
 * @type {ReadonlyArray<{key: string, header: string}>}
 */
export const EXPORT_COLUMNS = Object.freeze([
  { key: 'section', header: 'Section' },
  { key: 'label', header: 'Item' },
  { key: 'code', header: 'Code' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'amountCents', header: 'Amount (minor units)' },
  { key: 'currency', header: 'Currency' },
  { key: 'note', header: 'Note' },
])

/**
 * The same breakdowns with every monetary column removed.
 *
 * Nulled rather than dropped, so the shape a screen renders is the same shape
 * whether or not the reader may see money — a table that grows and loses
 * columns depending on who is reading it is a table whose headings stop
 * matching its cells.
 *
 * @param {object} sales The four breakdowns.
 * @returns {object} The same four, valueless.
 */
function withoutValues(sales) {
  return Object.fromEntries(
    Object.entries(sales).map(([key, groups]) => [
      key,
      groups.map((group) => ({ ...group, lineValueCents: null, refundedCents: null })),
    ]),
  )
}

/**
 * Turn an analytics payload into the rows an export carries.
 *
 * Every row names its section, so a spreadsheet of forty rows from six
 * different measurements is still readable — and so that a money row and a
 * count row can never be summed by accident in the same column. Counts go in
 * `quantity`; money goes in `amountCents`. They are never the same column.
 *
 * @param {object} view The payload from the summary handler.
 * @returns {Array<object>} Rows ready for {@link EXPORT_COLUMNS}.
 */
function exportRows(view) {
  const rows = [
    {
      section: 'About',
      label: 'Payment mode',
      code: view.mode,
      note: view.modeNotice,
    },
    { section: 'About', label: 'Time zone', code: view.timeZone, note: 'All dates and windows' },
    {
      section: 'About',
      label: 'Money figures included',
      code: view.moneyVisible ? 'yes' : 'no',
      note: view.moneyVisible
        ? 'Derived from the append-only ledger'
        : view.moneyWithheld === 'STEP_UP'
          ? 'Omitted: this account holds finance:view but has not confirmed a second factor recently enough'
          : 'Omitted: this account does not hold finance:view in this organisation',
    },
  ]

  if (view.moneyVisible && view.money) {
    for (const [key, value] of Object.entries(view.money.totals)) {
      rows.push({ section: 'Money', label: key, amountCents: value, currency: view.currency })
    }

    for (const [key, value] of Object.entries(view.money.activity)) {
      rows.push({
        section: 'Money activity',
        label: key,
        quantity: value.count,
        amountCents: value.amountCents,
        currency: view.currency,
      })
    }
  }

  rows.push({ section: 'Tickets', label: 'Live tickets', quantity: view.tickets.live })

  for (const lost of view.tickets.byLostState) {
    rows.push({ section: 'Tickets', label: lost.label, code: lost.state, quantity: lost.count })
  }

  for (const type of view.inventory.generalAdmission) {
    rows.push({
      section: 'General admission',
      label: type.name,
      code: type.status,
      quantity: type.quantityRemaining,
      amountCents: type.priceCents,
      currency: type.currency,
      note: `${type.quantitySold} of ${type.quantityTotal} sold${type.oversold ? ' — OVERSOLD' : ''}`,
    })
  }

  for (const [groupName, groups] of [
    ['Seats by section', view.inventory.reserved.bySection],
    ['Seats by price zone', view.inventory.reserved.byPriceZone],
  ]) {
    for (const group of groups) {
      rows.push({
        section: groupName,
        label: group.name,
        quantity: group.total,
        note: `${group.available} available, ${group.held} held, ${group.sold} sold, ${group.blocked} blocked`,
      })
    }
  }

  for (const [groupName, groups] of [
    ['Sales by event', view.sales.byEvent],
    ['Sales by session', view.sales.bySession],
    ['Sales by ticket type', view.sales.byTicketType],
    ['Sales by date', view.sales.byDate],
  ]) {
    for (const group of groups) {
      rows.push({
        section: groupName,
        label: group.label,
        quantity: group.quantity,
        amountCents: group.lineValueCents,
        currency: group.currency,
        note: `${group.refundedQuantity} refunded`,
      })
    }
  }

  rows.push({
    section: 'Check-in',
    label: 'Admitted',
    quantity: view.checkIns.admitted,
    note:
      view.checkIns.percent === null
        ? 'No live tickets to admit'
        : `${view.checkIns.percent}% of ${view.checkIns.live} live tickets`,
  })

  for (const transfer of view.movement.transfers) {
    rows.push({ section: 'Transfers', label: transfer.status, quantity: transfer.count })
  }

  rows.push({ section: 'Tickets', label: 'Revoked', quantity: view.movement.revoked })

  for (const notification of view.notifications) {
    rows.push({
      section: 'Notifications',
      label: notification.status,
      quantity: notification.count,
    })
  }

  rows.push({
    section: 'Reconciliation',
    label: 'Open exceptions',
    quantity: view.exceptions.open,
    note:
      view.exceptions.oldestAgeHours === null
        ? 'None open'
        : `Oldest is ${view.exceptions.oldestAgeHours}h old`,
  })
  rows.push({
    section: 'Reconciliation',
    label: 'Escalated',
    quantity: view.exceptions.escalated,
  })

  for (const step of view.funnel.steps) {
    rows.push({ section: 'Funnel', label: step.label, code: step.key, quantity: step.count })
  }

  for (const missing of view.funnel.missing) {
    rows.push({ section: 'Funnel', label: 'Not recorded', note: missing })
  }

  return rows
}

/**
 * Register the analytics routes.
 *
 * @param {object} app The Fastify instance.
 * @param {object} deps Injected dependencies.
 * @param {object} deps.prisma The Prisma client.
 * @param {object} deps.providers The provider registry.
 * @returns {void} Nothing.
 */
export function registerAnalyticsRoutes(app, { prisma, providers }) {
  /**
   * Build the analytics view a screen or an export is asking for.
   *
   * @param {object} request The request.
   * @returns {Promise<object>} The payload.
   */
  async function viewFor(request) {
    const { organizationId, currency, eventId, eventSessionId, from, to } = request.query

    // Declared on the route as well, and asserted again here. The contract's
    // guard is what a test walks; this is what runs. Neither is redundant —
    // the first fails a pull request, the second fails a request.
    assertCan(request.actor, CAPABILITIES.REPORT_VIEW, { organizationId })

    const holdsFinance = can(request.actor, CAPABILITIES.FINANCE_VIEW, { organizationId })
    const confirmedRecently = stepUpSatisfied(request.session, {
      windowMs: stepUpWindowFor('FINANCE_VIEW'),
    })
    const moneyWithheld = !holdsFinance ? 'CAPABILITY' : confirmedRecently ? null : 'STEP_UP'
    const moneyVisible = moneyWithheld === null
    const mock = providers.payments.name === 'in-memory-payments'

    const analytics = await organizerAnalytics(prisma, {
      organizationId,
      currency,
      eventId: eventId ?? null,
      eventSessionId: eventSessionId ?? null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      now: new Date(),
    })

    const { money, sales, ...rest } = analytics

    return {
      organizationId,
      currency,
      eventId: eventId ?? null,
      eventSessionId: eventSessionId ?? null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      mode: mock ? 'MOCK' : 'STRIPE_TEST',
      modeNotice: mock
        ? 'DEMO — no money moved. These figures describe a demonstration and are not an accounting record.'
        : "SANDBOX — settled in Stripe's test mode. No real money moved.",
      moneyVisible,
      moneyWithheld,
      // The breakdowns are the quiet way money escapes a permission check: the
      // totals are gated, and then a table headed "sales by event" prints what
      // each one took. The quantities survive the withholding; the values do
      // not, and they are removed here rather than left out of the markup.
      sales: moneyVisible ? sales : withoutValues(sales),
      // Dropped from the payload, not from the markup.
      money: moneyVisible
        ? {
            totals: money.totals,
            accounts: money.accounts,
            activity: money.activity,
            integrity: money.integrity,
          }
        : null,
      ...rest,
    }
  }

  defineRoute(app, 'analytics.summary', {
    handler: async (request) => ({ data: await viewFor(request) }),
  })

  defineRoute(app, 'analytics.export', {
    handler: async (request, reply) => {
      const view = await viewFor(request)

      // Before the body, and fatal if it fails: an export with no record of it
      // is what the register exists to prevent. An analytics export always
      // names an organisation, so unlike the finance one this always records.
      await recordExport(prisma, {
        organizationId: request.query.organizationId,
        kind: EXPORT_KINDS.ANALYTICS,
        requestedById: request.actor?.id ?? null,
      })

      const body = toCsv({ columns: EXPORT_COLUMNS, rows: exportRows(view) })

      reply.header('content-type', 'text/csv; charset=utf-8')
      reply.header(
        'content-disposition',
        `attachment; filename="${csvFilename('analytics', new Date().toISOString())}"`,
      )

      return body
    },
  })
}

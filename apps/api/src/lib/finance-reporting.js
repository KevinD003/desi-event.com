/**
 * The finance numbers, derived from the ledger and from nothing else.
 *
 * `Order.totalCents` is a convenience. It is written once at checkout and never
 * corrected; it does not know about a refund, a chargeback, or a fee that was
 * waived. Summing it gives a number that looks like revenue and is not one, and
 * a marketplace that pays organisers from it eventually pays somebody money it
 * already gave back.
 *
 * So every figure here comes from `LedgerEntry`: append-only, balanced by a
 * database check on each batch, and corrected by compensating entries rather
 * than by editing. A figure derived from it can be traced to the rows that make
 * it up, which is the only property that matters when somebody disputes one.
 *
 * ## The alert
 *
 * {@link findImbalances} looks for two things the ledger should make impossible
 * and which would be invisible in any total: a batch whose stored debit and
 * credit columns disagree, and a batch whose entries do not sum to those
 * columns. The first would mean the CHECK constraint was bypassed; the second
 * would mean entries were written or lost outside the batch that owns them.
 * Either is a reason to stop reading the totals, which is why the dashboard
 * shows the alert above them rather than below.
 *
 * @module @desi-event/api/lib/finance-reporting
 */

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'

/**
 * Every account the finance view reports, and how it reads.
 *
 * Written out rather than derived from `ACCOUNTS`, because the order is the
 * order a finance person reads them in — money in, what it was for, what is
 * owed — and an alphabetical list would scatter that.
 *
 * @type {ReadonlyArray<{code: string, label: string, normal: string}>}
 */
export const REPORTED_ACCOUNTS = Object.freeze([
  { code: ACCOUNTS.PROCESSOR_CLEARING, label: 'Held by the processor', normal: DEBIT },
  { code: ACCOUNTS.ORGANIZER_PAYABLE, label: 'Owed to organisers', normal: CREDIT },
  { code: ACCOUNTS.PLATFORM_FEE_REVENUE, label: 'Platform fee revenue', normal: CREDIT },
  { code: ACCOUNTS.TAX_PAYABLE, label: 'Tax payable', normal: CREDIT },
  { code: ACCOUNTS.PROMOTIONAL_DISCOUNT, label: 'Discounts given', normal: DEBIT },
  { code: ACCOUNTS.REFUND_CLEARING, label: 'Refunds in flight', normal: CREDIT },
  { code: ACCOUNTS.DISPUTE_CLEARING, label: 'Disputed funds held', normal: CREDIT },
  { code: ACCOUNTS.TRANSFER_CLEARING, label: 'Transfers in flight', normal: DEBIT },
  { code: ACCOUNTS.PAYOUT_CLEARING, label: 'Payouts in flight', normal: DEBIT },
  { code: ACCOUNTS.PAYMENT_FEE_EXPENSE, label: 'Processor fees', normal: DEBIT },
])

/**
 * The balance of one account, in the direction it normally moves.
 *
 * An asset with more debits than credits has a positive balance; so does a
 * liability with more credits than debits. Reporting both as "the number that
 * grew" is what makes a finance screen readable without a sign convention
 * nobody remembers.
 *
 * @param {{debitCents: number, creditCents: number}} totals The two sides.
 * @param {string} normal Which direction increases this account.
 * @returns {number} Integer cents, signed.
 */
export function balanceOf(totals, normal) {
  return normal === DEBIT
    ? totals.debitCents - totals.creditCents
    : totals.creditCents - totals.debitCents
}

/**
 * Per-account debit and credit totals over a window.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string|null} [params.organizationId] One organisation, or null for the platform.
 * @param {string} params.currency Which currency.
 * @param {Date|null} [params.from] Inclusive lower bound on `createdAt`.
 * @param {Date|null} [params.to] Exclusive upper bound.
 * @returns {Promise<Array<{code: string, label: string, debitCents: number, creditCents: number, balanceCents: number}>>} One row per reported account.
 */
export async function accountTotals(prisma, { organizationId = null, currency, from, to }) {
  const accounts = await prisma.ledgerAccount.findMany({
    where: { code: { in: REPORTED_ACCOUNTS.map((account) => account.code) } },
  })
  const idByCode = new Map(accounts.map((account) => [account.code, account.id]))

  const window = {
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
      : {}),
  }

  const rows = []

  for (const account of REPORTED_ACCOUNTS) {
    const accountId = idByCode.get(account.code)

    if (!accountId) {
      // A chart of accounts missing a row is a deployment problem, not a
      // reporting one. Reported as zero rather than skipped, so the screen
      // shows the account and its absence is visible.
      rows.push({ ...account, debitCents: 0, creditCents: 0, balanceCents: 0 })
      continue
    }

    const where = {
      accountId,
      currency,
      ...(organizationId ? { organizationId } : {}),
      ...window,
    }

    const [debits, credits] = await Promise.all([
      prisma.ledgerEntry.aggregate({
        where: { ...where, direction: DEBIT },
        _sum: { amountCents: true },
      }),
      prisma.ledgerEntry.aggregate({
        where: { ...where, direction: CREDIT },
        _sum: { amountCents: true },
      }),
    ])

    const totals = {
      debitCents: debits._sum.amountCents ?? 0,
      creditCents: credits._sum.amountCents ?? 0,
    }

    rows.push({
      code: account.code,
      label: account.label,
      ...totals,
      balanceCents: balanceOf(totals, account.normal),
    })
  }

  return rows
}

/**
 * Batches whose own arithmetic does not add up.
 *
 * Two checks, and both should find nothing: a batch is balanced by a database
 * CHECK when it posts, and its entries are written in the same transaction. A
 * result here means one of those stopped being true, and the totals above
 * should not be trusted until somebody has looked.
 *
 * Bounded rather than exhaustive — a report that tries to scan every batch ever
 * posted is a report that times out — and the bound is reported, so "no
 * imbalances" never silently means "we stopped looking".
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string|null} [params.organizationId] Restrict to one organisation's batches.
 * @param {Date|null} [params.from] Inclusive lower bound.
 * @param {Date|null} [params.to] Exclusive upper bound.
 * @param {number} [params.limit] How many batches to examine.
 * @returns {Promise<{examined: number, truncated: boolean, imbalances: Array<object>}>} What was found.
 */
export async function findImbalances(prisma, { organizationId = null, from, to, limit = 500 }) {
  const batches = await prisma.ledgerBatch.findMany({
    where: {
      status: 'POSTED',
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  })

  const truncated = batches.length > limit
  const examined = truncated ? batches.slice(0, limit) : batches
  const imbalances = []

  for (const batch of examined) {
    const entries = await prisma.ledgerEntry.findMany({ where: { batchId: batch.id } })

    if (organizationId && !entries.some((entry) => entry.organizationId === organizationId)) {
      continue
    }

    const debitCents = entries
      .filter((entry) => entry.direction === DEBIT)
      .reduce((sum, entry) => sum + entry.amountCents, 0)
    const creditCents = entries
      .filter((entry) => entry.direction === CREDIT)
      .reduce((sum, entry) => sum + entry.amountCents, 0)

    if (entries.length === 0) {
      imbalances.push({
        batchId: batch.id,
        reference: batch.reference,
        kind: batch.kind,
        problem: 'NO_ENTRIES',
        storedDebitCents: batch.debitCents,
        storedCreditCents: batch.creditCents,
        actualDebitCents: 0,
        actualCreditCents: 0,
      })
      continue
    }

    if (debitCents !== creditCents) {
      imbalances.push({
        batchId: batch.id,
        reference: batch.reference,
        kind: batch.kind,
        problem: 'ENTRIES_UNBALANCED',
        storedDebitCents: batch.debitCents,
        storedCreditCents: batch.creditCents,
        actualDebitCents: debitCents,
        actualCreditCents: creditCents,
      })
      continue
    }

    if (debitCents !== batch.debitCents || creditCents !== batch.creditCents) {
      imbalances.push({
        batchId: batch.id,
        reference: batch.reference,
        kind: batch.kind,
        problem: 'ENTRIES_DISAGREE_WITH_BATCH',
        storedDebitCents: batch.debitCents,
        storedCreditCents: batch.creditCents,
        actualDebitCents: debitCents,
        actualCreditCents: creditCents,
      })
    }
  }

  return { examined: examined.length, truncated, imbalances }
}

/**
 * How much was refunded, disputed, transferred and paid out over a window.
 *
 * Counted from the rows rather than from the ledger, because these are counts
 * of *work* as well as of money — "eleven refunds settled" is the number a
 * finance person is looking for, and the ledger knows amounts rather than
 * events.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string|null} [params.organizationId] One organisation, or null for the platform.
 * @param {string} params.currency Which currency.
 * @param {Date|null} [params.from] Inclusive lower bound.
 * @param {Date|null} [params.to] Exclusive upper bound.
 * @returns {Promise<object>} Counts and amounts per activity.
 */
export async function activityTotals(prisma, { organizationId = null, currency, from, to }) {
  const window =
    from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}
  const scope = organizationId ? { event: { organizationId } } : {}

  /**
   * Sum one slice of one table.
   *
   * @param {object} delegate The Prisma delegate.
   * @param {object} where The filter.
   * @returns {Promise<{count: number, amountCents: number}>} How many and how much.
   */
  const tally = async (delegate, where) => {
    const [count, sum] = await Promise.all([
      delegate.count({ where }),
      delegate.aggregate({ where, _sum: { amountCents: true } }),
    ])

    return { count, amountCents: sum._sum.amountCents ?? 0 }
  }

  const refundScope = { currency, ...window, ...(organizationId ? { order: scope } : {}) }
  const movementScope = { currency, ...window, ...(organizationId ? { organizationId } : {}) }

  const [requested, settled, disputes, transfers, payouts] = await Promise.all([
    tally(prisma.refund, {
      ...refundScope,
      status: { in: ['REQUESTED', 'APPROVED', 'SUBMITTED', 'TIMEOUT', 'RECONCILIATION_REQUIRED'] },
    }),
    tally(prisma.refund, { ...refundScope, status: 'SUCCEEDED' }),
    tally(prisma.dispute, {
      currency,
      ...window,
      ...(organizationId ? { payment: { order: scope } } : {}),
    }),
    tally(prisma.transfer, movementScope),
    tally(prisma.payout, movementScope),
  ])

  return { refundsRequested: requested, refundsSettled: settled, disputes, transfers, payouts }
}

/**
 * The whole finance view, in one call.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs, as {@link accountTotals}.
 * @param {string|null} [params.organizationId] One organisation, or null for the platform.
 * @param {string} params.currency Which currency.
 * @param {Date|null} [params.from] Inclusive lower bound.
 * @param {Date|null} [params.to] Exclusive upper bound.
 * @returns {Promise<object>} Accounts, activity and the imbalance alert.
 */
export async function financeSummary(prisma, params) {
  const [accounts, activity, integrity] = await Promise.all([
    accountTotals(prisma, params),
    activityTotals(prisma, params),
    findImbalances(prisma, params),
  ])

  const byCode = new Map(accounts.map((account) => [account.code, account]))
  const balance = (code) => byCode.get(code)?.balanceCents ?? 0

  return {
    accounts,
    activity,
    integrity,
    totals: {
      // What buyers actually handed over, from the asset side rather than from
      // order rows: a payment that was later refunded shows in both directions.
      grossCollectedCents: byCode.get(ACCOUNTS.PROCESSOR_CLEARING)?.debitCents ?? 0,
      faceValueCents: balance(ACCOUNTS.ORGANIZER_PAYABLE) + balance(ACCOUNTS.PROMOTIONAL_DISCOUNT),
      discountCents: balance(ACCOUNTS.PROMOTIONAL_DISCOUNT),
      taxPayableCents: balance(ACCOUNTS.TAX_PAYABLE),
      platformFeeRevenueCents: balance(ACCOUNTS.PLATFORM_FEE_REVENUE),
      organizerPayableCents: balance(ACCOUNTS.ORGANIZER_PAYABLE),
      processorFeeCents: balance(ACCOUNTS.PAYMENT_FEE_EXPENSE),
    },
  }
}

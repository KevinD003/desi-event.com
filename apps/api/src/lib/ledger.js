/**
 * Posting a ledger batch, and finding out whether it posted.
 *
 * The composition rules are pure and live in `@desi-event/ledger`. This module
 * is the half that needs a transaction: it resolves account codes to ids, writes
 * a draft, and flips it to `POSTED`.
 *
 * Three properties, in the order they matter:
 *
 *   - **Idempotent.** Every batch carries an `idempotencyKey` derived from the
 *     source event, and the column is unique. A webhook delivered twice, a worker
 *     retried, a saga resumed — all of them attempt the same insert and the
 *     second one loses to the index rather than doubling the money. The loser
 *     returns the existing batch, because "already posted" is a success from the
 *     caller's point of view.
 *   - **Atomic.** Draft and post happen in one transaction. A batch that exists
 *     but never posted is invisible to every report, which is the worst of both
 *     outcomes: the money moved and the ledger does not say so.
 *   - **Refused rather than fixed.** The database's `desi_ledger_batch_balance`
 *     trigger checks the sum again at the moment of posting. If this module and
 *     that trigger ever disagree, the trigger wins and the transaction fails.
 *     That is the intended order: the trigger is true for every writer, and this
 *     module is only true for callers who go through it.
 *
 * @module @desi-event/api/lib/ledger
 */

import { LedgerError } from '@desi-event/ledger'

/**
 * Account ids by code, resolved once per process.
 *
 * The ten accounts are created by a migration and never change, so looking them
 * up on every post would be ten pointless round trips inside a transaction that
 * is holding row locks.
 *
 * @type {Map<string, string>}
 */
const accountIds = new Map()

/**
 * Resolve account codes to ids, caching what it learns.
 *
 * @param {object} db A Prisma client or transaction.
 * @param {string[]} codes The codes needed.
 * @returns {Promise<Map<string, string>>} Code to id.
 * @throws {LedgerError} When a code names no account.
 */
export async function resolveAccounts(db, codes) {
  const wanted = [...new Set(codes)]
  const missing = wanted.filter((code) => !accountIds.has(code))

  if (missing.length > 0) {
    const rows = await db.ledgerAccount.findMany({
      where: { code: { in: missing } },
      select: { id: true, code: true },
    })

    for (const row of rows) accountIds.set(row.code, row.id)
  }

  const resolved = new Map()

  for (const code of wanted) {
    const id = accountIds.get(code)

    if (!id) {
      throw new LedgerError('UNKNOWN_ACCOUNT', `No ledger account row has the code "${code}"`, {
        details: { code },
      })
    }

    resolved.set(code, id)
  }

  return resolved
}

/**
 * Forget the cached account ids.
 *
 * Only for tests, which build and drop databases between cases and would
 * otherwise carry ids from one into the next.
 *
 * @returns {void}
 */
export function resetAccountCache() {
  accountIds.clear()
}

/**
 * Which unique constraint a P2002 violated.
 *
 * Prisma reports this in two different places depending on how it is talking to
 * PostgreSQL. The classic engine fills `meta.target` with the field names; the
 * driver adapter this project uses puts the *index* name deep inside
 * `meta.driverAdapterError.cause.constraint`. Reading only one of them yields an
 * empty list, and an empty list is indistinguishable from "some other
 * constraint" — which is why the caller treats it as a failure rather than a
 * retry.
 *
 * @param {object} error A Prisma error with code P2002.
 * @returns {string[]} Field or index names, lower-cased for comparison.
 */
export function violatedFields(error) {
  const target = error?.meta?.target
  const fromTarget = Array.isArray(target) ? target : [target].filter(Boolean)

  const constraint = error?.meta?.driverAdapterError?.cause?.constraint
  const fromAdapter = [constraint?.index, constraint?.fields, constraint].flat().filter(Boolean)

  return [...fromTarget, ...fromAdapter].filter((value) => typeof value === 'string')
}

/**
 * A stable idempotency key for a source event.
 *
 * Scoped by kind as well as source, because one order legitimately posts more
 * than one batch over its life — paid, then refunded, then corrected — and a key
 * of just the order id would let the second one silently no-op.
 *
 * @param {string} kind The batch kind.
 * @param {string} sourceType What caused it: ORDER, REFUND, DISPUTE, TRANSFER, PAYOUT.
 * @param {string} sourceId The id of that thing.
 * @param {string} [discriminator] A suffix for a source that posts the same kind twice, e.g. a settlement after a decision.
 * @returns {string} The key.
 */
export function ledgerIdempotencyKey(kind, sourceType, sourceId, discriminator = '') {
  return ['ledger', kind, sourceType, sourceId, discriminator].filter(Boolean).join(':')
}

/**
 * Post a composed batch.
 *
 * @param {object} db A Prisma client, or a transaction when the caller has one.
 * @param {object} batch A batch from `@desi-event/ledger`, already balanced.
 * @param {object} context Where it came from and what it concerns.
 * @param {string} context.sourceType ORDER, REFUND, DISPUTE, TRANSFER or PAYOUT.
 * @param {string} context.sourceId The id of that thing.
 * @param {string} context.reference A human-readable reference for reports.
 * @param {string} [context.idempotencyKey] Override the derived key.
 * @param {string} [context.discriminator] Distinguishes two batches of one kind from one source.
 * @param {string|null} [context.actorId] Who posted it. Null means a system job.
 * @param {string|null} [context.orderId] Links, all optional.
 * @param {string|null} [context.paymentId] See above.
 * @param {string|null} [context.refundId] See above.
 * @param {string|null} [context.disputeId] See above.
 * @param {string|null} [context.transferId] See above.
 * @param {string|null} [context.payoutId] See above.
 * @param {string|null} [context.compensatesBatchId] Set only on a CORRECTION.
 * @param {Date} [context.now] The posting time.
 * @returns {Promise<{batch: object, posted: boolean}>} The batch, and whether this call posted it.
 */
export async function postBatch(db, batch, context) {
  const {
    sourceType,
    sourceId,
    reference,
    discriminator = '',
    idempotencyKey = ledgerIdempotencyKey(batch.kind, sourceType, sourceId, discriminator),
    actorId = null,
    now = new Date(),
    ...links
  } = context

  const accounts = await resolveAccounts(
    db,
    batch.entries.map((line) => line.account),
  )

  try {
    // Created as a DRAFT and flipped in the same statement sequence. The
    // database refuses to post an unbalanced batch, so the totals are written
    // from the composed batch rather than recomputed here: if they were wrong,
    // the entries would not add up to them and the trigger would say so.
    const created = await db.ledgerBatch.create({
      data: {
        reference,
        kind: batch.kind,
        status: 'DRAFT',
        currency: batch.currency,
        debitCents: batch.debitCents,
        creditCents: batch.creditCents,
        sourceType,
        sourceId,
        idempotencyKey,
        actorId,
        orderId: links.orderId ?? null,
        paymentId: links.paymentId ?? null,
        refundId: links.refundId ?? null,
        disputeId: links.disputeId ?? null,
        transferId: links.transferId ?? null,
        payoutId: links.payoutId ?? null,
        compensatesBatchId: links.compensatesBatchId ?? null,
        entries: {
          create: batch.entries.map((line) => ({
            accountId: accounts.get(line.account),
            direction: line.direction,
            amountCents: line.amountCents,
            currency: batch.currency,
            memo: line.memo,
            organizationId: line.organizationId ?? null,
          })),
        },
      },
    })

    const posted = await db.ledgerBatch.update({
      where: { id: created.id },
      data: { status: 'POSTED', postedAt: now },
      include: { entries: true },
    })

    return { batch: posted, posted: true }
  } catch (error) {
    if (error?.code !== 'P2002') throw error

    // Which unique index lost matters, and conflating them is a real hazard:
    // `reference` is also unique, and treating a reference collision as "already
    // posted" would return a *different* batch — a caller would carry on
    // believing its money had been recorded when some unrelated batch had been.
    // So only an idempotency-key collision counts as a retry.
    const fields = violatedFields(error)
    const onIdempotencyKey = fields.some((field) => field.includes('idempotencyKey'))

    if (fields.length === 0 || !onIdempotencyKey) {
      throw new LedgerError(
        'ALREADY_POSTED',
        `A ledger batch already uses ${fields.join(', ') || 'a unique value'} — references must be unique`,
        { details: { fields, reference }, cause: error },
      )
    }

    // Somebody else posted it. That is the expected outcome of a retry, and the
    // caller's correct response is to carry on — so the existing batch is
    // returned rather than an error thrown.
    const existing = await db.ledgerBatch.findUnique({
      where: { idempotencyKey },
      include: { entries: true },
    })

    return { batch: existing, posted: false }
  }
}

/**
 * Whether a source event has already posted a batch of a given kind.
 *
 * A read for callers that want to decide *before* doing other work, rather than
 * discovering it from a unique-constraint violation afterwards. Not a substitute
 * for the constraint: two callers can both read "no" at the same moment, which is
 * exactly why `postBatch` is written to lose gracefully.
 *
 * @param {object} db A Prisma client or transaction.
 * @param {string} kind The batch kind.
 * @param {string} sourceType The source type.
 * @param {string} sourceId The source id.
 * @param {string} [discriminator] The discriminator, if any.
 * @returns {Promise<object|null>} The batch, or null.
 */
export function findPostedBatch(db, kind, sourceType, sourceId, discriminator = '') {
  return db.ledgerBatch.findUnique({
    where: { idempotencyKey: ledgerIdempotencyKey(kind, sourceType, sourceId, discriminator) },
    include: { entries: true },
  })
}

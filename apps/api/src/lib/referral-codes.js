/**
 * Referral codes: codes the Desi-Event team hands out that remove the whole
 * booking fee from one order (SPEC3 §8, as SPEC3-XI §8.4 amends the reports).
 *
 * The only writer of `ReferralCode` other than its use count, and of
 * `ReferralCodeEvent` (source scan, SPEC3 §13). The use count is
 * `lib/referral-uses.js`'s alone: a use is taken when an order is placed with
 * the code and given back once when that order ends without being used.
 *
 * ## What a code's text never touches
 *
 * A code is a bearer value worth one order's booking fee. Its text is stored
 * in plain (administrators read it back to re-share it, ADR 0016) and travels
 * only as `referralCode`, in the administrators' own responses. It is never in
 * an audit row (`referralAuditMetadata`; a label is recorded only as
 * `labelSet`/`labelChanged`), a log line, a URL or an outbox row. No log call
 * here is given a code's row.
 *
 * ## Guessing (DR10)
 *
 * {@link evaluateReferral} runs the same queries whatever it finds — a lookup by
 * text (a value that cannot be a code is looked up as one that can never
 * exist), then the scope probe — and answers one `NOT_ACCEPTED` for every
 * reason a code does not apply: unknown, switched off, expired, used up, out of
 * scope, or the caller's own. Only an applicable code is locked, at the charge.
 * The refusal budget (`referralAttemptBudget`) rations the answers that say no.
 *
 * @module @desi-event/api/lib/referral-codes
 */

import { randomInt } from 'node:crypto'

import {
  REFERRAL_ALPHABET,
  REFERRAL_CODE_PATTERN,
  REFERRAL_LIMITS,
  REFERRAL_LIST_EVENTS,
  REFERRAL_PAGE_SIZE,
} from '@desi-event/schemas/payment-terms'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import {
  databaseErrorCode,
  exposedServerError,
  notFound,
  PAYMENT_TERMS_SENTENCES,
  paymentTermsRefusal,
  unprocessable,
} from './errors.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from './transaction-budget.js'

/** A text no code can have (`referral_code_shape` refuses it): what a malformed entry is looked up as. */
const NO_SUCH_TEXT = '-'

/** An id no code can have: what the scope probe is asked with when no code was found. */
const NO_SUCH_ID = 'no-such-referral-code'

/** How many generated codes are drawn before giving up on a run of clashes. */
export const GENERATION_ATTEMPTS = 5

/**
 * How many codes the list, or uses a code's detail, holds at once: fifty
 * (SPEC3 §8.4; `referralCodeDetailResponseSchema` holds no more).
 */
const PAGE_MAX = REFERRAL_PAGE_SIZE

/** The events a list row names, at most (`referralCodeListItemSchema.events`). */
const LISTED_EVENTS = REFERRAL_LIST_EVENTS

/**
 * The events one code's own answer names: every one its scope holds, which a
 * code keeps to fifty (`adminReferralCodeSchema.events`), so a change to its
 * events starts from all of them rather than from the list's three.
 */
const EVERY_EVENT = REFERRAL_LIMITS.maxEvents

/**
 * Where a code stands now. OFF wins, then EXPIRED, then USED_UP (from the uses
 * that count now, so a use given back can make a used-up code usable again,
 * SPEC3-XI XR7).
 *
 * @param {object} row A `ReferralCode` row.
 * @param {Date} now The moment.
 * @returns {'ON'|'OFF'|'EXPIRED'|'USED_UP'} The status.
 */
export function referralStatus(row, now) {
  if (!row.active) return 'OFF'
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) return 'EXPIRED'
  if (row.maxUses !== null && row.maxUses !== undefined && row.useCount >= row.maxUses) {
    return 'USED_UP'
  }

  return 'ON'
}

/**
 * A code as a buyer typed it, normalised the way codes are stored: trimmed and
 * upper-cased. Anything that cannot be a code becomes a text no code has, so
 * it is looked up like any other and found by none.
 *
 * @param {unknown} code What the buyer sent.
 * @returns {string} The text to look up.
 */
function lookupText(code) {
  if (typeof code !== 'string') return NO_SUCH_TEXT

  const trimmed = code.trim()

  // Only printable ASCII is upper-cased: `ı` and `ß` upper-case to ASCII
  // letters and must not be folded into a code they are not.
  if (!/^[\x20-\x7E]*$/u.test(trimmed)) return NO_SUCH_TEXT

  const upper = trimmed.toUpperCase()

  return REFERRAL_CODE_PATTERN.test(upper) && !upper.includes('--') ? upper : NO_SUCH_TEXT
}

/**
 * Whether a code, as read, applies to this order.
 *
 * @param {object|null} row The code, or null.
 * @param {object} context The order.
 * @param {boolean} context.inScope Whether a scope row names the event.
 * @param {object|null} context.actor The buyer.
 * @param {Date} context.now The moment.
 * @returns {boolean} True when it applies.
 */
function applies(row, { inScope, actor, now }) {
  if (!row) return false
  if (referralStatus(row, now) !== 'ON') return false
  if (row.scope === 'SELECTED_EVENTS' && !inScope) return false

  // DR13: an administrator cannot use a code they made.
  if (row.createdById && actor?.id && row.createdById === actor.id) return false

  return true
}

/**
 * Whether a scope row names this event for this code.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} referralCodeId The code's id, or {@link NO_SUCH_ID}.
 * @param {string} eventId The event.
 * @returns {Promise<boolean>} True when one does.
 */
async function scopeNames(db, referralCodeId, eventId) {
  const row = await db.referralCodeEvent.findUnique({
    where: { referralCodeId_eventId: { referralCodeId, eventId } },
    select: { eventId: true },
  })

  return Boolean(row)
}

/**
 * Evaluate a referral code for a checkout (SPEC3 §8.2).
 *
 * The same two queries run whatever the lookup finds: the code by its text,
 * then the scope probe with the found id or one no code has. Only when the
 * code applies and `lock` is set (the charge) is its row locked — after the
 * tiers, nights, holds and promo code, before the venue-booking advisory lock
 * (SPEC3-XI §2.1 row 10) — read again and decided again, so a code with one use
 * left is applied once however many buyers race for it.
 *
 * @param {object} db A Prisma transaction client (or client, for an unlocked read).
 * @param {object} params Inputs.
 * @param {string} params.code The code as the buyer sent it.
 * @param {{id: string}} params.event The event being bought into.
 * @param {object|null} params.actor The buyer.
 * @param {Date} params.now The moment.
 * @param {boolean} params.lock Whether to lock and re-read an applicable code.
 * @returns {Promise<{row: object|null, applicable: boolean, reason: null|'NOT_ACCEPTED'}>} The code when it applies; one reason for every refusal.
 */
export async function evaluateReferral(db, { code, event, actor, now, lock }) {
  let row = await db.referralCode.findUnique({ where: { code: lookupText(code) } })
  let inScope = await scopeNames(db, row?.id ?? NO_SUCH_ID, event.id)
  let applicable = applies(row, { inScope, actor, now })

  if (applicable && lock) {
    // NO KEY UPDATE: an order's foreign-key check takes this row FOR KEY SHARE
    // and must never wait on it (SPEC3-XI §2.1); the count still serialises.
    await db.$queryRaw`SELECT "id" FROM "ReferralCode" WHERE "id" = ${row.id} FOR NO KEY UPDATE`

    // Read again under the lock: another checkout, an edit or a switch-off
    // may have committed meanwhile.
    row = await db.referralCode.findUnique({ where: { id: row.id } })
    inScope = await scopeNames(db, row?.id ?? NO_SUCH_ID, event.id)
    applicable = applies(row, { inScope, actor, now })
  }

  return applicable
    ? { row, applicable: true, reason: null }
    : { row: null, applicable: false, reason: 'NOT_ACCEPTED' }
}

/**
 * A new code's text: two groups of five from the alphabet without 0, O, 1, I
 * or L, drawn with `crypto.randomInt`.
 *
 * @returns {string} The text, e.g. `K7HQ2-PX9WM`.
 */
export function generateReferralCode() {
  const group = () =>
    Array.from({ length: 5 }, () => REFERRAL_ALPHABET[randomInt(REFERRAL_ALPHABET.length)]).join('')

  return `${group()}-${group()}`
}

/**
 * What an audit row may say about a code: ids, the scope, the expiry, the
 * limit and whether it is on. Never its text and never its label.
 *
 * @param {object} row A `ReferralCode` row.
 * @returns {object} The metadata.
 */
export function referralAuditMetadata(row) {
  return {
    referralCodeId: row.id,
    scope: row.scope,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    maxUses: row.maxUses ?? null,
    active: row.active,
  }
}

/**
 * Refuse events a code may not name: one that does not exist, or a deleted one
 * (DR6). Asked of events being added to a scope only: an event deleted after
 * it was named stays in the scope and sells nothing.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string[]} eventIds The events being added.
 * @returns {Promise<void>} Resolves when all may be named.
 * @throws {Error} 422 `REFERRAL_EVENT_NOT_ELIGIBLE`, naming them.
 */
async function assertEligibleEvents(db, eventIds) {
  if (eventIds.length === 0) return

  const found = await db.event.findMany({
    where: { id: { in: eventIds } },
    select: { id: true, status: true },
  })
  const eligible = new Set(found.filter((row) => row.status !== 'DELETED').map((row) => row.id))
  const refused = eventIds.filter((id) => !eligible.has(id))

  if (refused.length > 0) {
    throw paymentTermsRefusal('REFERRAL_EVENT_NOT_ELIGIBLE', { details: { eventIds: refused } })
  }
}

/**
 * Refuse an expiry that is not in the future.
 *
 * @param {string|Date|null|undefined} expiresAt The expiry.
 * @param {Date} now The moment.
 * @returns {void}
 * @throws {Error} 422.
 */
function assertFutureExpiry(expiresAt, now) {
  if (expiresAt === undefined || expiresAt === null) return

  if (new Date(expiresAt).getTime() <= now.getTime()) {
    throw unprocessable('Choose an expiry in the future, or none.', { field: 'expiresAt' })
  }
}

/**
 * Make a referral code (SPEC3 §8.1): typed or generated, its scope, expiry and
 * limit. A generated code that clashes with one already made is drawn again,
 * up to {@link GENERATION_ATTEMPTS} times; each attempt is its own transaction,
 * since a refused insert ends the transaction it is in.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} params Inputs.
 * @param {object} params.body The request: `referralCode` or `generate`, `label?`, `scope`, `eventIds?`, `expiresAt?`, `maxUses?`.
 * @param {{id: string}} params.actor The administrator.
 * @param {Date} params.now The moment.
 * @param {string|null} [params.requestId] For the audit row.
 * @returns {Promise<object>} The new row.
 * @throws {Error} 409 `REFERRAL_CODE_TAKEN`; 422 `REFERRAL_EVENT_NOT_ELIGIBLE` or a past expiry; 503 `TRY_AGAIN` after a run of clashing generated codes.
 */
export async function createReferralCode(prisma, { body, actor, now, requestId = null }) {
  assertFutureExpiry(body.expiresAt, now)

  const generated = body.generate === true
  const eventIds = body.scope === 'SELECTED_EVENTS' ? [...(body.eventIds ?? [])] : []
  const attempts = generated ? GENERATION_ATTEMPTS : 1

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const text = generated ? generateReferralCode() : body.referralCode

    try {
      return await prisma.$transaction(async (tx) => {
        await assertEligibleEvents(tx, eventIds)

        const row = await tx.referralCode.create({
          data: {
            code: text,
            label: body.label ?? null,
            scope: body.scope,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            maxUses: body.maxUses ?? null,
            active: true,
            createdById: actor.id,
            updatedById: actor.id,
          },
        })

        for (const eventId of eventIds) {
          await tx.referralCodeEvent.create({ data: { referralCodeId: row.id, eventId } })
        }

        await recordAudit(tx, {
          action: AUDIT_ACTIONS.REFERRAL_CODE_CREATED,
          entityType: 'ReferralCode',
          entityId: row.id,
          actorId: actor.id,
          metadata: {
            referralCodeId: row.id,
            generated,
            scope: row.scope,
            eventIds: [...eventIds].sort(),
            expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
            maxUses: row.maxUses ?? null,
            labelSet: Boolean(row.label),
            requestId,
          },
        })

        return row
      })
    } catch (error) {
      if (databaseErrorCode(error) !== 'P2002') throw error
      if (!generated) throw paymentTermsRefusal('REFERRAL_CODE_TAKEN')
    }
  }

  throw exposedServerError(
    503,
    'TRY_AGAIN',
    'The generated codes were already in use, so no code was made. Try again in a moment.',
  )
}

/**
 * Lock a code's row and read it, for a change that decides from what it reads.
 *
 * @param {object} tx A transaction client.
 * @param {string} id The code's id.
 * @returns {Promise<object>} The row, with its scope rows.
 * @throws {Error} 404 for no such code.
 */
/**
 * How long an edit or a switch of a code may wait behind another change to it
 * (a checkout using it, a refund or cancellation giving a use back), and what
 * the administrator is told when it waited too long: a 503 with `Retry-After`,
 * nothing changed (final door review, finding 2).
 */
const REFERRAL_CODE_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal: PAYMENT_TERMS_SENTENCES.referralCodeTryAgain,
})

async function lockedCode(tx, id) {
  // NO KEY UPDATE, like every lock on a row orders reference (SPEC3-XI §2.1).
  await tx.$queryRaw`SELECT "id" FROM "ReferralCode" WHERE "id" = ${id} FOR NO KEY UPDATE`

  const row = await tx.referralCode.findUnique({ where: { id }, include: { events: true } })

  if (!row) throw notFound('No such referral code.')

  return row
}

/**
 * An instant as the audit row and the comparison read it.
 *
 * @param {Date|string|null|undefined} value The instant.
 * @returns {string|null} ISO 8601, or null.
 */
function iso(value) {
  return value ? new Date(value).toISOString() : null
}

/**
 * Change a code's label, scope, expiry or limit (SPEC3 §8.1). Its text never
 * changes. The row is locked, so an edit and a checkout using the code take
 * turns; orders already placed keep their waiver.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.id The code.
 * @param {object} params.body The request: any of `label`, `scope`, `eventIds`, `expiresAt`, `maxUses`, and `expectedUpdatedAt`.
 * @param {{id: string}} params.actor The administrator.
 * @param {Date} params.now The moment.
 * @param {string|null} [params.requestId] For the audit row.
 * @returns {Promise<object>} The row after the change.
 * @throws {Error} 404; 409 `REFERRAL_CODE_CHANGED`; 422 `REFERRAL_LIMIT_BELOW_USES`, `REFERRAL_EVENT_NOT_ELIGIBLE`, a past expiry, or events named for a code for all events; 503 when it waited too long.
 */
export function updateReferralCode(prisma, { id, body, actor, now, requestId = null }) {
  return budgetedTransaction(prisma, REFERRAL_CODE_BUDGET, async (tx) => {
    const row = await lockedCode(tx, id)

    if (new Date(row.updatedAt).getTime() !== new Date(body.expectedUpdatedAt).getTime()) {
      throw paymentTermsRefusal('REFERRAL_CODE_CHANGED')
    }

    const nextScope = body.scope ?? row.scope

    if (nextScope === 'ALL_EVENTS' && body.eventIds !== undefined) {
      throw unprocessable('A code for all events names no events.', { field: 'eventIds' })
    }

    const currentIds = row.events.map((scope) => scope.eventId).sort()
    const nextIds = nextScope === 'ALL_EVENTS' ? [] : [...(body.eventIds ?? currentIds)].sort()

    if (nextScope === 'SELECTED_EVENTS' && nextIds.length === 0) {
      throw unprocessable('Choose at least one event.', { field: 'eventIds' })
    }

    const added = nextIds.filter((eventId) => !currentIds.includes(eventId))
    const removed = currentIds.filter((eventId) => !nextIds.includes(eventId))

    await assertEligibleEvents(tx, added)

    if (body.expiresAt !== undefined) assertFutureExpiry(body.expiresAt, now)

    if (body.maxUses !== undefined && body.maxUses !== null && body.maxUses < row.useCount) {
      throw paymentTermsRefusal('REFERRAL_LIMIT_BELOW_USES', { values: { n: row.useCount } })
    }

    /** @type {Record<string, {from: unknown, to: unknown}>} */
    const changes = {}
    const data = {}

    if (nextScope !== row.scope) {
      changes.scope = { from: row.scope, to: nextScope }
      data.scope = nextScope
    }

    if (added.length > 0 || removed.length > 0) {
      changes.eventIds = { from: currentIds, to: nextIds }
    }

    if (body.expiresAt !== undefined && iso(body.expiresAt) !== iso(row.expiresAt)) {
      changes.expiresAt = { from: iso(row.expiresAt), to: iso(body.expiresAt) }
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    }

    if (body.maxUses !== undefined && (body.maxUses ?? null) !== (row.maxUses ?? null)) {
      changes.maxUses = { from: row.maxUses ?? null, to: body.maxUses ?? null }
      data.maxUses = body.maxUses ?? null
    }

    const labelChanged = body.label !== undefined && (body.label ?? null) !== (row.label ?? null)

    if (labelChanged) data.label = body.label ?? null

    // Nothing differs from what is stored: nothing to write, nothing to audit.
    if (Object.keys(changes).length === 0 && !labelChanged) return row

    if (removed.length > 0) {
      await tx.referralCodeEvent.deleteMany({
        where: { referralCodeId: row.id, eventId: { in: removed } },
      })
    }

    for (const eventId of added) {
      await tx.referralCodeEvent.create({ data: { referralCodeId: row.id, eventId } })
    }

    const updated = await tx.referralCode.update({
      where: { id: row.id },
      data: { ...data, updatedById: actor.id },
    })

    await recordAudit(tx, {
      action: AUDIT_ACTIONS.REFERRAL_CODE_UPDATED,
      entityType: 'ReferralCode',
      entityId: row.id,
      actorId: actor.id,
      metadata: {
        referralCodeId: row.id,
        changes,
        ...(labelChanged ? { labelChanged: true } : {}),
        requestId,
      },
    })

    return updated
  })
}

/**
 * Switch a code off or back on (SPEC3 §8.1). Idempotent: a code already in
 * the asked state is returned as it is, with no second audit row. A code whose
 * expiry has passed is not switched back on.
 *
 * @param {object} prisma The Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.id The code.
 * @param {boolean} params.active On (true) or off (false).
 * @param {string|null} [params.reason] Why it was switched off, 10 to 500 characters.
 * @param {{id: string}} params.actor The administrator.
 * @param {Date} params.now The moment.
 * @param {string|null} [params.requestId] For the audit row.
 * @returns {Promise<object>} The row as it now stands.
 * @throws {Error} 404; 409 `REFERRAL_CODE_EXPIRED`; 503 when it waited too long.
 */
export function switchReferralCode(
  prisma,
  { id, active, reason = null, actor, now, requestId = null },
) {
  return budgetedTransaction(prisma, REFERRAL_CODE_BUDGET, async (tx) => {
    const row = await lockedCode(tx, id)

    if (row.active === active) return row

    if (active && row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
      throw paymentTermsRefusal('REFERRAL_CODE_EXPIRED')
    }

    const updated = await tx.referralCode.update({
      where: { id: row.id },
      data: { active, switchedOffAt: active ? null : now, updatedById: actor.id },
    })

    await recordAudit(tx, {
      action: active
        ? AUDIT_ACTIONS.REFERRAL_CODE_SWITCHED_ON
        : AUDIT_ACTIONS.REFERRAL_CODE_SWITCHED_OFF,
      entityType: 'ReferralCode',
      entityId: row.id,
      actorId: actor.id,
      metadata: active
        ? { referralCodeId: row.id, requestId }
        : { referralCodeId: row.id, reason: reason ?? null, requestId },
    })

    return updated
  })
}

/**
 * What a set of codes' orders came to (SPEC3-XI §8.4): orders placed with each
 * (`usesPlaced`), those that gave their use back (`usesReturned`), and the
 * booking fee current uses waived on PAID orders, per currency. Waived amounts
 * come from the orders, not from the ledger: a waived fee was never charged.
 *
 * @param {object} db A Prisma client.
 * @param {string[]} codeIds The codes.
 * @returns {Promise<Map<string, {usesPlaced: number, usesReturned: number, waived: Array<{currency: string, cents: number}>}>>} By code id.
 */
export async function referralCodeStats(db, codeIds) {
  /** @type {Map<string, {usesPlaced: number, usesReturned: number, waived: Array<{currency: string, cents: number}>}>} */
  const stats = new Map(codeIds.map((id) => [id, { usesPlaced: 0, usesReturned: 0, waived: [] }]))

  if (codeIds.length === 0) return stats

  const [placed, returned, waived] = await Promise.all([
    db.order.groupBy({
      by: ['referralCodeId'],
      where: { referralCodeId: { in: codeIds } },
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ['referralCodeId'],
      where: { referralCodeId: { in: codeIds }, referralUseReturnedAt: { not: null } },
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ['referralCodeId', 'currency'],
      where: { referralCodeId: { in: codeIds }, referralUseReturnedAt: null, status: 'PAID' },
      _sum: { feeWaivedCents: true },
    }),
  ])

  for (const group of placed) stats.get(group.referralCodeId).usesPlaced = group._count._all
  for (const group of returned) stats.get(group.referralCodeId).usesReturned = group._count._all

  for (const group of waived) {
    const cents = group._sum?.feeWaivedCents ?? 0

    if (cents > 0) stats.get(group.referralCodeId).waived.push({ currency: group.currency, cents })
  }

  for (const entry of stats.values()) {
    entry.waived.sort((left, right) => (left.currency < right.currency ? -1 : 1))
  }

  return stats
}

/**
 * The events each code names, oldest first, up to `shown` of each, with their
 * count.
 *
 * @param {object} db A Prisma client.
 * @param {string[]} codeIds The codes.
 * @param {number} shown How many of each code's events to name: a list row's
 *   {@link LISTED_EVENTS}, or one code's {@link EVERY_EVENT}.
 * @returns {Promise<Map<string, {events: object[], eventCount: number}>>} By code id.
 */
async function scopedEvents(db, codeIds, shown) {
  const rows =
    codeIds.length === 0
      ? []
      : await db.referralCodeEvent.findMany({
          where: { referralCodeId: { in: codeIds } },
          orderBy: [{ addedAt: 'asc' }, { eventId: 'asc' }],
          include: { event: { select: { id: true, title: true, slug: true, status: true } } },
        })
  const byCode = new Map(codeIds.map((id) => [id, { events: [], eventCount: 0 }]))

  for (const row of rows) {
    const entry = byCode.get(row.referralCodeId)

    entry.eventCount += 1

    if (entry.events.length < shown && row.event) {
      entry.events.push({
        id: row.event.id,
        title: row.event.title,
        slug: row.event.slug,
        status: row.event.status,
      })
    }
  }

  return byCode
}

/**
 * A code as platform administrators manage it (`adminReferralCodeSchema`). Its
 * text is `referralCode`, never `code`.
 *
 * @param {object} row A `ReferralCode` row, with `createdBy` when loaded.
 * @param {object} options Options.
 * @param {Date} options.now The moment, for the status.
 * @param {{usesPlaced: number, usesReturned: number, waived: object[]}} [options.stats] Its orders' figures.
 * @param {{events: object[], eventCount: number}} [options.scope] The events it names.
 * @returns {object} The payload.
 */
export function toAdminReferralCode(row, { now, stats, scope }) {
  return {
    id: row.id,
    referralCode: row.code,
    label: row.label ?? null,
    scope: row.scope,
    events: scope?.events ?? [],
    eventCount: Math.min(scope?.eventCount ?? 0, REFERRAL_LIMITS.maxEvents),
    expiresAt: iso(row.expiresAt),
    maxUses: row.maxUses ?? null,
    useCount: row.useCount,
    usesPlaced: stats?.usesPlaced ?? 0,
    usesReturned: stats?.usesReturned ?? 0,
    waived: stats?.waived ?? [],
    status: referralStatus(row, now),
    active: row.active,
    createdBy: row.createdBy
      ? { id: row.createdBy.id, displayName: row.createdBy.displayName }
      : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  }
}

/** What a code is read with for its administrators' view. */
const CODE_INCLUDE = Object.freeze({ createdBy: { select: { id: true, displayName: true } } })

/**
 * Codes as administrators read them, with their figures and events.
 *
 * @param {object} db A Prisma client.
 * @param {object[]} rows The rows, with `createdBy`.
 * @param {Date} now The moment.
 * @param {number} shown How many of each code's events to name (see {@link scopedEvents}).
 * @returns {Promise<object[]>} The payloads, in the rows' order.
 */
async function presentCodes(db, rows, now, shown) {
  const ids = rows.map((row) => row.id)
  const [stats, scopes] = await Promise.all([
    referralCodeStats(db, ids),
    scopedEvents(db, ids, shown),
  ])

  return rows.map((row) =>
    toAdminReferralCode(row, { now, stats: stats.get(row.id), scope: scopes.get(row.id) }),
  )
}

/**
 * One code as administrators read it, naming every event of its scope.
 *
 * @param {object} db A Prisma client.
 * @param {string} id The code.
 * @param {Date} now The moment.
 * @returns {Promise<object>} The payload.
 * @throws {Error} 404 for no such code.
 */
export async function adminReferralCode(db, id, now) {
  const row = await db.referralCode.findUnique({ where: { id }, include: CODE_INCLUDE })

  if (!row) throw notFound('No such referral code.')

  const [shown] = await presentCodes(db, [row], now, EVERY_EVENT)

  return shown
}

/**
 * The administrators' list (SPEC3 §8.4): newest first, filtered by status, by
 * the administrator who made it and by an event it works for (a code for all
 * events works for every event). Never by its text.
 *
 * ON and USED_UP depend on a code's uses against its limit, which a filter on
 * one row cannot compare, so those two are filtered here over the codes that
 * are on and unexpired; codes are made by hand, a few hundred at most.
 *
 * @param {object} db A Prisma client.
 * @param {object} query The parsed query: `page`, `perPage`, `status?`, `creatorId?`, `eventId?`.
 * @param {Date} now The moment.
 * @returns {Promise<{data: object[], total: number}>} The page and how many match.
 */
export async function listReferralCodes(db, query, now) {
  const page = query.page ?? 1
  const perPage = Math.min(query.perPage ?? PAGE_MAX, PAGE_MAX)
  const conditions = []

  if (query.creatorId) conditions.push({ createdById: query.creatorId })

  if (query.eventId) {
    conditions.push({
      OR: [{ scope: 'ALL_EVENTS' }, { events: { some: { eventId: query.eventId } } }],
    })
  }

  if (query.status === 'OFF') conditions.push({ active: false })

  // An expiry that has passed; a code with none never expires.
  if (query.status === 'EXPIRED') {
    conditions.push({ active: true, expiresAt: { not: null, lte: now } })
  }

  if (query.status === 'ON' || query.status === 'USED_UP') {
    conditions.push({ active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] })
  }

  const where = { AND: conditions }
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }]

  if (query.status === 'ON' || query.status === 'USED_UP') {
    const candidates = await db.referralCode.findMany({ where, orderBy, include: CODE_INCLUDE })
    const matching = candidates.filter((row) => referralStatus(row, now) === query.status)
    const pageRows = matching.slice((page - 1) * perPage, page * perPage)

    return { data: await presentCodes(db, pageRows, now, LISTED_EVENTS), total: matching.length }
  }

  const [rows, total] = await Promise.all([
    db.referralCode.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      include: CODE_INCLUDE,
    }),
    db.referralCode.count({ where }),
  ])

  return { data: await presentCodes(db, rows, now, LISTED_EVENTS), total }
}

/**
 * One order placed with a code, as the code's detail lists it: never the
 * buyer's name, address or account (SPEC3 §8.4), and with when and why it
 * gave its use back (SPEC3-XI §8.4).
 *
 * @param {object} order An `Order` row with `event.title`.
 * @returns {object} A `referralUseSchema` payload.
 */
export function toReferralUse(order) {
  return {
    orderReference: order.reference,
    eventId: order.eventId,
    eventTitle: order.event?.title ?? '',
    placedAt: iso(order.createdAt),
    paymentMethod: order.paymentMethod,
    orderStatus: order.status,
    feeWaivedCents: order.feeWaivedCents ?? 0,
    currency: order.currency,
    useReturned: order.referralUseReturnedAt
      ? { at: iso(order.referralUseReturnedAt), cause: order.referralUseReturnCause }
      : null,
  }
}

/**
 * A code and a page of the orders placed with it, newest first.
 *
 * @param {object} db A Prisma client.
 * @param {string} id The code.
 * @param {{page?: number, perPage?: number}} query The page asked for (at most fifty a page).
 * @param {Date} now The moment.
 * @returns {Promise<{data: object, page: number, perPage: number, total: number}>} The code with its uses, and the page's figures.
 * @throws {Error} 404 for no such code.
 */
export async function referralCodeDetail(db, id, query, now) {
  const code = await adminReferralCode(db, id, now)
  const page = query.page ?? 1
  const perPage = Math.min(query.perPage ?? PAGE_MAX, PAGE_MAX)
  const where = { referralCodeId: id }
  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        reference: true,
        eventId: true,
        createdAt: true,
        paymentMethod: true,
        status: true,
        feeWaivedCents: true,
        currency: true,
        referralUseReturnedAt: true,
        referralUseReturnCause: true,
        event: { select: { title: true } },
      },
    }),
    db.order.count({ where }),
  ])

  return { data: { ...code, uses: orders.map(toReferralUse) }, page, perPage, total }
}

/**
 * Codes by the administrator who made them (SPEC3-XI §8.4): how many codes,
 * the orders placed with them, the uses given back, the uses that count now,
 * and the booking fees current uses waived on PAID orders, per currency. One
 * row has no administrator: codes whose maker's account is gone.
 *
 * @param {object} db A Prisma client.
 * @returns {Promise<object[]>} `referralAdministratorRowSchema` payloads, most codes first.
 */
export async function referralCodesByAdministrator(db) {
  const codes = await db.referralCode.findMany({
    select: { id: true, createdById: true, useCount: true, createdBy: CODE_INCLUDE.createdBy },
  })
  const stats = await referralCodeStats(
    db,
    codes.map((code) => code.id),
  )
  /** @type {Map<string, object>} */
  const rows = new Map()

  for (const code of codes) {
    const key = code.createdBy ? code.createdBy.id : ''
    const row = rows.get(key) ?? {
      administrator: code.createdBy
        ? { id: code.createdBy.id, displayName: code.createdBy.displayName }
        : null,
      codes: 0,
      usesPlaced: 0,
      usesReturned: 0,
      currentUses: 0,
      waivedBy: new Map(),
    }
    const figures = stats.get(code.id)

    row.codes += 1
    row.usesPlaced += figures.usesPlaced
    row.usesReturned += figures.usesReturned
    row.currentUses += code.useCount

    for (const { currency, cents } of figures.waived) {
      row.waivedBy.set(currency, (row.waivedBy.get(currency) ?? 0) + cents)
    }

    rows.set(key, row)
  }

  return [...rows.values()]
    .map(({ waivedBy, ...row }) => ({
      ...row,
      waived: [...waivedBy.entries()]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([currency, cents]) => ({ currency, cents })),
    }))
    .sort(
      (left, right) =>
        right.codes - left.codes ||
        (left.administrator?.displayName ?? '').localeCompare(
          right.administrator?.displayName ?? '',
        ),
    )
}

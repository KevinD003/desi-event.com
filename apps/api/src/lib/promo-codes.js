/**
 * Promo codes as an organiser manages them.
 *
 * A code's status is not a column: it is what its row and the clock say
 * together — paused by the organiser, not started yet, over, used up, or live.
 * Computing it in one pure function means the list, the filter and the
 * resume refusal cannot disagree about what "ended" means.
 *
 * @module @desi-event/api/lib/promo-codes
 */

import { unprocessable } from './errors.js'

/**
 * What a code is doing at a moment.
 *
 * `PAUSED` wins over everything, because it is the organiser's own choice and
 * the thing they would undo; then `ENDED` and `USED_UP`, which no resume can
 * undo; then `SCHEDULED` for a window not yet open. The window is start
 * inclusive and end exclusive, exactly as checkout judges it.
 *
 * @param {object} row A `PromoCode` row.
 * @param {Date} now The moment.
 * @returns {'ACTIVE'|'PAUSED'|'SCHEDULED'|'ENDED'|'USED_UP'} The status.
 */
export function promoStatus(row, now) {
  const at = now.getTime()

  if (!row.active) return 'PAUSED'
  if (row.endsAt && at >= new Date(row.endsAt).getTime()) return 'ENDED'
  if (row.maxRedemptions != null && row.redemptionCount >= row.maxRedemptions) return 'USED_UP'
  if (row.startsAt && at < new Date(row.startsAt).getTime()) return 'SCHEDULED'

  return 'ACTIVE'
}

/**
 * Whether a code's window has closed for good.
 *
 * @param {object} row A `PromoCode` row.
 * @param {Date} now The moment.
 * @returns {boolean} True when `endsAt` has passed.
 */
export function promoHasEnded(row, now) {
  return Boolean(row.endsAt) && now.getTime() >= new Date(row.endsAt).getTime()
}

/**
 * A code as its organisation sees it.
 *
 * @param {object} row A `PromoCode` row, optionally with `event` and `_count.orders`.
 * @param {object} [options] Options.
 * @param {Date} [options.now] The moment its status is computed at.
 * @returns {object} A payload satisfying `organiserPromoCodeSchema`.
 */
export function toOrganiserPromoCode(row, { now = new Date() } = {}) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    eventId: row.eventId ?? null,
    code: row.code,
    type: row.type,
    value: row.value,
    currency: row.currency ?? null,
    maxRedemptions: row.maxRedemptions ?? null,
    redemptionCount: row.redemptionCount ?? 0,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    active: Boolean(row.active),
    createdAt: row.createdAt,
    status: promoStatus(row, now),
    event: row.event ? { id: row.event.id, slug: row.event.slug, title: row.event.title } : null,
    ordersCount: row._count?.orders ?? 0,
  }
}

/**
 * The audit metadata for a code write: its terms and window, never its text.
 *
 * The code itself is a bearer discount: whoever reads it can use it, so it
 * does not go where an audit reader, a log or an export would find it.
 *
 * @param {object} row A `PromoCode` row.
 * @returns {object} Metadata safe to record.
 */
export function promoAuditMetadata(row) {
  return {
    promoCodeId: row.id,
    organizationId: row.organizationId,
    eventId: row.eventId ?? null,
    type: row.type,
    value: row.value,
    currency: row.currency ?? null,
    maxRedemptions: row.maxRedemptions ?? null,
    startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
  }
}

/**
 * Refuse a new code whose terms cannot work.
 *
 * A window that has already ended would make a code nobody can use; a fixed
 * amount for one event must be in a currency that event sells in, or checkout
 * would never apply it.
 *
 * @param {object} body The parsed create request.
 * @param {object} context Context.
 * @param {Date} context.now The moment.
 * @param {string[]|null} context.eventCurrencies The currencies the scoped event's tiers are priced in, or null for an organisation-wide code.
 * @returns {void}
 * @throws {Error} A 422 naming the problem.
 */
export function assertPromoTermsUsable(body, { now, eventCurrencies }) {
  if (body.endsAt && new Date(body.endsAt).getTime() <= now.getTime()) {
    throw unprocessable('That window has already ended. Choose an end in the future.', {
      field: 'endsAt',
    })
  }

  if (
    body.type === 'FIXED_AMOUNT' &&
    Array.isArray(eventCurrencies) &&
    eventCurrencies.length > 0 &&
    !eventCurrencies.includes(body.currency)
  ) {
    throw unprocessable(
      `That event sells in ${eventCurrencies.join(', ')}, so a fixed amount off must be in ${eventCurrencies.length === 1 ? 'that currency' : 'one of those'}.`,
      { field: 'currency', eventCurrencies },
    )
  }
}

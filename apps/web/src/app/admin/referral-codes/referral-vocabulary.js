/**
 * What the referral-code pages say, and the pure rules behind their forms
 * (SPEC3 §12.5, SPEC3-XI §12.5).
 *
 * A referral code removes the whole booking fee (the platform fee) from one
 * order, and any tax charged on that fee, and nothing else. The Desi-Event
 * team's platform administrators make them, change them and switch them off;
 * nobody is paid for referrals.
 *
 * ## Where a code's text is, and where it never is
 *
 * In the API's answers to `referral_code:manage` sessions, on these pages, and
 * on a clipboard when an administrator presses "Copy code" — never in a web
 * address, browser storage, a log or an analytics event. The list is filtered
 * by status, maker and event in the address; finding a code by its text is done
 * in the browser, over the page already drawn.
 *
 * Pure: the server pages, the client forms and their tests all read it.
 *
 * @module app/admin/referral-codes/referral-vocabulary
 */

import {
  PAYMENT_TERMS_MESSAGES,
  REFERRAL_LIMITS,
  REFERRAL_STATUSES,
  referralCodeStringSchema,
} from '@desi-event/schemas/payment-terms'

import { formatAmount } from '../../../lib/pricing.js'
import { fromLocalInputValue, toLocalInputValue } from '../../../lib/zoned-time.js'

/** The stacked-table classes: cards below `sm`, a table from `sm` up. */
export const STACKED = Object.freeze({
  table: 'block w-full border-collapse text-sm sm:table',
  thead: 'sr-only sm:not-sr-only sm:table-header-group',
  tbody: 'block space-y-3 sm:table-row-group sm:space-y-0',
  row: 'block rounded-card border border-line bg-surface-raised p-3 shadow-card sm:table-row sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none',
  th: 'border-b border-line-strong px-3 py-2 text-left font-semibold text-ink',
  cell: 'flex flex-wrap justify-between gap-x-3 gap-y-1 py-1 text-ink sm:table-cell sm:border-b sm:border-line sm:px-3 sm:py-2 sm:align-top',
  label: 'font-medium text-ink-muted sm:hidden',
})

/** The list page's path. */
export const REFERRAL_CODES_PATH = '/admin/referral-codes'

/** What the list page says about referral codes first (SPEC3 §12.5). */
export const INTRODUCTION =
  'A referral code removes the whole booking fee from one order, and any tax charged on that fee. It never changes the ticket price or the tax on it. Anyone who has the code can use it.'

/** The note under the list (SPEC3-XI §12.5). */
export const LIST_NOTE =
  'Uses count orders placed with the code. When an order is refunded in full or cancelled, its use is given back, once. Nobody is paid for referrals.'

/** What the list says when there are no codes at all. */
export const EMPTY_LIST = 'There are no referral codes. Make one to hand to a partner or a guest.'

/** What the list says when the filters leave nothing. */
export const EMPTY_FILTERED = 'No referral code matches these filters.'

/** What "Find on this page" says when nothing on the page matches. */
export const NO_MATCH = 'No code on this page matches.'

/** What a code's detail says when no order used it. */
export const NO_USES = 'No order has used this code.'

/** What the page says after a code is made, beside the code. */
export const GIVE_ONLY_TO = 'Give this code only to the people it is for.'

/** What a session without `referral_code:manage` is told. */
export const NOT_FOR_THIS_ACCOUNT =
  'Referral codes are made and managed by the Desi-Event team’s platform administrators. Nothing on this page can grant it.'

/** The typed code's hint. */
export const TYPED_CODE_HINT =
  '6 to 32 letters, numbers or single hyphens. Short or common words are easy to guess.'

/** The limit's hint. */
export const LIMIT_HINT = 'How many orders can use it in all.'

/** Who made a code whose maker's account is gone. */
export const FORMER_ADMINISTRATOR = 'A former administrator'

/**
 * How each status reads, as a word and a tone (never colour alone).
 *
 * @type {Readonly<Record<string, {label: string, tone: string}>>}
 */
export const STATUS_WORDS = Object.freeze({
  ON: { label: 'On', tone: 'success' },
  OFF: { label: 'Off', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'warning' },
  USED_UP: { label: 'Used up', tone: 'info' },
})

/** The status filter's options, "Any status" first. */
export const STATUS_FILTERS = Object.freeze([
  { value: '', label: 'Any status' },
  ...REFERRAL_STATUSES.map((status) => ({ value: status, label: STATUS_WORDS[status].label })),
])

/**
 * Why an order gave its use back, in words (SPEC3-XI §12.5).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const RETURN_CAUSE_WORDS = Object.freeze({
  PAYMENT_FAILED: 'Payment did not go through',
  NOT_COMPLETED: 'Booking could not be completed',
  UNPAID_ORDER_CANCELLED: 'Not paid; cancelled',
  REFUNDED: 'Refunded in full',
  VENUE_UNPAID_CANCELLED: 'Unpaid tickets cancelled',
  EVENT_CANCELLED: 'Event cancelled',
  EVENT_DELETED: 'Event deleted',
  SESSION_CANCELLED: 'Night cancelled',
  TICKETS_REVOKED: 'Tickets withdrawn',
})

/** How an order was paid, in words. */
export const PAYMENT_METHOD_WORDS = Object.freeze({ CARD: 'Card', AT_VENUE: 'At the venue' })

/** The shape of an id the API takes as a filter. */
const ID_PATTERN = /^[a-z][a-z0-9]{7,39}$/u

/** How a day is written in the lists: in UTC, as the admin lists write it. */
const DAY = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

/**
 * A count, with thousands separators.
 *
 * @param {number} value The count.
 * @returns {string} "1,250".
 */
function count(value) {
  return Number(value ?? 0).toLocaleString('en-US')
}

/**
 * A day, in words, or null.
 *
 * @param {string|null|undefined} value An ISO instant.
 * @returns {string|null} "Oct 12, 2026", or null.
 */
export function dayWords(value) {
  if (!value) return null

  const at = new Date(value)

  return Number.isNaN(at.getTime()) ? null : DAY.format(at)
}

/**
 * The filters the list reads from its address, each dropped when the API
 * would refuse it. Never a code's text: that stays out of addresses.
 *
 * @param {Record<string, unknown>} [query] The query string.
 * @returns {{status?: string, creatorId?: string, eventId?: string, page: number}} The filters.
 */
export function readListFilters(query = {}) {
  const page = Number(query.page)

  return {
    status: REFERRAL_STATUSES.includes(query.status) ? query.status : undefined,
    creatorId:
      typeof query.creatorId === 'string' && ID_PATTERN.test(query.creatorId)
        ? query.creatorId
        : undefined,
    eventId:
      typeof query.eventId === 'string' && ID_PATTERN.test(query.eventId)
        ? query.eventId
        : undefined,
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  }
}

/**
 * Which events a code works for, in words: "All events", the one event's
 * title, or "{n} events".
 *
 * @param {object} code The code.
 * @returns {string} The words.
 */
export function worksForText(code) {
  if (code.scope === 'ALL_EVENTS') return 'All events'

  const n = code.eventCount ?? code.events?.length ?? 0

  if (n === 1 && code.events?.[0]?.title) return code.events[0].title

  return `${count(n)} ${n === 1 ? 'event' : 'events'}`
}

/**
 * A code's uses: "{useCount} of {maxUses}" or "{useCount}".
 *
 * @param {object} code The code.
 * @returns {string} The words.
 */
export function usesText(code) {
  return code.maxUses ? `${count(code.useCount)} of ${count(code.maxUses)}` : count(code.useCount)
}

/**
 * Under the uses, when any were given back: "{usesPlaced} placed,
 * {usesReturned} given back" (SPEC3-XI §12.5).
 *
 * @param {object} code The code.
 * @returns {string|null} The words, or null when none was given back.
 */
export function usesDetail(code) {
  if (!(code.usesReturned > 0)) return null

  return `${count(code.usesPlaced)} placed, ${count(code.usesReturned)} given back`
}

/**
 * Booking fees waived, per currency: "$12.40", or "$12.40 USD and $3.00 CAD".
 *
 * @param {Array<{currency: string, cents: number}>} waived The amounts.
 * @returns {string} The words, "None" when nothing was waived.
 */
export function waivedText(waived) {
  const amounts = (waived ?? []).filter((each) => each.cents > 0)

  if (amounts.length === 0) return 'None'

  // Two currencies can write their amounts alike ("$" for both US and Canadian
  // dollars), so a list of more than one names each currency.
  if (amounts.length === 1) return formatAmount(amounts[0].cents, amounts[0].currency)

  return amounts
    .map((each) => `${formatAmount(each.cents, each.currency)} ${each.currency}`)
    .join(' and ')
}

/**
 * Who made a code, or "A former administrator".
 *
 * @param {{displayName: string}|null} person The maker.
 * @returns {string} The name.
 */
export function makerName(person) {
  return person?.displayName ?? FORMER_ADMINISTRATOR
}

/**
 * The copy button's accessible name: never the code itself (SPEC3 §12.12).
 *
 * @param {{label: string|null}} code The code.
 * @returns {string} "Copy code for {label}", or "Copy referral code".
 */
export function copyLabel(code) {
  return code.label ? `Copy code for ${code.label}` : 'Copy referral code'
}

/**
 * When and why an order gave its use back: "—" or "{date}: {cause}".
 *
 * @param {{useReturned: {at: string, cause: string}|null}} use The use.
 * @returns {string} The words.
 */
export function returnedText(use) {
  if (!use.useReturned) return '—'

  const cause = RETURN_CAUSE_WORDS[use.useReturned.cause] ?? use.useReturned.cause

  return `${dayWords(use.useReturned.at) ?? ''}: ${cause}`
}

/**
 * The browser's own time zone, or UTC when it says none.
 *
 * @returns {string} An IANA zone name.
 */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * @typedef {object} ReferralFormValues
 * @property {'GENERATE'|'TYPED'} codeMode Generate a code, or type one (create only).
 * @property {string} referralCode The typed code.
 * @property {string} label The label.
 * @property {'ALL_EVENTS'|'SELECTED_EVENTS'} scope Which events.
 * @property {Array<{id: string, title: string}>} events The chosen events.
 * @property {boolean} eventsTouched Whether the chosen events were changed (edit only).
 * @property {string} expires A `datetime-local` value in `timeZone`, or empty.
 * @property {string} maxUses The limit as typed, or empty.
 */

/**
 * The form's problems by field, and the body to send when there are none.
 *
 * For a new code every field is sent as chosen. For a change, only what
 * differs from the code as read is sent, with `expectedUpdatedAt`, so a
 * change nobody made is never written; a cleared label, expiry or limit is
 * sent as null, which removes it.
 *
 * @param {ReferralFormValues} values What the form holds.
 * @param {object} options Options.
 * @param {'create'|'edit'} options.mode Which form.
 * @param {string} options.timeZone The zone the expiry is typed in.
 * @param {Date} [options.now] The time now.
 * @param {object} [options.code] The code as read, for a change.
 * @returns {{errors: Record<string, string>, body: object|null}} The problems, or the body.
 */
export function referralFormRequest(values, { mode, timeZone, now = new Date(), code = null }) {
  const errors = {}

  let referralCode
  if (mode === 'create' && values.codeMode === 'TYPED') {
    const parsed = referralCodeStringSchema.safeParse(values.referralCode)

    if (parsed.success) referralCode = parsed.data
    else errors.referralCode = PAYMENT_TERMS_MESSAGES.referralCode
  }

  const label = values.label.trim()

  if (label.length > REFERRAL_LIMITS.labelMax || /\p{Cc}/u.test(label)) {
    errors.label = PAYMENT_TERMS_MESSAGES.label
  }

  // A change keeps an expiry the form shows as it was read, even one already
  // past: only a new expiry has to be after now.
  const keptExpiry =
    mode === 'edit' &&
    Boolean(code?.expiresAt) &&
    values.expires === toLocalInputValue(code.expiresAt, timeZone)

  let expiresAt = null
  if (keptExpiry) {
    expiresAt = code.expiresAt
  } else if (values.expires) {
    expiresAt = fromLocalInputValue(values.expires, timeZone)

    if (!expiresAt || new Date(expiresAt).getTime() <= now.getTime()) {
      errors.expires = 'Choose a time after now.'
    }
  }

  let maxUses = null
  if (values.maxUses.trim() !== '') {
    const typed = values.maxUses.trim().replaceAll(',', '')
    const number = /^\d+$/u.test(typed) ? Number(typed) : Number.NaN

    if (!Number.isInteger(number) || number < 1 || number > REFERRAL_LIMITS.maxUses) {
      errors.maxUses = PAYMENT_TERMS_MESSAGES.maxUses
    } else {
      maxUses = number
    }
  }

  const eventIds = values.events.map((event) => event.id)

  if (values.scope === 'SELECTED_EVENTS') {
    const checkEvents = mode === 'create' || values.eventsTouched || code?.scope !== values.scope

    if (checkEvents && eventIds.length === 0) errors.events = PAYMENT_TERMS_MESSAGES.eventsRequired
    else if (checkEvents && eventIds.length > REFERRAL_LIMITS.maxEvents) {
      errors.events = PAYMENT_TERMS_MESSAGES.eventsTooMany
    }
  }

  if (Object.keys(errors).length > 0) return { errors, body: null }

  if (mode === 'create') {
    return {
      errors,
      body: {
        ...(referralCode ? { referralCode } : { generate: true }),
        ...(label ? { label } : {}),
        scope: values.scope,
        ...(values.scope === 'SELECTED_EVENTS' ? { eventIds } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        ...(maxUses ? { maxUses } : {}),
      },
    }
  }

  const body = {}

  if ((code.label ?? '') !== label) body.label = label || null

  if (code.scope !== values.scope) {
    body.scope = values.scope
    if (values.scope === 'SELECTED_EVENTS') body.eventIds = eventIds
  } else if (values.scope === 'SELECTED_EVENTS' && values.eventsTouched) {
    body.scope = values.scope
    body.eventIds = eventIds
  }

  const before = code.expiresAt ? new Date(code.expiresAt).getTime() : null
  const after = expiresAt ? new Date(expiresAt).getTime() : null

  if (before !== after) body.expiresAt = expiresAt

  if ((code.maxUses ?? null) !== maxUses) body.maxUses = maxUses

  if (Object.keys(body).length === 0) {
    return { errors: { form: 'Nothing has changed. Change something, then save.' }, body: null }
  }

  return { errors, body: { ...body, expectedUpdatedAt: code.updatedAt } }
}

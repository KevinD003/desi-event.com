/**
 * The words of full control over a posted event: deleting it, restoring it,
 * cancelling one of its nights, the editing sittings of the team at The Desi Events, and
 * what ticket holders are shown changed (SPEC2-XI area X).
 *
 * Pure and browser-safe. Every sentence here is built from what the server
 * answered — a preview's counts, a deletion's record, a refund pass's summary
 * — and never from an outcome the browser worked out for itself: the server
 * decides what a deletion does, and decides it again when it is sent.
 *
 * Imports only narrow subpaths (`@desi-event/schemas/lifecycle` and
 * `/event-control`), never the schemas barrel, and names no capability: the
 * pages that decide who may do what hand their components booleans.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file lib/event-control
 */

import {
  CONTROL_REASON_DESCRIPTION,
  CONTROL_REASON_LIMITS,
  controlReasonSchema,
} from '@desi-event/schemas/event-control'
import { restoreTarget } from '@desi-event/schemas/lifecycle'

import { statusReading } from './event-status.js'
import { formatEventDate, formatEventTime } from './format.js'
import { formatAmount } from './pricing.js'
import { isKnownTimeZone, zoneAbbreviation } from './zoned-time.js'

/** The description every reason box in this area carries (SPEC2-XI §0.8). */
export const REASON_DESCRIPTION = CONTROL_REASON_DESCRIPTION

/** The bounds of every reason box in this area. */
export const REASON_LIMITS = CONTROL_REASON_LIMITS

/** What every deletion says about pictures already in somebody's browser. */
export const PICTURE_CACHE_SENTENCE =
  'Its pictures stop being served at once, but a copy already in someone’s browser can stay there for up to a day.'

/** What every refunding change says about the notices it records. */
export const NOTICE_SENTENCE =
  'A notice is recorded against each order and shown on its order page; it is not emailed.'

/** The question a finished event nobody was checked in at asks of the person deleting it. */
export const CHOICE_PROMPT = 'Nobody was checked in through The Desi Events, so say what happened:'

/**
 * The two answers to {@link CHOICE_PROMPT}, by the outcome each one sends.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHOICE_LABELS = Object.freeze({
  REMOVE_AFTER_EVENT: 'It took place: take its page down and refund nobody',
  CANCEL_AND_REFUND: 'It did not take place: cancel it and refund every order',
})

/** What the team at The Desi Events is asked before every write of an editing sitting, after ten minutes. */
export const PLATFORM_STEP_UP_SENTENCE =
  'Confirm it’s you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else’s event.'

/** What the editor says when a sitting has ended under it. */
export const SITTING_ENDED_SENTENCE =
  'This editing session has ended. Open it again to keep editing.'

/** What the team at The Desi Events is told about an event that has never been posted. */
export const NOT_POSTED_SENTENCE =
  'The Desi Events team edits an event’s details only once it has been published. Before that they are the organiser’s draft; ask for changes through review.'

/**
 * A count with its noun, singular or plural.
 *
 * @param {number} n The count.
 * @param {string} one The noun for one.
 * @param {string} many The noun for any other number.
 * @returns {string} For example `1 order` or `3 orders`.
 */
export function counted(n, one, many) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`
}

/**
 * What a refund moves, in this deployment's payment mode.
 *
 * @param {string} mode `MOCK`, `STRIPE_TEST` or `LIVE`.
 * @returns {string} The sentence.
 */
export function paymentModeSentence(mode) {
  if (mode === 'MOCK')
    return 'Payments on this site are simulated, so these refunds move no real money.'
  if (mode === 'STRIPE_TEST')
    return 'Payments here run in Stripe’s test mode, so no real money moves.'

  return 'The money goes back to the card each order was paid with.'
}

/**
 * An amount in the preview's currency.
 *
 * @param {number} cents The amount.
 * @param {string|null} currency The currency, or null when nothing is owed.
 * @returns {string} The amount, for example `$480.00`.
 */
function money(cents, currency) {
  return formatAmount(cents ?? 0, currency ?? 'USD')
}

/**
 * The sentences a deletion preview reads as, for one outcome.
 *
 * Built from the preview's counts only (SPEC2-XI X-D, Xm1). "Orders", never
 * "people": one person can hold several, and several people one.
 *
 * @param {object} preview A deletion preview (`eventDeletionPreviewSchema`).
 * @param {string|null} [outcome] The outcome to describe; the preview's own by default, or one of its `choices`.
 * @returns {string[]} The sentences, in reading order; empty for no outcome.
 */
export function deletionSentences(preview, outcome = preview?.outcome ?? null) {
  if (!preview || !outcome) return []

  const counts = preview.counts ?? {}
  const zero = counts.zeroValueOrders ?? 0
  const freeSentence =
    zero > 0
      ? `${counted(zero, 'free order has its', 'free orders have their')} tickets withdrawn.`
      : null
  /** @type {Array<string|null>} */
  let sentences = []

  if (outcome === 'REMOVE') {
    sentences = [
      'Nobody has bought a ticket to this event. Deleting it takes its page, listing and pictures off the site straight away. It is kept, hidden, so the team at The Desi Events can restore it.',
      preview.slug?.keptRetired
        ? 'Its web address stays retired, so an old link never shows a different event.'
        : 'Its web address is freed for another event.',
      freeSentence,
    ]
  } else if (outcome === 'CANCEL_AND_REFUND') {
    const disputed = counts.disputedOrders ?? 0
    const refunded = Math.max(0, (counts.paidOrders ?? 0) - disputed)
    const partly = counts.partlyRefundedOrders ?? 0

    sentences = [
      refunded > 0
        ? `Deleting this event cancels it, refunds what is left of each of the ${counted(refunded, 'paid order', 'paid orders')} (${money(counts.refundableCents, counts.currency)} in all, booking fees and tax included) and takes its page off the site.`
        : 'Deleting this event cancels it and takes its page off the site. No order is refunded here.',
      disputed > 0
        ? `${counted(disputed, 'order is disputed and is', 'orders are disputed and are')} left to the finance team.`
        : null,
      partly > 0
        ? `${counted(partly, 'order already had', 'orders already had')} part of ${partly === 1 ? 'its' : 'their'} money refunded; the rest is refunded now.`
        : null,
      freeSentence,
      NOTICE_SENTENCE,
      refunded > 0 ? paymentModeSentence(preview.paymentMode) : null,
    ]
  } else if (outcome === 'REMOVE_AFTER_EVENT') {
    const kept = (counts.paidOrders ?? 0) + zero

    sentences = [
      `This event has taken place. Deleting it takes its page and listing off the site. The ${counted(kept, 'order', 'orders')} and their tickets stay as they are and nobody is refunded.`,
    ]
  }

  return [...sentences.filter(Boolean), PICTURE_CACHE_SENTENCE]
}

/**
 * What the delete button says for an outcome.
 *
 * @param {string|null} outcome The outcome the dialog will send.
 * @returns {string} The label.
 */
export function deleteButtonLabel(outcome) {
  return outcome === 'CANCEL_AND_REFUND' ? 'Cancel, refund and delete' : 'Delete this event'
}

/**
 * Whether the typed web address confirms the deletion, compared the way the
 * server compares it: trimmed and lower-cased.
 *
 * @param {string} typed What was typed.
 * @param {string} slug The event's web address.
 * @returns {boolean} True when it matches.
 */
export function slugMatches(typed, slug) {
  return (
    typeof typed === 'string' &&
    typeof slug === 'string' &&
    typed.trim().toLowerCase() === slug.trim().toLowerCase()
  )
}

/**
 * What is wrong with a reason, or null: the schema the server checks with.
 *
 * @param {string} reason What was typed.
 * @returns {string|null} The problem, in a sentence.
 */
export function reasonProblem(reason) {
  const parsed = controlReasonSchema.safeParse(reason)

  return parsed.success ? null : (parsed.error.issues[0]?.message ?? 'Give a reason.')
}

/**
 * What one pass of the refund driver did, in a sentence.
 *
 * @param {object|null} summary A `refundDriveSummarySchema` value.
 * @returns {string|null} The sentence, or null when nothing was owed.
 */
export function refundSummarySentence(summary) {
  if (!summary) return null

  const { owed = 0, settled = 0, waiting = 0, failed = 0, disputed = 0 } = summary

  if (owed === 0 && disputed === 0) return null

  const parts = []

  if (failed === 0 && waiting === 0) {
    parts.push(
      `${counted(settled, 'order', 'orders')} refunded (${money(summary.amountCents, summary.currency)}).`,
    )
  } else {
    parts.push(`${settled.toLocaleString('en-US')} refunded.`)
    if (failed > 0) parts.push(`${counted(failed, 'refund', 'refunds')} did not go through.`)
    if (waiting > 0) {
      parts.push(
        `${counted(waiting, 'refund is', 'refunds are')} still waiting to be sent: send ${waiting === 1 ? 'it' : 'them'} with “Finish refunds”.`,
      )
    }
  }

  if (disputed > 0) {
    parts.push(
      `${counted(disputed, 'order is disputed and is', 'orders are disputed and are')} left to the finance team.`,
    )
  }

  return parts.join(' ')
}

/**
 * Whether a refund pass left anything to try again.
 *
 * @param {object|null} summary A `refundDriveSummarySchema` value.
 * @returns {boolean} True when some refunds failed or are still waiting.
 */
export function refundsLeftOver(summary) {
  return Boolean(summary && ((summary.failed ?? 0) > 0 || (summary.waiting ?? 0) > 0))
}

/**
 * What a restore brings a deleted event back as, in words.
 *
 * @param {string} statusBefore The status the event had when it was deleted.
 * @returns {string} The sentence.
 */
export function restoreTargetReading(statusBefore) {
  const target = restoreTarget(statusBefore)

  if (target === 'SALES_PAUSED') return 'It comes back paused: the organiser reopens sales.'
  if (statusBefore === 'REVIEW_PENDING') {
    return 'It comes back as a draft: it was waiting for review when it was deleted, so it has to be sent again.'
  }
  if (statusBefore === 'APPROVED') {
    return 'It comes back as a draft: it had been approved but not published, and an approval covers only the version that was deleted, so it has to be sent for review again.'
  }
  if (target === 'DRAFT') return 'It comes back as a draft, which only its team can see.'
  if (target === 'CANCELLED') {
    return 'It comes back cancelled: its refunds stand, and its page says it was cancelled.'
  }

  return `It comes back as ${statusReading(target).label}.`
}

/**
 * Where the refunds of a deleted event stand, from a deletion preview's counts
 * read after the deletion (`GET /v1/events/:id/deletion` answers for a deleted
 * event too, with what is still owed).
 *
 * "Not refunded in full" counts every paid order with money still to go back,
 * including one whose refund the payment provider has not confirmed: the
 * counts read the order's own balance, which moves only once a refund settles.
 *
 * @param {object|null} counts The preview's `counts`.
 * @returns {string[]} The sentences; empty without counts.
 */
export function deletedRefundSentences(counts) {
  if (!counts) return []

  const disputed = counts.disputedOrders ?? 0
  const owed = Math.max(0, (counts.paidOrders ?? 0) - disputed)
  const sentences = []

  if (owed === 0 && disputed === 0) sentences.push('Every paid order has been refunded in full.')

  if (owed > 0) {
    sentences.push(
      `${counted(owed, 'paid order has', 'paid orders have')} not been refunded in full: ${money(counts.refundableCents, counts.currency)} in all is still to go back, counting any refund the payment provider has not confirmed.`,
    )
  }

  if (disputed > 0) {
    sentences.push(
      `${counted(disputed, 'order is disputed and is', 'orders are disputed and are')} left to the finance team.`,
    )
  }

  return sentences
}

/**
 * Whether a deleted event's web address was freed when it was deleted: one
 * that was never public gets the placeholder `deleted-<id>` (X-11), which is
 * no address anybody has seen.
 *
 * @param {{id: string, slug: string}} event The deleted event.
 * @returns {boolean} True for the placeholder.
 */
export function slugReleased(event) {
  return Boolean(event?.id) && event?.slug === `deleted-${event.id}`
}

/**
 * What a deletion did, as the deleted event's record says it.
 *
 * @param {string} outcome `REMOVE`, `CANCEL_AND_REFUND` or `REMOVE_AFTER_EVENT`.
 * @returns {string} The sentence.
 */
export function deletionOutcomeReading(outcome) {
  if (outcome === 'CANCEL_AND_REFUND') {
    return 'It was cancelled, and what was left of every paid order whose payment is not disputed was refunded or is waiting to be.'
  }
  if (outcome === 'REMOVE_AFTER_EVENT') {
    return 'It had taken place, so only its page came down: its orders and tickets stayed as they were and nobody was refunded.'
  }

  return 'Nobody held a paid order, so its page and listing came down and nobody was owed anything.'
}

/**
 * Who deleted the event, as its reader may be told.
 *
 * The server sends the name only to the team at The Desi Events, and to the
 * organisation when one of its own members deleted it; an organiser reads a
 * deletion by the team at The Desi Events without the administrator's name.
 *
 * @param {object} deletion The event's `deletion` block.
 * @returns {string} For example `the team at The Desi Events` or `Priya Shah, of the organisation`.
 */
export function deletedByReading(deletion) {
  const name = deletion?.deletedByName ?? null

  if (deletion?.authority === 'PLATFORM') {
    return name ? `${name}, of the team at The Desi Events` : 'the team at The Desi Events'
  }

  return name ? `${name}, of the organisation` : 'a member of the organisation'
}

/**
 * The sentences a night-cancellation preview reads as.
 *
 * @param {object} preview A `sessionCancellationPreviewSchema` value.
 * @returns {string[]} The sentences, in reading order.
 */
export function nightCancellationSentences(preview) {
  if (!preview) return []

  const refunded = preview.ordersRefunded ?? 0
  const sentences = [
    refunded > 0
      ? `${counted(refunded, 'paid order for this night is', 'paid orders for this night are')} refunded (${money(preview.refundableCents, preview.currency)} in all, booking fees and tax included): a whole order when every ticket on it is for this night, otherwise its tickets for this night.`
      : 'No paid order for this night is refunded.',
    preview.ordersToldOnly > 0
      ? `${counted(preview.ordersToldOnly, 'order holds', 'orders hold')} tickets for every night: ${preview.ordersToldOnly === 1 ? 'its holder keeps them' : 'their holders keep them'} for the other nights and ${preview.ordersToldOnly === 1 ? 'is' : 'are'} told, without a refund.`
      : null,
    preview.zeroValueOrders > 0
      ? `${counted(preview.zeroValueOrders, 'free order has its', 'free orders have their')} tickets withdrawn.`
      : null,
    preview.disputedOrders > 0
      ? `${counted(preview.disputedOrders, 'order is disputed and is', 'orders are disputed and are')} left to the finance team.`
      : null,
    preview.ordersCancelled > 0
      ? `${counted(preview.ordersCancelled, 'unpaid order is', 'unpaid orders are')} cancelled.`
      : null,
    preview.ticketsWithdrawn > 0
      ? `${counted(preview.ticketsWithdrawn, 'ticket', 'tickets')} for this night stop${preview.ticketsWithdrawn === 1 ? 's' : ''} working at the door.`
      : null,
    preview.orders > 0 ? NOTICE_SENTENCE : null,
    refunded > 0 ? paymentModeSentence(preview.paymentMode) : null,
  ]

  return sentences.filter(Boolean)
}

/**
 * The editor's names for the fields an editing sitting can change, so the
 * organiser reads "description, FAQ" rather than column names.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PLATFORM_EDIT_FIELD_LABELS = Object.freeze({
  title: 'title',
  summary: 'one-line summary',
  description: 'description',
  category: 'category',
  slug: 'web address',
  languages: 'languages',
  faq: 'FAQ',
  performers: 'line-up',
  artists: 'line-up',
  runningOrder: 'running order',
  sponsors: 'sponsors',
  socialLinks: 'social links',
  dressCode: 'dress code',
  directions: 'parking and directions',
  publicEmail: 'public email',
  publicPhone: 'public phone',
  websiteUrl: 'website address',
  accessibility: 'accessibility',
  policies: 'policies',
  startsAt: 'start time',
  endsAt: 'end time',
  timezone: 'time zone',
  venueId: 'venue',
  isOnline: 'whether it is online',
  onlineUrl: 'online address',
  ageRestriction: 'age restriction',
})

/**
 * What each write of a sitting did, when it changed something other than the
 * event's own fields.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PLATFORM_EDIT_ACTION_LABELS = Object.freeze({
  'event.session_added': 'added a night',
  'event.session_updated': 'changed a night',
  'event.session_removed': 'removed a night',
  'event.session_cancelled': 'cancelled a night',
  'event.session_material_change': 'moved a night',
  'event.ticket_type_added': 'added a ticket type',
  'event.ticket_type_updated': 'changed a ticket type',
  'event.ticket_type_removed': 'removed a ticket type',
  'event.media_added': 'added a picture',
  'event.media_described': 'described a picture again',
  'event.media_reordered': 'reordered the gallery',
  'event.media_removed': 'removed a picture',
})

/**
 * A column name in words, for a field this module has no label for.
 *
 * @param {string} field A field name such as `publicContact`.
 * @returns {string} `public contact`.
 */
function wordsOf(field) {
  return String(field)
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .toLowerCase()
}

/**
 * What a sitting changed, as a list of the editor's own words, each once.
 *
 * @param {Array<{action: string, fields: string[]}>} changes The sitting's changes.
 * @returns {string[]} For example `['description', 'FAQ', 'added a night']`.
 */
export function platformEditChanges(changes = []) {
  const words = []

  for (const change of changes) {
    const fields = Array.isArray(change.fields) ? change.fields : []

    if (fields.length > 0 && !PLATFORM_EDIT_ACTION_LABELS[change.action]) {
      for (const field of fields) words.push(PLATFORM_EDIT_FIELD_LABELS[field] ?? wordsOf(field))
    } else if (PLATFORM_EDIT_ACTION_LABELS[change.action]) {
      words.push(PLATFORM_EDIT_ACTION_LABELS[change.action])
    }
  }

  return [...new Set(words)]
}

/**
 * A time of day in a named zone, labelled with it, for "until 7:40 PM EDT".
 *
 * Always in a zone given here, never the clock of whatever machine renders
 * it: a server in UTC and a browser in Chicago would otherwise print two
 * different times for the same page, and an unlabelled time beside a date in
 * the event's zone reads as that zone's.
 *
 * @param {string} value An ISO-8601 instant.
 * @param {string} [timeZone] An IANA zone; UTC when it is missing or unknown.
 * @returns {string} For example `7:40 PM EDT`, or an empty string for no instant.
 */
export function clockTime(value, timeZone = 'UTC') {
  const at = new Date(value)

  if (Number.isNaN(at.getTime())) return ''

  const zone = isKnownTimeZone(timeZone) ? timeZone : 'UTC'
  const time = formatEventTime(at, zone)
  const label = zoneAbbreviation(zone, at)

  return label ? `${time} ${label}` : time
}

/**
 * What the organiser's editor says while the team at The Desi Events has the event open
 * for editing (X-7).
 *
 * @param {string} expiresAt When the editing session ends.
 * @param {string} [timeZone] The event's zone.
 * @returns {string} For example `The Desi Events team is editing this event until 7:40 PM EDT.`
 */
export function teamEditingSentence(expiresAt, timeZone) {
  const until = clockTime(expiresAt, timeZone)

  return until
    ? `The Desi Events team is editing this event until ${until}.`
    : 'The Desi Events team is editing this event.'
}

/**
 * How each kind of change notice is headed for a ticket holder.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHANGE_KIND_LABELS = Object.freeze({
  MATERIAL_CHANGE: 'The event changed',
  SESSION_CHANGE: 'A night changed',
  RESCHEDULED: 'A new date',
  POSTPONED: 'Postponed',
  CANCELLED: 'Cancelled',
  SESSION_CANCELLED: 'A night was cancelled',
  DELETED: 'Taken off the site',
})

/** The change kinds a holder reads in a status box rather than a plain line. */
export const SERIOUS_CHANGE_KINDS = Object.freeze(
  new Set(['SESSION_CANCELLED', 'DELETED', 'CANCELLED', 'POSTPONED']),
)

/** The fields whose values a notice shows as dates. */
const INSTANT_FIELDS = Object.freeze(['startsAt', 'endsAt', 'doorsOpenAt'])

/**
 * A stored instant, in the event's own zone.
 *
 * @param {unknown} value An ISO-8601 instant.
 * @param {string} timeZone The zone.
 * @returns {string|null} For example `Sat, Oct 17, 2026, 7:30 PM`, or null.
 */
function instantText(value, timeZone) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null

  return `${formatEventDate(value, timeZone)}, ${formatEventTime(value, timeZone)}`
}

/**
 * The before → after lines a notice can show: dates and times only, in the
 * event's zone. Other values (an address, a policy) are named, not quoted.
 *
 * @param {object} notice An `eventChangeNoticeSchema` value.
 * @param {string} timeZone The event's zone.
 * @returns {Array<{field: string, label: string, before: string, after: string}>} The lines.
 */
export function noticeMoves(notice, timeZone) {
  const before = notice?.before ?? {}
  const after = notice?.after ?? {}
  const zone = (typeof after.timezone === 'string' && after.timezone) || timeZone || 'UTC'

  return INSTANT_FIELDS.flatMap((field) => {
    const from = instantText(before[field], zone)
    const to = instantText(after[field], zone)

    if (!from || !to || from === to) return []

    return [
      {
        field,
        label: PLATFORM_EDIT_FIELD_LABELS[field] ?? wordsOf(field),
        before: from,
        after: to,
      },
    ]
  })
}

/**
 * When a cancelled night was to start, from its notice: the night is named
 * this way when the page holding the notice does not list the night itself
 * (an order page, or a ticket good for every night).
 *
 * @param {object} notice An `eventChangeNoticeSchema` value.
 * @param {string} timeZone The event's zone.
 * @returns {string|null} For example `Sat, Oct 17, 2026, 7:30 PM`, or null.
 */
export function noticeNightStart(notice, timeZone) {
  if (notice?.kind !== 'SESSION_CANCELLED') return null

  return instantText(notice.before?.startsAt, timeZone || 'UTC')
}

/**
 * Who made a change, for a ticket holder.
 *
 * @param {object} notice An `eventChangeNoticeSchema` value.
 * @returns {string} `by the organiser` or `by the team at The Desi Events`.
 */
export function noticeBy(notice) {
  return notice?.by === 'DESI_EVENT' ? 'by the team at The Desi Events' : 'by the organiser'
}

/**
 * What a deleted event's page says to somebody holding an order for it.
 *
 * @param {object|null} notice The DELETED notice, when there is one.
 * @returns {string} The sentence.
 */
export function deletedForHolder(notice) {
  return notice?.by === 'DESI_EVENT'
    ? 'The Desi Events team removed this event’s page.'
    : 'The organiser removed this event’s page.'
}

// ---------------------------------------------------------------------------
// The booking fee (the platform fee) and paying at the venue, as the team
// at The Desi Events manages them on an event's page (SPEC3 §7, §9.1, §12.3)
// ---------------------------------------------------------------------------

/** What the panel says on an event that was never published. */
export const UNPOSTED_TERMS_SENTENCE =
  'You can set this event’s booking fee and whether it can be paid for at the venue now, before it is published.'

/** What the panel says to an administrator who belongs to the event's organisation. */
export const MEMBER_TERMS_SENTENCE =
  'You belong to this event’s organisation, so another administrator has to change its booking fee and payment settings.'

/** What the panel says on a deleted event (SPEC3 §7.3). */
export const DELETED_TERMS_SENTENCE =
  'This event was deleted. Its booking fee and payment settings are kept as they were and come back if it is restored.'

/** What the panel says on an event sold on its listing's own site. */
export const SOLD_ON_SOURCE_TERMS_SENTENCE =
  'Tickets for this event are sold on Sulekha, so it has no booking fee here.'

/** The bounds of an event's own booking fee: 30.00% and 100.00 per ticket. */
export const FEE_FORM_LIMITS = Object.freeze({ maxPercentageBps: 3000, maxFlatCents: 10000 })

/** The bounds of the most tickets that may wait to be paid at the door, and the suggestion. */
export const VENUE_LIMIT_BOUNDS = Object.freeze({ min: 1, max: 100000, suggested: 50 })

/**
 * A percentage in basis points, as the panel writes it: two decimal places.
 *
 * @param {number} bps Basis points.
 * @returns {string} For example `3.00`.
 */
export function percentText(bps) {
  return (bps / 100).toFixed(2)
}

/**
 * Booking fee terms in one short phrase, as the admin list and the history
 * write them: "3.00% + $1.49", or "No booking fee" for 0 and 0.
 *
 * @param {object} terms The terms.
 * @param {number} terms.percentageBps The percentage, in basis points.
 * @param {number} terms.flatCents The amount per ticket.
 * @param {string} terms.currency Its currency.
 * @returns {string} The phrase.
 */
export function feeTermsShort({ percentageBps, flatCents, currency }) {
  if (percentageBps === 0 && flatCents === 0) return 'No booking fee'

  return `${percentText(percentageBps)}% + ${formatAmount(flatCents, currency)}`
}

/**
 * What the panel says the event's booking fee is now (SPEC3 §12.3).
 *
 * @param {object} fee `paymentTerms.fee`.
 * @param {object} siteDefault `paymentTerms.siteDefault`.
 * @returns {string} The sentence.
 */
export function currentFeeSentence(fee, siteDefault) {
  if (fee.source === 'EVENT') {
    if (fee.percentageBps === 0 && fee.flatCentsPerTicket === 0) {
      return 'This event has no booking fee.'
    }

    return `This event: ${percentText(fee.percentageBps)}% of the ticket price plus ${formatAmount(fee.flatCentsPerTicket, fee.currency)} per ticket.`
  }

  return `Site default: ${percentText(siteDefault.percentageBps)}% of the ticket price plus ${formatAmount(siteDefault.flatCentsPerTicket, siteDefault.currency)} per ticket. The site default is set in the server’s settings.`
}

/**
 * Who made a change, for the team at The Desi Events: the administrator's name, or a
 * former administrator once the account is gone.
 *
 * @param {string|null|undefined} name The display name the API sent.
 * @returns {string} The name.
 */
export function changedBy(name) {
  return name || 'A former administrator'
}

/**
 * The newest change to the booking fee, as one line: "Changed by {name} on
 * {date}: “{reason}”".
 *
 * @param {object} fee `paymentTerms.fee`.
 * @param {string} [timeZone] The zone the date is written in.
 * @returns {string|null} The line, or null when the fee was never changed.
 */
export function lastFeeChangeSentence(fee, timeZone = 'UTC') {
  if (!fee?.changedAt) return null

  return `Changed by ${changedBy(fee.changedByName)} on ${formatEventDate(fee.changedAt, timeZone)}: “${fee.reason ?? ''}”`
}

/**
 * "up to 50 tickets waiting to be paid at the door", or "up to 1 ticket …" for
 * a limit of one, the smallest the limit can be (`VENUE_LIMIT_BOUNDS.min`).
 * The one wording for the limit, in the switch's state and in what saving it
 * says.
 *
 * @param {number} limit The limit.
 * @returns {string} The words.
 */
export function venueLimitWords(limit) {
  return `up to ${limit.toLocaleString('en-US')} ${limit === 1 ? 'ticket' : 'tickets'} waiting to be paid at the door`
}

/**
 * Paying at the venue's state, as text (SPEC3 §12.3, §12.4): never by colour
 * alone. The one wording for the switch, shared by the panel of the team at
 * The Desi Events and the organiser's read-only summary (`payment-terms-summary.jsx`), so the
 * two never describe the same switch differently. A switch that is on without
 * a limit the reader was given says "On" alone rather than inventing one.
 *
 * @param {object} venuePayment `paymentTerms.venuePayment`.
 * @returns {string} "On — up to 50 tickets waiting to be paid at the door", "On" or "Off".
 */
export function venueStatusText(venuePayment) {
  if (!venuePayment?.enabled) return 'Off'
  if (!Number.isInteger(venuePayment.limit)) return 'On'

  return `On — ${venueLimitWords(venuePayment.limit)}`
}

/**
 * Paying at the venue, in the admin list's column: "On, up to 50 unpaid" or "Off".
 *
 * @param {object} row A `platformEvents.list` row.
 * @returns {string} The words.
 */
export function venueListText(row) {
  if (!row?.venuePaymentEnabled) return 'Off'

  return `On, up to ${Number(row.venuePaymentLimit ?? 0).toLocaleString('en-US')} unpaid`
}

/**
 * The booking fee, in the admin list's column: "Site default", "No booking
 * fee" or "3.00% + $1.49".
 *
 * @param {object} row A `platformEvents.list` row.
 * @returns {string} The words.
 */
export function feeListText(row) {
  if (row?.feeSource !== 'EVENT') return 'Site default'

  return feeTermsShort({
    percentageBps: row.feePercentageBps ?? 0,
    flatCents: row.feeFlatCentsPerTicket ?? 0,
    currency: row.feeCurrency ?? 'USD',
  })
}

/**
 * One entry of the panel's history, as one line (SPEC3 §12.3). Whether a
 * switch change turned paying at the venue on or changed its limit depends on
 * the change before it, which is the next older entry of the same kind.
 *
 * @param {object} entry The entry.
 * @param {object|null} previousVenue The next older pay-at-the-venue entry, when the list holds one.
 * @param {object} options Options.
 * @param {string} options.currency The event's currency, for a fee written without one.
 * @param {string} [options.timeZone] The zone dates are written in.
 * @param {boolean} [options.olderUnknown] Whether older entries exist that the list does not hold.
 * @returns {string} The line.
 */
export function historyLine(
  entry,
  previousVenue,
  { currency, timeZone = 'UTC', olderUnknown = false },
) {
  const when = formatEventDate(entry.at, timeZone)
  const who = changedBy(entry.byName)
  const why = `“${entry.reason}”`

  if (entry.kind === 'FEE') {
    if (entry.source === 'SITE_DEFAULT') {
      return `${when} — ${who} returned the booking fee to the site default: ${why}`
    }

    // Always the two numbers, 0.00% + $0.00 included, so the line says
    // exactly what was set.
    const terms = `${percentText(entry.percentageBps ?? 0)}% + ${formatAmount(entry.flatCentsPerTicket ?? 0, entry.currency ?? currency)}`

    return `${when} — ${who} set the booking fee to ${terms}: ${why}`
  }

  const limit = Number(entry.limit ?? 0).toLocaleString('en-US')

  if (!entry.enabled) return `${when} — ${who} turned paying at the venue off: ${why}`

  // On after on is a new limit; on after off, or with nothing before it, is a
  // switch-on. With older changes this page does not hold, which it was is
  // not known, so the line says only what it set.
  if (previousVenue?.enabled) return `${when} — ${who} changed the limit to ${limit}: ${why}`
  if (!previousVenue && olderUnknown) {
    return `${when} — ${who} set paying at the venue on, up to ${limit} unpaid: ${why}`
  }

  return `${when} — ${who} turned paying at the venue on, up to ${limit} unpaid: ${why}`
}

/**
 * The panel's history as lines, newest first.
 *
 * @param {object[]} history `paymentTerms.history`, newest first.
 * @param {object} options As {@link historyLine}'s, with `olderUnknown` from `historyHasMore`.
 * @returns {string[]} The lines.
 */
export function historyLines(history, options) {
  return (history ?? []).map((entry, index) => {
    const previousVenue =
      entry.kind === 'VENUE_PAYMENT'
        ? ((history ?? []).slice(index + 1).find((older) => older.kind === 'VENUE_PAYMENT') ?? null)
        : null

    return historyLine(entry, previousVenue, options)
  })
}

/**
 * A percentage typed into the fee form, in basis points: 0 to 30, with at
 * most two decimal places.
 *
 * @param {string} text What was typed.
 * @returns {{bps: number}|{error: string}} The value, or what is wrong.
 */
export function parsePercentage(text) {
  const raw = String(text ?? '').trim()
  const error = 'Enter a percentage from 0 to 30, with at most two decimal places.'

  if (!/^\d{1,2}(\.\d{1,2})?$/u.test(raw) && !/^\.\d{1,2}$/u.test(raw)) return { error }

  const [whole = '0', fraction = ''] = raw.split('.')
  const bps = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'))

  return bps > FEE_FORM_LIMITS.maxPercentageBps ? { error } : { bps }
}

/**
 * What the fee form says about an amount per ticket out of bounds, in the
 * event's currency (SPEC3 §12.3).
 *
 * @param {string} currency The event's currency.
 * @returns {string} The sentence.
 */
export function amountBoundsSentence(currency) {
  return `Enter an amount from ${formatAmount(0, currency)} to ${formatAmount(FEE_FORM_LIMITS.maxFlatCents, currency)}.`
}

/**
 * The currency's symbol, as the amount box's prefix.
 *
 * @param {string} currency ISO 4217 code.
 * @returns {string} For example `$`, or the code itself when there is no symbol.
 */
export function currencySymbol(currency) {
  try {
    const part = new Intl.NumberFormat('en-US', { style: 'currency', currency })
      .formatToParts(0)
      .find((each) => each.type === 'currency')

    return part?.value ?? currency
  } catch {
    return currency
  }
}

/**
 * The most tickets waiting to be paid at the door, typed: a whole number from
 * 1 to 100,000.
 *
 * @param {string} text What was typed.
 * @returns {{limit: number}|{error: string}} The value, or what is wrong.
 */
export function parseVenueLimit(text) {
  const raw = String(text ?? '')
    .trim()
    .replace(/,/gu, '')
  const error = 'Enter a whole number from 1 to 100,000.'

  if (!/^\d+$/u.test(raw)) return { error }

  const limit = Number(raw)

  return limit >= VENUE_LIMIT_BOUNDS.min && limit <= VENUE_LIMIT_BOUNDS.max ? { limit } : { error }
}

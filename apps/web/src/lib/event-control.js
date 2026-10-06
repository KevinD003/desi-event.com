/**
 * The words of full control over a posted event: deleting it, restoring it,
 * cancelling one of its nights, the Desi-Event team's editing sittings, and
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
export const CHOICE_PROMPT = 'Nobody was checked in through Desi-Event, so say what happened:'

/**
 * The two answers to {@link CHOICE_PROMPT}, by the outcome each one sends.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CHOICE_LABELS = Object.freeze({
  REMOVE_AFTER_EVENT: 'It took place: take its page down and refund nobody',
  CANCEL_AND_REFUND: 'It did not take place: cancel it and refund every order',
})

/** What the Desi-Event team is asked before every write of an editing sitting, after ten minutes. */
export const PLATFORM_STEP_UP_SENTENCE =
  'Confirm it’s you to keep editing. The Desi-Event team confirms every 10 minutes while editing someone else’s event.'

/** What the editor says when a sitting has ended under it. */
export const SITTING_ENDED_SENTENCE =
  'This editing session has ended. Open it again to keep editing.'

/** What the Desi-Event team is told about an event that has never been posted. */
export const NOT_POSTED_SENTENCE =
  'The Desi-Event team edits an event only once it has been published. Before that it is the organiser’s draft; ask for changes through review.'

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
      'Nobody has bought a ticket to this event. Deleting it takes its page, listing and pictures off the site straight away. It is kept, hidden, so the Desi-Event team can restore it.',
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
 * The server sends the name only to the Desi-Event team, and to the
 * organisation when one of its own members deleted it; an organiser reads a
 * deletion by the Desi-Event team without the administrator's name.
 *
 * @param {object} deletion The event's `deletion` block.
 * @returns {string} For example `the Desi-Event team` or `Priya Shah, of the organisation`.
 */
export function deletedByReading(deletion) {
  const name = deletion?.deletedByName ?? null

  if (deletion?.authority === 'PLATFORM') {
    return name ? `${name}, of the Desi-Event team` : 'the Desi-Event team'
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
 * What the organiser's editor says while the Desi-Event team has the event open
 * for editing (X-7).
 *
 * @param {string} expiresAt When the editing session ends.
 * @param {string} [timeZone] The event's zone.
 * @returns {string} For example `The Desi-Event team is editing this event until 7:40 PM EDT.`
 */
export function teamEditingSentence(expiresAt, timeZone) {
  const until = clockTime(expiresAt, timeZone)

  return until
    ? `The Desi-Event team is editing this event until ${until}.`
    : 'The Desi-Event team is editing this event.'
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
 * @returns {string} `by the organiser` or `by the Desi-Event team`.
 */
export function noticeBy(notice) {
  return notice?.by === 'DESI_EVENT' ? 'by the Desi-Event team' : 'by the organiser'
}

/**
 * What a deleted event's page says to somebody holding an order for it.
 *
 * @param {object|null} notice The DELETED notice, when there is one.
 * @returns {string} The sentence.
 */
export function deletedForHolder(notice) {
  return notice?.by === 'DESI_EVENT'
    ? 'The Desi-Event team removed this event’s page.'
    : 'The organiser removed this event’s page.'
}

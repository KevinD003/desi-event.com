/**
 * Visits, as the analytics screens say them: who is left out of counting,
 * which period a screen shows, how fresh the figures are, and the sentences
 * that say what the figures count.
 *
 * Pure and server-safe; it reads no session and fetches nothing. The pages and
 * the server component that decides who is not counted pass it what they read.
 *
 * Every sentence here is what the system does today. None names a cadence:
 * the job that adds visits up runs on a schedule the deployment sets, so the
 * screens say when the figures run to rather than how often they change.
 *
 * @module lib/traffic
 */

import { statusReading } from './event-status.js'
import {
  ONLY_THE_TEAM,
  administratorSummary,
  formatDecisionInstant,
  organiserSummary,
} from './website-redirect.js'
import { websiteHost } from './website.js'

/** The periods a screen offers, latest days first. */
export const PERIODS = Object.freeze([
  Object.freeze({ key: '7', label: 'Last 7 days', days: 7 }),
  Object.freeze({ key: '30', label: 'Last 30 days', days: 30 }),
  Object.freeze({ key: '90', label: 'Last 90 days', days: 90 }),
  Object.freeze({ key: 'all', label: 'Everything', days: null }),
])

/** An organisation's analytics shows everything unless asked otherwise. */
export const DEFAULT_ANALYTICS_PERIOD = 'all'

/** The platform's list of every event is bounded by default. */
export const DEFAULT_PLATFORM_PERIOD = '30'

/** The banner shown when any figure on a screen was written by the development seed. */
export const DEMONSTRATION_NOTICE = Object.freeze({
  title: 'Demonstration figures',
  body: 'Some of these figures were written by the development seed to show how this page looks. They are not counted visits.',
})

/** What "Orders paid" means beside visits, as distinct from the funnel's step. */
export const ORDERS_PAID_ON_DAYS_LABEL = 'Orders paid on these days'

/** Said under every figure of paid orders. */
export const REFUNDED_ORDERS_NOTE = 'An order refunded later is not counted as paid.'

/** What the visit figures count, and what they do not. */
export const VISIT_COUNTING_NOTES = Object.freeze([
  'Robots and automated tools are not counted.',
  'Visits by you and everybody else in your organisation while signed in, and by Desi-Event staff, are not counted.',
  'People whose browser asks not to be tracked (Global Privacy Control or Do Not Track) are counted as page views, never as visitors.',
  'No cookie is set and no address, browser description or account is kept. A visitor is recognised for one day and one event only, by a code made from their connection and browser with a secret that is deleted from the live database when the day ends. Backups taken during the day keep that secret for as long as the backups are kept.',
  'The record of each visit is deleted two days after the day it happened, by the job that adds visits up, once it has been added up. Only the daily totals are kept.',
  'Somebody determined to can make visits look like more people than they are. These figures are a guide to interest, not an audit.',
])

const COUNT_FORMAT = new Intl.NumberFormat('en-US')
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
})

/**
 * Who a page should not count while they look at it.
 *
 * Desi-Event staff hold platform capabilities and are never counted; an
 * organisation's members are not counted on its own events. Decided here from
 * the session the page already read, because a beacon carries no session.
 *
 * @param {object|null} session The signed-in session, or null.
 * @returns {{excludeAll: boolean, excludedOrganizationIds: string[]}} Who is left out.
 */
export function trafficExclusion(session) {
  return {
    excludeAll: (session?.capabilities ?? []).length > 0,
    excludedOrganizationIds: (session?.memberships ?? [])
      .map((membership) => membership?.organizationId)
      .filter((id) => typeof id === 'string' && id.length > 0),
  }
}

/**
 * The period a query asked for, or the screen's default.
 *
 * @param {unknown} key The `range` query value.
 * @param {string} fallback The default period key.
 * @returns {{key: string, label: string, days: number|null}} The period.
 */
export function periodFor(key, fallback = DEFAULT_ANALYTICS_PERIOD) {
  return (
    PERIODS.find((period) => period.key === key) ??
    PERIODS.find((period) => period.key === fallback)
  )
}

/**
 * Where a period starts: UTC midnight of the first of its days, today counted.
 *
 * @param {string} key A period key.
 * @param {Date} [now] The current instant.
 * @returns {string|null} An ISO instant, or null for everything.
 */
export function periodFrom(key, now = new Date()) {
  const period = PERIODS.find((entry) => entry.key === key)

  if (!period || period.days === null) return null

  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)

  return new Date(today - (period.days - 1) * 86_400_000).toISOString()
}

/**
 * A count, with thousands separated.
 *
 * @param {number} value The count.
 * @returns {string} The words.
 */
export function formatCount(value) {
  return COUNT_FORMAT.format(Number(value) || 0)
}

/**
 * A share of a whole, to one decimal place.
 *
 * @param {number} part The part.
 * @param {number} whole The whole.
 * @returns {string} A percentage, or a dash when there is nothing to share.
 */
export function formatShare(part, whole) {
  if (!whole) return '—'

  return `${(Math.round((part / whole) * 1000) / 10).toFixed(1)}%`
}

/**
 * A UTC day as a short date: `Oct 1`, or `Oct 1, 2026` with its year.
 *
 * @param {string} day `YYYY-MM-DD`.
 * @param {object} [options] Options.
 * @param {boolean} [options.withYear] Whether to name the year too.
 * @returns {string} The date.
 */
export function formatDay(day, { withYear = false } = {}) {
  return (withYear ? DAY_YEAR_FORMAT : DAY_FORMAT).format(new Date(`${day}T00:00:00.000Z`))
}

/**
 * Whether a series of days runs into a second calendar year.
 *
 * Within one year a month and a day name a day once; across two, `Oct 7` can
 * be either end of a 366-day series.
 *
 * @param {Array<{day: string}>} days One entry per UTC day, oldest first.
 * @returns {boolean} True when the first and last days fall in different years.
 */
export function spansYears(days) {
  return days.length > 0 && days[0].day.slice(0, 4) !== days.at(-1).day.slice(0, 4)
}

/**
 * How to name each day of one series: with the year whenever the series runs
 * into a second year, so no two days of a chart, its description, its
 * tooltips or its table read the same.
 *
 * @param {Array<{day: string}>} days One entry per UTC day, oldest first.
 * @returns {function(string): string} Names a `YYYY-MM-DD` day of the series.
 */
export function dayNamer(days) {
  const withYear = spansYears(days)

  return (day) => formatDay(day, { withYear })
}

/**
 * How fresh a screen's visit figures are, in a sentence.
 *
 * @param {{updatedAt?: string|Date|null, stale?: boolean}} traffic The figures' freshness.
 * @returns {{tone: 'never'|'fresh'|'stale', sentence: string}} What to say, and how loudly.
 */
export function freshness({ updatedAt = null, stale = false } = {}) {
  if (!updatedAt) {
    return {
      tone: 'never',
      sentence: 'No visits have been added up on this site: the job that adds them up has not run.',
    }
  }

  const at = new Date(updatedAt)
  const runsTo = `These figures run to ${TIME_FORMAT.format(at)} UTC on ${DAY_FORMAT.format(at)}.`

  if (stale) {
    return {
      tone: 'stale',
      sentence: `${runsTo} The job that adds visits up has not finished since, so later visits are missing.`,
    }
  }

  return { tone: 'fresh', sentence: runsTo }
}

/**
 * Whether a page leaves a view or a click on one organisation's event
 * uncounted for this reader.
 *
 * @param {{excludeAll: boolean, excludedOrganizationIds: string[]}} exclusion From {@link trafficExclusion}.
 * @param {string|null|undefined} organizationId Whose event it is.
 * @returns {boolean} True when nothing about this event is counted for this reader.
 */
export function excludesEvent(exclusion, organizationId) {
  if (exclusion?.excludeAll) return true

  return (
    typeof organizationId === 'string' &&
    (exclusion?.excludedOrganizationIds ?? []).includes(organizationId)
  )
}

/**
 * An event's state in a visits table: "Deleted" for a deleted event, which is
 * listed because it was seen and sold before it was taken down, and otherwise
 * the organiser's word for its status.
 *
 * @param {{status: string, deleted?: boolean}} row A row of the API's visit lists.
 * @returns {string} The word.
 */
export function trafficStatusLabel(row) {
  if (row?.deleted === true || row?.status === 'DELETED') return 'Deleted'

  return statusReading(row?.status).label
}

/**
 * The website link's state in one line, for an event's analytics.
 *
 * The organiser's own sentence where it reads true without the address in
 * front of the reader (the analytics payload carries the switch, not the
 * address the organiser typed): "on, with a change waiting" does not say
 * whether the address was changed or cleared, and "never decided, no address"
 * does not point at a field that is not on this page.
 *
 * A platform administrator reading another organisation's event is not told
 * about "your event page": they get the administrators' wording, the one the
 * review page and the list of website links use.
 *
 * @param {{websiteLinkOn: boolean, websiteRedirect: object|null}|null} event The analytics' narrowed event.
 * @param {object} [options] Options.
 * @param {function(string): string} [options.formatInstant] How an instant is shown.
 * @param {'organiser'|'administrator'} [options.reader] Who reads the line: the
 *   organisation's own team, or a platform administrator from outside it.
 * @returns {string} The line, starting "Website link:".
 */
export function websiteLinkLine(
  event,
  { formatInstant = formatDecisionInstant, reader = 'organiser' } = {},
) {
  const state = event?.websiteRedirect ?? null

  if (!state) {
    return `Website link: ${event?.websiteLinkOn ? 'On' : 'Off'}. Only the Desi-Event team can turn it on or off.`
  }

  if (state.enabled && state.pending) {
    const decidedHost = websiteHost(state.decidedUrl) ?? 'the approved address'

    return `Website link: On since ${formatInstant(state.changedAt)}, going to ${decidedHost}. A change to the event’s website address is on the Desi-Event team’s list to look at; until an administrator decides on it, the link keeps going to ${decidedHost}. ${ONLY_THE_TEAM}`
  }

  if (!state.enabled && !state.pending && !state.changedAt) {
    return `Website link: Off. This event has no website address for the Desi-Event team to link to; one can be added in the event’s editor. ${ONLY_THE_TEAM}`
  }

  // The cases left never reach the administrators' sentence about a changed
  // or removed address (that is the on-with-a-change-waiting case above).
  if (reader === 'administrator') {
    return `Website link: ${[...administratorSummary(state, { formatInstant }).sentences, ONLY_THE_TEAM].join(' ')}`
  }

  // Every sentence but the one about the address rules, which points at the
  // editor's field ("change it above"), and the closing line, said once here.
  const sentences = organiserSummary(state, { formatInstant }).sentences.filter(
    (sentence) => sentence !== ONLY_THE_TEAM && !sentence.startsWith('Your address does not pass'),
  )

  return `Website link: ${[...sentences, ONLY_THE_TEAM].join(' ')}`
}

/**
 * What the website link's switch says, in words: to the organiser, under their
 * website field and on their event's analytics, and to the administrators who
 * decide on it.
 *
 * Pure, so every sentence can be tested word for word and the same sentence is
 * shown wherever the same state is. The state is the API's
 * `websiteRedirectState`: on or off, whether an address waits, where the link
 * goes, and who decided, when and why. The organiser is shown the deciding
 * administrator's name, as the user asked (SPEC2 D6).
 *
 * @module lib/website-redirect
 */

import { websiteHost } from './website.js'

/** The last line of every organiser summary. */
export const ONLY_THE_TEAM = 'Only the Desi-Event team can turn this link on or off.'

/** Who decided, when the API gave no name. */
const SOMEBODY = 'A Desi-Event administrator'

const INSTANT = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/**
 * An instant as these sentences show it: "Sep 30, 2026, 10:00 AM UTC".
 *
 * @param {string|Date|null|undefined} value An instant.
 * @returns {string} The words, or an empty string for none.
 */
export function formatDecisionInstant(value) {
  if (!value) return ''

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? '' : `${INSTANT.format(date)} UTC`
}

/**
 * The administrator's note, quoted, as a clause; nothing when there is none.
 *
 * @param {string|null|undefined} reason The note.
 * @returns {string} `, with this note: “…”` or an empty string.
 */
function noteClause(reason) {
  const text = typeof reason === 'string' ? reason.trim() : ''

  return text ? `, with this note: “${text}”` : ''
}

/**
 * @typedef {object} WebsiteSummary
 * @property {'On'|'Off'} label What the badge says.
 * @property {'success'|'neutral'} tone The badge's colour.
 * @property {boolean} pending Whether an address waits for a decision.
 * @property {string[]} sentences What is said, in order.
 */

/**
 * The switch as the organiser reads it, under their website field.
 *
 * Word for word from SPEC2 §4.W-A. The last line is always
 * {@link ONLY_THE_TEAM}.
 *
 * @param {object|null|undefined} state The switch, `websiteRedirectState`; null when unknown.
 * @param {object} [options] Options.
 * @param {string|null} [options.websiteUrl] The organiser's current address.
 * @param {function(string): string} [options.formatInstant] How an instant is shown.
 * @returns {WebsiteSummary} The summary.
 */
export function organiserSummary(
  state,
  { websiteUrl = null, formatInstant = formatDecisionInstant } = {},
) {
  const current = typeof websiteUrl === 'string' && websiteUrl.trim() ? websiteUrl.trim() : null
  const enabled = state?.enabled === true
  const pending = state?.pending === true
  const decided = Boolean(state?.changedAt)
  const when = formatInstant(state?.changedAt)
  const name = state?.changedByName || SOMEBODY
  const decidedHost = websiteHost(state?.decidedUrl) ?? ''
  /** @type {string[]} */
  const sentences = []

  if (enabled && !pending) {
    sentences.push(
      `On since ${when}. ${name} of the Desi-Event team turned it on${noteClause(state.reason)}. Your event page shows “Visit the organiser’s website”, which goes to ${decidedHost}. Visits through it are counted in your event’s analytics, apart from robots and some automated or blocked requests.`,
    )
  } else if (enabled && current) {
    const newHost = websiteHost(current) ?? current

    sentences.push(
      `On since ${when}, going to ${decidedHost}. Your new address, ${newHost}, is on the Desi-Event team’s list to look at; until an administrator approves it, the link keeps going to ${decidedHost}. If the old address should stop being linked at once, ask the Desi-Event team to turn the link off.`,
    )
  } else if (enabled) {
    sentences.push(
      `On since ${when}, going to ${decidedHost}. You removed your address; the link keeps going to ${decidedHost} until an administrator turns it off. Ask the Desi-Event team if it should stop at once.`,
    )
  } else if (decided) {
    sentences.push(
      `Off since ${when}. ${name} of the Desi-Event team turned it off${noteClause(state.reason)}. Your address is not shown on the event page.`,
    )

    if (pending) sentences.push('Your new address is on the Desi-Event team’s list to look at.')
  } else if (pending || current) {
    sentences.push(
      'Off. Your address is on the Desi-Event team’s list of website links to look at. It is not shown on your event page until an administrator turns the link on.',
    )
  } else {
    sentences.push(
      'Off. Add your website’s address above and the Desi-Event team can link to it from your event page.',
    )
  }

  if (state?.websiteProblem) {
    sentences.push(
      `Your address does not pass the address rules: ${state.websiteProblem} Change it above to have the link considered.`,
    )
  }

  sentences.push(ONLY_THE_TEAM)

  return {
    label: enabled ? 'On' : 'Off',
    tone: enabled ? 'success' : 'neutral',
    pending,
    sentences,
  }
}

/**
 * The switch as an administrator reads it, on the review page's panel and in
 * the list of website links.
 *
 * @param {object|null|undefined} state The switch, `websiteRedirectState`.
 * @param {object} [options] Options.
 * @param {string|null} [options.websiteUrl] The organiser's current address.
 * @param {function(string): string} [options.formatInstant] How an instant is shown.
 * @returns {WebsiteSummary} The summary.
 */
export function administratorSummary(
  state,
  { websiteUrl = null, formatInstant = formatDecisionInstant } = {},
) {
  const current = typeof websiteUrl === 'string' && websiteUrl.trim() ? websiteUrl.trim() : null
  const enabled = state?.enabled === true
  const pending = state?.pending === true
  const decided = Boolean(state?.changedAt)
  const when = formatInstant(state?.changedAt)
  const name = state?.changedByName || SOMEBODY
  const reason =
    typeof state?.reason === 'string' && state.reason.trim() ? state.reason.trim() : null
  const decidedHost = websiteHost(state?.decidedUrl) ?? ''
  /** @type {string[]} */
  const sentences = []

  if (enabled) {
    sentences.push(`On since ${when}, going to ${decidedHost}. Turned on by ${name}.`)
  } else if (decided) {
    sentences.push(`Off since ${when}. Turned off by ${name}.`)
  } else {
    sentences.push('Off. No administrator has decided on this address.')
  }

  if (decided && reason) sentences.push(`Reason: ${reason}`)

  if (pending) {
    const since = formatInstant(state?.submittedAt)
    const waiting = since ? `Waiting since ${since}.` : 'Waiting for a decision.'

    if (enabled && current) {
      sentences.push(
        `${waiting} The organiser changed the address to ${websiteHost(current) ?? current}; until it is approved, the link keeps going to ${decidedHost}.`,
      )
    } else if (enabled) {
      sentences.push(
        `${waiting} The organiser removed their address; the link keeps going to ${decidedHost} until it is turned off.`,
      )
    } else {
      sentences.push(waiting)
    }
  }

  return {
    label: enabled ? 'On' : 'Off',
    tone: enabled ? 'success' : 'neutral',
    pending,
    sentences,
  }
}

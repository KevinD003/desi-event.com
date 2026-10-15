/**
 * How an event imported from an organiser's own listing reads in public
 * (SPEC2-XI I-E; ADR 0015, addendum 2026-10-15 (2)).
 *
 * The API sends `importedFrom` on an event only while it is held by the team
 * at The Desi Events: `{ presentedBy, listedOn, prices, priceListed, … }`.
 * Such an event is sold here like any other, through its own ticket types and
 * checkout, and can also be reserved on WhatsApp: nothing here links to, or
 * names, the site its listing was read from, and `sourceName` (if the API
 * still sends one) is never printed.
 *
 * Pure and dependency-light, so a server component and a client one may both
 * import it.
 *
 * @module lib/imports
 */

/** The date a listing was read, as the page prints it: "30 September 2026". */
const LISTED_ON = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * The day a listing was read, in words, or null when it cannot be read.
 *
 * @param {string|null|undefined} listedOn `YYYY-MM-DD`, in UTC.
 * @returns {string|null} "30 September 2026".
 */
export function listedOnWords(listedOn) {
  if (typeof listedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(listedOn)) return null

  const time = Date.parse(`${listedOn}T00:00:00Z`)

  return Number.isFinite(time) ? LISTED_ON.format(new Date(time)) : null
}

/**
 * Where an imported event's prices come from, in a sentence for its ticket
 * box: "Prices are as the organiser listed them on 30 September 2026." With
 * no date it says only that they are as the organiser listed them. It names no
 * other site and invents no count or deadline.
 *
 * @param {object} importedFrom The event's `importedFrom`.
 * @returns {string} The sentence.
 */
export function importedPricesSentence(importedFrom) {
  const when = listedOnWords(importedFrom?.listedOn)

  return `Prices are as the organiser listed them${when ? ` on ${when}` : ''}.`
}

/**
 * Whether the listing gave an end time for every night.
 *
 * Where it gave none, the API keeps a planning estimate as the end, which is
 * never shown: the page shows the start alone.
 *
 * @param {{sessions?: {endTimeListed?: boolean}[]}} event The public event.
 * @returns {boolean} False when any night's end was not listed.
 */
export function endTimeListed(event) {
  return !(event?.sessions ?? []).some((session) => session?.endTimeListed === false)
}

/**
 * How an editor's or an administrator's screen labels a night's end that its
 * listing did not give (SPEC2-XI §0 rule 9). The stored end is then a planning
 * estimate, the start plus three hours, which no public page shows.
 */
export const ESTIMATED_END_LABEL = 'Not given by the listing (estimate for scheduling)'

/**
 * Whether a night's stored end is the importer's estimate rather than a listed
 * or organiser-set end.
 *
 * @param {{endTimeListed?: boolean}|null|undefined} session A night.
 * @returns {boolean} True only when the API says the end was not listed.
 */
export function endIsEstimate(session) {
  return session?.endTimeListed === false
}

/**
 * The statuses in which an imported event can still be asked about on
 * WhatsApp: announced, on sale, paused or sold out here. Not a cancelled,
 * postponed or finished one, whose chat message would ask to reserve tickets
 * for something not happening on that day.
 *
 * @type {ReadonlySet<string>}
 */
export const RESERVABLE_STATUSES = new Set(['PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT'])

/**
 * Whether an imported event's page offers "Reserve on WhatsApp" now: it is in
 * one of {@link RESERVABLE_STATUSES} and its start is still ahead.
 *
 * @param {{status?: string, startsAt?: string}} event The public event.
 * @param {Date} [now] The moment in question. Defaults to now.
 * @returns {boolean} True when the button is shown.
 */
export function reservableOnWhatsApp(event, now = new Date()) {
  const start = Date.parse(event?.startsAt)

  return RESERVABLE_STATUSES.has(event?.status) && Number.isFinite(start) && start > now.getTime()
}

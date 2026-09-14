/**
 * Date, time and place formatting.
 *
 * Every event carries its own IANA timezone, and that is the timezone the
 * event happens in — a Diwali mela in Mississauga starts at 2 pm in Toronto
 * regardless of where the person reading the page is sitting. So every helper
 * here formats in the *event's* zone and says which zone that was, rather than
 * silently converting to the viewer's local time.
 *
 * Formatting in an explicit timezone also makes the output identical on the
 * server and in the browser, which is what keeps React from reporting a
 * hydration mismatch on every date on the page.
 *
 * @module lib/format
 */

/** Locale used when a caller does not supply one. */
const DEFAULT_LOCALE = 'en-IN'

/**
 * Format the date part of a timestamp in the event's own timezone.
 *
 * @param {string|Date} value An ISO-8601 timestamp or `Date`.
 * @param {string} [timeZone] IANA timezone, e.g. `Asia/Kolkata`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} A string such as `Sat, 11 Oct 2026`, or an empty string for an unparseable value.
 */
export function formatEventDate(value, timeZone = 'Asia/Kolkata', locale = DEFAULT_LOCALE) {
  const date = toDate(value)
  if (!date) return ''

  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date)
}

/**
 * Format the time part of a timestamp in the event's own timezone.
 *
 * @param {string|Date} value An ISO-8601 timestamp or `Date`.
 * @param {string} [timeZone] IANA timezone.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} A string such as `7:00 pm`, or an empty string for an unparseable value.
 */
export function formatEventTime(value, timeZone = 'Asia/Kolkata', locale = DEFAULT_LOCALE) {
  const date = toDate(value)
  if (!date) return ''

  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/**
 * Describe when an event runs, collapsing a same-day range to one date.
 *
 * @param {object} event An event or event summary carrying `startsAt`, `endsAt` and `timezone`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} A phrase such as `Sat, 11 Oct 2026 · 7:00 pm – 11:30 pm`.
 */
export function formatEventWhen(event, locale = DEFAULT_LOCALE) {
  const zone = event?.timezone ?? 'Asia/Kolkata'
  const start = toDate(event?.startsAt)
  if (!start) return ''

  const end = toDate(event?.endsAt)
  const startDate = formatEventDate(start, zone, locale)
  const startTime = formatEventTime(start, zone, locale)

  if (!end) return `${startDate} · ${startTime}`

  const endDate = formatEventDate(end, zone, locale)
  const endTime = formatEventTime(end, zone, locale)

  if (startDate === endDate) return `${startDate} · ${startTime} – ${endTime}`

  return `${startDate}, ${startTime} – ${endDate}, ${endTime}`
}

/**
 * The short timezone name shown next to a time, e.g. `IST`.
 *
 * @param {object} event An event carrying `startsAt` and `timezone`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} The localised short zone name, or an empty string.
 */
export function formatTimeZoneLabel(event, locale = DEFAULT_LOCALE) {
  const date = toDate(event?.startsAt)
  if (!date) return ''

  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: event?.timezone ?? 'Asia/Kolkata',
    timeZoneName: 'short',
  }).formatToParts(date)

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

/**
 * The machine-readable value for a `<time dateTime="…">` attribute.
 *
 * @param {string|Date} value An ISO-8601 timestamp or `Date`.
 * @returns {string|undefined} A UTC ISO-8601 string, or `undefined` when unparseable.
 */
export function toDateTimeAttribute(value) {
  return toDate(value)?.toISOString()
}

/**
 * Describe where an event happens, in one line.
 *
 * @param {object} event An event, or an event summary carrying `venueName`/`city`.
 * @returns {string} A phrase such as `Jio World Garden, Mumbai`, or `Online` for a streamed event.
 */
export function formatEventLocation(event) {
  if (event?.isOnline) return 'Online'

  const venueName = event?.venue?.name ?? event?.venueName
  const city = event?.venue?.city ?? event?.city

  return [venueName, city].filter(Boolean).join(', ') || 'Venue to be announced'
}

/**
 * Format a full postal address as separate lines.
 *
 * @param {object|null|undefined} venue A venue record.
 * @returns {string[]} Address lines, omitting the parts the venue does not have.
 */
export function formatVenueAddress(venue) {
  if (!venue) return []

  return [
    venue.addressLine1,
    venue.addressLine2,
    [venue.city, venue.region].filter(Boolean).join(', '),
    venue.postalCode,
  ].filter(Boolean)
}

/**
 * Split a stored description into paragraphs for rendering.
 *
 * Descriptions are plain text with blank lines between paragraphs, never HTML,
 * so nothing here has to be trusted or sanitised.
 *
 * @param {string|null|undefined} description The stored description.
 * @returns {string[]} One entry per non-empty paragraph.
 */
export function toParagraphs(description) {
  if (typeof description !== 'string') return []

  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
}

/**
 * Coerce a timestamp to a valid `Date`.
 *
 * @param {string|number|Date|null|undefined} value Candidate timestamp.
 * @returns {Date|null} A valid `Date`, or `null` when the value cannot be read as one.
 */
function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== 'string' && typeof value !== 'number') return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

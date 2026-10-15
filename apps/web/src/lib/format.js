/**
 * Date, time and place formatting.
 *
 * Every event carries its own IANA timezone, and that is the timezone the
 * event happens in — a garba night in Santa Clara starts at 7:30 PM Pacific
 * regardless of where the person reading the page is sitting. So every helper
 * here formats in the *event's* zone and says which zone that was, rather than
 * silently converting to the viewer's local time.
 *
 * The house format is US English, because the catalogue is American: `Sat,
 * Oct 17 · 7:30 PM EDT`. The locale is a parameter rather than a constant
 * baked into each call, so nothing here assumes the event is in the US — an
 * event in Kolkata still formats in Kolkata time, labelled as such.
 *
 * Formatting in an explicit timezone also makes the output identical on the
 * server and in the browser, which is what keeps React from reporting a
 * hydration mismatch on every date on the page.
 *
 * @module lib/format
 */

/** Locale used when a caller does not supply one. */
const DEFAULT_LOCALE = 'en-US'

/**
 * Zone assumed for an event that does not say, which no well-formed event
 * does. The catalogue's most common zone, so a malformed record at least reads
 * in a zone somebody on this site is likely to be in.
 */
const DEFAULT_ZONE = 'America/New_York'

/**
 * How far past midnight an evening may run and still read as that evening.
 *
 * A garba night from 7:30 PM to 12:30 AM is one night out, and "Sat, Oct 17 ·
 * 7:30 PM – 12:30 AM" is how anyone would write it. Spelling out Sunday's date
 * for the last half hour makes a single evening look like a two-day festival.
 * Anything ending at or after this hour is written with both dates.
 */
const OVERNIGHT_END_HOUR = 6

/**
 * Format the date part of a timestamp in the event's own timezone.
 *
 * @param {string|Date} value An ISO-8601 timestamp or `Date`.
 * @param {string} [timeZone] IANA timezone, e.g. `America/New_York`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} A string such as `Sat, Oct 17, 2026`, or an empty string for an unparseable value.
 */
export function formatEventDate(value, timeZone = DEFAULT_ZONE, locale = DEFAULT_LOCALE) {
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
 * @returns {string} A string such as `7:30 PM`, or an empty string for an unparseable value.
 */
export function formatEventTime(value, timeZone = DEFAULT_ZONE, locale = DEFAULT_LOCALE) {
  const date = toDate(value)
  if (!date) return ''

  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(date)
}

/**
 * Describe when an event runs, collapsing a same-day range — and an evening
 * that runs into the small hours — to one date.
 *
 * @param {object} event An event or event summary carrying `startsAt`, `endsAt` and `timezone`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} A phrase such as `Sat, Oct 17, 2026 · 7:30 PM – 12:30 AM`.
 */
export function formatEventWhen(event, locale = DEFAULT_LOCALE) {
  const zone = event?.timezone ?? DEFAULT_ZONE
  const start = toDate(event?.startsAt)
  if (!start) return ''

  const end = toDate(event?.endsAt)
  const startDate = formatEventDate(start, zone, locale)
  const startTime = formatEventTime(start, zone, locale)

  if (!end) return `${startDate} · ${startTime}`

  const endDate = formatEventDate(end, zone, locale)
  const endTime = formatEventTime(end, zone, locale)

  if (startDate === endDate || isSameEvening(start, end, zone)) {
    return `${startDate} · ${startTime} – ${endTime}`
  }

  return `${startDate}, ${startTime} – ${endDate}, ${endTime}`
}

/**
 * The start of an event as a card states it: day, date, time and zone.
 *
 * The year is left out while it is the current one, because every date on a
 * listing of the next few weeks carrying ", 2026" is noise; it comes back the
 * moment an event is in a different year, where leaving it out would mislead.
 *
 * @param {object} event An event or event summary carrying `startsAt` and `timezone`.
 * @param {object} [options] Options.
 * @param {string} [options.locale] BCP 47 locale tag.
 * @param {Date|number} [options.now] What "the current year" is measured from.
 * @returns {string} A phrase such as `Sat, Oct 17 · 7:30 PM EDT`, or an empty string.
 */
export function formatEventStart(event, { locale = DEFAULT_LOCALE, now = Date.now() } = {}) {
  const start = toDate(event?.startsAt)
  if (!start) return ''

  const zone = event?.timezone ?? DEFAULT_ZONE
  const yearOf = (instant) =>
    new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: zone }).format(instant)
  const current = toDate(typeof now === 'number' ? now : now?.getTime?.())
  const sameYear = current ? yearOf(start) === yearOf(current) : false

  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: zone,
  }).format(start)
  const label = formatTimeZoneLabel(event, locale)

  return `${date} · ${formatEventTime(start, zone, locale)}${label ? ` ${label}` : ''}`
}

/**
 * The short timezone name shown next to a time, e.g. `EDT`.
 *
 * Read at the event's own start, because the abbreviation is seasonal: the
 * same New York event is `EDT` in October and `EST` in December.
 *
 * @param {object} event An event carrying `startsAt` and `timezone`.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string} The localised short zone name, or an empty string.
 */
export function formatTimeZoneLabel(event, locale = DEFAULT_LOCALE) {
  const date = toDate(event?.startsAt)
  if (!date) return ''

  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: event?.timezone ?? DEFAULT_ZONE,
    timeZoneName: 'short',
  }).formatToParts(date)

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

/**
 * A zone `Intl` can format in, or UTC for one it does not know.
 *
 * @param {string|null|undefined} timeZone Candidate IANA zone.
 * @returns {string} The zone, or `UTC`.
 */
function knownZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return 'UTC'

  try {
    new Intl.DateTimeFormat('en-US', { timeZone })

    return timeZone
  } catch {
    return 'UTC'
  }
}

/**
 * An instant as a person reads it, in the zone named and saying which.
 *
 * For records an event keeps — a payment taken at its door, a ticket
 * cancelled, a change to its terms — the zone is the event's own, so the
 * organiser reads the time their door kept, not the server's or the
 * browser's. Without a zone, or with one `Intl` does not know, it is written
 * in UTC and labelled so: never in the reader's zone unsaid.
 *
 * @param {string|Date|null|undefined} value An ISO-8601 instant or `Date`.
 * @param {string} [timeZone] IANA zone; UTC when absent.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string|null} "Oct 9, 2026, 9:30 PM CDT", or null for no instant.
 */
export function formatInstantIn(value, timeZone = 'UTC', locale = DEFAULT_LOCALE) {
  const at = toDate(value)
  if (!at) return null

  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: knownZone(timeZone),
    timeZoneName: 'short',
  }).format(at)
}

/**
 * The day an instant falls on in the zone named.
 *
 * @param {string|Date|null|undefined} value An ISO-8601 instant or `Date`.
 * @param {string} [timeZone] IANA zone; UTC when absent.
 * @param {string} [locale] BCP 47 locale tag.
 * @returns {string|null} "Oct 9, 2026", or null for no instant.
 */
export function formatDateIn(value, timeZone = 'UTC', locale = DEFAULT_LOCALE) {
  const at = toDate(value)
  if (!at) return null

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: knownZone(timeZone),
  }).format(at)
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
 * @returns {string} A phrase such as `Lamplight Expo Hall, Edison`, or `Online` for a streamed event.
 */
export function formatEventLocation(event) {
  if (event?.isOnline) return 'Online'

  const venueName = event?.venue?.name ?? event?.venueName
  const city = event?.venue?.city ?? event?.city

  return [venueName, city].filter(Boolean).join(', ') || 'Venue to be announced'
}

/**
 * The country a venue's two-letter code names, in English, or null.
 *
 * @param {string|null|undefined} code An ISO 3166-1 alpha-2 code.
 * @returns {string|null} "Canada", or null for no code or one `Intl` cannot name.
 */
function countryName(code) {
  if (typeof code !== 'string' || !/^[A-Za-z]{2}$/u.test(code.trim())) return null

  const upper = code.trim().toUpperCase()

  try {
    const name = new Intl.DisplayNames(['en-US'], { type: 'region' }).of(upper)

    return name && name !== upper ? name : null
  } catch {
    return null
  }
}

/**
 * Format a full postal address as separate lines.
 *
 * The region and postal code share a line, as a US address writes them —
 * `Edison, NJ 08837` — and as a Canadian one does too — `Toronto, ON M5V 2T6`.
 * A venue outside the United States ends with its country, "Canada", because
 * the catalogue is mostly American and a province code alone is easy to
 * misread as a state.
 *
 * @param {object|null|undefined} venue A venue record.
 * @returns {string[]} Address lines, omitting the parts the venue does not have.
 */
export function formatVenueAddress(venue) {
  if (!venue) return []

  const locality = [venue.city, venue.region].filter(Boolean).join(', ')
  const country =
    typeof venue.country === 'string' && venue.country.trim().toUpperCase() !== 'US'
      ? countryName(venue.country)
      : null

  return [
    venue.addressLine1,
    venue.addressLine2,
    [locality, venue.postalCode].filter(Boolean).join(' '),
    country,
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
 * Whether an end belongs to the same evening as its start: under a day later,
 * on the next calendar day in the event's zone, and before the small hours are
 * over.
 *
 * @param {Date} start The start.
 * @param {Date} end The end.
 * @param {string} timeZone IANA zone of the event.
 * @returns {boolean} True for a night that simply runs past midnight.
 */
function isSameEvening(start, end, timeZone) {
  const elapsed = end.getTime() - start.getTime()
  if (elapsed <= 0 || elapsed >= 86_400_000) return false

  const calendarDay = (instant) =>
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).format(instant)
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone })
      .formatToParts(end)
      .find((part) => part.type === 'hour')?.value,
  )
  const nextDay = calendarDay(new Date(start.getTime() + 86_400_000))

  return calendarDay(end) === nextDay && hour < OVERNIGHT_END_HOUR
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

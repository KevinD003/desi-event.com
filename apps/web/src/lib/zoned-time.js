/**
 * Wall-clock time in a named zone, both ways.
 *
 * An event starts at seven in the evening *at the venue*. That is the fact the
 * organiser knows and the only one that survives a daylight-saving change, so
 * it is what the form collects: a local date and time, plus the zone it is
 * local to. The column stores UTC. This module is the conversion, and it exists
 * because getting it wrong is silent — an event an hour out looks exactly like
 * an event that is right until somebody misses the first act.
 *
 * `<input type="datetime-local">` has no time zone at all. It hands back
 * `YYYY-MM-DDTHH:mm` and means "whatever the person typed". Reading that with
 * `new Date(value)` interprets it in the *browser's* zone, which is how an
 * organiser in London schedules a Mumbai show for half past midnight.
 *
 * ## How the inverse works
 *
 * `Intl.DateTimeFormat` converts an instant to a zone's wall clock. Going the
 * other way has no primitive, so it is done by measurement: read the wall time
 * as though it were UTC, ask the zone what its offset is around then, subtract
 * it, and check the answer once more in case the subtraction crossed a
 * daylight-saving boundary and changed the offset. Two passes settle every
 * case except the hour that does not exist in a spring-forward, where there is
 * no right answer and this gives the instant the clock jumps to.
 *
 * @module lib/zoned-time
 */

/**
 * Exactly what `<input type="datetime-local">` produces.
 *
 * Matched rather than handed to `new Date`, because `Date`'s parser is
 * famously willing: it will find a date in a surprising amount of prose and
 * return one rather than refusing. A field that silently turns a typo into a
 * timestamp in 1999 is worse than one that says it cannot read the value.
 *
 * @type {RegExp}
 */
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * A zone's offset from UTC at a given instant, in milliseconds.
 *
 * Positive east of Greenwich. Measured rather than tabulated, so the answer
 * comes from the platform's own zone database and follows it across a rule
 * change.
 *
 * @param {Date} instant The moment to measure at.
 * @param {string} timeZone An IANA zone name.
 * @returns {number} Milliseconds to add to UTC to get local time.
 */
export function zoneOffsetMs(instant, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  )

  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )

  return wallAsUtc - instant.getTime()
}

/**
 * Whether a string names a zone this platform knows.
 *
 * Asked rather than matched against a list: the list is the platform's, it
 * changes, and a form that refuses `Asia/Kolkata` because somebody's array is
 * out of date is worse than one that trusts the zone database.
 *
 * @param {string} timeZone A candidate IANA zone name.
 * @returns {boolean} True when it resolves.
 */
export function isKnownTimeZone(timeZone) {
  if (!timeZone) return false

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * An instant, as the wall clock reads in a zone.
 *
 * The shape `<input type="datetime-local">` wants: `YYYY-MM-DDTHH:mm`, no
 * offset, no seconds.
 *
 * @param {string|Date|null|undefined} instant An ISO timestamp or a Date.
 * @param {string} timeZone An IANA zone name.
 * @returns {string} The input value, or an empty string when there is no instant.
 */
export function toLocalInputValue(instant, timeZone) {
  if (!instant) return ''

  const date = instant instanceof Date ? instant : new Date(instant)

  if (Number.isNaN(date.getTime())) return ''
  if (!isKnownTimeZone(timeZone)) return ''

  const shifted = new Date(date.getTime() + zoneOffsetMs(date, timeZone))

  return shifted.toISOString().slice(0, 16)
}

/**
 * A wall clock reading in a zone, as an instant.
 *
 * @param {string} value A `YYYY-MM-DDTHH:mm` value from a datetime-local input.
 * @param {string} timeZone An IANA zone name.
 * @returns {string|null} An ISO-8601 UTC timestamp, or null when the input is unusable.
 */
export function fromLocalInputValue(value, timeZone) {
  if (!LOCAL_INPUT.test(value ?? '')) return null
  if (!isKnownTimeZone(timeZone)) return null

  // Read what was typed as though it were already UTC. It is not, but it is a
  // fixed point to measure the offset around.
  const asIfUtc = new Date(`${value.length === 16 ? `${value}:00` : value}Z`)

  if (Number.isNaN(asIfUtc.getTime())) return null

  const firstGuess = new Date(asIfUtc.getTime() - zoneOffsetMs(asIfUtc, timeZone))

  // One correction. Subtracting the offset can land on the other side of a
  // daylight-saving boundary, where the offset is different and the first
  // answer is an hour out.
  const corrected = new Date(asIfUtc.getTime() - zoneOffsetMs(firstGuess, timeZone))

  return corrected.toISOString()
}

/**
 * A zone's current abbreviation, for a label beside the input.
 *
 * "IST" beside a time box is what tells somebody the box means seven in Mumbai
 * rather than seven where they are sitting.
 *
 * @param {string} timeZone An IANA zone name.
 * @param {Date} [at] The instant to read the abbreviation at; zones change it seasonally.
 * @returns {string} The abbreviation, or the zone name when there is none.
 */
export function zoneAbbreviation(timeZone, at = new Date(0)) {
  if (!isKnownTimeZone(timeZone)) return ''

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(at)

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone
}

/**
 * Zones an organiser on this platform is most likely to want.
 *
 * A starting list, not a limit: the field accepts any zone the platform knows.
 * Ordered by how often they will be picked here rather than alphabetically,
 * because a select whose first entry is `Africa/Abidjan` makes somebody scroll
 * past two hundred names to reach the one they always want.
 *
 * @type {ReadonlyArray<string>}
 */
export const COMMON_ZONES = Object.freeze([
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Australia/Sydney',
  'Asia/Singapore',
  'UTC',
])

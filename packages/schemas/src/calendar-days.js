/**
 * Calendar days where an event happens.
 *
 * A card states an event's start in the event's own timezone ("Sat, Oct 17 ·
 * 10:00 PM PDT"), so a visitor who asks for the 17th means the events a card
 * would put on the 17th — including that Vancouver show, which is already the
 * 18th in Toronto by then. And "Today" means today where the event is: a show
 * in Vancouver tonight is on today's list while it is still today in Vancouver.
 *
 * So a day filter is read once per timezone: in each zone, a day is the span
 * from that zone's midnight to the next, and an event matches when it starts
 * inside the span of its own zone. The API turns that into one condition per
 * zone; the web's offline catalogue applies the same rule event by event.
 *
 * Plain `Intl` arithmetic, so no answer depends on the timezone the process
 * happens to run in, and nothing here imports anything, so the browser can use
 * it as the API does.
 *
 * @module @desi-event/schemas/calendar-days
 */

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The named spans a visitor can ask for instead of choosing dates.
 *
 * - `today`: today.
 * - `weekend`: Friday to Sunday — the next one, or the one under way.
 * - `week`: today to Sunday.
 * - `month`: today to the last day of the month.
 *
 * @type {ReadonlyArray<string>}
 */
export const WHEN_PRESETS = Object.freeze(['today', 'weekend', 'week', 'month'])

/** Formatters by zone: building one is the slow part. */
const FORMATTERS = new Map()

/**
 * A formatter that writes an instant's wall-clock fields in a zone.
 *
 * @param {string} timeZone IANA zone.
 * @returns {Intl.DateTimeFormat} The formatter.
 */
function formatterFor(timeZone) {
  let formatter = FORMATTERS.get(timeZone)

  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    FORMATTERS.set(timeZone, formatter)
  }

  return formatter
}

/**
 * An instant's wall-clock fields in a zone.
 *
 * @param {string} timeZone IANA zone the runtime knows.
 * @param {number} instant Milliseconds since the epoch.
 * @returns {{year: number, month: number, day: number, hour: number, minute: number, second: number}} The fields; `month` is 1-12.
 */
function wallClock(timeZone, instant) {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(instant))
      .map((part) => [part.type, Number(part.value)]),
  )

  return parts
}

/**
 * How far a zone's wall clock is ahead of UTC at an instant.
 *
 * @param {string} timeZone IANA zone the runtime knows.
 * @param {number} instant Milliseconds since the epoch.
 * @returns {number} The offset in milliseconds; negative west of Greenwich.
 */
function offsetAt(timeZone, instant) {
  const { year, month, day, hour, minute, second } = wallClock(timeZone, instant)
  const wall = Date.UTC(year, month - 1, day, hour, minute, second)

  return wall - Math.floor(instant / 1000) * 1000
}

/**
 * Whether the runtime knows a zone.
 *
 * @param {unknown} timeZone Candidate IANA zone.
 * @returns {boolean} True when `Intl` accepts it.
 */
export function isKnownZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false

  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * Whether a string is a calendar day that exists, written `YYYY-MM-DD`.
 *
 * @param {unknown} value Candidate.
 * @returns {boolean} True for `2028-02-29`; false for `2026-02-30` or `17/10/2026`.
 */
export function isCalendarDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    year >= 1970 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * A calendar day so many days after another.
 *
 * @param {string} date `YYYY-MM-DD`.
 * @param {number} days How many days on; negative goes back.
 * @returns {string} The day, `YYYY-MM-DD`.
 */
export function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number)

  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10)
}

/**
 * The calendar day after a date.
 *
 * @param {string} date `YYYY-MM-DD`.
 * @returns {string} The next day, `YYYY-MM-DD`.
 */
export function nextDay(date) {
  return addDays(date, 1)
}

/**
 * The calendar day an instant falls on in a zone.
 *
 * @param {Date|number|string} instant The instant.
 * @param {string} timeZone IANA zone; one the runtime does not know reads as UTC.
 * @returns {string} `YYYY-MM-DD`.
 */
export function localDay(instant, timeZone) {
  const time = instant instanceof Date ? instant.getTime() : new Date(instant).getTime()

  if (!isKnownZone(timeZone)) return new Date(time).toISOString().slice(0, 10)

  const { year, month, day } = wallClock(timeZone, time)

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The instant a calendar day begins in a zone.
 *
 * Two passes, because the offset is read at a guess and the guess can sit on
 * the other side of a daylight-saving change from the answer.
 *
 * @param {string} date `YYYY-MM-DD`.
 * @param {string} timeZone IANA zone; one the runtime does not know reads as UTC.
 * @returns {Date} Midnight at the start of that day, in that zone.
 */
export function startOfDayIn(date, timeZone) {
  const [year, month, day] = date.split('-').map(Number)
  const wall = Date.UTC(year, month - 1, day)

  if (!isKnownZone(timeZone)) return new Date(wall)

  const first = wall - offsetAt(timeZone, wall)
  const second = wall - offsetAt(timeZone, first)

  return new Date(second)
}

/**
 * The days a named span covers in a zone, at a moment.
 *
 * @param {string} when One of {@link WHEN_PRESETS}.
 * @param {string} timeZone IANA zone.
 * @param {Date|number} [now] The moment "today" is read at.
 * @returns {{fromDate: string, toDate: string}|null} Both days inclusive; null for an unknown name.
 */
export function presetDays(when, timeZone, now = Date.now()) {
  const today = localDay(now instanceof Date ? now : new Date(now), timeZone)
  // 0 is Sunday, as `getUTCDay` counts.
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay()

  switch (when) {
    case 'today':
      return { fromDate: today, toDate: today }
    case 'weekend': {
      // Friday to Sunday: on a weekday before Friday, the next one; from
      // Friday on, what is left of this one.
      if (weekday === 0) return { fromDate: today, toDate: today }
      if (weekday >= 5) return { fromDate: today, toDate: addDays(today, 7 - weekday) }

      return { fromDate: addDays(today, 5 - weekday), toDate: addDays(today, 7 - weekday) }
    }
    case 'week':
      return { fromDate: today, toDate: addDays(today, (7 - weekday) % 7) }
    case 'month': {
      const [year, month] = today.split('-').map(Number)
      const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)

      return { fromDate: today, toDate: last }
    }
    default:
      return null
  }
}

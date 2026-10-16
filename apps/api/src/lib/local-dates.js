/**
 * The listing's day filters, as a `where` condition.
 *
 * `fromDate`/`toDate` and `when` are calendar days where each event happens
 * (`@desi-event/schemas/calendar-days`), so they cannot be one `startsAt`
 * range: the 17th begins at a different instant in Toronto and in Vancouver.
 * The condition has one branch per timezone the catalogue uses, each with that
 * zone's own span, and an event matches the branch of its own zone. The zones
 * are few, so the branches are too, and each is a `startsAt` range the
 * `[status, startsAt]` index serves.
 *
 * @module @desi-event/api/lib/local-dates
 */

import { nextDay, presetDays, startOfDayIn } from '@desi-event/schemas/calendar-days'

/**
 * The `startsAt` span one zone gives a day filter.
 *
 * @param {object} range The filter.
 * @param {string} [range.fromDate] The first day, `YYYY-MM-DD`.
 * @param {string} [range.toDate] The last day, `YYYY-MM-DD`.
 * @param {string} [range.when] A named span (`WHEN_PRESETS`).
 * @param {string} zone IANA zone.
 * @param {Date} now The moment a named span is read at.
 * @returns {{gte?: Date, lt?: Date}} The span; both ends are kept when both the dates and the name narrow it.
 */
function spanIn({ fromDate, toDate, when }, zone, now) {
  /** @type {Date[]} */
  const starts = []
  /** @type {Date[]} */
  const ends = []

  if (fromDate) starts.push(startOfDayIn(fromDate, zone))
  if (toDate) ends.push(startOfDayIn(nextDay(toDate), zone))

  const preset = when ? presetDays(when, zone, now) : null

  if (preset) {
    starts.push(startOfDayIn(preset.fromDate, zone))
    ends.push(startOfDayIn(nextDay(preset.toDate), zone))
  }

  /** @type {{gte?: Date, lt?: Date}} */
  const startsAt = {}
  if (starts.length > 0) startsAt.gte = new Date(Math.max(...starts.map(Number)))
  if (ends.length > 0) startsAt.lt = new Date(Math.min(...ends.map(Number)))

  return startsAt
}

/**
 * The `where` condition for "starts on one of these days, where it happens".
 *
 * @param {object} range The filter: `fromDate`/`toDate` (both inclusive) and/or `when`.
 * @param {string} [range.fromDate] The first day, `YYYY-MM-DD`.
 * @param {string} [range.toDate] The last day, `YYYY-MM-DD`.
 * @param {string} [range.when] A named span (`WHEN_PRESETS`).
 * @param {string[]} zones Every timezone an event in the catalogue uses.
 * @param {Date} [now] The moment a named span is read at.
 * @returns {object} A Prisma `where` fragment: one branch per zone.
 */
export function localDateCondition({ fromDate, toDate, when }, zones, now = new Date()) {
  const branches = [...new Set(zones)].map((zone) => ({
    timezone: zone,
    startsAt: spanIn({ fromDate, toDate, when }, zone, now),
  }))

  // No zones means no events to find: spelled as an id nothing has, so it
  // cannot be read as "no condition".
  return branches.length > 0 ? { OR: branches } : { id: { in: [] } }
}

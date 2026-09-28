/**
 * Every time zone an organiser might need, with the common ones first.
 *
 * The server accepts any IANA zone the runtime knows, so the form offers all of
 * them rather than a short list that sends somebody in Chicago to a text box.
 * `Intl.supportedValuesOf('timeZone')` is the list; a runtime without it falls
 * back to the common zones, which is what the form offered before.
 *
 * @module lib/time-zones
 */

import { COMMON_ZONES } from './zoned-time.js'

/**
 * Every zone this runtime knows.
 *
 * @returns {string[]} IANA names, sorted; the common list when the runtime cannot say.
 */
export function allTimeZones() {
  try {
    const zones = Intl.supportedValuesOf?.('timeZone')

    if (Array.isArray(zones) && zones.length > 0) {
      // Some runtimes list only canonical names — `Asia/Calcutta` rather than
      // `Asia/Kolkata` — and leave out `UTC` although they accept both. The
      // common zones are always included, so the names organisers know are there.
      return [...new Set([...zones, ...COMMON_ZONES])].sort()
    }
  } catch {
    // Fall through to the common list.
  }

  return [...COMMON_ZONES].sort()
}

/**
 * The two groups the select shows.
 *
 * The current value is always present, even when this runtime does not list
 * it: a stored zone is never silently replaced by the first option.
 *
 * @param {string} current The zone selected now.
 * @param {string[]} [all] Every zone, from {@link allTimeZones}; the common list when omitted.
 * @returns {{common: string[], others: string[]}} The common zones, and every other one.
 */
export function zoneGroups(current, all = [...COMMON_ZONES]) {
  const common = [...COMMON_ZONES]

  if (current && !common.includes(current) && !all.includes(current)) {
    common.unshift(current)
  }

  const listed = new Set(common)

  return { common, others: all.filter((zone) => !listed.has(zone)) }
}

/**
 * An event's nights, as a buyer reads them.
 *
 * A multi-night event sells tickets for one night or for every night, and the
 * only thing worse than not saying which is saying it wrongly. So a night is
 * always labelled truthfully: the organiser's label ("Night 2") beside the
 * night's own date and time, or the date and time alone when there is no
 * label. Times are read in the night's own zone — the local time at the venue —
 * never the browser's.
 *
 * Pure: no React, no fetch, safe in a browser bundle.
 *
 * @module lib/sessions
 */

/** What a tier good for every night is called when there is more than one night. */
export const EVERY_NIGHT = 'Every night'

/**
 * A date and time in a zone, as `Fri, Oct 3 · 7:30 PM`.
 *
 * @param {string|Date} value An instant.
 * @param {string} timeZone An IANA zone.
 * @returns {string|null} The reading, or null for an instant that cannot be read.
 */
export function formatNightTime(value, timeZone) {
  const instant = new Date(value)

  if (Number.isNaN(instant.getTime())) return null

  try {
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(instant)
    const time = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(instant)

    return `${date} · ${time}`
  } catch {
    return instant.toISOString()
  }
}

/**
 * A night's label, always true: its name and its date, or its date alone.
 *
 * @param {{label?: string|null, startsAt: string|Date, timezone?: string}|null|undefined} session The night.
 * @param {object} [options] Options.
 * @param {string} [options.timeZone] Read the time in this zone instead of the night's own.
 * @returns {string} For example `Night 2 · Fri, Oct 3 · 7:30 PM`; empty for no night.
 */
export function sessionDisplayLabel(session, { timeZone } = {}) {
  if (!session) return ''

  const zone = timeZone ?? session.timezone ?? 'UTC'
  const when = formatNightTime(session.startsAt, zone)
  const label = typeof session.label === 'string' ? session.label.trim() : ''

  return [label, when].filter(Boolean).join(' · ')
}

/**
 * The night a tier is for, or null for a tier good for every night.
 *
 * @param {{eventSessionId?: string|null}} tier A ticket type.
 * @param {Array<{id: string}>} sessions The event's nights.
 * @returns {object|null} The night.
 */
export function sessionForTier(tier, sessions = []) {
  if (!tier?.eventSessionId) return null

  return sessions.find((session) => session.id === tier.eventSessionId) ?? null
}

/**
 * The night a ticket is for, as the API named it.
 *
 * @param {{session?: object|null}} ticket A wallet ticket or a ticket page's ticket.
 * @returns {object|null} The night, or null for a ticket good for every night.
 */
export function sessionForTicket(ticket) {
  return ticket?.session ?? null
}

/**
 * Group tiers under their nights, soonest first, keeping each tier's order.
 *
 * With one night or none, there is nothing to tell apart, so every tier comes
 * back in one group with no heading. With several, each night with a tier gets
 * a group headed by its label, and tiers good for every night come last under
 * `Every night`. A tier naming a night the event does not list is treated as
 * good for every night rather than dropped: showing it under the wrong heading
 * would be worse than showing it under a general one, and dropping it would
 * hide something that is on sale.
 *
 * @param {object[]} tiers The event's ticket types, in display order.
 * @param {object[]} sessions The event's nights.
 * @returns {Array<{key: string, session: object|null, heading: string|null, tiers: object[]}>} The groups.
 */
export function groupTiersBySession(tiers = [], sessions = []) {
  if (sessions.length <= 1) {
    return tiers.length === 0 ? [] : [{ key: 'all', session: null, heading: null, tiers }]
  }

  const ordered = [...sessions].sort(
    (left, right) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
      (left.sortOrder ?? 0) - (right.sortOrder ?? 0),
  )
  const groups = ordered.map((session) => ({
    key: session.id,
    session,
    heading: sessionDisplayLabel(session),
    tiers: [],
  }))
  const byId = new Map(groups.map((group) => [group.key, group]))
  const everyNight = { key: 'every-night', session: null, heading: EVERY_NIGHT, tiers: [] }

  for (const tier of tiers) {
    const group = tier.eventSessionId ? byId.get(tier.eventSessionId) : null

    ;(group ?? everyNight).tiers.push(tier)
  }

  return [...groups, everyNight].filter((group) => group.tiers.length > 0)
}

/**
 * Whether a night with a seat map is selling seats now, as far as the event
 * page can tell: on sale, inside its window, with a free seat.
 *
 * The seat map says more (which tier each seat is sold under, and whether that
 * tier is selling); this only decides whether to offer the way there.
 *
 * @param {object|null} session A public night from `events.get`.
 * @param {Date} [now] The moment in question.
 * @returns {boolean} True when a "Choose seats" link leads somewhere that sells.
 */
export function sessionSellsSeats(session, now = new Date()) {
  if (!session?.hasSeatMap) return false
  if (!['SCHEDULED', 'ON_SALE'].includes(session.status)) return false
  if (!Number.isInteger(session.seatsAvailable) || session.seatsAvailable <= 0) return false

  const at = now.getTime()

  if (session.salesStartAt && at < new Date(session.salesStartAt).getTime()) return false

  const end = session.salesEndAt ?? session.endsAt

  return !(end && at >= new Date(end).getTime())
}

/**
 * Whether every seated tier of a night has no seat left.
 *
 * A night's `seatsAvailable` counts the seats a buyer could take now, so zero
 * can mean sold out or can mean its tiers are not on sale at the moment. Only
 * the tiers tell the two apart: sold out is every tier selling its seats with
 * none left.
 *
 * @param {object} session A public night.
 * @param {object[]} tiers The event's tiers, with availability folded in.
 * @returns {boolean} True when the night's seated tiers are all sold out.
 */
function seatedTiersSoldOut(session, tiers) {
  const seated = tiers.filter((tier) => tier.reserved && tier.eventSessionId === session.id)

  return (
    seated.length > 0 &&
    seated.every(
      (tier) =>
        tier.status === 'SOLD_OUT' || (tier.status === 'ON_SALE' && tier.availableQuantity === 0),
    )
  )
}

/**
 * The words for a night's state on the public page, or null when on sale.
 *
 * Words, never a colour alone; and nothing a buyer cannot act on.
 *
 * @param {object} session A public night.
 * @param {Date} [now] The moment in question.
 * @param {object[]} [tiers] The event's tiers, to tell a sold-out seated night from one not selling now.
 * @returns {{text: string, variant: string}} The badge.
 */
export function sessionStatusBadge(session, now = new Date(), tiers = []) {
  if (session?.status === 'CANCELLED') return { text: 'Cancelled', variant: 'danger' }
  if (session?.status === 'SOLD_OUT') return { text: 'Sold out', variant: 'danger' }
  if (session?.status === 'SALES_PAUSED') return { text: 'Sales paused', variant: 'neutral' }
  if (session?.status === 'COMPLETED') return { text: 'Finished', variant: 'neutral' }

  const noSeatNow = Boolean(session?.hasSeatMap) && session.seatsAvailable === 0

  if (noSeatNow && seatedTiersSoldOut(session, tiers)) {
    return { text: 'Sold out', variant: 'danger' }
  }

  const at = now.getTime()

  if (session?.salesStartAt && at < new Date(session.salesStartAt).getTime()) {
    return { text: 'Not on sale now', variant: 'neutral' }
  }

  const end = session?.salesEndAt ?? session?.endsAt

  if (end && at >= new Date(end).getTime()) return { text: 'Sales closed', variant: 'neutral' }

  // Nothing a buyer can take now, and not because it sold: its tiers are not
  // on sale at the moment.
  if (noSeatNow) return { text: 'Not on sale now', variant: 'neutral' }

  return { text: 'On sale', variant: 'success' }
}

/**
 * The host of a joining link, to name it in the link's own words.
 *
 * @param {string} url The joining link.
 * @returns {string|null} The host, e.g. `stream.example.com`, or null for a link that is not one.
 */
export function joinLinkHost(url) {
  try {
    const parsed = new URL(url)

    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : null
  } catch {
    return null
  }
}

/**
 * Booking a hidden or complimentary tier, as the organisation's own team.
 *
 * A hidden tier is a guest list or a team allocation: left off the event page
 * for everybody else, and bookable through the ordinary checkout by members
 * holding `ticketType:manage` in the event's organisation (the API's rule,
 * `mayBookHiddenTier`). The public pages read the event without the viewer's
 * session, so they never see such a tier, and nor did the checkout — so the
 * team had no way to book one from the site.
 *
 * These reads are the team's half of the checkout and seat pages: made as the
 * signed-in viewer, forwarding their cookie and nothing else, and only when
 * the viewer's session says they may book a hidden tier here. The API decides
 * again on every hold and order; this only decides what the pages offer.
 * Tickets booked this way land in the booker's own account, and each can be
 * handed on with a transfer code from their tickets page.
 *
 * Server-only: it reads the request's cookies.
 *
 * @module lib/team-booking
 */

import { withTicketTypeAvailability } from './api.js'
import { sessionCan } from './capabilities.js'
import { callApi } from './organizer-api.js'

/** The capability the API asks for before it books a hidden tier. */
export const TEAM_BOOKING_CAPABILITY = 'ticketType:manage'

/**
 * Whether this session may book the event's hidden tiers.
 *
 * @param {object|null} session The session payload from `readSession`.
 * @param {{organizationId?: string}|null} event The event.
 * @returns {boolean} True for a member holding `ticketType:manage` in its organisation.
 */
export function mayBookTeamTiers(session, event) {
  if (!session || !event?.organizationId) return false

  return sessionCan(session, TEAM_BOOKING_CAPABILITY, event.organizationId)
}

/**
 * The tiers a team member can book: every tier but a draft, hidden ones included.
 *
 * A draft tier is not on sale to anybody, so offering it would only produce a
 * refusal.
 *
 * @param {object} event An event detail read as the team member.
 * @returns {object[]} Its bookable tiers, with availability worked out.
 */
export function teamTicketTypes(event) {
  const withAvailability = withTicketTypeAvailability(event)

  return (withAvailability?.ticketTypes ?? []).filter((tier) => tier.status !== 'DRAFT')
}

/**
 * Whether any of these tiers is hidden from the public.
 *
 * @param {object[]} ticketTypes Tiers.
 * @returns {boolean} True when at least one is `HIDDEN`.
 */
export function hasHiddenTier(ticketTypes) {
  return (ticketTypes ?? []).some((tier) => tier.visibility === 'HIDDEN')
}

/**
 * The event's tiers as its team sees them, or null when that read fails.
 *
 * @param {string} slug The event's slug.
 * @param {object} [options] Overrides.
 * @param {Function} [options.call] The API call; supplied by tests.
 * @returns {Promise<object[]|null>} The tiers, or null.
 */
export async function loadTeamTicketTypes(slug, { call = callApi } = {}) {
  try {
    const body = await call(`/v1/events/${encodeURIComponent(slug)}`)

    return body?.data ? teamTicketTypes(body.data) : null
  } catch {
    return null
  }
}

/**
 * One night's seat map as the team sees it — hidden tiers' seats included — or
 * null when that read fails.
 *
 * @param {string} sessionId The night.
 * @param {object} [options] Overrides.
 * @param {Function} [options.call] The API call; supplied by tests.
 * @returns {Promise<object|null>} The map's `data`, or null.
 */
export async function loadTeamSeatMap(sessionId, { call = callApi } = {}) {
  try {
    const body = await call(`/v1/sessions/${encodeURIComponent(sessionId)}/seats`)

    return body?.data ?? null
  } catch {
    return null
  }
}

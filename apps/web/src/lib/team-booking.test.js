/**
 * The team's half of the checkout: who is offered hidden tiers, which tiers,
 * and what happens when the team's read fails.
 *
 * @module lib/team-booking.test
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('./organizer-api.js', () => ({ callApi: vi.fn() }))

const { hasHiddenTier, loadTeamSeatMap, loadTeamTicketTypes, mayBookTeamTiers, teamTicketTypes } =
  await import('./team-booking.js')

/**
 * A session with one membership.
 *
 * @param {string[]} capabilities What the membership holds.
 * @param {string} [organizationId] Where.
 * @returns {object} The session payload.
 */
function member(capabilities, organizationId = 'org-a') {
  return {
    user: { id: 'u1', displayName: 'Meera', email: 'meera@example.test' },
    capabilities: [],
    memberships: [{ organizationId, role: 'EVENT_MANAGER', capabilities }],
  }
}

const EVENT = { id: 'ev1', slug: 'garba-night', organizationId: 'org-a' }

/**
 * A tier.
 *
 * @param {object} fields What differs.
 * @returns {object} The tier.
 */
function tier(fields) {
  return {
    id: fields.id,
    name: fields.id,
    priceCents: 2_000,
    currency: 'USD',
    quantityTotal: 10,
    quantitySold: 0,
    status: 'ON_SALE',
    visibility: 'PUBLIC',
    ...fields,
  }
}

describe('who is offered the hidden tiers', () => {
  it('is a member holding ticketType:manage in the event’s organisation', () => {
    expect(mayBookTeamTiers(member(['ticketType:manage']), EVENT)).toBe(true)
  })

  it('is not a member of another organisation, one without the capability, or nobody', () => {
    expect(mayBookTeamTiers(member(['ticketType:manage'], 'org-b'), EVENT)).toBe(false)
    expect(mayBookTeamTiers(member(['event:view_draft']), EVENT)).toBe(false)
    expect(mayBookTeamTiers(null, EVENT)).toBe(false)
    expect(mayBookTeamTiers(member(['ticketType:manage']), { id: 'ev1' })).toBe(false)
  })

  it('is a platform administrator, as the API has it', () => {
    const admin = { ...member([], 'org-z'), capabilities: ['platform:admin'] }

    expect(mayBookTeamTiers(admin, EVENT)).toBe(true)
  })
})

describe('which tiers the team is offered', () => {
  it('every tier but a draft, hidden ones included, with availability worked out', () => {
    const tiers = teamTicketTypes({
      ...EVENT,
      ticketTypes: [
        tier({ id: 'public' }),
        tier({ id: 'guest-list', visibility: 'HIDDEN', priceCents: 0, complimentary: true }),
        tier({ id: 'draft', status: 'DRAFT' }),
      ],
    })

    expect(tiers.map((row) => row.id)).toEqual(['public', 'guest-list'])
    expect(tiers[1]).toMatchObject({ availableQuantity: 10, isSoldOut: false })
    expect(hasHiddenTier(tiers)).toBe(true)
    expect(hasHiddenTier([tiers[0]])).toBe(false)
  })
})

describe('the team’s reads', () => {
  it('reads the event as the viewer, by its slug', async () => {
    const call = vi.fn(async () => ({
      data: { ...EVENT, ticketTypes: [tier({ id: 'crew', visibility: 'HIDDEN' })] },
    }))

    const tiers = await loadTeamTicketTypes('garba night', { call })

    expect(call).toHaveBeenCalledWith('/v1/events/garba%20night')
    expect(tiers.map((row) => row.id)).toEqual(['crew'])
  })

  it('answers null when the read fails, so the page keeps the public tiers', async () => {
    const call = vi.fn(async () => {
      throw Object.assign(new Error('The API answered 503.'), { status: 503 })
    })

    expect(await loadTeamTicketTypes('garba-night', { call })).toBeNull()
    expect(await loadTeamSeatMap('night-1', { call })).toBeNull()
  })

  it('reads a night’s seat map as the viewer', async () => {
    const call = vi.fn(async () => ({ data: { sessionId: 'night-1', eventId: 'ev1' } }))

    expect(await loadTeamSeatMap('night-1', { call })).toEqual({
      sessionId: 'night-1',
      eventId: 'ev1',
    })
    expect(call).toHaveBeenCalledWith('/v1/sessions/night-1/seats')
  })
})

/**
 * Who a public page counts is decided on the server from the session, and the
 * browser is handed only the answer: staff are left out everywhere, an
 * organisation's own team on its own events, and nobody else.
 *
 * @module components/traffic-scope.test
 */

import { PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../lib/session.js')
const { TrafficBeacons } = await import('./traffic-beacons.jsx')
const { TrafficScope } = await import('./traffic-scope.jsx')

const EVENT = 'cevent00000000000000001'
const ORG = 'corg000000000000000001'

beforeEach(() => {
  readSession.mockReset()
})

/**
 * What the scope hands the browser for a session.
 *
 * @param {object|null} session The session `readSession` answers.
 * @param {object|null} [view] The page's event.
 * @returns {Promise<object>} The client component's props.
 */
async function handedOn(session, view = null) {
  readSession.mockResolvedValue(session)

  const element = await TrafficScope({ view })

  expect(element.type).toBe(TrafficBeacons)

  return element.props
}

describe('TrafficScope', () => {
  it('counts a signed-out visitor', async () => {
    expect(await handedOn(null, { eventId: EVENT, organizationId: ORG })).toEqual({
      view: { eventId: EVENT, organizationId: ORG },
      excludeAll: false,
      excludedOrganizationIds: [],
    })
  })

  it('counts an attendee and an organiser looking at somebody else’s events', async () => {
    expect(
      await handedOn({ platformRole: 'ATTENDEE', capabilities: [], memberships: [] }),
    ).toMatchObject({ excludeAll: false, excludedOrganizationIds: [] })
  })

  it('leaves out every member of an organisation on its own events, whatever their role', async () => {
    const props = await handedOn({
      platformRole: 'ORGANIZER',
      capabilities: [],
      memberships: [
        { organizationId: ORG, role: 'OWNER', capabilities: ['report:view'] },
        { organizationId: 'corg000000000000000002', role: 'SCANNER', capabilities: [] },
      ],
    })

    expect(props.excludeAll).toBe(false)
    expect(props.excludedOrganizationIds).toEqual([ORG, 'corg000000000000000002'])
  })

  it.each(['SUPPORT', 'MODERATOR', 'FINANCE_ADMIN', 'ADMIN', 'SUPER_ADMIN'])(
    'leaves a %s out everywhere',
    async (role) => {
      const props = await handedOn({
        platformRole: role,
        capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]],
        memberships: [],
      })

      expect(props.excludeAll).toBe(true)
    },
  )

  it('hands the browser booleans and ids, never a capability name', async () => {
    const props = await handedOn({
      platformRole: 'SUPER_ADMIN',
      capabilities: [...PLATFORM_ROLE_CAPABILITIES.SUPER_ADMIN],
      memberships: [{ organizationId: ORG, role: 'OWNER', capabilities: ['report:view'] }],
    })

    expect(Object.keys(props).sort()).toEqual(['excludeAll', 'excludedOrganizationIds', 'view'])
    expect(JSON.stringify(props)).not.toMatch(/[a-z_]+:[a-z_]+/u)
  })
})

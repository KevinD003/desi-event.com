import { ORG_ROLE_CAPABILITIES, PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import {
  belongsTo,
  editsAsPlatform,
  organizerEventIdFromPath,
  platformEditorRedirect,
} from './platform-editor.js'

/**
 * A session holding one platform role, and optionally one membership.
 *
 * @param {string} role A platform role.
 * @param {string|null} [organizationId] An organisation it belongs to.
 * @returns {object} The session.
 */
function platform(role, organizationId = null) {
  return {
    user: { id: 'u1' },
    capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]],
    memberships: organizationId
      ? [{ organizationId, role: 'OWNER', capabilities: [...ORG_ROLE_CAPABILITIES.OWNER] }]
      : [],
  }
}

const EVENT = { id: 'cevent0000000000000000001', organizationId: 'org_1' }

describe('which path names an organiser’s editor', () => {
  it('finds the event id, with or without a query or a trailing slash', () => {
    expect(organizerEventIdFromPath(`/organizer/events/${EVENT.id}`)).toBe(EVENT.id)
    expect(organizerEventIdFromPath(`/organizer/events/${EVENT.id}/?step=media`)).toBe(EVENT.id)
  })

  it('names no event for the new-event page, the list, or anywhere else', () => {
    expect(organizerEventIdFromPath('/organizer/events/new')).toBeNull()
    expect(organizerEventIdFromPath('/organizer/events')).toBeNull()
    expect(organizerEventIdFromPath('/organizer/events/x/more')).toBeNull()
    expect(organizerEventIdFromPath('/admin/events/x')).toBeNull()
    expect(organizerEventIdFromPath(null)).toBeNull()
    expect(organizerEventIdFromPath('/organizer/events/%E0%A4%A')).toBeNull()
  })
})

describe('who is sent to the Desi-Event team’s editor', () => {
  it('sends a platform administrator and a super administrator who are not members', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      expect(platformEditorRedirect(platform(role), EVENT), role).toBe(`/admin/events/${EVENT.id}`)
    }
  })

  it('leaves a platform administrator who belongs to the organisation in its editor', () => {
    expect(platformEditorRedirect(platform('ADMIN', 'org_1'), EVENT)).toBeNull()
    expect(belongsTo(platform('ADMIN', 'org_1'), 'org_1')).toBe(true)
  })

  it('sends a member of another organisation all the same', () => {
    expect(platformEditorRedirect(platform('SUPER_ADMIN', 'org_2'), EVENT)).toBe(
      `/admin/events/${EVENT.id}`,
    )
  })

  it('never sends an organiser, a moderator or a finance administrator', () => {
    for (const role of ['MODERATOR', 'SUPPORT', 'FINANCE_ADMIN']) {
      if (!PLATFORM_ROLE_CAPABILITIES[role]) continue

      expect(editsAsPlatform(platform(role)), role).toBe(false)
      expect(platformEditorRedirect(platform(role), EVENT), role).toBeNull()
    }

    const owner = {
      user: { id: 'u2' },
      capabilities: [],
      memberships: [
        { organizationId: 'org_1', role: 'OWNER', capabilities: [...ORG_ROLE_CAPABILITIES.OWNER] },
      ],
    }

    expect(platformEditorRedirect(owner, EVENT)).toBeNull()
    expect(platformEditorRedirect(null, EVENT)).toBeNull()
    expect(platformEditorRedirect(platform('ADMIN'), null)).toBeNull()
  })
})

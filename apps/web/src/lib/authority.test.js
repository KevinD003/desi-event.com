/**
 * The bar says which platform reach a session carries, read from the same
 * capabilities the rest of the navigation reads.
 *
 * @module lib/authority.test
 */

import { PLATFORM_ROLE_CAPABILITIES } from '@desi-event/permissions'
import { describe, expect, it } from 'vitest'

import { AUTHORITIES, platformAuthority } from './authority.js'

/**
 * A session holding one platform role.
 *
 * @param {string} role The role.
 * @returns {object} The session.
 */
function platform(role) {
  return { capabilities: [...PLATFORM_ROLE_CAPABILITIES[role]], memberships: [] }
}

describe('platformAuthority', () => {
  it('marks a super administrator, the one role that changes platform roles, in gold', () => {
    expect(platformAuthority(platform('SUPER_ADMIN'))).toBe(AUTHORITIES.super)
    expect(AUTHORITIES.super.label).toBe('Super administrator')
  })

  it('badges a platform administrator', () => {
    expect(platformAuthority(platform('ADMIN'))).toBe(AUTHORITIES.admin)
    expect(AUTHORITIES.admin.label).toBe('Platform administrator')
  })

  it.each(['ATTENDEE', 'ORGANIZER', 'SUPPORT', 'MODERATOR', 'FINANCE_ADMIN'])(
    'says nothing for %s, whose reach is not every organisation’s',
    (role) => {
      expect(platformAuthority(platform(role))).toBeNull()
    },
  )

  it('says nothing without a session, and believes no membership claiming the capability', () => {
    expect(platformAuthority(null)).toBeNull()
    expect(
      platformAuthority({
        capabilities: [],
        memberships: [{ organizationId: 'org_1', capabilities: ['platform:admin'] }],
      }),
    ).toBeNull()
  })

  it('says what the reach means in plain words, with no dash, promising only what is recorded', () => {
    for (const authority of Object.values(AUTHORITIES)) {
      expect(authority.line).toMatch(/Each change is recorded against your account\.$/u)
      expect(authority.line).not.toMatch(/[—–]/u)
    }
  })
})

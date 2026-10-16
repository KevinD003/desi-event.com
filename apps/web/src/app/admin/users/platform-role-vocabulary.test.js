/**
 * The platform role vocabulary says what the API and the session policy say.
 *
 * The lists are written out so the client controls do not pull the schemas
 * barrel or the credential package into the browser. Here, where nothing is
 * bundled, they are held to the originals.
 *
 * @module app/admin/users/platform-role-vocabulary.test
 */

import {
  PRIVILEGED_ORG_ROLES as SESSION_ORG_ROLES,
  PRIVILEGED_PLATFORM_ROLES as SESSION_PLATFORM_ROLES,
} from '@desi-event/auth/sessions'
import { ORG_ROLES, USER_ROLES } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import {
  GRANTABLE_ORG_ROLES,
  PLATFORM_ROLES,
  PLATFORM_ROLE_DESCRIPTIONS,
  PLATFORM_ROLE_LABELS,
  PRIVILEGED_ORG_ROLES,
  PRIVILEGED_PLATFORM_ROLES,
  platformRoleLabel,
} from './platform-role-vocabulary.js'

describe('the platform role vocabulary', () => {
  it('offers exactly the platform roles the API accepts, each named and described', () => {
    expect([...PLATFORM_ROLES].sort()).toEqual([...USER_ROLES].sort())

    for (const role of PLATFORM_ROLES) {
      expect(PLATFORM_ROLE_LABELS[role], role).toBeTruthy()
      expect(PLATFORM_ROLE_DESCRIPTIONS[role], role).toBeTruthy()
    }

    expect(platformRoleLabel('SUPER_ADMIN')).toBe('Super administrator')
  })

  it('offers every organisation role for a grant, owner first', () => {
    expect([...GRANTABLE_ORG_ROLES].sort()).toEqual([...ORG_ROLES].sort())
    expect(GRANTABLE_ORG_ROLES[0]).toBe('OWNER')
  })

  it('warns about a second factor for exactly the roles the session policy demands one of', () => {
    expect([...PRIVILEGED_PLATFORM_ROLES].sort()).toEqual([...SESSION_PLATFORM_ROLES].sort())
    expect([...PRIVILEGED_ORG_ROLES].sort()).toEqual([...SESSION_ORG_ROLES].sort())
  })

  it('names the platform administrator, below the super administrator, and marks it privileged', () => {
    expect(PLATFORM_ROLES.indexOf('ADMIN')).toBe(PLATFORM_ROLES.indexOf('SUPER_ADMIN') - 1)
    expect(platformRoleLabel('ADMIN')).toBe('Platform administrator')
    expect(PLATFORM_ROLE_DESCRIPTIONS.ADMIN).toBe(
      'Everything a super administrator can do — every event, organisation, refund, report and door, and putting people into organisations — except changing anybody’s platform role. Needs two-step sign-in.',
    )
    expect(PRIVILEGED_PLATFORM_ROLES).toContain('ADMIN')
  })

  it('never says soon, yet or planned', () => {
    for (const text of [
      ...Object.values(PLATFORM_ROLE_LABELS),
      ...Object.values(PLATFORM_ROLE_DESCRIPTIONS),
    ]) {
      expect(text).not.toMatch(/\b(soon|yet|planned)\b/i)
    }
  })
})

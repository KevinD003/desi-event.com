/**
 * Membership, not platform role, decides whether a reviewer is told that
 * somebody else decides.
 *
 * @module lib/review-independence.test
 */

import { describe, expect, it } from 'vitest'

import { CONFLICT_OF_INTEREST_NOTICE, belongsTo } from './review-independence.js'

describe('belongsTo', () => {
  it('is true only for a membership in that organisation', () => {
    const session = {
      capabilities: ['moderation:review'],
      memberships: [{ organizationId: 'org1', role: 'VIEWER', capabilities: [] }],
    }

    expect(belongsTo(session, 'org1')).toBe(true)
    expect(belongsTo(session, 'org2')).toBe(false)
  })

  it('is false for a platform role with no membership, and for no organisation', () => {
    const platform = { capabilities: ['moderation:review', 'platform:admin'], memberships: [] }

    expect(belongsTo(platform, 'org1')).toBe(false)
    expect(belongsTo({ memberships: [{ organizationId: 'org1' }] }, null)).toBe(false)
    expect(belongsTo(null, 'org1')).toBe(false)
  })

  it('says who decides in the API’s words', () => {
    expect(CONFLICT_OF_INTEREST_NOTICE).toBe(
      'You belong to this organisation, so somebody else on the team at The Desi Events has to decide this.',
    )
  })
})

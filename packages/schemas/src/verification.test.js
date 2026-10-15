/**
 * The moderators' verification queue and review: what may be asked for, and
 * what may come back.
 */

import { describe, expect, it } from 'vitest'

import {
  verificationQueueQuerySchema,
  verificationQueueResponseSchema,
  verificationReviewResponseSchema,
} from './verification.js'

const ORG_ID = 'ckl1a2b3c4d5e6f7g8h9i0ja'

describe('verificationQueueQuerySchema', () => {
  it('opens on the organisations waiting for a moderator', () => {
    expect(verificationQueueQuerySchema.parse({})).toEqual({
      status: 'PENDING',
      page: 1,
      perPage: 20,
    })
  })

  it('filters by any state somebody has asked to be judged in', () => {
    for (const status of ['REQUIRES_INFORMATION', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'REVOKED']) {
      expect(verificationQueueQuerySchema.parse({ status }).status).toBe(status)
    }
  })

  it('refuses UNVERIFIED, which is not a queue: nobody has asked', () => {
    expect(verificationQueueQuerySchema.safeParse({ status: 'UNVERIFIED' }).success).toBe(false)
  })
})

describe('verification responses', () => {
  it('never carry the organisation contact address', () => {
    const queue = verificationQueueResponseSchema.parse({
      data: [
        {
          organizationId: ORG_ID,
          name: 'Bay Lights',
          slug: 'bay-lights',
          legalName: null,
          status: 'PENDING',
          submittedAt: '2026-09-01T00:00:00.000Z',
          createdAt: '2026-08-01T00:00:00.000Z',
          organiserNote: 'We run four nights a year.',
          memberCount: 2,
          eventCount: 0,
          contactEmail: 'owner@example.com',
        },
      ],
      pagination: {
        page: 1,
        perPage: 20,
        total: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    })

    const review = verificationReviewResponseSchema.parse({
      data: {
        organization: {
          id: ORG_ID,
          name: 'Bay Lights',
          slug: 'bay-lights',
          description: null,
          websiteUrl: null,
          timezone: 'America/New_York',
          legalName: null,
          verificationStatus: 'PENDING',
          eligible: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          contactEmail: 'owner@example.com',
        },
        verification: {
          organizationId: ORG_ID,
          status: 'PENDING',
          eligible: false,
          note: null,
          updatedAt: '2026-09-01T00:00:00.000Z',
          history: [],
        },
        memberCount: 2,
        eventCount: 0,
      },
    })

    expect(JSON.stringify(queue)).not.toContain('owner@example.com')
    expect(JSON.stringify(review)).not.toContain('owner@example.com')
  })
})

import { describe, expect, it } from 'vitest'

import {
  ATTENDEE_ONLY_MESSAGE,
  currentSessionResponseSchema,
  registerAccountRequestSchema,
} from './auth.js'

/** A minimal valid registration body. */
const REGISTRATION = {
  email: '  Priya@Example.COM ',
  password: 'garba-nights-2026',
  displayName: '  Priya Sharma  ',
}

describe('registerAccountRequestSchema', () => {
  it('creates attendee accounts, and defaults to one', () => {
    expect(registerAccountRequestSchema.parse(REGISTRATION)).toMatchObject({
      email: 'priya@example.com',
      displayName: 'Priya Sharma',
      role: 'ATTENDEE',
    })
    expect(registerAccountRequestSchema.parse({ ...REGISTRATION, role: 'ATTENDEE' }).role).toBe(
      'ATTENDEE',
    )
  })

  it.each(['ORGANIZER', 'ADMIN', 'SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'FINANCE_ADMIN', 'OWNER'])(
    'refuses %s with the sentence that says how organisers join',
    (role) => {
      const result = registerAccountRequestSchema.safeParse({ ...REGISTRATION, role })

      expect(result.success).toBe(false)
      expect(result.error.issues).toEqual([
        expect.objectContaining({ path: ['role'], message: ATTENDEE_ONLY_MESSAGE }),
      ])
    },
  )

  it('says organisers join by invitation from the team at The Desi Events', () => {
    expect(ATTENDEE_ONLY_MESSAGE).toBe(
      'Accounts are created as attendees. Organisers join by invitation from the team at The Desi Events.',
    )
  })
})

describe('currentSessionResponseSchema', () => {
  const ME = {
    user: {
      id: 'ckl1a2b3c4d5e6f7g8h9i0ja',
      email: 'priya@example.com',
      displayName: 'Priya Sharma',
      phone: null,
      locale: 'en-US',
      role: 'ATTENDEE',
      emailVerified: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    capabilities: [],
    memberships: [],
    session: {
      id: 'ckl1a2b3c4d5e6f7g8h9i0jb',
      expiresAt: '2026-10-01T00:00:00.000Z',
      stepUpSatisfied: false,
      mfaRequired: false,
      mfaEnrolled: false,
    },
  }

  it.each(['MANUAL', 'EMAIL'])('carries the delivery mode %s', (deliveryMode) => {
    expect(
      currentSessionResponseSchema.parse({ data: { ...ME, deliveryMode } }).data.deliveryMode,
    ).toBe(deliveryMode)
  })

  it('requires the delivery mode, and knows only the two', () => {
    expect(currentSessionResponseSchema.safeParse({ data: ME }).success).toBe(false)
    expect(
      currentSessionResponseSchema.safeParse({ data: { ...ME, deliveryMode: 'SMS' } }).success,
    ).toBe(false)
  })
})

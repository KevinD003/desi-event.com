import { describe, expect, it } from 'vitest'

import {
  PRIVACY_HOLD_DECISIONS,
  PRIVACY_HOLD_KINDS,
  PRIVACY_REQUEST_REASONS,
  PRIVACY_REQUEST_STATES,
  privacyHoldDecisionSchema,
  privacyHoldKindSchema,
  privacyRequestReasonSchema,
  privacyRequestStateSchema,
} from './enums.js'
import {
  PRIVACY_DATA_CATEGORIES,
  privacyDataCategorySchema,
  privacyRequestListQuerySchema,
  privacyRequestListResponseSchema,
  privacyRequestResponseSchema,
  privacyRequestSchema,
  privacyScopeEntrySchema,
} from './privacy.js'

const ID = 'c'.repeat(25)
const SUBJECT = 'd'.repeat(25)

/**
 * A complete request payload.
 *
 * @param {object} overrides Fields to change.
 * @returns {object} The payload.
 */
function request(overrides = {}) {
  return {
    id: ID,
    subjectId: SUBJECT,
    state: 'REQUESTED',
    reason: 'SUBJECT_REQUEST',
    holdDecision: 'NOT_EVALUATED',
    policyVersion: '2026-09-17.1',
    correlationId: 'DE-ABCD1234',
    scope: null,
    outcomeCode: null,
    requestedAt: '2026-09-17T05:00:00.000Z',
    confirmedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  }
}

describe('the privacy vocabularies', () => {
  it('mirror the database enums exactly', () => {
    expect([...PRIVACY_REQUEST_REASONS]).toEqual([
      'SUBJECT_REQUEST',
      'ORGANIZER_REQUEST',
      'RETENTION_POLICY',
      'DATA_MINIMISATION',
    ])
    expect([...PRIVACY_REQUEST_STATES]).toEqual([
      'REQUESTED',
      'QUEUED',
      'PROCESSING',
      'COMPLETED',
      'HELD',
      'FAILED_SAFE',
      'CANCELLED',
    ])
    expect([...PRIVACY_HOLD_DECISIONS]).toEqual([
      'NOT_EVALUATED',
      'NONE_ACTIVE',
      'LEGAL_HOLD_ACTIVE',
      'FRAUD_HOLD_ACTIVE',
      'OPEN_PROCESS',
    ])
    expect([...PRIVACY_HOLD_KINDS]).toEqual(['LEGAL', 'FRAUD_INVESTIGATION'])
  })

  it('are frozen, so a caller cannot widen one', () => {
    expect(Object.isFrozen(PRIVACY_REQUEST_STATES)).toBe(true)
    expect(() => PRIVACY_REQUEST_STATES.push('UNDONE')).toThrow(TypeError)
  })

  it('refuse a value that is not in them', () => {
    expect(privacyRequestReasonSchema.safeParse('BECAUSE_I_SAID').success).toBe(false)
    expect(privacyRequestStateSchema.safeParse('REVERSED').success).toBe(false)
    expect(privacyHoldDecisionSchema.safeParse('PROBABLY_FINE').success).toBe(false)
    expect(privacyHoldKindSchema.safeParse('CURIOSITY').success).toBe(false)
    expect(privacyDataCategorySchema.safeParse('EVERYTHING').success).toBe(false)
  })

  it('name categories rather than columns', () => {
    // A category is what an operator can be asked to confirm. A column list is
    // a map of where the personal data is, and handing one to a browser is a
    // worse leak than the fields it describes.
    for (const category of PRIVACY_DATA_CATEGORIES) {
      expect(category).toMatch(/^[A-Z][A-Z_]*$/)
      expect(category).not.toMatch(/email|name|phone/i)
    }
  })
})

describe('privacyScopeEntrySchema', () => {
  it('accepts a category and a count', () => {
    expect(
      privacyScopeEntrySchema.parse({
        category: 'BUYER_IDENTITY',
        rows: 3,
        status: 'REDACTED',
      }),
    ).toEqual({
      category: 'BUYER_IDENTITY',
      rows: 3,
      status: 'REDACTED',
    })
  })

  it('refuses a negative or fractional count', () => {
    expect(
      privacyScopeEntrySchema.safeParse({
        category: 'BUYER_IDENTITY',
        rows: -1,
        status: 'REDACTED',
      }).success,
    ).toBe(false)
    expect(
      privacyScopeEntrySchema.safeParse({
        category: 'BUYER_IDENTITY',
        rows: 1.5,
        status: 'REDACTED',
      }).success,
    ).toBe(false)
  })

  it('requires a status, because a count of zero cannot say why', () => {
    // "Nothing of this kind" and "this organisation may not touch it" are
    // different answers, and an operator confirming an irreversible action is
    // owed the difference. Zero rows with no status would conflate them.
    expect(
      privacyScopeEntrySchema.safeParse({ category: 'ACCOUNT_IDENTITY', rows: 0 }).success,
    ).toBe(false)

    expect(
      privacyScopeEntrySchema.safeParse({
        category: 'ACCOUNT_IDENTITY',
        rows: 0,
        status: 'OUT_OF_SCOPE',
      }).success,
    ).toBe(true)

    expect(
      privacyScopeEntrySchema.safeParse({
        category: 'ACCOUNT_IDENTITY',
        rows: 0,
        status: 'INVENTED',
      }).success,
    ).toBe(false)
  })

  it('refuses anything carrying a value alongside the count', () => {
    const parsed = privacyScopeEntrySchema.parse({
      category: 'BUYER_IDENTITY',
      rows: 1,
      status: 'REDACTED',
      sample: 'priya@example.com',
    })

    // The schema is an allow list, so an extra key is stripped rather than
    // carried: a preview must describe how much, never what.
    expect(parsed).not.toHaveProperty('sample')
  })
})

describe('privacyRequestSchema', () => {
  it('accepts a complete request', () => {
    expect(privacyRequestSchema.parse(request())).toMatchObject({ id: ID, subjectId: SUBJECT })
  })

  it('identifies the subject by id and offers no way to name them', () => {
    const shape = Object.keys(privacyRequestSchema.shape)

    expect(shape).toContain('subjectId')
    expect(shape).not.toContain('subjectEmail')
    expect(shape).not.toContain('subjectName')
    expect(shape).not.toContain('confirmationHash')
    expect(shape).not.toContain('idempotencyKey')
    expect(shape).not.toContain('organizationId')
  })

  it('refuses a subject id that is an address', () => {
    expect(
      privacyRequestSchema.safeParse(request({ subjectId: 'priya@example.com' })).success,
    ).toBe(false)
  })

  it('carries scope as a list of category counts when there is one', () => {
    const parsed = privacyRequestSchema.parse(
      request({ scope: [{ category: 'ACCOUNT_IDENTITY', rows: 1, status: 'REDACTED' }] }),
    )

    expect(parsed.scope).toEqual([{ category: 'ACCOUNT_IDENTITY', rows: 1, status: 'REDACTED' }])
  })

  it('wraps a single request and a list in the shapes the routes return', () => {
    expect(privacyRequestResponseSchema.parse({ data: request() }).data.id).toBe(ID)
    expect(
      privacyRequestListResponseSchema.parse({
        data: [request()],
        pagination: {
          page: 1,
          perPage: 20,
          total: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      }).data,
    ).toHaveLength(1)
  })
})

describe('privacyRequestListQuerySchema', () => {
  it('defaults to the first page', () => {
    expect(privacyRequestListQuerySchema.parse({})).toMatchObject({ page: 1, perPage: 20 })
  })

  it('accepts a state and a subject id', () => {
    expect(
      privacyRequestListQuerySchema.parse({ state: 'HELD', subjectId: SUBJECT }),
    ).toMatchObject({ state: 'HELD', subjectId: SUBJECT })
  })

  it('refuses a subject filter that is an address', () => {
    expect(
      privacyRequestListQuerySchema.safeParse({ subjectId: 'priya@example.com' }).success,
    ).toBe(false)
  })
})

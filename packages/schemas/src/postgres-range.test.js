/**
 * Request fields PostgreSQL compares with a column: bounded by that column.
 *
 * A revision is sent back as a compare-and-set precondition and compared with
 * an `integer` column. Past 2147483647 PostgreSQL will not compare it at all —
 * Prisma refuses the query with P2020 — and the delete, restore and
 * night-cancellation commands answered 500. A query's date filter is compared
 * with a `timestamp` column or turned into a UTC day: year 0000 is no year in
 * PostgreSQL's calendar (22008), and the analytics, traffic, finance and event
 * list reads answered 500. Both are refused here as a 400 instead.
 *
 * @module @desi-event/schemas/postgres-range.test
 */

import { describe, expect, it } from 'vitest'

import * as schemas from './index.js'

const { POSTGRES_INT_MAX, QUERY_DATE_EARLIEST, queryDateTimeSchema, revisionPreconditionSchema } =
  schemas

/** Every request schema that carries a revision precondition. */
const WITH_REVISION = [
  'deleteEventRequestSchema',
  'cancelSessionRequestSchema',
  'restoreEventRequestSchema',
  'eventImportReassignRequestSchema',
  'updateEventRequestSchema',
  'moderationDecisionRequestSchema',
  'rescheduleEventRequestSchema',
  'createSessionRequestSchema',
  'updateSessionRequestSchema',
  'deleteSessionRequestSchema',
  'updateAuthorTicketTypeRequestSchema',
  'materialChangeRequestSchema',
  'updateEventMediaRequestSchema',
  'reorderEventMediaRequestSchema',
  'putLayoutRequestSchema',
  'uploadEventMediaQuerySchema',
]

/** Every query schema with a date filter, and its date fields. */
const WITH_QUERY_DATES = [
  ['trafficEventsQuerySchema', ['from', 'to']],
  ['analyticsQuerySchema', ['from', 'to']],
  ['financeSummaryQuerySchema', ['from', 'to']],
  ['listEventsQuerySchema', ['startsAfter', 'startsBefore']],
]

describe('a revision precondition', () => {
  it('is bounded by an integer column: 0 to 2147483647', () => {
    expect(POSTGRES_INT_MAX).toBe(2_147_483_647)
    expect(revisionPreconditionSchema.safeParse(0).success).toBe(true)
    expect(revisionPreconditionSchema.safeParse(POSTGRES_INT_MAX).success).toBe(true)
    expect(revisionPreconditionSchema.safeParse(POSTGRES_INT_MAX + 1).success).toBe(false)
    expect(revisionPreconditionSchema.safeParse(-1).success).toBe(false)
    expect(revisionPreconditionSchema.safeParse(1.5).success).toBe(false)
  })

  it.each(WITH_REVISION)('%s refuses a revision past 2147483647', (name) => {
    const field = schemas[name].shape.revision

    expect(field.safeParse(2_147_483_647).success).toBe(true)
    expect(field.safeParse(2_147_483_648).success).toBe(false)
    expect(field.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(false)
  })

  it('bounds every item an import approval names', () => {
    const item = { eventId: 'cm8eventaaaaaaaaaaaaaaaaa', revision: 2_147_483_647 }
    const { eventImportApproveRequestSchema } = schemas

    expect(eventImportApproveRequestSchema.safeParse({ items: [item] }).success).toBe(true)
    expect(
      eventImportApproveRequestSchema.safeParse({ items: [{ ...item, revision: 2_147_483_648 }] })
        .success,
    ).toBe(false)
  })
})

describe('a query date filter', () => {
  it('starts at the Unix epoch and keeps every shape it took before', () => {
    expect(QUERY_DATE_EARLIEST).toBe('1970-01-01T00:00:00.000Z')
    expect(queryDateTimeSchema.parse('1970-01-01')).toBe('1970-01-01T00:00:00.000Z')
    expect(queryDateTimeSchema.parse('2026-10-07T18:30')).toBe('2026-10-07T18:30:00Z')
    expect(queryDateTimeSchema.parse('2026-10-07T18:30:00+05:30')).toBe('2026-10-07T18:30:00+05:30')
    expect(queryDateTimeSchema.parse('9999-12-31T23:59:59Z')).toBe('9999-12-31T23:59:59Z')
  })

  it('refuses year 0000 and every instant before 1970, in any shape', () => {
    for (const value of [
      '0000-01-01',
      '0000-01-01T00:00:00Z',
      '0000-06-01T00:00:00Z',
      '0001-01-01T00:00:00Z',
      '1969-12-31T23:59:59Z',
      // Still 1969 in UTC, though it reads as 1970 where it was written.
      '1970-01-01T01:00:00+05:30',
    ]) {
      const parsed = queryDateTimeSchema.safeParse(value)

      expect(parsed.success, value).toBe(false)
      expect(parsed.error.issues[0].message, value).toBe('Use a date in 1970 or later.')
    }
  })

  it.each(WITH_QUERY_DATES)('%s refuses year 0000 in each of its dates', (name, fields) => {
    for (const field of fields) {
      expect(schemas[name].shape[field].safeParse('0000-01-01T00:00:00Z').success, field).toBe(
        false,
      )
      expect(schemas[name].shape[field].safeParse('2026-01-01T00:00:00Z').success, field).toBe(true)
    }
  })
})

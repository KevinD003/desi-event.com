import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CONTROL_PAYMENT_MODES,
  CONTROL_REASON_DESCRIPTION,
  CONTROL_REASON_LIMITS,
  DELETION_REFUSALS,
  NIGHT_START_MARGIN_MINUTES,
  PLATFORM_EDIT_MINUTES,
  cancelSessionRequestSchema,
  controlReasonSchema,
  deleteEventRequestSchema,
  eventChangeNoticeSchema,
  eventDeletionPreviewResponseSchema,
  eventDeletionPreviewSchema,
  finishRefundsResponseSchema,
  openPlatformEditRequestSchema,
  platformEditListResponseSchema,
  platformEventRowSchema,
  platformEventsQuerySchema,
  refundDriveSummarySchema,
  restoreEventRequestSchema,
  sessionCancellationPreviewSchema,
} from './event-control.js'
import { DELETION_OUTCOMES } from './lifecycle.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const EVENT_ID = 'cm8eventaaaaaaaaaaaaaaaaa'
const SESSION_ID = 'cm8sessionaaaaaaaaaaaaaaa'
const REASON = 'The venue closed for repairs, so the night cannot go ahead.'

/** A deletion preview as the API would answer it for an event with paid orders. */
function preview(overrides = {}) {
  return {
    eventId: EVENT_ID,
    status: 'ON_SALE',
    revision: 4,
    outcome: 'CANCEL_AND_REFUND',
    choices: null,
    needsTookPlaceConfirmation: false,
    refusal: null,
    authority: 'ORGANIZATION',
    permitted: true,
    missing: null,
    counts: {
      paidOrders: 12,
      refundableCents: 86_400,
      currency: 'USD',
      pendingOrders: 0,
      paymentsInFlight: 0,
      activeHolds: 1,
      tickets: 30,
      checkIns: 0,
      zeroValueOrders: 2,
      disputedOrders: 1,
      partlyRefundedOrders: 1,
    },
    slug: { value: 'garba-night-dallas', keptRetired: true },
    paymentMode: 'MOCK',
    ...overrides,
  }
}

describe('the constants', () => {
  it('times a sitting at an hour and a night as started an hour before its doors', () => {
    expect(PLATFORM_EDIT_MINUTES).toBe(60)
    expect(NIGHT_START_MARGIN_MINUTES).toBe(60)
    expect(CONTROL_REASON_LIMITS).toEqual({ min: 10, max: 500 })
    expect(Object.isFrozen(CONTROL_REASON_LIMITS)).toBe(true)
  })

  it('names the refusals and payment modes a preview can carry', () => {
    expect([...DELETION_REFUSALS]).toEqual([
      'EVENT_IN_PROGRESS',
      'PAYMENT_IN_FLIGHT',
      'UNEXPECTED_ORDERS',
      'ALREADY_DELETED',
    ])
    expect([...CONTROL_PAYMENT_MODES]).toEqual(['MOCK', 'STRIPE_TEST', 'LIVE'])
  })

  it('carries the reason boxes’ description word for word', () => {
    expect(CONTROL_REASON_DESCRIPTION).toBe(
      "Shown with the event's history. Do not include anybody's personal details.",
    )
  })
})

describe('controlReasonSchema', () => {
  it('trims and accepts 10 to 500 characters', () => {
    expect(controlReasonSchema.parse(`  ${REASON}  `)).toBe(REASON)
    expect(controlReasonSchema.parse('a'.repeat(10))).toBe('a'.repeat(10))
    expect(controlReasonSchema.parse('a'.repeat(500))).toBe('a'.repeat(500))
  })

  it('refuses fewer than 10 characters once trimmed, and more than 500', () => {
    expect(controlReasonSchema.safeParse('   too short   ').success).toBe(false)
    expect(controlReasonSchema.safeParse('a'.repeat(9)).success).toBe(false)
    expect(controlReasonSchema.safeParse('a'.repeat(501)).success).toBe(false)
  })

  it('allows line breaks and tabs, and refuses every other control character', () => {
    expect(controlReasonSchema.safeParse('First line.\nSecond line,\twith a tab.').success).toBe(
      true,
    )

    for (const control of ['\u0000', '\u0007', '\u001b', '\u007f', '\u0085']) {
      expect(controlReasonSchema.safeParse(`A reason with ${control} inside.`).success).toBe(false)
    }
  })

  it('refuses something that is not text', () => {
    expect(controlReasonSchema.safeParse(1234567890).success).toBe(false)
    expect(controlReasonSchema.safeParse(null).success).toBe(false)
  })
})

describe('deleteEventRequestSchema', () => {
  const body = {
    revision: 4,
    reason: REASON,
    confirmSlug: 'garba-night-dallas',
    expectedOutcome: 'REMOVE',
  }

  it('accepts each outcome, and only those', () => {
    for (const outcome of DELETION_OUTCOMES) {
      expect(
        deleteEventRequestSchema.parse({ ...body, expectedOutcome: outcome }).expectedOutcome,
      ).toBe(outcome)
    }
    expect(
      deleteEventRequestSchema.safeParse({ ...body, expectedOutcome: 'REMOVED' }).success,
    ).toBe(false)
  })

  it('leaves the typed address for the server to compare, case and spaces included', () => {
    // The server trims and lower-cases before comparing, and a mismatch is its
    // 422, shown beside the field, not a 400 from here.
    expect(
      deleteEventRequestSchema.parse({ ...body, confirmSlug: ' Garba-Night-Dallas ' }).confirmSlug,
    ).toBe(' Garba-Night-Dallas ')
    expect(deleteEventRequestSchema.safeParse({ ...body, confirmSlug: '' }).success).toBe(false)
    expect(
      deleteEventRequestSchema.safeParse({ ...body, confirmSlug: 'a'.repeat(201) }).success,
    ).toBe(false)
  })

  it('takes confirmTookPlace only as true', () => {
    expect(
      deleteEventRequestSchema.parse({ ...body, confirmTookPlace: true }).confirmTookPlace,
    ).toBe(true)
    expect(deleteEventRequestSchema.safeParse({ ...body, confirmTookPlace: false }).success).toBe(
      false,
    )
    expect(deleteEventRequestSchema.parse(body)).not.toHaveProperty('confirmTookPlace')
  })

  it('refuses an unknown key, a negative revision and a missing reason', () => {
    expect(deleteEventRequestSchema.safeParse({ ...body, outcome: 'REMOVE' }).success).toBe(false)
    expect(deleteEventRequestSchema.safeParse({ ...body, revision: -1 }).success).toBe(false)
    const { reason, ...withoutReason } = body
    expect(reason).toBe(REASON)
    expect(deleteEventRequestSchema.safeParse(withoutReason).success).toBe(false)
  })
})

describe('cancelSessionRequestSchema', () => {
  const body = { revision: 2, reason: REASON, confirm: true, expectedOrders: 7 }

  it('needs confirm: true, and says why', () => {
    expect(cancelSessionRequestSchema.parse(body)).toEqual(body)

    const refused = cancelSessionRequestSchema.safeParse({ ...body, confirm: false })
    expect(refused.success).toBe(false)
    expect(refused.error.issues[0].message).toBe('Confirm that these orders are refunded.')
  })

  it('is strict', () => {
    expect(cancelSessionRequestSchema.safeParse({ ...body, refund: false }).success).toBe(false)
  })
})

describe('the sitting and restore bodies', () => {
  it('take a reason and nothing else', () => {
    expect(openPlatformEditRequestSchema.parse({ reason: REASON })).toEqual({ reason: REASON })
    expect(openPlatformEditRequestSchema.safeParse({ reason: 'short' }).success).toBe(false)
    expect(openPlatformEditRequestSchema.safeParse({ reason: REASON, minutes: 120 }).success).toBe(
      false,
    )
    expect(restoreEventRequestSchema.parse({ revision: 0, reason: REASON })).toEqual({
      revision: 0,
      reason: REASON,
    })
    expect(restoreEventRequestSchema.safeParse({ reason: REASON }).success).toBe(false)
  })
})

describe('the previews', () => {
  it('parse a deletion preview with paid, disputed, free and partly refunded orders', () => {
    expect(
      eventDeletionPreviewResponseSchema.parse({ data: preview() }).data.counts.disputedOrders,
    ).toBe(1)
  })

  it('parse a finished event that needs the deleter to say what happened', () => {
    const choice = preview({
      status: 'PUBLISHED',
      outcome: null,
      choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
      needsTookPlaceConfirmation: true,
    })

    expect(eventDeletionPreviewSchema.parse(choice).choices).toEqual([
      'REMOVE_AFTER_EVENT',
      'CANCEL_AND_REFUND',
    ])
  })

  it('parse a refusal, and refuse a refusal code it does not know', () => {
    const refused = preview({
      outcome: null,
      permitted: false,
      missing: 'A night of this event has started.',
      refusal: { code: 'EVENT_IN_PROGRESS', message: 'A night of this event has started.' },
    })

    expect(eventDeletionPreviewSchema.parse(refused).refusal.code).toBe('EVENT_IN_PROGRESS')
    expect(
      eventDeletionPreviewSchema.safeParse({
        ...refused,
        refusal: { code: 'SOMETHING_ELSE', message: 'x' },
      }).success,
    ).toBe(false)
    expect(eventDeletionPreviewSchema.safeParse(preview({ paymentMode: 'REAL' })).success).toBe(
      false,
    )
  })

  it('parse a night-cancellation preview', () => {
    expect(
      sessionCancellationPreviewSchema.parse({
        sessionId: SESSION_ID,
        revision: 3,
        permitted: true,
        missing: null,
        refusal: null,
        ordersRefunded: 5,
        ordersToldOnly: 2,
        zeroValueOrders: 1,
        disputedOrders: 0,
        ticketsWithdrawn: 9,
        refundableCents: 22_500,
        currency: 'USD',
        paymentMode: 'STRIPE_TEST',
      }).ordersToldOnly,
    ).toBe(2)
  })

  it('count what the refund driver did, disputed orders included', () => {
    const summary = {
      owed: 12,
      settled: 10,
      waiting: 0,
      failed: 1,
      disputed: 1,
      amountCents: 86_400,
      currency: 'USD',
    }

    expect(refundDriveSummarySchema.parse(summary)).toEqual(summary)
    expect(finishRefundsResponseSchema.parse({ data: summary }).data.failed).toBe(1)
    const { disputed, ...withoutDisputed } = summary
    expect(disputed).toBe(1)
    expect(refundDriveSummarySchema.safeParse(withoutDisputed).success).toBe(false)
  })
})

describe('platform editing', () => {
  it('lists sittings, with the administrator named only where the reader may see it', () => {
    const sitting = {
      id: 'cm8sittingaaaaaaaaaaaaaaa',
      openedAt: '2026-10-05T18:00:00.000Z',
      expiresAt: '2026-10-05T19:00:00.000Z',
      closedAt: null,
      endedBy: null,
      open: true,
      mine: false,
      reason: REASON,
      administratorName: null,
      changes: [{ action: 'event.updated', fields: ['title'], at: '2026-10-05T18:05:00.000Z' }],
    }

    expect(
      platformEditListResponseSchema.parse({ data: [sitting] }).data[0].administratorName,
    ).toBeNull()
    expect(
      platformEditListResponseSchema.parse({
        data: [{ ...sitting, open: false, closedAt: sitting.expiresAt, endedBy: 'EXPIRED' }],
      }).data[0].endedBy,
    ).toBe('EXPIRED')
  })

  it('reads the event list query with its defaults', () => {
    expect(platformEventsQuerySchema.parse({})).toEqual({
      deleted: 'exclude',
      imported: 'include',
      sort: 'updatedAt:desc',
      page: 1,
      perPage: 25,
    })
    expect(platformEventsQuerySchema.parse({ q: '  garba ', imported: 'only' })).toMatchObject({
      q: 'garba',
      imported: 'only',
    })
    expect(platformEventsQuerySchema.safeParse({ q: 'gar\u0000ba' }).success).toBe(false)
    expect(platformEventsQuerySchema.safeParse({ perPage: '101' }).success).toBe(false)
    expect(platformEventsQuerySchema.safeParse({ deleted: 'all' }).success).toBe(false)
  })

  it('parses a deleted, imported row', () => {
    const row = platformEventRowSchema.parse({
      id: EVENT_ID,
      title: 'Garba Night',
      slug: 'garba-night-dallas',
      status: 'DELETED',
      startsAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
      organization: { id: 'cm8orgaaaaaaaaaaaaaaaaaaa', name: 'Sulekha Events' },
      paidOrders: 0,
      picturesWaiting: 0,
      imported: true,
      deletion: {
        deletedAt: '2026-10-05T00:00:00.000Z',
        outcome: 'REMOVE',
        authority: 'PLATFORM',
        statusBefore: 'ON_SALE',
        restoreTo: 'SALES_PAUSED',
      },
    })

    expect(row.deletion.restoreTo).toBe('SALES_PAUSED')
  })
})

describe('eventChangeNoticeSchema', () => {
  it('parses a night cancelled by the Desi-Event team', () => {
    expect(
      eventChangeNoticeSchema.parse({
        id: 'cm8noticeaaaaaaaaaaaaaaaa',
        kind: 'SESSION_CANCELLED',
        at: '2026-10-05T00:00:00.000Z',
        changed: ['the night of 10 October'],
        before: null,
        after: null,
        reason: REASON,
        sessionId: SESSION_ID,
        by: 'DESI_EVENT',
      }).by,
    ).toBe('DESI_EVENT')
  })

  it('refuses a kind or an author it does not know', () => {
    const notice = {
      id: 'cm8noticeaaaaaaaaaaaaaaaa',
      kind: 'MATERIAL_CHANGE',
      at: '2026-10-05T00:00:00.000Z',
      changed: [],
      before: {},
      after: {},
      reason: null,
      sessionId: null,
      by: 'ORGANIZER',
    }

    expect(eventChangeNoticeSchema.safeParse(notice).success).toBe(true)
    expect(eventChangeNoticeSchema.safeParse({ ...notice, kind: 'RENAMED' }).success).toBe(false)
    expect(eventChangeNoticeSchema.safeParse({ ...notice, by: 'ADMIN' }).success).toBe(false)
  })
})

describe('the browser subpath', () => {
  it('imports neither entities.js nor the barrel, so a client component may use it', () => {
    const source = readFileSync(path.join(here, 'event-control.js'), 'utf8')
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])

    expect(imports.sort()).toEqual(['./enums.js', './lifecycle.js', './primitives.js', 'zod'])
  })

  it('is exported as @desi-event/schemas/event-control and /imports', () => {
    const manifest = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))

    expect(manifest.exports['./event-control']).toBe('./src/event-control.js')
    expect(manifest.exports['./imports']).toBe('./src/imports.js')
  })
})

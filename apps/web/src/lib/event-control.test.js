import { describe, expect, it } from 'vitest'

import {
  CHOICE_LABELS,
  CHOICE_PROMPT,
  NOTICE_SENTENCE,
  NOT_POSTED_SENTENCE,
  UNPOSTED_TERMS_SENTENCE,
  PICTURE_CACHE_SENTENCE,
  PLATFORM_STEP_UP_SENTENCE,
  REASON_DESCRIPTION,
  clockTime,
  counted,
  deleteButtonLabel,
  deletedByReading,
  deletedForHolder,
  deletedRefundSentences,
  deletionOutcomeReading,
  deletionSentences,
  nightCancellationSentences,
  noticeBy,
  noticeMoves,
  noticeNightStart,
  paymentModeSentence,
  platformEditChanges,
  reasonProblem,
  refundSummarySentence,
  refundsLeftOver,
  restoreTargetReading,
  slugMatches,
  slugReleased,
  teamEditingSentence,
  amountBoundsSentence,
  changedBy,
  currencySymbol,
  currentFeeSentence,
  feeListText,
  feeTermsShort,
  historyLines,
  lastFeeChangeSentence,
  parsePercentage,
  parseVenueLimit,
  percentText,
  venueListText,
  venueStatusText,
} from './event-control.js'

/**
 * A deletion preview as `GET /v1/events/:id/deletion` answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @param {object} [counts] Counts to change.
 * @returns {object} The preview.
 */
function preview(overrides = {}, counts = {}) {
  return {
    eventId: 'cevent0000000000000000001',
    status: 'ON_SALE',
    revision: 7,
    outcome: 'CANCEL_AND_REFUND',
    choices: null,
    needsTookPlaceConfirmation: false,
    refusal: null,
    authority: 'ORGANIZATION',
    permitted: true,
    missing: null,
    counts: {
      paidOrders: 12,
      refundableCents: 48_000,
      currency: 'USD',
      pendingOrders: 0,
      paymentsInFlight: 0,
      activeHolds: 0,
      tickets: 30,
      checkIns: 0,
      zeroValueOrders: 0,
      disputedOrders: 0,
      partlyRefundedOrders: 0,
      ...counts,
    },
    slug: { value: 'diwali-mela-2026', keptRetired: true },
    paymentMode: 'MOCK',
    ...overrides,
  }
}

describe('the sentences a deletion preview reads as', () => {
  it('says what removing an unsold event does, and that its address stays retired', () => {
    const sentences = deletionSentences(preview({ outcome: 'REMOVE' }, { paidOrders: 0 }))

    expect(sentences[0]).toBe(
      'Nobody has bought a ticket to this event. Deleting it takes its page, listing and pictures off the site straight away. It is kept, hidden, so the team at The Desi Events can restore it.',
    )
    expect(sentences).toContain(
      'Its web address stays retired, so an old link never shows a different event.',
    )
    expect(sentences.at(-1)).toBe(PICTURE_CACHE_SENTENCE)
  })

  it('frees the address of an event that was never public, and withdraws free orders', () => {
    const sentences = deletionSentences(
      preview(
        { outcome: 'REMOVE', slug: { value: 'x', keptRetired: false } },
        { paidOrders: 0, zeroValueOrders: 3 },
      ),
    )

    expect(sentences).toContain('Its web address is freed for another event.')
    expect(sentences).toContain('3 free orders have their tickets withdrawn.')
  })

  it('counts paid orders, not people, and names the amount, fees and tax included', () => {
    const sentences = deletionSentences(preview())

    expect(sentences[0]).toBe(
      'Deleting this event cancels it, refunds what is left of each of the 12 paid orders ($480.00 in all, booking fees and tax included) and takes its page off the site.',
    )
    expect(sentences).toContain(NOTICE_SENTENCE)
    expect(sentences).toContain(
      'Payments on this site are simulated, so these refunds move no real money.',
    )
    expect(sentences.join(' ')).not.toMatch(/\bpeople\b/)
  })

  it('leaves disputed orders to the finance team and says what was already refunded', () => {
    const sentences = deletionSentences(
      preview(
        {},
        { paidOrders: 5, disputedOrders: 2, partlyRefundedOrders: 1, zeroValueOrders: 1 },
      ),
    )

    expect(sentences[0]).toMatch(/each of the 3 paid orders/)
    expect(sentences).toContain('2 orders are disputed and are left to the finance team.')
    expect(sentences).toContain(
      '1 order already had part of its money refunded; the rest is refunded now.',
    )
    expect(sentences).toContain('1 free order has its tickets withdrawn.')
  })

  it('says nobody is refunded when every paid order is disputed', () => {
    const sentences = deletionSentences(preview({}, { paidOrders: 1, disputedOrders: 1 }))

    expect(sentences[0]).toBe(
      'Deleting this event cancels it and takes its page off the site. No order is refunded here.',
    )
    expect(sentences.join(' ')).not.toMatch(/simulated/)
  })

  it('names what moves in each payment mode', () => {
    expect(paymentModeSentence('STRIPE_TEST')).toBe(
      'Payments here run in Stripe’s test mode, so no real money moves.',
    )
    expect(paymentModeSentence('LIVE')).toBe(
      'The money goes back to the card each order was paid with.',
    )
  })

  it('takes a finished event down without refunding anybody', () => {
    const sentences = deletionSentences(
      preview({ outcome: 'REMOVE_AFTER_EVENT' }, { paidOrders: 10, zeroValueOrders: 2 }),
    )

    expect(sentences[0]).toBe(
      'This event has taken place. Deleting it takes its page and listing off the site. The 12 orders and their tickets stay as they are and nobody is refunded.',
    )
  })

  it('describes either of the choices a finished event nobody was checked in at offers', () => {
    const choice = preview({
      outcome: null,
      choices: ['REMOVE_AFTER_EVENT', 'CANCEL_AND_REFUND'],
      needsTookPlaceConfirmation: true,
    })

    expect(deletionSentences(choice)).toEqual([])
    expect(deletionSentences(choice, 'REMOVE_AFTER_EVENT')[0]).toMatch(/has taken place/)
    expect(deletionSentences(choice, 'CANCEL_AND_REFUND')[0]).toMatch(/cancels it, refunds/)
    expect(CHOICE_PROMPT).toBe(
      'Nobody was checked in through The Desi Events, so say what happened:',
    )
    expect(Object.values(CHOICE_LABELS)).toEqual([
      'It took place: take its page down and refund nobody',
      'It did not take place: cancel it and refund every order',
    ])
  })

  it('labels the delete button by what it does', () => {
    expect(deleteButtonLabel('CANCEL_AND_REFUND')).toBe('Cancel, refund and delete')
    expect(deleteButtonLabel('REMOVE')).toBe('Delete this event')
    expect(deleteButtonLabel(null)).toBe('Delete this event')
  })
})

describe('the typed confirmation and the reason', () => {
  it('compares the web address trimmed and in lower case, as the server does', () => {
    expect(slugMatches('  Diwali-Mela-2026 ', 'diwali-mela-2026')).toBe(true)
    expect(slugMatches('diwali-mela', 'diwali-mela-2026')).toBe(false)
    expect(slugMatches(undefined, 'diwali-mela-2026')).toBe(false)
  })

  it('checks the reason with the schema the server uses', () => {
    expect(reasonProblem('short')).toBe('Give a reason of at least 10 characters.')
    expect(reasonProblem('x'.repeat(501))).toBe('Keep the reason to 500 characters.')
    expect(reasonProblem('The venue flooded, so the night cannot go ahead.')).toBeNull()
  })

  it('carries the description every reason box shows', () => {
    expect(REASON_DESCRIPTION).toBe(
      "Shown with the event's history. Do not include anybody's personal details.",
    )
  })
})

describe('what a refund pass did', () => {
  it('says how many were refunded and for how much', () => {
    const summary = {
      owed: 12,
      settled: 12,
      waiting: 0,
      failed: 0,
      disputed: 0,
      amountCents: 48_000,
      currency: 'USD',
    }

    expect(refundSummarySentence(summary)).toBe('12 orders refunded ($480.00).')
    expect(refundsLeftOver(summary)).toBe(false)
  })

  it('says what did not go through and what is still waiting', () => {
    const summary = {
      owed: 12,
      settled: 9,
      waiting: 1,
      failed: 2,
      disputed: 1,
      amountCents: 36_000,
      currency: 'USD',
    }
    const sentence = refundSummarySentence(summary)

    expect(sentence).toMatch(/^9 refunded\./)
    expect(sentence).toMatch(/2 refunds did not go through\./)
    expect(sentence).toMatch(
      /1 refund is still waiting to be sent: send it with “Finish refunds”\./,
    )
    expect(sentence).toMatch(/1 order is disputed and is left to the finance team\./)
    expect(refundsLeftOver(summary)).toBe(true)
  })

  it('says nothing when nothing was owed', () => {
    expect(refundSummarySentence(null)).toBeNull()
    expect(
      refundSummarySentence({ owed: 0, settled: 0, waiting: 0, failed: 0, disputed: 0 }),
    ).toBeNull()
  })
})

describe('what a restore brings back', () => {
  it('brings an on-sale or sold-out event back paused', () => {
    expect(restoreTargetReading('ON_SALE')).toBe(
      'It comes back paused: the organiser reopens sales.',
    )
    expect(restoreTargetReading('SOLD_OUT')).toBe(
      'It comes back paused: the organiser reopens sales.',
    )
  })

  it('sends an event that was waiting for review back to draft', () => {
    expect(restoreTargetReading('REVIEW_PENDING')).toMatch(/comes back as a draft: it was waiting/)
    expect(restoreTargetReading('APPROVED')).toMatch(/comes back as a draft/)
    // An approved event was not waiting for review: it had been approved and
    // not yet published, and the approval does not carry over.
    expect(restoreTargetReading('APPROVED')).toBe(
      'It comes back as a draft: it had been approved but not published, and an approval covers only the version that was deleted, so it has to be sent for review again.',
    )
    expect(restoreTargetReading('APPROVED')).not.toMatch(/waiting for review/)
    expect(restoreTargetReading('REVIEW_PENDING')).toBe(
      'It comes back as a draft: it was waiting for review when it was deleted, so it has to be sent again.',
    )
    expect(restoreTargetReading('DRAFT')).toBe(
      'It comes back as a draft, which only its team can see.',
    )
  })

  it('names any other status in the organiser’s words', () => {
    expect(restoreTargetReading('CANCELLED')).toMatch(/comes back cancelled/)
    expect(restoreTargetReading('PUBLISHED')).toBe('It comes back as Published.')
  })
})

describe('a deleted event’s record', () => {
  it('reads each outcome', () => {
    expect(deletionOutcomeReading('REMOVE')).toMatch(/Nobody held a paid order/)
    expect(deletionOutcomeReading('CANCEL_AND_REFUND')).toMatch(/was cancelled/)
    expect(deletionOutcomeReading('REMOVE_AFTER_EVENT')).toMatch(/had taken place/)
  })

  it('names the person only when the server sent the name', () => {
    expect(deletedByReading({ authority: 'PLATFORM', deletedByName: null })).toBe(
      'the team at The Desi Events',
    )
    expect(deletedByReading({ authority: 'PLATFORM', deletedByName: 'Anil Rao' })).toBe(
      'Anil Rao, of the team at The Desi Events',
    )
    expect(deletedByReading({ authority: 'ORGANIZATION', deletedByName: 'Priya Shah' })).toBe(
      'Priya Shah, of the organisation',
    )
    expect(deletedByReading({ authority: 'ORGANIZATION', deletedByName: null })).toBe(
      'a member of the organisation',
    )
  })

  it('tells a ticket holder who removed the page', () => {
    expect(deletedForHolder({ by: 'DESI_EVENT' })).toBe(
      'The Desi Events team removed this event’s page.',
    )
    expect(deletedForHolder(null)).toBe('The organiser removed this event’s page.')
  })
})

describe('the sentences a night-cancellation preview reads as', () => {
  it('builds every sentence from the counts', () => {
    const sentences = nightCancellationSentences({
      orders: 9,
      ordersRefunded: 5,
      ordersToldOnly: 2,
      zeroValueOrders: 1,
      disputedOrders: 0,
      ordersCancelled: 1,
      ticketsWithdrawn: 11,
      refundableCents: 15_000,
      currency: 'USD',
      paymentMode: 'MOCK',
    })

    expect(sentences[0]).toMatch(/^5 paid orders for this night are refunded \(\$150\.00 in all/)
    expect(sentences).toContain(
      '2 orders hold tickets for every night: their holders keep them for the other nights and are told, without a refund.',
    )
    expect(sentences).toContain('1 free order has its tickets withdrawn.')
    expect(sentences).toContain('1 unpaid order is cancelled.')
    expect(sentences).toContain('11 tickets for this night stop working at the door.')
    expect(sentences).toContain(NOTICE_SENTENCE)
    expect(sentences.at(-1)).toMatch(/simulated/)
  })

  it('says nobody is refunded for a night nobody paid for', () => {
    expect(
      nightCancellationSentences({
        orders: 0,
        ordersRefunded: 0,
        ordersToldOnly: 0,
        zeroValueOrders: 0,
        disputedOrders: 0,
        ordersCancelled: 0,
        ticketsWithdrawn: 0,
        refundableCents: 0,
        currency: null,
        paymentMode: 'MOCK',
      }),
    ).toEqual(['No paid order for this night is refunded.'])
  })
})

describe('what a sitting changed, in the editor’s words', () => {
  it('names the fields and the other writes, each once', () => {
    expect(
      platformEditChanges([
        { action: 'event.updated', fields: ['description', 'faq'] },
        { action: 'event.updated', fields: ['description', 'publicContact'] },
        { action: 'event.session_added', fields: [] },
        { action: 'event.media_added', fields: ['kind'] },
      ]),
    ).toEqual(['description', 'FAQ', 'public contact', 'added a night', 'added a picture'])
  })

  it('asks the team at The Desi Events to confirm every ten minutes', () => {
    expect(PLATFORM_STEP_UP_SENTENCE).toBe(
      'Confirm it’s you to keep editing. The Desi Events team confirms every 10 minutes while editing someone else’s event.',
    )
  })

  it('reads a time of day, and nothing for a bad one', () => {
    expect(clockTime('not a time')).toBe('')
    expect(clockTime('2026-10-17T19:40:00.000Z')).toMatch(/\d{1,2}:\d{2} [AP]M/)
    // Always in the zone it is given, labelled, whatever zone the machine runs in.
    expect(clockTime('2026-10-06T19:40:00.000Z', 'America/Chicago')).toBe('2:40 PM CDT')
    expect(clockTime('2026-10-06T19:40:00.000Z', 'America/New_York')).toBe('3:40 PM EDT')
    expect(clockTime('2026-12-06T19:40:00.000Z', 'America/New_York')).toBe('2:40 PM EST')
    expect(clockTime('2026-10-06T19:40:00.000Z')).toBe('7:40 PM UTC')
    expect(clockTime('2026-10-06T19:40:00.000Z', 'Not/AZone')).toBe('7:40 PM UTC')
  })

  it('tells the organiser the team at The Desi Events is editing, until when, in the event’s zone', () => {
    expect(teamEditingSentence('2026-10-06T19:40:00.000Z', 'America/Chicago')).toBe(
      'The Desi Events team is editing this event until 2:40 PM CDT.',
    )
    expect(teamEditingSentence('not a time', 'America/Chicago')).toBe(
      'The Desi Events team is editing this event.',
    )
  })
})

describe('a change notice', () => {
  it('shows a moved date in the event’s own zone, and names nothing else', () => {
    const moves = noticeMoves(
      {
        before: { startsAt: '2026-10-17T23:30:00.000Z', policies: { refund: 'old' } },
        after: { startsAt: '2026-10-24T23:30:00.000Z', policies: { refund: 'new' } },
      },
      'America/Chicago',
    )

    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ field: 'startsAt', label: 'start time' })
    expect(moves[0].before).toMatch(/Oct 17, 2026/)
    expect(moves[0].after).toMatch(/Oct 24, 2026/)
    expect(moves[0].after).toMatch(/6:30\s?PM/)
  })

  it('says who made the change', () => {
    expect(noticeBy({ by: 'DESI_EVENT' })).toBe('by the team at The Desi Events')
    expect(noticeBy({ by: 'ORGANIZER' })).toBe('by the organiser')
  })
})

describe('honest copy', () => {
  it('counts with the right noun', () => {
    expect(counted(1, 'order', 'orders')).toBe('1 order')
    expect(counted(1200, 'order', 'orders')).toBe('1,200 orders')
  })

  it('never promises something later', () => {
    const copy = [
      ...deletionSentences(preview()),
      ...deletionSentences(preview({ outcome: 'REMOVE' })),
      ...deletionSentences(preview({ outcome: 'REMOVE_AFTER_EVENT' })),
      restoreTargetReading('ON_SALE'),
      PLATFORM_STEP_UP_SENTENCE,
    ].join(' ')

    expect(copy).not.toMatch(/\b(soon|yet|planned|coming)\b/i)
  })
})

describe('a deleted event’s refunds, read after the deletion', () => {
  it('says every paid order was refunded when nothing is owed or disputed', () => {
    expect(
      deletedRefundSentences({
        paidOrders: 0,
        refundableCents: 0,
        currency: null,
        disputedOrders: 0,
      }),
    ).toEqual(['Every paid order has been refunded in full.'])
  })

  it('counts what is still to go back, and leaves disputed orders to finance', () => {
    expect(
      deletedRefundSentences({
        paidOrders: 3,
        refundableCents: 9000,
        currency: 'USD',
        disputedOrders: 1,
      }),
    ).toEqual([
      '2 paid orders have not been refunded in full: $90.00 in all is still to go back, counting any refund the payment provider has not confirmed.',
      '1 order is disputed and is left to the finance team.',
    ])
    expect(
      deletedRefundSentences({
        paidOrders: 2,
        refundableCents: 0,
        currency: 'USD',
        disputedOrders: 2,
      }),
    ).toEqual(['2 orders are disputed and are left to the finance team.'])
  })

  it('says nothing without counts', () => {
    expect(deletedRefundSentences(null)).toEqual([])
  })
})

describe('a deleted event’s web address', () => {
  it('knows the placeholder a never-public event’s address became', () => {
    expect(slugReleased({ id: 'cevent1', slug: 'deleted-cevent1' })).toBe(true)
    expect(slugReleased({ id: 'cevent1', slug: 'diwali-mela-2026' })).toBe(false)
    // An organiser's own address that happens to start the same way is theirs.
    expect(slugReleased({ id: 'cevent1', slug: 'deleted-scenes-premiere' })).toBe(false)
  })
})

describe('a cancelled night a page does not list', () => {
  it('is named by the start its notice recorded, in the event’s zone', () => {
    expect(
      noticeNightStart(
        { kind: 'SESSION_CANCELLED', before: { startsAt: '2026-10-18T00:30:00.000Z' } },
        'America/Chicago',
      ),
    ).toBe('Sat, Oct 17, 2026, 7:30 PM')
  })

  it('names nothing for another kind of notice, or one without a start', () => {
    expect(
      noticeNightStart(
        { kind: 'MATERIAL_CHANGE', before: { startsAt: '2026-10-18T00:30:00.000Z' } },
        'America/Chicago',
      ),
    ).toBeNull()
    expect(noticeNightStart({ kind: 'SESSION_CANCELLED', before: null }, 'UTC')).toBeNull()
  })
})

describe('the booking fee and paying at the venue, in words (SPEC3 §12.3, SPEC3-XI §12.3)', () => {
  const SITE = { currency: 'USD', percentageBps: 450, flatCentsPerTicket: 151 }

  it('writes a fee as two numbers, and "No booking fee" for 0% + $0.00', () => {
    expect(percentText(450)).toBe('4.50')
    expect(feeTermsShort({ percentageBps: 300, flatCents: 149, currency: 'USD' })).toBe(
      '3.00% + $1.49',
    )
    expect(feeTermsShort({ percentageBps: 0, flatCents: 0, currency: 'USD' })).toBe(
      'No booking fee',
    )
  })

  it('says which fee is in force: the site default, the event’s own, or none', () => {
    expect(currentFeeSentence({ source: 'SITE_DEFAULT' }, SITE)).toBe(
      'Site default: 4.50% of the ticket price plus $1.51 per ticket. The site default is set in the server’s settings.',
    )
    expect(
      currentFeeSentence(
        { source: 'EVENT', percentageBps: 300, flatCentsPerTicket: 99, currency: 'USD' },
        SITE,
      ),
    ).toBe('This event: 3.00% of the ticket price plus $0.99 per ticket.')
    expect(
      currentFeeSentence(
        { source: 'EVENT', percentageBps: 0, flatCentsPerTicket: 0, currency: 'USD' },
        SITE,
      ),
    ).toBe('This event has no booking fee.')
  })

  it('says who changed the fee last, naming a former administrator when the account is gone', () => {
    expect(lastFeeChangeSentence({ changedAt: null })).toBeNull()
    expect(
      lastFeeChangeSentence(
        { changedAt: '2026-10-09T15:00:00.000Z', changedByName: null, reason: 'Partner rate.' },
        'UTC',
      ),
    ).toBe('Changed by A former administrator on Fri, Oct 9, 2026: “Partner rate.”')
    expect(changedBy('Anil')).toBe('Anil')
  })

  it('writes the switch as words, on the panel and in the events list', () => {
    expect(venueStatusText({ enabled: false, limit: 50 })).toBe('Off')
    expect(venueStatusText({ enabled: true, limit: 1500 })).toBe(
      'On — up to 1,500 tickets waiting to be paid at the door',
    )
    // On, with no limit given: "On", never "up to 0".
    expect(venueStatusText({ enabled: true, limit: null })).toBe('On')
    // The smallest limit, one ticket, is not "1 tickets".
    expect(venueStatusText({ enabled: true, limit: 1 })).toBe(
      'On — up to 1 ticket waiting to be paid at the door',
    )
    expect(venueListText({ venuePaymentEnabled: true, venuePaymentLimit: 50 })).toBe(
      'On, up to 50 unpaid',
    )
    expect(venueListText({ venuePaymentEnabled: false })).toBe('Off')
    expect(feeListText({ feeSource: 'SITE_DEFAULT' })).toBe('Site default')
    expect(
      feeListText({
        feeSource: 'EVENT',
        feePercentageBps: 300,
        feeFlatCentsPerTicket: 149,
        feeCurrency: 'USD',
      }),
    ).toBe('3.00% + $1.49')
    expect(
      feeListText({
        feeSource: 'EVENT',
        feePercentageBps: 0,
        feeFlatCentsPerTicket: 0,
        feeCurrency: 'USD',
      }),
    ).toBe('No booking fee')
  })

  it('writes each change, newest first, knowing a new limit from a switch-on', () => {
    const history = [
      {
        kind: 'VENUE_PAYMENT',
        at: '2026-10-11T12:00:00.000Z',
        byName: 'Anil',
        enabled: true,
        limit: 80,
        reason: 'More room.',
      },
      {
        kind: 'VENUE_PAYMENT',
        at: '2026-10-10T12:00:00.000Z',
        byName: 'Anil',
        enabled: true,
        limit: 50,
        reason: 'Trial run.',
      },
      {
        kind: 'FEE',
        at: '2026-10-09T12:00:00.000Z',
        byName: null,
        source: 'EVENT',
        percentageBps: 0,
        flatCentsPerTicket: 0,
        currency: 'USD',
        reason: 'Charity night.',
      },
      {
        kind: 'FEE',
        at: '2026-10-08T12:00:00.000Z',
        byName: 'Priya',
        source: 'SITE_DEFAULT',
        reason: 'Back to normal.',
      },
      {
        kind: 'VENUE_PAYMENT',
        at: '2026-10-07T12:00:00.000Z',
        byName: 'Priya',
        enabled: false,
        limit: 50,
        reason: 'Paused for now.',
      },
    ]

    expect(historyLines(history, { currency: 'USD', timeZone: 'UTC' })).toEqual([
      'Sun, Oct 11, 2026 — Anil changed the limit to 80: “More room.”',
      'Sat, Oct 10, 2026 — Anil turned paying at the venue on, up to 50 unpaid: “Trial run.”',
      'Fri, Oct 9, 2026 — A former administrator set the booking fee to 0.00% + $0.00: “Charity night.”',
      'Thu, Oct 8, 2026 — Priya returned the booking fee to the site default: “Back to normal.”',
      'Wed, Oct 7, 2026 — Priya turned paying at the venue off: “Paused for now.”',
    ])
  })

  it('reads a percentage of up to two decimals, from 0 to 30', () => {
    expect(parsePercentage('3')).toEqual({ bps: 300 })
    expect(parsePercentage('4.5')).toEqual({ bps: 450 })
    expect(parsePercentage('0.05')).toEqual({ bps: 5 })
    expect(parsePercentage('30')).toEqual({ bps: 3000 })

    for (const bad of ['30.01', '-1', '4.555', 'four', '']) {
      expect(parsePercentage(bad)).toEqual({
        error: 'Enter a percentage from 0 to 30, with at most two decimal places.',
      })
    }
  })

  it('reads a limit as a whole number from 1 to 100,000', () => {
    expect(parseVenueLimit('50')).toEqual({ limit: 50 })
    expect(parseVenueLimit('100,000')).toEqual({ limit: 100_000 })

    for (const bad of ['0', '100001', '2.5', 'many']) {
      expect(parseVenueLimit(bad)).toEqual({ error: 'Enter a whole number from 1 to 100,000.' })
    }
  })

  it('writes the amount’s bounds and prefix in the event’s currency', () => {
    expect(amountBoundsSentence('USD')).toBe('Enter an amount from $0.00 to $100.00.')
    expect(currencySymbol('USD')).toBe('$')
    expect(currencySymbol('INR')).toBe('₹')
  })
})

describe('an event not yet posted (SPEC3 §12.3, O8)', () => {
  it('says the team edits an event’s details only once it is published, and its fee before', () => {
    expect(NOT_POSTED_SENTENCE).toBe(
      'The Desi Events team edits an event’s details only once it has been published. Before that they are the organiser’s draft; ask for changes through review.',
    )
    expect(UNPOSTED_TERMS_SENTENCE).toBe(
      'You can set this event’s booking fee and whether it can be paid for at the venue now, before it is published.',
    )
  })
})

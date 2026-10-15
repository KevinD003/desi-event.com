/**
 * The limitations list holds together: every id is unique and usable as an
 * anchor, every link names words its meaning really says and leads to an
 * entry that exists, and `meaningParts` gives back the meaning unchanged.
 *
 * @module lib/limitations.test
 */

import { describe, expect, it } from 'vitest'

import { LIMITATIONS, meaningParts } from './limitations.js'

/** The status words the project records, and no others. */
const STATUS_WORDS = new Set([
  'NOT IMPLEMENTED',
  'DISABLED',
  'EXTERNAL VERIFICATION PENDING',
  'EXTERNAL DEVICE VERIFICATION PENDING',
])

describe('LIMITATIONS', () => {
  it('gives every entry a unique id that works as a page anchor', () => {
    const ids = LIMITATIONS.map(({ id }) => id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/u)
  })

  it('uses only the recorded status words', () => {
    for (const { status } of LIMITATIONS) expect(STATUS_WORDS.has(status)).toBe(true)
  })

  it('lists exactly the entries SPEC2 §10, SPEC2-XI §11, SPEC3 §15.1 and SPEC3-XI §15 record, in page order', () => {
    expect(LIMITATIONS.map(({ id }) => id)).toEqual([
      'payments',
      'paying-at-the-venue',
      'tax-on-venue-tickets',
      'unpaid-bookings',
      'general-admission-refunds',
      'booking-fee-default',
      'referral-rewards',
      'group-booking',
      'offline-admission',
      'physical-qr',
      'camera',
      'image-scanning',
      'organiser-sign-up',
      'live-changes-not-reviewed',
      'night-cancellation-passes',
      'event-refunds-batch',
      'payment-after-cancellation',
      'deleted-events-kept',
      'imported-events',
      'website-link-checks',
      'email',
      'sms',
      'retention',
      'visit-counts',
    ])
  })

  it('no longer carries pictures-after-publication (SPEC2-XI O12)', () => {
    expect(LIMITATIONS.some(({ id }) => id === 'pictures-after-publication')).toBe(false)
  })

  it('links only words the meaning says, to an entry that exists', () => {
    const ids = new Set(LIMITATIONS.map(({ id }) => id))
    const linked = LIMITATIONS.filter(({ links }) => links?.length)

    expect(linked.map(({ id }) => id)).toEqual(['website-link-checks', 'retention'])
    for (const limitation of linked) {
      for (const link of limitation.links) {
        expect(limitation.meaning).toContain(link.text)
        expect(link.href.startsWith('#')).toBe(true)
        expect(ids.has(link.href.slice(1))).toBe(true)
      }
    }
  })

  it('promises nothing in any meaning', () => {
    for (const { meaning } of LIMITATIONS) {
      expect(meaning).not.toMatch(/coming soon|\bsoon\b|\byet\b|in a future|planned/iu)
    }
  })
})

describe('meaningParts', () => {
  it('gives back the meaning unchanged when joined, for every entry', () => {
    for (const limitation of LIMITATIONS) {
      expect(
        meaningParts(limitation)
          .map(({ text }) => text)
          .join(''),
      ).toBe(limitation.meaning)
    }
  })

  it('marks the linked words, in order, between plain runs', () => {
    expect(
      meaningParts({
        meaning: 'One two three four.',
        links: [
          { text: 'two', href: '#a' },
          { text: 'four', href: '#b' },
        ],
      }),
    ).toEqual([
      { text: 'One ' },
      { text: 'two', href: '#a' },
      { text: ' three ' },
      { text: 'four', href: '#b' },
      { text: '.' },
    ])
  })

  it('gives one plain run when there is no link', () => {
    expect(meaningParts({ meaning: 'Plain.' })).toEqual([{ text: 'Plain.' }])
  })

  it('refuses a link whose words the meaning does not say', () => {
    expect(() =>
      meaningParts({ meaning: 'Plain.', links: [{ text: 'absent', href: '#x' }] }),
    ).toThrow(/does not contain the link text/u)
  })
})

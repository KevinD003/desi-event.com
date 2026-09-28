import { describe, expect, it } from 'vitest'

import { eventJsonLd, lifecycleNotice } from './event-jsonld.js'

/** A public event payload, of the shape `GET /events/:slug` returns. */
const event = {
  id: 'evt_1',
  slug: 'qawwali-under-the-banyan',
  title: 'Qawwali Under the Banyan',
  summary: 'An evening of qawwali.',
  status: 'ON_SALE',
  startsAt: '2026-11-01T14:30:00.000Z',
  endsAt: '2026-11-01T17:30:00.000Z',
  timezone: 'Asia/Kolkata',
  isOnline: false,
  artists: ['Nizami Bandhu'],
  ageRestriction: null,
  venue: {
    name: 'Banyan Courtyard',
    addressLine1: '1 Banyan Road',
    city: 'Mumbai',
    region: 'Maharashtra',
    postalCode: '400001',
    country: 'IN',
  },
  organization: { name: 'Swar Sadhana Trust', slug: 'swar-sadhana-trust' },
  ticketTypes: [{ id: 'tt_1', name: 'General', priceCents: 149_900, currency: 'INR' }],
}

describe('the structured data an event publishes', () => {
  it('describes an event on sale as scheduled, with its tickets in stock', () => {
    const data = eventJsonLd(event, { siteUrl: 'https://example.test' })

    expect(data['@type']).toBe('Event')
    expect(data.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(data.offers[0].availability).toBe('https://schema.org/InStock')
    expect(data.offers[0].price).toBe('1499.00')
    expect(data.offers[0].priceCurrency).toBe('INR')
  })

  it('points at its own canonical URL', () => {
    const data = eventJsonLd(event, { siteUrl: 'https://example.test' })

    expect(data.url).toBe('https://example.test/events/qawwali-under-the-banyan')
  })

  it('says cancelled when the event is cancelled', () => {
    // The whole reason this vocabulary exists. A page that omits it is telling
    // a search engine the show is on, and the search engine will repeat that
    // in a rich result long after the organiser called it off.
    const data = eventJsonLd({ ...event, status: 'CANCELLED' })

    expect(data.eventStatus).toBe('https://schema.org/EventCancelled')
  })

  it('offers no tickets for a cancelled event', () => {
    const data = eventJsonLd({ ...event, status: 'CANCELLED' })

    expect(data.offers).toBeUndefined()
  })

  it("says postponed, and carries the date that was in somebody's calendar", () => {
    const data = eventJsonLd({
      ...event,
      status: 'POSTPONED',
      previousStartsAt: '2026-10-01T14:30:00.000Z',
    })

    expect(data.eventStatus).toBe('https://schema.org/EventPostponed')
    expect(data.previousStartDate).toBe('2026-10-01T14:30:00.000Z')
  })

  it('marks a sold-out event sold out rather than merely scheduled', () => {
    const data = eventJsonLd({ ...event, status: 'SOLD_OUT' })

    expect(data.eventStatus).toBe('https://schema.org/EventScheduled')
    expect(data.offers[0].availability).toBe('https://schema.org/SoldOut')
  })

  it('treats paused and announced-but-not-yet-selling as pre-order', () => {
    expect(eventJsonLd({ ...event, status: 'SALES_PAUSED' }).offers[0].availability).toBe(
      'https://schema.org/PreOrder',
    )
    expect(eventJsonLd({ ...event, status: 'PUBLISHED' }).offers[0].availability).toBe(
      'https://schema.org/PreOrder',
    )
  })

  it('gives an online event a virtual location rather than a postal address', () => {
    const data = eventJsonLd(
      { ...event, isOnline: true, onlineUrl: 'https://stream.test/show', venue: null },
      { siteUrl: 'https://example.test' },
    )

    expect(data.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode')
    expect(data.location).toEqual({ '@type': 'VirtualLocation', url: 'https://stream.test/show' })
  })

  it('names the performers in billing order', () => {
    const data = eventJsonLd({ ...event, artists: ['Nizami Bandhu', 'Warsi Brothers'] })

    expect(data.performer.map((performer) => performer.name)).toEqual([
      'Nizami Bandhu',
      'Warsi Brothers',
    ])
  })

  it('publishes an age restriction as a range, not as a bare number', () => {
    expect(eventJsonLd({ ...event, ageRestriction: 18 }).typicalAgeRange).toBe('18-')
    expect(eventJsonLd(event).typicalAgeRange).toBeUndefined()
  })

  it('publishes nothing at all for a payload with no slug or title', () => {
    expect(eventJsonLd(null)).toBeNull()
    expect(eventJsonLd({ title: 'Nameless' })).toBeNull()
    expect(eventJsonLd({ slug: 'untitled' })).toBeNull()
  })

  it('carries nothing the public payload does not already carry', () => {
    // Built from the same object the page renders, so there is one allow list
    // rather than two. A second source is how an organiser's contact address
    // ends up inside a `<script>` tag after being kept out of the visible page
    // — which is the shape finding NF-14 took.
    const serialised = JSON.stringify(
      eventJsonLd(
        {
          ...event,
          contactEmail: 'accounts@swar-sadhana.test',
          moderationNote: 'Chase them about the licence.',
          payoutCurrency: 'INR',
          revision: 7,
        },
        { siteUrl: 'https://example.test' },
      ),
    )

    expect(serialised).not.toMatch(/accounts@swar-sadhana\.test/)
    expect(serialised).not.toMatch(/licence/i)
    expect(serialised).not.toMatch(/payoutCurrency/)
    expect(serialised).not.toMatch(/revision/)
  })

  it('drops a tier with no usable price rather than publishing a broken offer', () => {
    const data = eventJsonLd({
      ...event,
      ticketTypes: [
        { id: 'tt_1', name: 'General', priceCents: 149_900, currency: 'INR' },
        { id: 'tt_2', name: 'Unpriced' },
      ],
    })

    expect(data.offers).toHaveLength(1)
  })
})

describe('the pictures the structured data points at', () => {
  /**
   * A public picture payload.
   *
   * @param {string} id The asset id.
   * @returns {object} The payload.
   */
  const picture = (id) => ({
    id,
    url: `/v1/media/${id}`,
    altText: `Picture ${id}`,
    width: 1200,
    height: 630,
    contentType: 'image/jpeg',
  })

  it('names the cover and the first two gallery pictures, each as an absolute URL on this site', () => {
    const data = eventJsonLd(
      {
        ...event,
        coverImage: picture('cmedia0000000000000000001'),
        gallery: [
          picture('cmedia0000000000000000002'),
          picture('cmedia0000000000000000003'),
          picture('cmedia0000000000000000004'),
        ],
      },
      { siteUrl: 'https://example.test/' },
    )

    expect(data.image).toEqual([
      'https://example.test/api/v1/media/cmedia0000000000000000001',
      'https://example.test/api/v1/media/cmedia0000000000000000002',
      'https://example.test/api/v1/media/cmedia0000000000000000003',
    ])
  })

  it('points at the generated poster card when the event has no picture', () => {
    expect(eventJsonLd(event, { siteUrl: 'https://example.test' }).image).toEqual([
      'https://example.test/events/qawwali-under-the-banyan/opengraph-image/poster-event',
    ])
    const concert = { ...event, category: 'MUSIC_CONCERT', coverImage: null, gallery: [] }

    expect(eventJsonLd(concert, { siteUrl: 'https://example.test' }).image).toEqual([
      'https://example.test/events/qawwali-under-the-banyan/opengraph-image/poster-music-concert',
    ])
  })

  it('never publishes an address that is not one of this site’s pictures', () => {
    // A payload carrying a third-party address — which the API never sends —
    // is treated as no picture at all rather than echoed into a search result.
    const data = eventJsonLd(
      {
        ...event,
        coverImage: {
          ...picture('cmedia0000000000000000001'),
          url: 'https://tracker.test/pixel.png',
        },
        gallery: [{ ...picture('cmedia0000000000000000002'), url: '/v1/media/x?y=1' }],
      },
      { siteUrl: 'https://example.test' },
    )

    expect(JSON.stringify(data)).not.toMatch(/tracker\.test|\?y=1/)
    expect(data.image).toEqual([
      'https://example.test/events/qawwali-under-the-banyan/opengraph-image/poster-event',
    ])
  })
})

describe('what a lifecycle state says to a person', () => {
  it('agrees with the structured data about every state that has a notice', () => {
    // A banner saying "cancelled" over structured data saying `EventScheduled`
    // is worse than either alone, because one of them feeds a search result.
    expect(lifecycleNotice('CANCELLED').title).toMatch(/cancelled/i)
    expect(eventJsonLd({ ...event, status: 'CANCELLED' }).eventStatus).toMatch(/EventCancelled/)

    expect(lifecycleNotice('POSTPONED').title).toMatch(/postponed/i)
    expect(eventJsonLd({ ...event, status: 'POSTPONED' }).eventStatus).toMatch(/EventPostponed/)
  })

  it('says nothing when the ordinary page is the truth', () => {
    expect(lifecycleNotice('ON_SALE')).toBeNull()
    expect(lifecycleNotice('PUBLISHED')).toBeNull()
  })

  it('marks a cancellation as an error and a pause as information', () => {
    // Not colour alone: each notice carries its own sentence. The variant only
    // decides how loudly it is drawn.
    expect(lifecycleNotice('CANCELLED').variant).toBe('error')
    expect(lifecycleNotice('POSTPONED').variant).toBe('warning')
    expect(lifecycleNotice('SALES_PAUSED').variant).toBe('info')
  })

  it('tells somebody holding a ticket to a cancelled event that a refund is owed', () => {
    expect(lifecycleNotice('CANCELLED').body).toMatch(/refund/i)
  })

  it('does not promise a refund has been paid, only that it has been asked for', () => {
    // Refunds are created as REQUESTED and no provider call is made, so the
    // page must not claim money has moved.
    expect(lifecycleNotice('CANCELLED').body).not.toMatch(/refunded|has been paid|issued/i)
  })

  it('has a notice for every state that is public but not on sale', () => {
    for (const status of ['CANCELLED', 'POSTPONED', 'SOLD_OUT', 'SALES_PAUSED', 'COMPLETED']) {
      expect(lifecycleNotice(status), status).not.toBeNull()
    }
  })
})

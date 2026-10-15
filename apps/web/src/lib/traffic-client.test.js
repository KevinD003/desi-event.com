import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  TRAFFIC_BEACON_PATH,
  beaconReferrer,
  clickBeacon,
  landedHere,
  noteViewSent,
  resetTrafficClient,
  sendTrafficBeacon,
  trafficAttributes,
  whenShown,
} from './traffic-client.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const EVENT = 'cevent00000000000000001'
const ORG = 'corg000000000000000001'
const ORIGIN = 'https://desi-event.test'

/**
 * A link marked for counting, inside the document, with a child to click.
 *
 * @param {object} attributes The data attributes.
 * @returns {HTMLElement} The child element a click lands on.
 */
function markedLink(attributes) {
  const link = document.createElement('a')
  const inner = document.createElement('span')

  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value)

  link.append(inner)
  document.body.append(link)

  return inner
}

/**
 * A mouse event as the delegated listener receives it.
 *
 * @param {string} type `click` or `auxclick`.
 * @param {number} button Which button.
 * @param {EventTarget} target What was clicked.
 * @returns {object} The event.
 */
const press = (type, button, target) => ({ type, button, target })

beforeEach(() => {
  resetTrafficClient()
  document.body.innerHTML = ''
})

describe('beaconReferrer', () => {
  it('says this site for a view after a navigation inside it, whatever the document says', () => {
    expect(
      beaconReferrer({
        referrer: 'https://www.google.com/search?q=x',
        origin: ORIGIN,
        landed: false,
      }),
    ).toBe('SAME_SITE')
  })

  it.each([
    ['', null],
    [`${ORIGIN}/events`, 'SAME_SITE'],
    ['https://www.Google.com/search?q=garba', 'www.google.com'],
    ['https://l.instagram.com/?u=x', 'l.instagram.com'],
    ['https://[2001:db8::1]/page', 'OTHER_SITE'],
    ['not a url', 'OTHER_SITE'],
  ])('reads a landing referrer of %j as %j, never a URL', (referrer, expected) => {
    expect(beaconReferrer({ referrer, origin: ORIGIN, landed: true })).toBe(expected)
  })
})

describe('landedHere', () => {
  it('is true for the first view of a document loaded at this path', () => {
    expect(
      landedHere({
        navigationEntry: { name: `${ORIGIN}/events/garba` },
        pathname: '/events/garba',
      }),
    ).toBe(true)
  })

  it('is false after a soft navigation, and after a view was already sent', () => {
    expect(landedHere({ navigationEntry: { name: `${ORIGIN}/` }, pathname: '/events/garba' })).toBe(
      false,
    )

    noteViewSent()

    expect(
      landedHere({
        navigationEntry: { name: `${ORIGIN}/events/garba` },
        pathname: '/events/garba',
      }),
    ).toBe(false)
  })

  it('is false with no navigation entry', () => {
    expect(landedHere({ navigationEntry: undefined, pathname: '/' })).toBe(false)
  })
})

describe('clickBeacon', () => {
  const card = {
    'data-traffic-kind': 'CARD_CLICK',
    'data-traffic-event': EVENT,
    'data-traffic-placement': 'HOME',
    'data-traffic-organization': ORG,
  }

  it('makes a card click from a primary click anywhere inside a marked link', () => {
    expect(clickBeacon(press('click', 0, markedLink(card)))).toEqual({
      eventId: EVENT,
      kind: 'CARD_CLICK',
      placement: 'HOME',
    })
  })

  it('counts a middle-button click, which opens a new tab', () => {
    expect(clickBeacon(press('auxclick', 1, markedLink(card)))).not.toBeNull()
  })

  it('ignores a right click, a middle button on `click`, and a click outside a marked link', () => {
    const inside = markedLink(card)
    const outside = document.createElement('p')

    document.body.append(outside)

    expect(clickBeacon(press('auxclick', 2, inside))).toBeNull()
    expect(clickBeacon(press('click', 1, inside))).toBeNull()
    expect(clickBeacon(press('click', 0, outside))).toBeNull()
  })

  it('sends nothing for staff, or for the viewer’s own organisation', () => {
    const inside = markedLink(card)

    expect(clickBeacon(press('click', 0, inside), { excludeAll: true })).toBeNull()
    expect(clickBeacon(press('click', 0, inside), { excludedOrganizationIds: [ORG] })).toBeNull()
    expect(
      clickBeacon(press('click', 0, inside), { excludedOrganizationIds: ['corgother0000000001'] }),
    ).not.toBeNull()
  })

  it.each([
    ['a page view', { ...card, 'data-traffic-kind': 'PAGE_VIEW' }],
    ['an id that is not an event’s', { ...card, 'data-traffic-event': '../admin' }],
    ['a card on the event page', { ...card, 'data-traffic-placement': 'EVENT_PAGE' }],
    ['tickets on a listing', { ...card, 'data-traffic-kind': 'TICKETS_CLICK' }],
  ])('refuses %s', (_name, attributes) => {
    expect(clickBeacon(press('click', 0, markedLink(attributes)))).toBeNull()
  })
})

describe('trafficAttributes', () => {
  it('marks a link with the four attributes', () => {
    expect(
      trafficAttributes({
        kind: 'SEATS_CLICK',
        eventId: EVENT,
        organizationId: ORG,
        placement: 'EVENT_PAGE',
      }),
    ).toEqual({
      'data-traffic-kind': 'SEATS_CLICK',
      'data-traffic-event': EVENT,
      'data-traffic-placement': 'EVENT_PAGE',
      'data-traffic-organization': ORG,
    })
  })

  it('marks nothing it could not count', () => {
    expect(
      trafficAttributes({ kind: 'CARD_CLICK', eventId: 'sample-1', placement: 'HOME' }),
    ).toEqual({})
    expect(
      trafficAttributes({ kind: 'CARD_CLICK', eventId: EVENT, placement: 'EVENT_PAGE' }),
    ).toEqual({})
    expect(
      trafficAttributes({ kind: 'PAGE_VIEW', eventId: EVENT, placement: 'EVENT_PAGE' }),
    ).toEqual({})
  })
})

describe('sendTrafficBeacon', () => {
  it('posts to this site without credentials, kept alive, with only the four keys', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

    sendTrafficBeacon(
      {
        eventId: EVENT,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        referrer: 'SAME_SITE',
        extra: 'x',
      },
      { fetchImpl },
    )

    const [url, init] = fetchImpl.mock.calls[0]

    expect(url).toBe(TRAFFIC_BEACON_PATH)
    expect(init).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store',
    })
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual([
      'eventId',
      'kind',
      'placement',
      'referrer',
    ])
  })

  it('sends no referrer with a click', () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))

    sendTrafficBeacon(
      { eventId: EVENT, kind: 'CARD_CLICK', placement: 'LISTING', referrer: 'SAME_SITE' },
      { fetchImpl },
    )

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      eventId: EVENT,
      kind: 'CARD_CLICK',
      placement: 'LISTING',
    })
  })

  it('never throws, whether the network fails or fetch itself does', async () => {
    const rejecting = vi.fn(() => Promise.reject(new Error('offline')))
    const throwing = vi.fn(() => {
      throw new Error('blocked')
    })

    expect(() =>
      sendTrafficBeacon(
        { eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE' },
        { fetchImpl: rejecting },
      ),
    ).not.toThrow()
    expect(() =>
      sendTrafficBeacon(
        { eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE' },
        { fetchImpl: throwing },
      ),
    ).not.toThrow()

    await Promise.resolve()
  })
})

describe('whenShown', () => {
  it('runs straight away on a page that is showing', () => {
    const callback = vi.fn()

    whenShown({ prerendering: false, visibilityState: 'visible' }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('waits for a prerendered page to be activated', () => {
    const target = new EventTarget()
    const doc = Object.assign(target, { prerendering: true })
    const callback = vi.fn()

    whenShown(doc, callback)

    expect(callback).not.toHaveBeenCalled()

    doc.dispatchEvent(new Event('prerenderingchange'))

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('waits for an old-style prerender to become visible, and can be cancelled', () => {
    const target = new EventTarget()
    const doc = Object.assign(target, { visibilityState: 'prerender' })
    const callback = vi.fn()

    whenShown(doc, callback)
    doc.dispatchEvent(new Event('visibilitychange'))

    expect(callback).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))

    expect(callback).toHaveBeenCalledTimes(1)

    const cancelled = vi.fn()
    const other = Object.assign(new EventTarget(), { prerendering: true })
    const cancel = whenShown(other, cancelled)

    cancel()
    other.dispatchEvent(new Event('prerenderingchange'))

    expect(cancelled).not.toHaveBeenCalled()
  })
})

describe('the module', () => {
  it('imports only the visit vocabulary, so the browser ships no schema and no capability', () => {
    const source = readFileSync(path.join(here, 'traffic-client.js'), 'utf8')
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gmu)].map(
      (match) => match[1],
    )

    expect(imports).toEqual(['@desi-event/schemas/traffic-vocabulary'])
    expect(source).not.toMatch(
      /analytics:view_all|website_redirect:manage|platform:admin|organizer:invite/u,
    )
  })
})

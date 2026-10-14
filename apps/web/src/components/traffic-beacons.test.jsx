/**
 * The page's visit counting in the browser: one page view per mount even under
 * StrictMode, a beacon for a marked click, nothing at all for staff at The Desi Events
 * or for an organisation's own team on its events, and nothing from a
 * prerendered page until it is shown.
 *
 * @module components/traffic-beacons.test
 */

import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TRAFFIC_BEACON_PATH, resetTrafficClient } from '../lib/traffic-client.js'
import { TrafficBeacons } from './traffic-beacons.jsx'

const EVENT = 'cevent00000000000000001'
const ORG = 'corg000000000000000001'
const OTHER_EVENT = 'cevent00000000000000002'
const OTHER_ORG = 'corg000000000000000002'

let fetchMock

beforeEach(() => {
  resetTrafficClient()
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  delete document.visibilityState
})

/**
 * The beacons sent so far, as their parsed bodies.
 *
 * @returns {Array<object>} The bodies.
 */
function sent() {
  return fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toBe(TRAFFIC_BEACON_PATH)
    expect(init.credentials).toBe('omit')

    return JSON.parse(init.body)
  })
}

/**
 * A server-rendered card link, marked as `trafficAttributes` marks it.
 *
 * @param {object} [options] Options.
 * @param {string} [options.eventId] The event.
 * @param {string} [options.organizationId] Whose event.
 * @returns {HTMLElement} The link.
 */
function cardLink({ eventId = EVENT, organizationId = ORG } = {}) {
  const link = document.createElement('a')

  link.href = '#card'
  link.setAttribute('data-traffic-kind', 'CARD_CLICK')
  link.setAttribute('data-traffic-event', eventId)
  link.setAttribute('data-traffic-placement', 'HOME')
  link.setAttribute('data-traffic-organization', organizationId)
  link.textContent = 'Garba night'
  link.addEventListener('click', (event) => event.preventDefault())
  document.body.append(link)

  return link
}

describe('TrafficBeacons', () => {
  it('sends exactly one page view under StrictMode, without a session', () => {
    render(
      <StrictMode>
        <TrafficBeacons view={{ eventId: EVENT, organizationId: ORG }} />
      </StrictMode>,
    )

    expect(sent()).toEqual([
      { eventId: EVENT, kind: 'PAGE_VIEW', placement: 'EVENT_PAGE', referrer: 'SAME_SITE' },
    ])
  })

  it('sends no page view where the page is not an event’s', () => {
    render(<TrafficBeacons />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a card click for a primary click on a marked link, and one for a middle click', () => {
    render(<TrafficBeacons />)

    const link = cardLink()

    fireEvent.click(link, { button: 0 })
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))
    // A right click counts for nothing.
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 2 }))

    expect(sent()).toEqual([
      { eventId: EVENT, kind: 'CARD_CLICK', placement: 'HOME' },
      { eventId: EVENT, kind: 'CARD_CLICK', placement: 'HOME' },
    ])
  })

  it('sends nothing for staff at The Desi Events, neither the view nor a click', () => {
    render(
      <StrictMode>
        <TrafficBeacons view={{ eventId: EVENT, organizationId: ORG }} excludeAll />
      </StrictMode>,
    )

    fireEvent.click(cardLink(), { button: 0 })
    fireEvent.click(cardLink({ eventId: OTHER_EVENT, organizationId: OTHER_ORG }), { button: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends nothing about the reader’s own organisation’s events, and counts everybody else’s', () => {
    render(
      <TrafficBeacons
        view={{ eventId: EVENT, organizationId: ORG }}
        excludedOrganizationIds={[ORG]}
      />,
    )

    fireEvent.click(cardLink(), { button: 0 })
    fireEvent.click(cardLink({ eventId: OTHER_EVENT, organizationId: OTHER_ORG }), { button: 0 })

    expect(sent()).toEqual([{ eventId: OTHER_EVENT, kind: 'CARD_CLICK', placement: 'HOME' }])
  })

  it('stops listening when the page goes', () => {
    const { unmount } = render(<TrafficBeacons />)
    const link = cardLink()

    unmount()
    fireEvent.click(link, { button: 0 })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('waits for a prerendered page to be shown before sending its view', () => {
    let visibility = 'prerender'

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })

    render(
      <StrictMode>
        <TrafficBeacons view={{ eventId: EVENT, organizationId: ORG }} />
      </StrictMode>,
    )

    expect(fetchMock).not.toHaveBeenCalled()

    act(() => {
      visibility = 'visible'
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(sent()).toHaveLength(1)
    expect(sent()[0].kind).toBe('PAGE_VIEW')
  })
})

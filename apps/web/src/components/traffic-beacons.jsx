'use client'

/**
 * The page's visit counting, in the browser.
 *
 * One delegated listener for the whole page: a click (primary button, or the
 * Enter key on a link, which fires `click`) or a middle-button `auxclick` on a
 * server-rendered link marked with `data-traffic-*` sends one beacon. The
 * listing components stay server components; they only carry the attributes.
 * Listening in the capture phase means the beacon is on its way, with
 * `keepalive`, before the navigation the click starts.
 *
 * On an event's page it also sends one page view, once the page is really
 * shown (a prerendered page nobody opens sends nothing), and once per mount
 * even under React's StrictMode double effects.
 *
 * Who is not counted was decided on the server, from the session the page
 * read (`TrafficScope`): Desi-Event staff are not counted anywhere, and an
 * organisation's own team is not counted on its events. Nothing is sent for
 * them. The beacon itself carries no session, cookie or account.
 *
 * Imports nothing but the beacon helpers, which import nothing but the visit
 * vocabulary, so no request schema or capability name reaches the browser.
 *
 * @module components/traffic-beacons
 */

import { useEffect, useRef } from 'react'

import {
  beaconReferrer,
  clickBeacon,
  landedHere,
  noteViewSent,
  sendTrafficBeacon,
  whenShown,
} from '../lib/traffic-client.js'

/**
 * @typedef {object} TrafficBeaconsProps
 * @property {{eventId: string, organizationId?: string}|null} [view] The event whose page this is; null elsewhere.
 * @property {boolean} [excludeAll] True for Desi-Event staff: nothing is counted.
 * @property {string[]} [excludedOrganizationIds] The reader's own organisations, whose events are not counted.
 */

/**
 * Listens for marked clicks and sends the page view. Renders nothing.
 *
 * @param {TrafficBeaconsProps} props Component props.
 * @returns {null} Nothing.
 */
export function TrafficBeacons({ view = null, excludeAll = false, excludedOrganizationIds = [] }) {
  const sentFor = useRef(null)
  // A stable key for the effects, so a new array with the same ids does not
  // tear the listener down and put it back on every render.
  const excludedKey = excludedOrganizationIds.join(',')
  const eventId = view?.eventId ?? null
  const organizationId = view?.organizationId ?? null

  useEffect(() => {
    if (excludeAll) return undefined

    const excluded = {
      excludeAll,
      excludedOrganizationIds: excludedKey ? excludedKey.split(',') : [],
    }

    /**
     * Send the beacon a marked click makes.
     *
     * @param {MouseEvent} event The click.
     * @returns {void}
     */
    const onClick = (event) => {
      const beacon = clickBeacon(event, excluded)

      if (beacon) sendTrafficBeacon(beacon)
    }

    document.addEventListener('click', onClick, true)
    document.addEventListener('auxclick', onClick, true)

    return () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('auxclick', onClick, true)
    }
  }, [excludeAll, excludedKey])

  useEffect(() => {
    if (!eventId || excludeAll) return undefined
    if (organizationId && excludedKey.split(',').includes(organizationId)) return undefined
    if (sentFor.current === eventId) return undefined

    return whenShown(document, () => {
      if (sentFor.current === eventId) return

      sentFor.current = eventId

      const landed = landedHere({
        navigationEntry: globalThis.performance?.getEntriesByType?.('navigation')?.[0],
        pathname: window.location.pathname,
      })

      sendTrafficBeacon({
        eventId,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        referrer: beaconReferrer({
          referrer: document.referrer,
          origin: window.location.origin,
          landed,
        }),
      })
      noteViewSent()
    })
  }, [eventId, organizationId, excludeAll, excludedKey])

  return null
}

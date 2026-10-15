/**
 * Who a public page counts, decided on the server.
 *
 * A beacon carries no session, so the page that knows who is looking decides
 * who is left out and hands the browser only that answer: `excludeAll` for
 * staff at The Desi Events (any session holding a platform capability), and the
 * ids of the reader's own organisations, whose events their visits do not count
 * for. The browser receives booleans and ids, never a capability name.
 *
 * Rendered once per instrumented page: the home page, the events list and an
 * event's page. On an event's page `view` names the event, so its page view is
 * sent; elsewhere only marked clicks are.
 *
 * The session read is the request's own (`readSession` is cached per request),
 * so a page that reads the session itself as well asks the API once.
 *
 * @module components/traffic-scope
 */

import { readSession } from '../lib/session.js'
import { trafficExclusion } from '../lib/traffic.js'
import { TrafficBeacons } from './traffic-beacons.jsx'

/**
 * @typedef {object} TrafficScopeProps
 * @property {{eventId: string, organizationId?: string}|null} [view] The event whose page this is.
 */

/**
 * The page's visit counting, scoped to who is reading.
 *
 * @param {TrafficScopeProps} props Component props.
 * @returns {Promise<JSX.Element>} The client listener.
 */
export async function TrafficScope({ view = null }) {
  const { excludeAll, excludedOrganizationIds } = trafficExclusion(await readSession())

  return (
    <TrafficBeacons
      view={view}
      excludeAll={excludeAll}
      excludedOrganizationIds={excludedOrganizationIds}
    />
  )
}

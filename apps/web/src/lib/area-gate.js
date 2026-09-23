/**
 * The door every signed-in area layout opens with.
 *
 * Three steps, the same in every area, so they are written once:
 *
 * 1. Read the session from the API.
 * 2. No session: send the person to sign in, carrying the page they asked for
 *    in `next` — the page itself, not the top of the area. Before Phase 4 each
 *    layout hard-coded its own root, so a link to `/tickets/abc` came back to
 *    `/tickets` after signing in and the person had to find the ticket again.
 * 3. A session the area does not admit (see `lib/areas.js`): report that, so
 *    the layout can draw its refusal instead of the page.
 *
 * The layout still decides what to render. This decides only who got here.
 *
 * @module lib/area-gate
 */

import { redirect } from 'next/navigation'

import { admits } from './areas.js'
import { signInHref } from './next-path.js'
import { requestPath } from './request-path.js'
import { readSession } from './session.js'

/**
 * Enter an area.
 *
 * @param {string} key The area's key in `lib/areas.js`.
 * @returns {Promise<{session: object, admitted: boolean}>} The session, and whether the area admits it.
 */
export async function enterArea(key) {
  const session = await readSession()

  if (!session) redirect(signInHref(await requestPath()))

  return { session, admitted: admits(session, key) }
}

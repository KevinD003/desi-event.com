/**
 * Emit the browser's view of the route table.
 *
 * `createApiClient` reads four things about a route: its id, its method, its
 * path, and whether it takes a body or a query string. It never *parses* with
 * the schemas — `route.body` is read for truthiness and nothing else.
 *
 * Importing `routes.js` to learn that costs the browser every Zod schema in the
 * contract, which is how the shape of `Organization.contactEmail` and
 * `Organization.payoutCurrency` came to be compiled into a chunk served to
 * every visitor. The values were never there; the description of them was, in
 * every bundle, and the browser-bundle scan found it once it was told to look
 * for private organiser fields.
 *
 * So the client reads this instead: the same table with the schemas removed,
 * generated rather than maintained, and checked for drift by a test in the same
 * way `openapi.json` is. A route that exists cannot be missing from it, because
 * the check fails.
 *
 * @module @desi-event/api-contract/scripts/emit-route-manifest
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { apiRoutes } from '../src/routes.js'
import { routeManifestSource } from '../src/manifest.js'

const target = fileURLToPath(new URL('../src/route-manifest.js', import.meta.url))

writeFileSync(target, routeManifestSource(apiRoutes), 'utf8')

console.log(`Wrote ${apiRoutes.length} routes to ${target}`)

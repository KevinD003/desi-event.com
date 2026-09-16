/**
 * The browser's view of a route, and how the generated file is written.
 *
 * Kept apart from the generator script so that the shape is testable without
 * running a build, and so that the drift check and the emitter agree by
 * construction rather than by both being edited.
 *
 * @module @desi-event/api-contract/manifest
 */

/**
 * One route, reduced to what a client needs to place a request.
 *
 * Five fields, because that is what `createApiClient` reads and a grep of it
 * proves so. Four are obvious; `auth` is the one that matters, because it
 * decides whether the bearer token is attached — a manifest missing it would
 * send credentials to a route declared to take none, which is how a token ends
 * up in somebody else's log.
 *
 * `body` and `query` are booleans rather than the schemas themselves. The
 * client asks "does this route take a body" and answers by truthiness; it never
 * parses. Carrying the schemas to answer a yes-or-no question is what put every
 * entity's column names into the browser.
 *
 * @param {object} route A descriptor from `apiRoutes`.
 * @returns {{id: string, method: string, path: string, auth: string, body: boolean, query: boolean}} The reduced route.
 */
export function toManifestEntry(route) {
  return {
    id: route.id,
    method: route.method,
    path: route.path,
    auth: route.auth,
    body: Boolean(route.body),
    query: Boolean(route.query),
  }
}

/**
 * The generated module's source text.
 *
 * A frozen array literal, not JSON: it is imported like any other module, it
 * costs no parse step at runtime, and a reader can see what it is.
 *
 * @param {object[]} routes The full route table.
 * @returns {string} The file contents, Prettier-compatible.
 */
export function routeManifestSource(routes) {
  const entries = routes
    .map(toManifestEntry)
    .map(
      (entry) =>
        `  {\n` +
        `    id: '${entry.id}',\n` +
        `    method: '${entry.method}',\n` +
        `    path: '${entry.path}',\n` +
        `    auth: '${entry.auth}',\n` +
        `    body: ${entry.body},\n` +
        `    query: ${entry.query},\n` +
        `  },`,
    )
    .join('\n')

  return `/**
 * The route table as a browser sees it. **Generated — do not edit.**
 *
 * Run \`pnpm --filter @desi-event/api-contract run manifest:emit\` to
 * regenerate. \`manifest.test.js\` fails when this disagrees with
 * \`apiRoutes\`, so a route added to the contract cannot be missing here.
 *
 * It exists so that \`createApiClient\` can place a request without importing
 * the request and response schemas. Those describe every column of every
 * entity — including an organiser's contact address and the currency they are
 * paid in — and a browser has no business holding the description of them.
 *
 * @module @desi-event/api-contract/route-manifest
 */

/** @type {ReadonlyArray<{id: string, method: string, path: string, auth: string, body: boolean, query: boolean}>} */
export const apiRouteManifest = Object.freeze([
${entries}
])
`
}

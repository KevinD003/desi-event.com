/**
 * The installed Next queues its development server's route-table rebuilds.
 *
 * `patches/next@16.3.8.patch` changes one handler in Next's own
 * `setup-dev-bundler.js`: each burst of file events used to start a rebuild of
 * the table of routes at once, and an early rebuild finishing last left a
 * partial table — whole sets of routes, the API proxy among them, answering
 * Next's 404 for the rest of a browser run (`e2e/support/dev-routes.mjs` has
 * the proof). pnpm applies the patch on every install and refuses one that no
 * longer applies; this reads the file Node actually loads, so a tree installed
 * without it — a bypassed patch, a copied `node_modules` — fails here rather
 * than in the fifth minute of a browser job.
 *
 * @module lib/next-dev-route-rebuilds.test
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const require = createRequire(path.join(process.cwd(), 'package.json'))

/** The file `next dev` loads to watch `src/app` and build its routes. */
const bundler = readFileSync(
  require.resolve('next/dist/server/lib/router-utils/setup-dev-bundler.js'),
  'utf8',
)

/** The patched versions, as `pnpm-workspace.yaml` lists them. */
const workspace = readFileSync(path.join(process.cwd(), '..', '..', 'pnpm-workspace.yaml'), 'utf8')

describe('next dev rebuilds its routes one at a time', () => {
  it('patches the version of Next that is installed', () => {
    const { version } = require('next/package.json')

    expect(workspace).toContain(`  next@${version}: patches/next@${version}.patch`)
  })

  it('listens for file events with a queue, not with the rebuild itself', () => {
    // One listener, and it is not the asynchronous rebuild: that ran once per
    // event, unawaited, and the last to finish replaced the table.
    expect(bundler.match(/wp\.on\('aggregated'/gu)).toHaveLength(1)
    expect(bundler).not.toMatch(/wp\.on\('aggregated', async/u)
    expect(bundler).toMatch(
      /wp\.on\('aggregated', \(\)=>\{\s*previousRouteRebuild = previousRouteRebuild\.then\(rebuildRoutes, rebuildRoutes\);\s*\}\);/u,
    )
  })

  it('runs the whole rebuild inside the queued function, so it reads the files known when its turn comes', () => {
    const start = bundler.indexOf('async function rebuildRoutes() {')
    const read = bundler.indexOf('const knownFiles = wp.getTimeInfoEntries();')
    const published = bundler.indexOf("propagateServerField(opts, 'appPathRoutes'")
    const routes = bundler.indexOf('opts.fsChecker.dynamicRoutes = sortedRoutes.map(')
    const watch = bundler.indexOf('wp.watch({')

    expect(start).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(start)
    expect(published).toBeGreaterThan(read)
    expect(routes).toBeGreaterThan(published)
    // The watcher starts after the queue exists, so no early event is lost.
    expect(watch).toBeGreaterThan(routes)
  })
})

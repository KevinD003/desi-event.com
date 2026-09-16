/**
 * Remove what the run created.
 *
 * Reads the tag back off disk rather than recomputing it, because a tag derived
 * from a clock in two places is two different tags and the second one deletes
 * nothing.
 *
 * @module e2e/support/detail-global-teardown
 */

import { readFile } from 'node:fs/promises'

import { cleanupDetailWorld } from './detail-world.mjs'
import { WORLD_FILE } from './detail-global-setup.mjs'

/**
 * Tear the world down.
 *
 * @returns {Promise<void>} Resolves when done.
 */
export default async function globalTeardown() {
  const raw = await readFile(WORLD_FILE, 'utf8').catch(() => null)

  if (!raw) return

  await cleanupDetailWorld(JSON.parse(raw).tag)
}

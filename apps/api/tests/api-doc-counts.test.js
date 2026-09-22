/**
 * `docs/api.md`'s counts, pinned to the artefacts they describe.
 *
 * That page opens with "N operations across M tags" and a per-tag table, and
 * both are restated by hand. Restated-by-hand numbers drift, and this one has
 * drifted twice: the table said 118 operations when there were 129 (corrected
 * 2026-09-21), and 129 when there were 131 (corrected 2026-09-22, the day the
 * two connect routes merged). Each time it was found by somebody reading the
 * page rather than by anything that could fail.
 *
 * So the numbers are derived here instead. `openapi.json` is regenerated from
 * the contract and CI already fails on a difference between the two, which
 * makes it a fair source of truth for the total; the per-tag rows come from the
 * contract directly.
 *
 * ## The arithmetic that looks wrong and is not
 *
 * The per-tag rows sum to one more than the total, because `sessions.hold`
 * carries two tags and is counted under each. A row is a count of tag
 * membership; the headline is a count of operations. Asserting the rows sum to
 * the total would be asserting something false, so this file asserts each
 * separately and says why.
 *
 * @module @desi-event/api/tests/api-doc-counts
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiRoutes } from '@desi-event/api-contract'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

/** The page whose numbers this file pins. */
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'api.md'), 'utf8')

/** The artefact CI already holds to the contract. */
const OPENAPI = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'apps', 'api', 'openapi.json'), 'utf8'),
)

/** The HTTP methods an OpenAPI path item may carry an operation under. */
const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace']

/**
 * How many operations the published document actually describes.
 *
 * @returns {number} The count.
 */
function publishedOperations() {
  return Object.values(OPENAPI.paths ?? {}).reduce(
    (total, item) => total + Object.keys(item).filter((key) => METHODS.includes(key)).length,
    0,
  )
}

/**
 * How many routes carry each tag.
 *
 * @returns {Map<string, number>} Tag to count.
 */
function tagMembership() {
  const counts = new Map()

  for (const route of apiRoutes) {
    for (const tag of route.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return counts
}

describe('docs/api.md states the counts the artefacts do', () => {
  it('opens with the operation and tag totals', () => {
    const stated = DOC.match(/\*\*(\d+) operations across (\d+) tags\.\*\*/u)

    // A missing headline is a failure rather than a skip: somebody rewording it
    // away is exactly how this check would otherwise stop checking anything.
    expect(stated, 'docs/api.md no longer states "N operations across M tags"').not.toBeNull()

    expect(Number(stated[1]), 'the stated operation total').toBe(publishedOperations())
    expect(Number(stated[2]), 'the stated tag total').toBe(tagMembership().size)
  })

  it('gives every tag in the contract a row, with the right number', () => {
    const counts = tagMembership()
    const wrong = []
    const missing = []

    for (const [tag, count] of counts) {
      // The table is two tag/count pairs per line, so each cell is matched on
      // its own rather than by parsing the row shape — a layout change should
      // not be able to turn this into a test of nothing.
      const cell = DOC.match(new RegExp(`\`${tag}\`\\s*\\|\\s*(\\d+)`, 'u'))

      if (!cell) {
        missing.push(tag)
        continue
      }

      if (Number(cell[1]) !== count)
        wrong.push(`${tag}: doc says ${cell[1]}, contract has ${count}`)
    }

    expect(missing, 'tags with no row in docs/api.md').toEqual([])
    expect(wrong, 'rows disagreeing with the contract').toEqual([])
  })

  it('names no tag the contract does not have', () => {
    const counts = tagMembership()
    const table = DOC.slice(DOC.indexOf('| Tag'), DOC.indexOf('> **Correction'))
    const named = [...table.matchAll(/`([a-z-]+)`\s*\|\s*\d+/gu)].map((match) => match[1])

    expect(named.length).toBeGreaterThan(0)

    for (const tag of named) {
      expect(counts.has(tag), `docs/api.md has a row for "${tag}", which no route carries`).toBe(
        true,
      )
    }
  })

  it('counts tag membership, not operations, in its rows', () => {
    // The rows sum to one more than the total because `sessions.hold` carries
    // two tags. Asserted rather than left as a discrepancy somebody will
    // eventually "fix" by making one of the two numbers wrong.
    const counts = tagMembership()
    const summed = [...counts.values()].reduce((total, count) => total + count, 0)
    const multiTagged = apiRoutes.filter((route) => (route.tags ?? []).length > 1)

    expect(summed - publishedOperations()).toBe(
      multiTagged.reduce((extra, route) => extra + route.tags.length - 1, 0),
    )
    expect(multiTagged.map((route) => route.id)).toEqual(['sessions.hold'])
  })
})

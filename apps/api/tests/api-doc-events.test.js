/**
 * `docs/api.md`'s Events section, and the contract's own words about the
 * listing, pinned to the lifecycle they describe.
 *
 * The section went on describing the Phase 1 lifecycle for two phases after
 * it was replaced: `POST /v1/events/:id/publish` "moving between DRAFT,
 * PUBLISHED, CANCELLED, COMPLETED", anonymous callers seeing "`PUBLISHED`
 * events only", and a `status` filter of four values. The contract's
 * description of `events.list` said the same about anonymous callers, and the
 * page sends readers to the OpenAPI document as the authority. Nothing failed,
 * because nothing read either against the code.
 *
 * So this file does: every public status, every event status the filter
 * accepts, and every lifecycle command route must be named where a reader
 * looks for them.
 *
 * @module @desi-event/api/tests/api-doc-events
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { apiRoutes } from '@desi-event/api-contract'
import { EVENT_STATUSES, PUBLIC_EVENT_STATUSES } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

/** The page this file reads. */
const DOC = readFileSync(path.join(REPO_ROOT, 'docs', 'api.md'), 'utf8')

/** The Events section: from its heading to the next one at the same level. */
const EVENTS = (() => {
  const start = DOC.indexOf('\n### Events\n')
  const end = DOC.indexOf('\n### ', start + 1)

  return start === -1 ? '' : DOC.slice(start, end === -1 ? undefined : end)
})()

/**
 * The one table row whose first cells match.
 *
 * @param {RegExp} pattern What the row starts with.
 * @returns {string} The row, or '' when there is none.
 */
function row(pattern) {
  return EVENTS.split('\n').find((line) => pattern.test(line)) ?? ''
}

/** The routes that move an event's status: every command, and the moderator's ruling. */
const LIFECYCLE_COMMANDS = [
  'events.submitReview',
  'events.withdrawReview',
  'events.rework',
  'events.publish',
  'events.openSales',
  'events.pauseSales',
  'events.postpone',
  'events.reschedule',
  'events.cancel',
  'moderation.decide',
]

describe('docs/api.md describes the event lifecycle the code has', () => {
  it('has an Events section', () => {
    expect(EVENTS).not.toBe('')
  })

  it('names every status an anonymous caller is listed, and nothing narrower', () => {
    const listing = row(/^\|\s*GET\s*\|\s*`\/v1\/events`\s*\|/u)

    expect(listing, 'no GET /v1/events row').not.toBe('')
    for (const status of PUBLIC_EVENT_STATUSES) expect(listing).toContain(`\`${status}\``)
    expect(listing).not.toMatch(/PUBLISHED`? events only/u)
  })

  it('lists every status the `status` filter accepts', () => {
    const filter = row(/^\|\s*`status`\s*\|/u)

    expect(filter, 'no `status` parameter row').not.toBe('')
    for (const status of EVENT_STATUSES) expect(filter).toContain(`\`${status}\``)
  })

  it('names every lifecycle command, by the path the contract gives it', () => {
    for (const id of LIFECYCLE_COMMANDS) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(route, `${id} is not in the contract`).toBeDefined()
      expect(EVENTS, `${id} (${route.path}) is missing from the Events section`).toContain(
        `${route.method} ${route.path}`,
      )
    }
  })

  it('no longer says publish moves between the Phase 1 statuses', () => {
    expect(EVENTS).not.toMatch(/Move between `DRAFT`, `PUBLISHED`, `CANCELLED`, `COMPLETED`/u)
  })
})

describe("the contract's description of the listing", () => {
  it('names every status an anonymous caller is listed', () => {
    const { description } = apiRoutes.find((route) => route.id === 'events.list')

    for (const status of PUBLIC_EVENT_STATUSES) expect(description).toContain(status)
    expect(description).not.toMatch(/only ever see PUBLISHED events/u)
  })

  it('does not send a status change to the publish route alone', () => {
    const { description } = apiRoutes.find((route) => route.id === 'events.update')

    expect(description).not.toMatch(/use `POST \/v1\/events\/:id\/publish`/u)
  })
})

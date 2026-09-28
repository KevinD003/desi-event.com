/**
 * The organisation vocabulary says what the API enforces.
 *
 * The lists are written out in the vocabulary so a client form does not pull
 * the schemas barrel into the browser. Here, where nothing is bundled, they
 * are held to the API's own lists.
 *
 * @module lib/organization-vocabulary.test
 */

import { US_ORGANIZATION_TIMEZONES } from '@desi-event/schemas'
import { describe, expect, it } from 'vitest'

import { ACTORS, TRANSITIONS } from '../../../api/src/lib/verification.js'
import {
  DECISIONS,
  MODERATOR_DECISIONS,
  SUBMITTABLE_STATUSES,
  US_TIMEZONE_OPTIONS,
  VERIFICATION_STATUSES,
  verificationReading,
} from './organization-vocabulary.js'

describe('the organisation vocabulary', () => {
  it('offers exactly the time zones the API accepts', () => {
    expect(US_TIMEZONE_OPTIONS.map((option) => option.value)).toEqual([
      ...US_ORGANIZATION_TIMEZONES,
    ])
  })

  it('names every verification state', () => {
    expect(Object.keys(VERIFICATION_STATUSES).sort()).toEqual(Object.keys(TRANSITIONS).sort())
    expect(verificationReading('PENDING').label).toBe('Waiting for a moderator')
  })

  it('offers an organiser a request exactly where the API lets one make it', () => {
    const fromApi = Object.entries(TRANSITIONS)
      .filter(([, edges]) => edges.some((edge) => edge.actor === ACTORS.ORGANISER))
      .map(([from]) => from)
      .sort()

    expect([...SUBMITTABLE_STATUSES].sort()).toEqual(fromApi)
  })

  it('offers a moderator exactly the decisions the API allows from each state', () => {
    for (const [from, edges] of Object.entries(TRANSITIONS)) {
      const fromApi = edges.filter((edge) => edge.actor === ACTORS.MODERATOR).map((e) => e.to)

      expect([...MODERATOR_DECISIONS[from]].sort(), from).toEqual(fromApi.sort())

      for (const decision of fromApi) expect(DECISIONS[decision], decision).toBeDefined()
    }
  })
})

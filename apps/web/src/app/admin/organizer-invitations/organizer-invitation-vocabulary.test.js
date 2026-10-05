/**
 * The organiser invitation words: every status reads as a word with its date,
 * a row offers only what its code still allows, and the delivery lines are
 * true in the mode they name.
 *
 * @module app/admin/organizer-invitations/organizer-invitation-vocabulary.test
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DELIVERY_LABELS,
  DELIVERY_LINES,
  JOIN_PATH,
  STATUS_FILTERS,
  STATUS_LABELS,
  invitationDescription,
  rowActions,
  statusSentence,
} from './organizer-invitation-vocabulary.js'

/** A stand-in for the page's formatter. */
const format = (value) => (value ? `[${value}]` : null)

describe('statusSentence', () => {
  it('says each status with its date and, where there is one, who', () => {
    expect(statusSentence({ status: 'PENDING', expiresAt: 'e' }, format)).toBe('Waiting until [e]')
    expect(
      statusSentence({ status: 'ACCEPTED', acceptedAt: 'a', acceptedByName: 'Priya' }, format),
    ).toBe('Accepted on [a] by Priya')
    expect(
      statusSentence({ status: 'REVOKED', revokedAt: 'r', revokedByName: 'Anil' }, format),
    ).toBe('Withdrawn on [r] by Anil')
    expect(statusSentence({ status: 'EXPIRED', expiresAt: 'e' }, format)).toBe('Expired on [e]')
  })

  it('names nobody it does not know, and invents no date', () => {
    expect(statusSentence({ status: 'REVOKED', revokedAt: null }, format)).toBe(
      'Withdrawn on a date not recorded',
    )
  })
})

describe('rowActions', () => {
  it('offers a waiting code both actions, an expired one a new code, and the rest nothing', () => {
    expect(rowActions({ status: 'PENDING' })).toEqual({ withdraw: true, reissue: true })
    expect(rowActions({ status: 'EXPIRED' })).toEqual({ withdraw: false, reissue: true })
    expect(rowActions({ status: 'ACCEPTED' })).toEqual({ withdraw: false, reissue: false })
    expect(rowActions({ status: 'REVOKED' })).toEqual({ withdraw: false, reissue: false })
  })
})

describe('the words', () => {
  it('labels every status and every filter', () => {
    expect(Object.keys(STATUS_LABELS)).toEqual(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'])
    expect(STATUS_FILTERS.map((filter) => filter.value)).toEqual([
      'PENDING',
      'ACCEPTED',
      'REVOKED',
      'EXPIRED',
      'ALL',
    ])
    expect(STATUS_LABELS.REVOKED).toBe('Withdrawn')
  })

  it('describes the one kind of invitation there is', () => {
    expect(invitationDescription({ organizationName: 'Rangoli Collective' })).toBe(
      'New organisation: Rangoli Collective',
    )
  })

  it('says what each delivery mode does and does not do', () => {
    expect(DELIVERY_LINES.MANUAL).toMatch(/not emailed/u)
    expect(DELIVERY_LINES.MANUAL).toMatch(/shown to you once/u)
    expect(DELIVERY_LINES.EMAIL).toMatch(/emailed .* You will not see them/u)
    expect(DELIVERY_LABELS).toEqual({ MANUAL: 'Shown once to whoever sent it', EMAIL: 'Emailed' })
  })

  it('names the join page as a path, with nothing after it', () => {
    expect(JOIN_PATH).toBe('/account/organizations/new')
  })

  it('carries no capability name, since client components read it', () => {
    const here = dirname(new URL(import.meta.url).pathname)
    const source = readFileSync(resolve(here, 'organizer-invitation-vocabulary.js'), 'utf8')

    expect(source).not.toMatch(
      /organizer:invite|platform:admin|website_redirect:manage|analytics:view_all/u,
    )
  })
})

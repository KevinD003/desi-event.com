/**
 * No email the worker sends, and no string in its code or in the notification
 * package it sends through, names the site imported events are listed on (the
 * owner's request, 2026-10-15), in any case. Every template is rendered, with
 * no data (its fallbacks) and with a full payload, and its subject, text and
 * HTML are read; every string literal of the worker's code is read too
 * (comments are documentation, not strings). Only an identifier or an address
 * may carry the name (`ALLOWED_STRINGS` in `@desi-event/config/source-name-scan`).
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { stringsNamingTheSource, valuesNamingTheSource } from '@desi-event/config/source-name-scan'

import { TEMPLATES, renderEmail } from '../src/email/templates.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

/** A payload with every field a template reads given a value. */
const FULL = Object.freeze({
  buyerName: 'Priya',
  orderReference: 'DE-8F3K2QRT',
  eventTitle: 'Garba Night',
  eventStartsAt: '2026-11-01T19:00:00.000Z',
  timezone: 'America/Chicago',
  venueName: 'Irving Hall',
  totalCents: 2500,
  currency: 'USD',
  quantity: 2,
  url: 'https://thedesievents.com/orders/DE-8F3K2QRT',
  reason: 'The venue closed.',
  organizationName: 'Rangoli Collective',
  code: '123456',
})

describe('no email names the source site', () => {
  it.each(Object.keys(TEMPLATES))('%s, with no data and with a full payload', (template) => {
    for (const data of [{}, FULL]) {
      expect(valuesNamingTheSource(renderEmail({ template, data }), template)).toEqual([])
    }
  })

  it('in any string literal of the worker or the notification package', () => {
    expect(
      stringsNamingTheSource(
        [path.join(REPO, 'apps/worker/src'), path.join(REPO, 'packages/notifications/src')],
        { relativeTo: REPO },
      ),
    ).toEqual([])
  })
})

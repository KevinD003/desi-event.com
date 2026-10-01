import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CARD_PLACEMENTS,
  CARD_PLACEMENT_LABELS,
  EVENT_ID_PATTERN,
  REFERRER_HOST_PATTERN,
  REFERRER_MARKERS,
  TRAFFIC_BEACON_KINDS,
  TRAFFIC_EVENT_KINDS,
  TRAFFIC_PLACEMENTS,
  TRAFFIC_SOURCES,
  TRAFFIC_SOURCE_DESCRIPTIONS,
  TRAFFIC_SOURCE_LABELS,
} from './traffic-vocabulary.js'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('the visit-counting vocabulary', () => {
  it('has no imports, so the browser can take it alone', () => {
    const source = readFileSync(path.join(here, 'traffic-vocabulary.js'), 'utf8')

    expect(source).not.toMatch(/^\s*import\b/mu)
    expect(source).not.toMatch(/\brequire\(/u)
  })

  it('is frozen throughout', () => {
    for (const value of [
      TRAFFIC_EVENT_KINDS,
      TRAFFIC_BEACON_KINDS,
      TRAFFIC_PLACEMENTS,
      CARD_PLACEMENTS,
      TRAFFIC_SOURCES,
      REFERRER_MARKERS,
      TRAFFIC_SOURCE_LABELS,
      TRAFFIC_SOURCE_DESCRIPTIONS,
      CARD_PLACEMENT_LABELS,
    ]) {
      expect(Object.isFrozen(value)).toBe(true)
    }
  })

  it('spells each kind as itself, and lets a browser report every kind but a website visit', () => {
    for (const [key, value] of Object.entries(TRAFFIC_EVENT_KINDS)) expect(value).toBe(key)

    expect([...TRAFFIC_BEACON_KINDS].sort()).toEqual(
      Object.values(TRAFFIC_EVENT_KINDS)
        .filter((kind) => kind !== 'WEBSITE_REDIRECT')
        .sort(),
    )
  })

  it('counts cards on the home page, the events list and search, and nothing on an organiser page', () => {
    expect([...CARD_PLACEMENTS]).toEqual(['HOME', 'LISTING', 'SEARCH'])
    expect([...TRAFFIC_PLACEMENTS]).toEqual([...CARD_PLACEMENTS, 'EVENT_PAGE'])
    expect(TRAFFIC_PLACEMENTS).not.toContain('ORGANISER_PAGE')
  })

  it('names every source and every card place in words', () => {
    expect(Object.keys(TRAFFIC_SOURCE_LABELS).sort()).toEqual([...TRAFFIC_SOURCES].sort())
    expect(Object.keys(TRAFFIC_SOURCE_DESCRIPTIONS).sort()).toEqual([...TRAFFIC_SOURCES].sort())
    expect(Object.keys(CARD_PLACEMENT_LABELS).sort()).toEqual([...CARD_PLACEMENTS].sort())
    expect(TRAFFIC_SOURCE_LABELS.INTERNAL).toBe('Desi-Event pages')

    for (const text of [
      ...Object.values(TRAFFIC_SOURCE_LABELS),
      ...Object.values(TRAFFIC_SOURCE_DESCRIPTIONS),
      ...Object.values(CARD_PLACEMENT_LABELS),
    ]) {
      expect(text).not.toMatch(/\b(soon|yet|planned)\b/i)
    }
  })
})

describe('REFERRER_HOST_PATTERN', () => {
  it.each(['www.google.com', 'xn--bcher-kva.example', 'localhost', 'a.b'])('accepts %s', (host) => {
    expect(REFERRER_HOST_PATTERN.test(host)).toBe(true)
  })

  it.each([
    'a..b',
    'GOOGLE.COM',
    'https://google.com',
    'google.com/search?q=x',
    'google.com:443',
    'user@google.com',
    '-a.example',
    `${'a'.repeat(64)}.example`,
    '',
  ])('refuses %j', (host) => {
    expect(REFERRER_HOST_PATTERN.test(host)).toBe(false)
  })
})

describe('EVENT_ID_PATTERN', () => {
  it('accepts a cuid', () => {
    expect(EVENT_ID_PATTERN.test('ckl1a2b3c4d5e6f7g8h9i0jn')).toBe(true)
  })

  it.each(['CKL1A2B3C4D5', '1kl1a2b3c4', 'ckl1a2', 'ckl1a2b3c4d5-e6f7', `c${'a'.repeat(32)}`])(
    'refuses %j',
    (id) => {
      expect(EVENT_ID_PATTERN.test(id)).toBe(false)
    },
  )
})

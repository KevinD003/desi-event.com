/**
 * No sentence the API can send names the site imported events are listed on
 * (the owner's request, 2026-10-15): not a refusal, an error, a response's
 * words, an audit summary, a stored reason or term, the platform-held
 * organisation's name, the OpenAPI descriptions, nor a user-facing message in
 * the schemas. In any case ("Sulekha", "Sulekha.com", "Sulekha's").
 *
 * Every string literal in the API's own code and in the shared packages it
 * answers with is read (comments are documentation and are not strings), and
 * so are the sentence tables as the running code holds them and the emitted
 * OpenAPI document. What may still carry the name is only an identifier: the
 * source's enum value `SULEKHA` and a dataset's file name (`ALLOWED_STRINGS`
 * in `@desi-event/config/source-name-scan`). Since 2026-10-15 not even an
 * address on the site is allowed: nothing links, redirects or connects there,
 * an imported venue's provenance is `import:listing`, and the address rule
 * names the site with a regular expression, not a string.
 *
 * @file @desi-event/api/tests/no-source-name
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  isAllowedString,
  stringsNamingTheSource,
  stringsOf,
  valuesNamingTheSource,
} from '@desi-event/config/source-name-scan'

import * as errors from '../src/lib/errors.js'
import * as eventImport from '../src/lib/event-import.js'
import * as eventLifecycle from '../src/lib/event-lifecycle.js'
import * as importDataset from '../src/lib/import-dataset.js'
import * as provisioning from '../src/lib/organization-provisioning.js'
import * as presenters from '../src/lib/presenters.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

/** The API's own code, and the shared packages whose words it answers with. */
const ROOTS = [
  'apps/api/src',
  'apps/api/scripts',
  'packages/api-contract/src',
  'packages/schemas/src',
  'packages/permissions/src',
  'packages/notifications/src',
  'packages/providers/src',
  'packages/pricing/src',
  'packages/inventory/src',
  'packages/ledger/src',
  'packages/auth/src',
].map((root) => path.join(REPO, root))

describe('the scan itself', () => {
  it('reads strings and template parts, never comments, and lets only the identifiers through', () => {
    const code = [
      '// Sulekha is named in this comment, which is documentation.',
      '/** And in this one: "Buy tickets on Sulekha". */',
      "const a = 'Tickets are sold on Sulekha.'",
      'const b = `Moved. The ${"x"} SULEKHA link is off.`',
      "const c = { SULEKHA: 'import:sulekha', host: 'usimg.sulekha.io' }",
      "const d = 'https://events.sulekha.com/garba_event-in_irving-tx_1'",
      "const e = 'sulekha-texas-2026.json'",
    ].join('\n')
    const named = stringsOf(code).filter(({ text }) => /sulekha/iu.test(text))

    expect(named.map(({ line }) => line)).toEqual([3, 4, 5, 5, 6, 7])
    // An address on the site, and the old venue provenance, are no longer
    // identifiers the code may hold (2026-10-15).
    expect(named.filter(({ text }) => !isAllowedString(text))).toEqual([
      { text: 'Tickets are sold on Sulekha.', line: 3 },
      { text: ' SULEKHA link is off.', line: 4 },
      { text: 'import:sulekha', line: 5 },
      { text: 'usimg.sulekha.io', line: 5 },
      { text: 'https://events.sulekha.com/garba_event-in_irving-tx_1', line: 6 },
    ])
    expect(isAllowedString('SULEKHA')).toBe(true)
    expect(isAllowedString('sulekha-texas-2026.json')).toBe(true)
    expect(isAllowedString("Sulekha's prices")).toBe(false)
    expect(isAllowedString('Sulekha.com')).toBe(false)
  })
})

describe('no string the API can answer with names the source site', () => {
  it('in any string literal of the API and the packages it answers with', () => {
    expect(stringsNamingTheSource(ROOTS, { relativeTo: REPO })).toEqual([])
  })

  it('in the sentence tables and words as the running code holds them', () => {
    const tables = {
      errors,
      eventImport,
      eventLifecycle,
      importDataset,
      provisioning,
      presenters,
    }
    const named = Object.entries(tables).flatMap(([name, module]) =>
      Object.entries(module)
        .filter(([, value]) => typeof value !== 'function')
        .flatMap(([key, value]) => valuesNamingTheSource(value, `${name}.${key}`)),
    )

    expect(named).toEqual([])
    // The ones the owner reads most, spelled out.
    expect(provisioning.PLATFORM_HELD_ORGANIZATIONS.SULEKHA).toMatchObject({
      name: 'The Desi Events',
      slug: 'the-desi-events',
    })
    expect(presenters.IMPORT_SOURCE_NAMES).toBeUndefined()
    expect(eventImport.IMPORT_VENUE_PROVENANCE.SULEKHA).toBe('import:listing')
    expect(eventImport.reassignLinkReason('Rangoli Collective')).toBe(
      "Moved to Rangoli Collective. Its website link is off until an administrator approves the organiser's own address.",
    )
  })

  it('in the sentences a file with problems is answered with', () => {
    const file = JSON.parse(
      readFileSync(path.join(REPO, 'packages/db/data/imports/sulekha-texas-2026.json'), 'utf8'),
    )
    const broken = structuredClone(file)

    // A file of before 2026-10-15, with its addresses and its source's name.
    broken.source = 'ELSEWHERE'
    broken.sourceName = 'Sulekha'
    broken.imageHosts = ['usimg.sulekha.io']
    broken.events[0].sourceUrl = 'https://events.sulekha.com/listing_1'
    broken.events[0].ticketUrl = 'http://events.sulekha.com/listing_1'
    broken.events[0].images = [{ url: 'https://usimg.sulekha.io/a.png', role: 'cover', alt: 'A' }]
    broken.events[1].prices = [{ name: 'Regular', priceCents: 1000, currency: 'EUR', note: null }]

    const { dataset, problems } = importDataset.parseImportDataset(broken)

    expect(dataset).toBeNull()
    expect(problems.length).toBeGreaterThan(3)
    expect(valuesNamingTheSource(problems)).toEqual([])
  })

  it('in the emitted OpenAPI document, but for the source enum value', () => {
    const document = JSON.parse(readFileSync(path.join(REPO, 'apps/api/openapi.json'), 'utf8'))

    expect(valuesNamingTheSource(document)).toEqual([])
  })
})

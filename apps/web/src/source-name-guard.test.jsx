/**
 * The owner asked that no page names the site imported events were copied
 * from: not a visitor's page, not an organiser's, not an administrator's. This
 * guard fails if "sulekha", in any case, reaches a string the web app shows.
 *
 * It checks three ways:
 *
 *   1. every source file under `src/` other than a test: no word a person
 *      reads can name the site, so the only spelling allowed is the API's
 *      import source value `SULEKHA`, in capitals, as an identifier;
 *   2. the string tables the pages read (limitations, metadata, the import
 *      vocabulary, the event-control sentences, the imported-event words),
 *      walked to every string they hold;
 *   3. what the components and pages that show an imported event render, fed
 *      what an older API sent (`sourceName: 'Sulekha'`, a website link on the
 *      listing site's host): text, attributes and accessible names alike. No
 *      host of the source site — `events.sulekha.com`, `usimg.sulekha.io` or
 *      any other on its domains — may appear, and no link may lead to one
 *      (ADR 0015, addendum 2026-10-15 (2): no link, no redirect, no contact).
 *
 * @module source-name-guard.test
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('./lib/request-path.js', () => ({ requestPathname: vi.fn() }))
vi.mock('./lib/imports-api.js', () => ({ getImportRuns: vi.fn() }))
vi.mock('./lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('./lib/api.js', () => ({ loadEventBySlug: vi.fn() }))
vi.mock('./components/traffic-scope.jsx', () => ({ TrafficScope: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}))

const { metadata: rootMetadata } = await import('./app/layout.jsx')
const { default: LimitationsPage, metadata: limitationsMetadata } =
  await import('./app/limitations/page.jsx')
const { INTRODUCTION } = await import('./app/admin/imports/page.jsx')
const vocabulary = await import('./app/admin/imports/import-vocabulary.js')
const control = await import('./lib/event-control.js')
const imports = await import('./lib/imports.js')
const { LIMITATIONS } = await import('./lib/limitations.js')
const { MOVE_SENTENCE, NOT_ASKED_SENTENCE } = await import('./components/reassign-event-dialog.jsx')
const { ImportedEventPanel } = await import('./components/imported-event-panel.jsx')
const { EventCard } = await import('./components/listing-card.jsx')
const { SessionList } = await import('./components/session-list.jsx')
const { SiteFooter } = await import('./components/site-footer.jsx')
const { loadEventBySlug } = await import('./lib/api.js')
const { readSession } = await import('./lib/session.js')
const { default: EventDetailPage } = await import('./app/events/[slug]/page.jsx')

const SRC = path.dirname(fileURLToPath(import.meta.url))
const NAME = /sulekha/iu

/** A host on the source site's domains, in an address or on its own. */
const SOURCE_HOST = /(?:^|[/.@\s"'(])[a-z0-9.-]*sulekha\.[a-z]{2,}/iu

/**
 * Every source file under `src/` that is not a test.
 *
 * @param {string} dir The directory.
 * @returns {string[]} Absolute paths.
 */
function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.(?:jsx?|mjs|css|json|md)$/u.test(entry.name)) return []
    if (/\.test\.(?:jsx?|mjs)$/u.test(entry.name)) return []

    return [full]
  })
}

/**
 * Every string a value holds, however deep.
 *
 * @param {unknown} value A string, array or plain object.
 * @param {Set<unknown>} [seen] Values already walked.
 * @returns {string[]} The strings.
 */
function stringsIn(value, seen = new Set()) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)

  return Object.values(value).flatMap((each) => stringsIn(each, seen))
}

/**
 * Everything a reader or a screen reader gets from a rendered tree: its text
 * and every attribute value, accessible names and descriptions included.
 *
 * @param {HTMLElement} container The rendered tree.
 * @returns {string} The words.
 */
function everythingShown(container) {
  const attributes = [...container.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes].map((attribute) => attribute.value),
  )

  return [container.textContent, ...attributes].join('\n')
}

/** What the API sends on an imported event: the source's name and host included. */
const importedFrom = (extra = {}) => ({
  sourceName: 'Sulekha',
  presentedBy: 'Raga Nights Houston',
  listedOn: '2026-09-30',
  prices: [
    { name: 'Adult', priceCents: 2500, currency: 'USD' },
    { name: 'Child', priceCents: 0, currency: 'USD' },
  ],
  priceListed: true,
  ticketsOnSource: true,
  ...extra,
})

const IMPORTED_CASES = [
  importedFrom(),
  importedFrom({ prices: [{ name: 'RSVP', priceCents: 0, currency: 'USD' }] }),
  importedFrom({ prices: [], priceListed: false }),
  importedFrom({ presentedBy: null, ticketsOnSource: false }),
  importedFrom({ prices: [{ name: 'Adult', priceCents: 3000, currency: 'CAD' }] }),
]

describe('no source file outside the tests names the import source', () => {
  it('spells it only as the API’s SULEKHA source value', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line: line.replace(/\bSULEKHA\b/gu, ''), index }))
        .filter(({ line }) => NAME.test(line))
        .map(({ index }) => `${path.relative(SRC, file)}:${index + 1}`),
    )

    expect(offenders).toEqual([])
  })
})

describe('no string table the pages read names the import source', () => {
  const tables = {
    'root metadata': rootMetadata,
    'limitations metadata': limitationsMetadata,
    LIMITATIONS,
    'import vocabulary': vocabulary,
    'event-control sentences': control,
    'imported-event words': imports,
    'imports introduction': INTRODUCTION,
    'move dialog': [MOVE_SENTENCE, NOT_ASKED_SENTENCE],
  }

  for (const [name, table] of Object.entries(tables)) {
    it(`holds none in ${name}`, () => {
      const strings = stringsIn(table)

      expect(strings.length).toBeGreaterThan(0)
      expect(strings.filter((words) => NAME.test(words))).toEqual([])
    })
  }

  it('says none in any plan reading, picture failure or approval sentence', () => {
    const said = [
      ...Object.keys(vocabulary.PLAN_ACTIONS).flatMap((action) => [
        vocabulary.planReading({ action }),
        vocabulary.planReading({ action, updatable: true, resubmit: true }),
      ]),
      ...[
        'HOST_NOT_ALLOWED',
        'ADDRESS_NOT_PUBLIC',
        'NETWORK_UNAVAILABLE',
        'TIMEOUT',
        'REDIRECT_OFF_LIST',
        'TOO_MANY_REDIRECTS',
        'NOT_AN_IMAGE',
        'TOO_LARGE',
        'HTTP_404',
        'HTTP_503',
        'SANITISER_REFUSED:IMAGE_TOO_SMALL',
        'SOMETHING_NEW',
      ].map((code) => vocabulary.failureReason(code)),
      ...['PUBLISHED', 'SALES_OPENED', 'PICTURES_APPROVED', 'REFUSED'].map((outcome) =>
        vocabulary.approveSentence({ outcome, picturesApproved: 2 }, 'Raga Night'),
      ),
    ]

    expect(stringsIn(said).filter((words) => NAME.test(words))).toEqual([])
  })

  it('says none in what deleting and restoring an import tells the team', () => {
    const said = IMPORTED_CASES.flatMap((imported) => [
      ...control.deletionReversibleSentences({ importedFrom: imported }),
      ...['PUBLISHED', 'ON_SALE', 'REVIEW_PENDING', 'DRAFT'].flatMap((statusBefore) =>
        control.restoreSentences({
          id: 'e1',
          slug: 'raga-night',
          deletion: { statusBefore },
          importedFrom: imported,
        }),
      ),
    ])

    expect(said.length).toBeGreaterThan(0)
    expect(said.filter((words) => NAME.test(words))).toEqual([])
  })

  it('says none in the prices sentence, whatever the listing gave', () => {
    const said = IMPORTED_CASES.map((imported) => imports.importedPricesSentence(imported))

    expect(said.filter((words) => NAME.test(words))).toEqual([])
  })
})

describe('no component that shows an imported event names its source', () => {
  for (const [index, imported] of IMPORTED_CASES.entries()) {
    it(`shows none in the ticket box, the card or the nights (case ${index + 1})`, () => {
      const { container, unmount } = render(
        <>
          <ImportedEventPanel
            event={{
              title: 'Raga Night',
              startsAt: '2026-11-07T00:30:00.000Z',
              timezone: 'America/Chicago',
              venue: { name: 'Stafford Centre', city: 'Houston' },
            }}
            importedFrom={imported}
          />
          <EventCard
            event={{
              id: 'cevent1',
              slug: 'raga-night',
              title: 'Raga Night',
              startsAt: '2026-11-07T00:30:00.000Z',
              timezone: 'America/Chicago',
              city: 'Houston',
              venueName: 'Stafford Centre',
              category: 'GARBA',
              status: 'PUBLISHED',
              organizationName: 'The Desi Events',
              minPriceCents: null,
              currency: null,
              salesOpen: false,
              importedFrom: imported,
            }}
          />
          <SessionList
            sessions={[
              {
                id: 'snight1',
                label: null,
                startsAt: '2026-11-07T00:30:00.000Z',
                endsAt: '2026-11-07T03:30:00.000Z',
                doorsOpenAt: null,
                timezone: 'America/Chicago',
                status: 'SCHEDULED',
                endTimeListed: false,
              },
            ]}
            eventSlug="raga-night"
            buyable
          />
        </>,
      )

      expect(everythingShown(container)).not.toMatch(NAME)
      expect(everythingShown(container)).not.toMatch(SOURCE_HOST)
      unmount()
    })
  }

  it('shows none in the footer or on the limitations page', () => {
    const { container } = render(
      <>
        <SiteFooter />
        <LimitationsPage />
      </>,
    )

    expect(container.textContent.length).toBeGreaterThan(0)
    expect(everythingShown(container)).not.toMatch(NAME)
  })
})

describe('no page that shows an imported event links to, or names a host of, its source', () => {
  /** An imported event as an older API sent it: a website link on the source's own host. */
  const importedEvent = (imported) => ({
    id: 'cevent1',
    organizationId: 'corg1',
    slug: 'raga-night',
    title: 'Raga Night',
    summary: 'Garba to a live band.',
    description: 'One paragraph.',
    category: 'GARBA_DANDIYA',
    status: 'ON_SALE',
    timezone: 'America/Chicago',
    startsAt: '2026-11-07T00:30:00.000Z',
    endsAt: '2026-11-07T03:30:00.000Z',
    venue: { name: 'Stafford Centre', city: 'Stafford', region: 'TX', country: 'US' },
    organization: { name: 'The Desi Events', slug: 'the-desi-events', verified: true },
    ticketTypes: [
      {
        id: 'ctier1',
        name: 'Adult',
        priceCents: 2500,
        currency: 'USD',
        quantityTotal: 100,
        quantitySold: 0,
        availableQuantity: 100,
        isSoldOut: false,
        status: 'ON_SALE',
        visibility: 'PUBLIC',
        salesStartAt: null,
        salesEndAt: null,
      },
    ],
    sessions: [],
    websiteLink: { host: 'events.sulekha.com' },
    importedFrom: imported,
  })

  for (const [index, imported] of IMPORTED_CASES.entries()) {
    it(`renders the public event page with no source name, host or link to it (case ${index + 1})`, async () => {
      readSession.mockResolvedValue(null)
      loadEventBySlug.mockResolvedValue({ event: importedEvent(imported), usedFallback: false })

      const { container, unmount } = render(
        await EventDetailPage({ params: Promise.resolve({ slug: 'raga-night' }) }),
      )
      const shown = [everythingShown(container), container.innerHTML].join('\n')

      expect(shown).not.toMatch(NAME)
      expect(shown).not.toMatch(SOURCE_HOST)
      // No link goes off the site but the company's own WhatsApp chat, and
      // none goes through the website redirect.
      const hrefs = [...container.querySelectorAll('a[href]')].map((link) =>
        link.getAttribute('href'),
      )

      expect(
        hrefs.filter((href) => /^[a-z]+:/iu.test(href)).map((href) => new URL(href).host),
      ).toEqual(['wa.me'])
      expect(hrefs.some((href) => href.includes('/website'))).toBe(false)
      unmount()
    })
  }
})

describe('the guard itself', () => {
  it('catches a source host in an address and on its own', () => {
    for (const planted of [
      'https://events.sulekha.com/raga-night',
      'https://usimg.sulekha.io/cdn/a.png',
      'Opens events.sulekha.com',
      '"sulekha.com"',
    ]) {
      expect(planted).toMatch(SOURCE_HOST)
    }
    expect('The Desi Events · wa.me').not.toMatch(SOURCE_HOST)
  })
})

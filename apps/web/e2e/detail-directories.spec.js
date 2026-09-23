import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { CONNECTION, PASSWORD, TOTP_SECRET } from './support/seed-refusals.mjs'

/**
 * The public discovery layer — the header, the three directories, the small
 * print, and what crawlers and installers are handed — read by somebody with
 * no session, against the live API.
 *
 * ## Why this is a detail spec
 *
 * The default config deliberately starts no API, so everything it renders is
 * the sample catalogue. A directory checked against that proves the markup and
 * nothing else. Here the API is up and the world is seeded, so each directory
 * can be held to rows that exist:
 *
 *   - the header offers four ways in, each reached by clicking, and marks the
 *     one you are on for somebody who cannot see the underline;
 *   - a category's number is the number the listing it links to reports, and
 *     the seeded alpha event is among what that listing holds — which is the
 *     facets and the listing counting the same statuses, not merely both
 *     rendering;
 *   - the venue directory is the shared venues and nobody's private ones, and
 *     its accessibility filter narrows and says it works a page at a time;
 *   - the organiser directory lists the alpha organisation with its one
 *     upcoming event, and an organisation whose only event is approved but
 *     unpublished is not there at all;
 *   - the limitations page states every recorded status word, the footer that
 *     links to it offers no email address, and nothing promises "soon";
 *   - the sitemap and the manifest are what a crawler and an installer get;
 *   - an event card quotes an all-in price and a stated availability, and
 *     invents no urgency.
 *
 * ## What this file creates, and removes
 *
 * Two shared venues, in a city named after this run. The world has none: its
 * venues belong to organisations, and `GET /v1/venues` keeps an organisation's
 * own venues out of an anonymous caller's list (see `venues.list`), so in a
 * fresh database the anonymous directory is empty. A shared venue is platform
 * data — `venues.create` refuses one to anybody but staff — so they are
 * written here directly, in the same way the world's own seeds write theirs,
 * and deleted in `afterAll`. Nothing references them, so the delete succeeds.
 * Nobody is signed in from here; the `visitor` fixture has no session at all.
 *
 * @module e2e/detail-directories
 */

/**
 * This run's seeded ids.
 *
 * Read inside each test rather than at module scope, because module scope runs
 * before global setup has written the file.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * The seeded published event's title, as `seed-refusals.mjs` writes it.
 *
 * @returns {string} The title.
 */
const eventTitle = () => `Alpha's Evening ${ids().tag}`

/**
 * The alpha organisation's draft, which no public page may list.
 *
 * @returns {string} The title.
 */
const draftTitle = () => `Alpha's Draft ${ids().tag}`

/**
 * The unverified organisation's event: approved by a moderator, never published.
 *
 * @returns {string} The title.
 */
const approvedTitle = () => `Unverified Evening ${ids().tag}`

/**
 * An organisation's public name, as `organisationWithOwner` writes it.
 *
 * @param {string} name The name before the run's tag.
 * @returns {string} The name as stored.
 */
const organisation = (name) => `${name} ${ids().tag}`

/** The organiser directory's own heading, which names the page rather than repeating its link. */
const ORGANISERS_HEADING = 'Who is putting on the nights'

/**
 * The header's four entries, in order, with where each goes and the heading
 * the page it opens carries.
 *
 * `PUBLIC_ITEMS` in `lib/navigation.js`, written out rather than imported: a
 * test that read the list it was checking would agree with any list.
 *
 * @type {ReadonlyArray<{label: string, path: string, heading: string}>}
 */
const HEADER_ENTRIES = Object.freeze([
  { label: 'Discover events', path: '/events', heading: 'What’s on' },
  { label: 'Categories', path: '/categories', heading: 'Browse by category' },
  { label: 'Venues', path: '/venues', heading: 'Venues' },
  { label: 'Organisers', path: '/organizers', heading: ORGANISERS_HEADING },
])

/**
 * The footer's sentence about money, on every page.
 *
 * `components/site-footer.jsx`, written out for the same reason as the header.
 */
const FOOTER_PAYMENTS = 'Payments on this site are simulated — no card, no money moves.'

/**
 * The footer's link to the limitations page. It sits under the heading "What
 * this site does not do", which gives it its context.
 */
const FOOTER_LIMITATIONS_LINK = 'The full list'

/**
 * Every category the web app offers, in its editorial order.
 *
 * `EVENT_CATEGORIES` in `lib/catalog.js`, written out for the same reason.
 *
 * @type {ReadonlyArray<string>}
 */
const CATEGORY_LABELS = Object.freeze([
  'Garba & Dandiya',
  'Live Music',
  'Bollywood Nights',
  'Classical Dance',
  'Comedy',
  'Food Festivals',
  'Melas & Festivals',
  'Film',
  'Theatre',
  'Workshops',
  'Religious & Devotional',
  'Wedding Expos',
  'Networking',
  'Sports',
])

/**
 * Every limitation the public page lists, with its recorded status, in order.
 *
 * The same list `detail-account.spec.js` holds the page to, written out rather
 * than imported from `lib/limitations.js`.
 *
 * @type {ReadonlyArray<Array<string>>}
 */
const RECORDED_LIMITATIONS = Object.freeze([
  ['Real payments, Stripe and Connect payouts', 'EXTERNAL VERIFICATION PENDING'],
  ['Handing on a reserved-seat ticket', 'BLOCKED — UNIQUE-SEAT TRANSFER DEFECT'],
  ['Group booking', 'NOT IMPLEMENTED'],
  ['Check-in without a connection', 'NOT IMPLEMENTED'],
  ['Ticket passes on real phones', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Door scanning in Safari and Firefox', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Email', 'NOT IMPLEMENTED'],
  ['Text messages', 'NOT IMPLEMENTED'],
  ['Automatic deletion after a set time', 'DISABLED'],
])

/**
 * Every word a card may use for availability: `eventAvailability` in
 * `lib/event-availability.js`.
 *
 * @type {ReadonlyArray<string>}
 */
const AVAILABILITY_WORDS = Object.freeze([
  'Cancelled',
  'Postponed',
  'Finished',
  'Sold out',
  'Sales paused',
  'On sale',
  'Not on sale now',
])

/** What an all-in price is qualified with, from `startingPrice`. */
const ALL_IN = 'including any fees and tax'

/** What a face value would be qualified with. The API sends all-in, so no card says it. */
const BEFORE_FEES = 'before fees and tax'

/** Urgency a summary carries no fact to support. */
const FABRICATED_URGENCY = /selling fast|hurry|only \d+ left|popular/iu

/** The sample catalogue's notice: its absence is the sign the API answered. */
const SAMPLE_NOTICE = 'Showing our sample programme'

/** The seeded tier's face value, as a card would format it. */
const FACE_VALUE = '₹1,000.00'

/**
 * The page's own heading.
 *
 * @param {object} page The Playwright page.
 * @param {string} name What it says, exactly.
 * @returns {object} A locator for the level-one heading.
 */
function pageHeading(page, name) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

/**
 * The header's discovery row.
 *
 * @param {object} page The Playwright page.
 * @returns {object} A locator for the navigation landmark inside the banner.
 */
function primaryNav(page) {
  return page.getByRole('banner').getByRole('navigation', { name: 'Primary', exact: true })
}

/**
 * Assert that neither the page nor its address carries a credential.
 *
 * Public pages have no business with any of these, which is what makes the
 * check cheap and worth making on every one of them: a summary allow-list that
 * widened, or a session read that leaked into the anonymous client, would put
 * one here first.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<void>} Resolves when checked.
 */
async function expectNoCredentials(page) {
  const html = await page.content()

  for (const needle of ['credentialHash', 'ticket-pass-v1', TOTP_SECRET, PASSWORD]) {
    expect(html, `the page carries ${needle}`).not.toContain(needle)
    expect(page.url(), `the address carries ${needle}`).not.toContain(needle)
  }
}

/**
 * The total the event listing states in its result sentence.
 *
 * `resultSummary` in `app/events/page.jsx` writes "12 events" (or "1 event")
 * when no city or search is set, which is every listing this file reads.
 *
 * @param {object} page The Playwright page, on `/events`.
 * @returns {Promise<number>} The stated total.
 */
async function statedTotal(page) {
  const sentence = page.getByTestId('result-count')

  await expect(sentence).toHaveText(/^\d+ events?$/u)

  return Number((await sentence.textContent()).match(/^(\d+)/u)[1])
}

/**
 * Every card on the current listing page, read the way a person reads it.
 *
 * @param {object} page The Playwright page, on `/events`.
 * @returns {Promise<Array<{title: string|null, href: string|null, category: string|null, availability: string|null, amount: string, qualifier: string|null, text: string}>>} The cards.
 */
function readCards(page) {
  return page
    .getByRole('list', { name: 'Matching events', exact: true })
    .getByRole('article')
    .evaluateAll((articles) =>
      articles.map((article) => {
        // A chip is the span holding its own screen-reader prefix — "Category:"
        // on the poster, "Availability:" beside the price — and what it says
        // is what follows the prefix.
        const chipFor = (prefix) =>
          [...article.querySelectorAll('span')].find((span) =>
            [...span.children].some((child) => child.textContent.trim() === prefix),
          ) ?? null
        const chipText = (chip, prefix) =>
          chip ? chip.textContent.replace(new RegExp(`^\\s*${prefix}\\s*`, 'u'), '').trim() : null
        const chip = chipFor('Availability:')
        // The price is the card's last paragraph: "From ₹…" and, on its own
        // line, the qualifier.
        const paragraphs = article.querySelectorAll('p')
        const price = paragraphs[paragraphs.length - 1] ?? null
        const lines = (price?.innerText ?? '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)

        // The title link is the card's one link, and its href names the event.
        const link = article.querySelector('h2 a, h3 a')

        return {
          title: link?.textContent.trim() ?? null,
          href: link?.getAttribute('href') ?? null,
          category: chipText(chipFor('Category:'), 'Category:'),
          availability: chipText(chip, 'Availability:'),
          amount: (lines[0] ?? '').replace(/^From\s+/u, ''),
          qualifier: lines[1] ?? null,
          text: article.textContent,
        }
      }),
    )
}

/**
 * Walk a listing from its first page, handing each page's cards to `visit`.
 *
 * The number of pages is read from the listing's own "Page 1 of N" rather
 * than worked out from a page size this file would have to copy. Every page
 * is reached by pressing **Next →**, and each arrival is waited for by its
 * page number, so no page is read twice or half-rendered.
 *
 * @param {object} page The Playwright page, on page 1 of a listing.
 * @param {function(Array<object>, number): (boolean|void)} visit Called per page; `true` stops the walk.
 * @returns {Promise<{total: number, pages: number}>} What the listing said about itself.
 */
async function walkListing(page, visit) {
  const total = await statedTotal(page)
  const nav = page.getByRole('navigation', { name: 'Listing pages', exact: true })
  let cards = await readCards(page)
  let pages = 1

  if (cards.length < total) {
    const indicator = nav.getByText(/^Page 1 of \d+$/u)

    await expect(indicator).toBeVisible()
    pages = Number((await indicator.textContent()).match(/of (\d+)$/u)[1])
  }

  for (let number = 1; ; number += 1) {
    if (visit(cards, number) === true || number >= pages) return { total, pages }

    await nav.getByRole('link', { name: 'Next →', exact: true }).click()
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === String(number + 1))
    await expect(nav.getByText(`Page ${number + 1} of ${pages}`, { exact: true })).toBeVisible()

    cards = await readCards(page)
  }
}

/**
 * Every venue name the anonymous directory shows, across all of its pages.
 *
 * The venue directory states no total — its filter runs after the page is
 * read, so the API's total would be a lie — so the walk follows **Next →**
 * for as long as the page offers one.
 *
 * @param {object} page The Playwright page, on page 1 of `/venues`.
 * @returns {Promise<string[]>} The names, in the order shown.
 */
async function everyDirectoryVenue(page) {
  const names = []
  const nav = page.getByRole('navigation', { name: 'Directory pages', exact: true })

  for (let number = 1; ; number += 1) {
    await expect(page.getByTestId('venue-summary')).toHaveText(/venues? on this page$/u)

    names.push(
      ...(await page
        .getByRole('list', { name: 'Venues', exact: true })
        .getByRole('heading', { level: 2 })
        .allTextContents()),
    )

    // The summary and the pagination arrive in one server render, so once the
    // summary is on screen the link's presence is settled.
    const next = nav.getByRole('link', { name: 'Next →', exact: true })

    if ((await next.count()) === 0) return names.map((name) => name.trim())

    await next.click()
    await expect(page).toHaveURL((url) => url.searchParams.get('page') === String(number + 1))
    await expect(nav.getByText(`Page ${number + 1}`, { exact: true })).toBeVisible()
  }
}

test.describe('the header', () => {
  test('offers exactly the four ways in, and marks the one you are on', async ({ visitor }) => {
    await visitor.goto('/')

    const nav = primaryNav(visitor)
    const current = nav.locator('[aria-current="page"]')

    // Four entries and nothing else: signed out, the account control is a
    // separate "Sign in" link beside the row, not an entry in it.
    await expect(nav.getByRole('link')).toHaveText(HEADER_ENTRIES.map((entry) => entry.label))
    // The home page is none of the four, so nothing claims to be it.
    await expect(current).toHaveCount(0)

    for (const entry of HEADER_ENTRIES) {
      await nav.getByRole('link', { name: entry.label, exact: true }).click()

      await expect(visitor).toHaveURL((url) => url.pathname === entry.path && url.search === '')
      await expect(pageHeading(visitor, entry.heading)).toBeVisible()

      // `aria-current` rather than a class: the highlight tells somebody
      // looking and says nothing to somebody listening. Exactly one entry, and
      // the one just chosen.
      await expect(current).toHaveCount(1)
      await expect(current).toHaveText(entry.label)
      await expect(current).toHaveAttribute('href', entry.path)

      await expectNoCredentials(visitor)
    }
  })
})

test.describe('the category directory', () => {
  test('counts Live Music as its listing does, and that listing holds the alpha event', async ({
    visitor,
  }) => {
    await visitor.goto('/categories')
    await expect(pageHeading(visitor, 'Browse by category')).toBeVisible()

    // The API answered: no sample catalogue, and the counts could be read.
    await expect(visitor.getByText(SAMPLE_NOTICE)).toHaveCount(0)
    await expect(visitor.getByText(/could not be read just now/u)).toHaveCount(0)

    const directory = visitor.getByRole('list', { name: 'Event categories', exact: true })

    // Every category, in order, including any with nothing in it: a directory
    // that dropped an empty one would read as a site that does not do it.
    await expect(directory.getByRole('heading', { level: 2 })).toHaveText([...CATEGORY_LABELS])

    const counts = directory.getByTestId('category-count')

    await expect(counts).toHaveCount(CATEGORY_LABELS.length)

    for (const label of await counts.allTextContents()) {
      expect(label.trim()).toMatch(/^(?:\d[\d,]* events|1 event|Nothing listed right now)$/u)
    }

    // The alpha event is MUSIC_CONCERT and PUBLISHED, so Live Music holds at
    // least one listed event.
    const music = directory
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('heading', { name: 'Live Music', exact: true }) })
    const label = (await music.getByTestId('category-count').textContent()).trim()
    const match = label.match(/^(\d[\d,]*) events?$/u)

    expect(match, `Live Music reads "${label}"`).not.toBeNull()

    const listed = Number(match[1].replaceAll(',', ''))

    expect(listed).toBeGreaterThanOrEqual(1)

    await music.getByRole('link').click()

    await expect(visitor).toHaveURL(
      (url) =>
        url.pathname === '/events' &&
        url.searchParams.get('category') === 'MUSIC_CONCERT' &&
        [...url.searchParams.keys()].length === 1,
    )
    await expect(pageHeading(visitor, 'What’s on')).toBeVisible()
    await expect(visitor.getByText(SAMPLE_NOTICE)).toHaveCount(0)

    // The facet and the listing count the same statuses. When they did not —
    // the facet once counted PUBLISHED alone — an event dropped out of its
    // category's number the moment it went on sale, and this sentence and the
    // directory disagreed.
    await expect(visitor.getByTestId('result-count')).toHaveText(
      `${listed} ${listed === 1 ? 'event' : 'events'}`,
    )

    const titles = []
    const hrefs = []

    const { total } = await walkListing(visitor, (cards) => {
      for (const card of cards) {
        expect(card.category, `${card.title} is in the Live Music listing`).toBe('Live Music')
      }

      titles.push(...cards.map((card) => card.title))
      hrefs.push(...cards.map((card) => card.href))
    })

    expect(total).toBe(listed)
    // Its pages together hold exactly the number it states, each event once:
    // counted by the event each card links to, because a page that repeated
    // the one before it would still add up to the right number of cards.
    expect(titles).toHaveLength(listed)
    expect(new Set(hrefs).size, 'distinct events across the listing’s pages').toBe(listed)
    expect(titles).toContain(eventTitle())
    // Both of these are MUSIC_CONCERT too. A draft and an approved-but-never-
    // published event are nobody's to list, and neither is in the count.
    expect(titles).not.toContain(draftTitle())
    expect(titles).not.toContain(approvedTitle())

    await expectNoCredentials(visitor)
  })
})

test.describe('the venue directory', () => {
  /**
   * The two shared venues this describe block writes, keyed by role.
   *
   * @returns {{city: string, loop: object, plain: object}} Names, slugs and the run's city.
   */
  const venues = () => {
    const { tag } = ids()

    return {
      city: `Directory Test Town ${tag}`,
      loop: { name: `Loop Hall ${tag}`, slug: `directory-loop-hall-${tag}` },
      plain: { name: `Plain Hall ${tag}`, slug: `directory-plain-hall-${tag}` },
    }
  }

  test.beforeAll(async () => {
    const { city, loop, plain } = venues()
    const prisma = createPrismaClient({ connectionString: CONNECTION })

    /**
     * Write one shared venue, idempotently: a failed case restarts the worker
     * and this hook runs again for the cases after it.
     *
     * @param {{name: string, slug: string}} venue Which one.
     * @param {object|null} accessibility What it asserts, or nothing.
     * @returns {Promise<void>} Resolves when written.
     */
    const shared = async (venue, accessibility) => {
      const fields = {
        name: venue.name,
        addressLine1: '2 Directory Road',
        city,
        region: 'Maharashtra',
        postalCode: '400002',
        // No organisation: a shared venue, which is what the anonymous list shows.
        organizationId: null,
        provenance: 'moderator',
        accessibility,
      }

      await prisma.venue.upsert({
        where: { slug: venue.slug },
        update: fields,
        create: { slug: venue.slug, ...fields },
      })
    }

    try {
      // Claims in this order, which is the order the card repeats them in.
      await shared(loop, { features: ['STEP_FREE_ENTRANCE', 'HEARING_LOOP'] })
      await shared(plain, null)
    } finally {
      await prisma.$disconnect()
    }
  })

  test.afterAll(async () => {
    const { loop, plain } = venues()
    const prisma = createPrismaClient({ connectionString: CONNECTION })

    try {
      await prisma.venue.deleteMany({ where: { slug: { in: [loop.slug, plain.slug] } } })
    } finally {
      await prisma.$disconnect()
    }
  })

  test('lists shared venues, narrows by what a venue asserts, and says how the filter works', async ({
    visitor,
  }) => {
    const { city, loop, plain } = venues()

    await visitor.goto('/venues')
    await expect(pageHeading(visitor, 'Venues')).toBeVisible()

    const form = visitor.getByRole('form', { name: 'Filter venues', exact: true })

    await expect(form).toContainText(
      'Only venues asserting every one you tick are shown. Up to 6 at once.',
    )

    // A plain GET form: the whole state lands in the address, as a link would.
    await form.getByLabel('City', { exact: true }).fill(city)
    await form.getByRole('button', { name: 'Apply', exact: true }).click()

    await expect(visitor).toHaveURL(
      (url) =>
        url.pathname === '/venues' &&
        url.searchParams.get('city') === city &&
        url.searchParams.getAll('accessibility').length === 0,
    )
    await expect(visitor.getByTestId('venue-summary')).toHaveText('2 venues on this page')

    const list = visitor.getByRole('list', { name: 'Venues', exact: true })

    // By name, which is the API's order.
    await expect(list.getByRole('heading', { level: 2 })).toHaveText([loop.name, plain.name])

    const loopCard = list
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('link', { name: loop.name, exact: true }) })
    const plainCard = list
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('link', { name: plain.name, exact: true }) })

    await expect(loopCard).toContainText(`${city}, Maharashtra, India`)
    // The claims the venue asserts, in words, in the order it gave them.
    await expect(
      loopCard
        .getByRole('list', { name: `Accessibility at ${loop.name}`, exact: true })
        .getByRole('listitem'),
    ).toHaveText(['Step-free entrance', 'Hearing loop'])
    // A venue that asserts nothing is said to have published nothing — not
    // shown as lacking every claim.
    await expect(plainCard).toContainText('This venue has not published its accessibility details.')
    await expect(plainCard.getByRole('list')).toHaveCount(0)

    // No accessibility filter yet, so no sentence about one.
    await expect(visitor.getByText(/applied a page at a time/u)).toHaveCount(0)

    await form.getByRole('checkbox', { name: 'Hearing loop', exact: true }).check()
    await form.getByRole('button', { name: 'Apply', exact: true }).click()

    await expect(visitor).toHaveURL(
      (url) =>
        url.pathname === '/venues' &&
        url.searchParams.get('city') === city &&
        url.searchParams.getAll('accessibility').join() === 'HEARING_LOOP',
    )
    // Narrowed, by the API, to the one venue asserting a hearing loop.
    await expect(visitor.getByTestId('venue-summary')).toHaveText('1 venue on this page')
    await expect(list.getByRole('heading', { level: 2 })).toHaveText([loop.name])
    await expect(visitor.getByRole('link', { name: plain.name, exact: true })).toHaveCount(0)

    // The filter runs over each page after it is read, and the page says so
    // rather than letting a thin page read as the end of the directory.
    await expect(
      visitor.getByText(
        'The accessibility filter is applied a page at a time, so one page can hold fewer venues than the next.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(form.getByRole('checkbox', { name: 'Hearing loop', exact: true })).toBeChecked()

    // The card opens the venue's own page, which the header still files under Venues.
    await visitor.getByRole('link', { name: loop.name, exact: true }).click()

    await expect(visitor).toHaveURL((url) => url.pathname === `/venues/${loop.slug}`)
    await expect(pageHeading(visitor, loop.name)).toBeVisible()
    await expect(visitor.getByRole('region', { name: 'Accessibility', exact: true })).toContainText(
      'Hearing loop',
    )
    await expect(visitor.getByRole('region', { name: 'Accessibility', exact: true })).toContainText(
      'Step-free entrance',
    )
    await expect(primaryNav(visitor).locator('[aria-current="page"]')).toHaveText('Venues')

    await expectNoCredentials(visitor)
  })

  test('keeps an organiser’s own hall out of the directory, while its page still answers', async ({
    visitor,
  }) => {
    const { tag } = ids()
    const hall = `alpha Hall ${tag}`

    // Reached the way a buyer reaches it: from the event held there.
    await visitor.goto(`/events/alpha-event-${tag}`)
    await expect(pageHeading(visitor, eventTitle())).toBeVisible()

    await visitor
      .getByRole('region', { name: 'Venue', exact: true })
      .getByRole('link', { name: hall, exact: true })
      .click()

    // `venues.public` resolves any venue by slug — somebody holding a ticket
    // needs the address — and lists what is on there in the public statuses.
    await expect(visitor).toHaveURL((url) => url.pathname === `/venues/alpha-hall-${tag}`)
    await expect(pageHeading(visitor, hall)).toBeVisible()

    const whatsOn = visitor.getByRole('region', { name: 'What’s on', exact: true })

    await expect(whatsOn.getByRole('link').filter({ hasText: eventTitle() })).toHaveCount(1)
    await expect(whatsOn).not.toContainText(draftTitle())

    // But the directory is not where it is listed. The alpha hall belongs to
    // the alpha organisation, and `venues.list` answers an anonymous caller
    // with shared venues only (`organizationId: null`), so it is absent from
    // every page — which is the directory's own stated scope: "the halls,
    // grounds and theatres shared across Desi-Event". Were the web to ask with
    // a session, or the API to drop that scope, it would appear here.
    await visitor.goto('/venues')
    await expect(pageHeading(visitor, 'Venues')).toBeVisible()

    const names = await everyDirectoryVenue(visitor)

    // The shared venues this file wrote are there, so the list is not simply empty.
    expect(names).toContain(venues().loop.name)
    expect(names).not.toContain(hall)
    // Nor is the unverified organisation's hall, for the same reason.
    expect(names).not.toContain(`unverified Hall ${tag}`)
  })
})

/**
 * Hold the organiser directory to having read the whole upcoming listing.
 *
 * The directory is derived from at most `ORGANIZER_SCAN` of the listing and
 * says so on the page when it stopped short. Whether this run's organisations
 * are in it is only a fair question when it did not: against a database
 * holding thousands of upcoming events left by other suites, the directory is
 * right to show only the first five hundred. CI's browser jobs each start from
 * a freshly migrated database, and so must a local run of this file; this
 * says which precondition failed rather than letting a missing card say it.
 *
 * @param {object} page The Playwright page, on `/organizers`.
 * @returns {Promise<void>} Resolves once the page has said it read everything.
 */
async function expectWholeListingRead(page) {
  await expect(
    page.getByTestId('organizer-coverage'),
    'the directory read only part of the listing: run this suite against a fresh database',
  ).toHaveCount(0)
}

test.describe('the organiser directory', () => {
  test('lists Alpha Collective with its one upcoming event, and its page lists the same one', async ({
    visitor,
  }) => {
    const { tag } = ids()
    const alpha = organisation('Alpha Collective')

    await visitor.goto('/organizers')
    await expect(pageHeading(visitor, ORGANISERS_HEADING)).toBeVisible()
    await expectWholeListingRead(visitor)
    await expect(visitor.getByText(SAMPLE_NOTICE)).toHaveCount(0)

    const directory = visitor.getByRole('list', { name: 'Organisers', exact: true })
    const card = directory
      .getByRole('listitem')
      .filter({ has: visitor.getByRole('link', { name: alpha, exact: true }) })

    // One: the alpha organisation has a published event and a draft, and only
    // the published one is listed. A count that included the draft would say 2.
    await expect(card).toHaveCount(1)
    await expect(card.getByText(/upcoming events? listed$/u)).toHaveText('1 upcoming event listed')

    // The beta organisation has no events at all, so it has nothing to be listed for.
    await expect(
      directory.getByRole('link', { name: organisation('Beta Collective'), exact: true }),
    ).toHaveCount(0)

    await card.getByRole('link', { name: alpha, exact: true }).click()

    await expect(visitor).toHaveURL((url) => url.pathname === `/organizers/alpha-${tag}`)
    await expect(pageHeading(visitor, alpha)).toBeVisible()
    await expect(primaryNav(visitor).locator('[aria-current="page"]')).toHaveText('Organisers')

    // The count on the card is the count behind the link.
    const upcoming = visitor.getByRole('region', { name: 'Upcoming events', exact: true })

    await expect(upcoming.getByRole('link')).toHaveCount(1)
    await expect(upcoming.getByRole('link')).toContainText(eventTitle())
    await expect(visitor.locator('main')).not.toContainText(draftTitle())

    // Verified in the seed, so the badge is earned and shown. Read from the
    // page's text rather than matched exactly: the badge carries a
    // screen-reader prefix, "Organiser status:", in the same element.
    await expect(visitor.locator('main')).toContainText('Organiser status: Verified organiser')

    // No way to write to them is invented: no email, no form, and the page
    // says so. The organisation's contact address is an account detail.
    await expect(visitor.getByRole('region', { name: 'Contact', exact: true })).toContainText(
      `This site does not pass messages between buyers and organisers, and sends no email. ${alpha} has not given a website, so this page has no way to reach them.`,
    )
    await expect(visitor.locator('a[href^="mailto:"]')).toHaveCount(0)

    const html = await visitor.content()

    expect(html).not.toContain(`alpha-${tag}@example.test`)
    expect(html).not.toContain(`alpha-owner-${tag}@organiser.test`)

    await expectNoCredentials(visitor)
  })

  test('leaves out an organisation whose only event is approved but unpublished', async ({
    visitor,
  }) => {
    const { tag } = ids()
    const unverified = organisation('Unverified Collective')

    await visitor.goto('/organizers')
    await expect(pageHeading(visitor, ORGANISERS_HEADING)).toBeVisible()
    await expectWholeListingRead(visitor)
    // The directory is built from the anonymous listing, which carries only
    // the listed statuses. APPROVED is not one of them, so the unverified
    // organisation has no listed event to be counted for — and appears with
    // no count, because it does not appear at all.
    await expect(
      visitor.getByRole('list', { name: 'Organisers', exact: true }).getByRole('link', {
        name: organisation('Alpha Collective'),
        exact: true,
      }),
    ).toHaveCount(1)
    await expect(visitor.locator('main')).not.toContainText(unverified)

    // Its own page resolves, and says it has nothing on — rather than listing
    // the approved event, and rather than claiming a badge it has not earned.
    await visitor.goto(`/organizers/unverified-${tag}`)
    await expect(pageHeading(visitor, unverified)).toBeVisible()
    await expect(
      visitor.getByRole('region', { name: 'Upcoming events', exact: true }),
    ).toContainText(`${unverified} has no upcoming events listed.`)
    await expect(
      visitor.getByRole('region', { name: 'Upcoming events', exact: true }).getByRole('link'),
    ).toHaveCount(0)
    await expect(visitor.locator('main')).not.toContainText(approvedTitle())
    await expect(visitor.locator('main')).not.toContainText('Verified organiser')
  })
})

test.describe('the small print', () => {
  test('the footer links to the limitations, offers no email, and the page promises nothing', async ({
    visitor,
  }) => {
    // The footer is on every page; checked on each directory, not assumed from one.
    for (const [path, heading] of [
      ['/events', 'What’s on'],
      ['/categories', 'Browse by category'],
      ['/venues', 'Venues'],
      ['/organizers', ORGANISERS_HEADING],
    ]) {
      await visitor.goto(path)
      await expect(pageHeading(visitor, heading)).toBeVisible()

      const footer = visitor.getByRole('contentinfo')

      await expect(footer.locator('a[href^="mailto:"]'), `the footer on ${path}`).toHaveCount(0)
      // Payments are simulated, and the footer says so rather than implying a charge.
      await expect(footer).toContainText(FOOTER_PAYMENTS)
    }

    await visitor
      .getByRole('contentinfo')
      .getByRole('link', { name: FOOTER_LIMITATIONS_LINK, exact: true })
      .click()

    await expect(visitor).toHaveURL((url) => url.pathname === '/limitations')
    await expect(pageHeading(visitor, 'What this site does not do')).toBeVisible()

    const recorded = await visitor
      .locator('main li[aria-labelledby^="limitation-"]')
      .evaluateAll((items) =>
        items.map((item) => [
          item.querySelector('h2').textContent.trim(),
          item
            .querySelector('p')
            .textContent.replace(/^\s*Status:\s*/u, '')
            .trim(),
        ]),
      )

    // Every name with its word, in order, and nothing else.
    expect(recorded).toEqual(RECORDED_LIMITATIONS)

    // A limitation is listed because it is missing now. The page says what
    // happens instead, never when it might change.
    const words = await visitor.locator('main').innerText()

    expect(words).not.toMatch(/\bcoming soon\b|\bsoon\b|\byet\b/iu)
    // Nowhere on the page, footer included, is there an address to write to.
    await expect(visitor.locator('a[href^="mailto:"]')).toHaveCount(0)
  })
})

test.describe('what crawlers and installers are given', () => {
  test('the sitemap lists the directories and the live catalogue, and nothing unlisted', async ({
    visitor,
  }) => {
    const { tag } = ids()
    const response = await visitor.request.get('/sitemap.xml')

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/xml/u)

    const xml = await response.text()
    // The origin is `NEXT_PUBLIC_SITE_URL`, which is not this server's, so
    // only the paths are compared.
    const paths = new Set(
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map(([, loc]) => new URL(loc.trim()).pathname),
    )

    for (const path of ['/categories', '/venues', '/organizers', '/limitations']) {
      expect(paths, `the sitemap lists ${path}`).toContain(path)
    }

    // Built from the live listing: the published event and its organiser are
    // there, and the draft, the approved-but-unpublished event and the two
    // organisations with nothing listed are not.
    expect(paths).toContain(`/events/alpha-event-${tag}`)
    expect(paths).toContain(`/organizers/alpha-${tag}`)
    expect(paths).not.toContain(`/events/alpha-draft-${tag}`)
    expect(paths).not.toContain(`/events/unverified-event-${tag}`)
    expect(paths).not.toContain(`/organizers/unverified-${tag}`)
    expect(paths).not.toContain(`/organizers/beta-${tag}`)
  })

  test('the manifest is linked, served as JSON, and its icon answers as SVG', async ({
    visitor,
  }) => {
    await visitor.goto('/')

    // Not scoped to `head`: streamed metadata can arrive later in the document
    // and be hoisted, and where it sits is not the claim.
    const href = await visitor.locator('link[rel="manifest"]').first().getAttribute('href')

    expect(new URL(href, visitor.url()).pathname).toBe('/manifest.webmanifest')

    const response = await visitor.request.get(href)

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/json/u)

    const manifest = await response.json()

    expect(manifest.start_url).toBe('/')
    expect(manifest.display).toBe('standalone')
    // It says what the site says: nothing here takes money.
    expect(manifest.description).toContain('Payments on this site are simulated.')

    const icon = manifest.icons.find((entry) => entry.type === 'image/svg+xml')

    expect(icon, 'the manifest names an SVG icon').toBeTruthy()

    const image = await visitor.request.get(icon.src)

    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toMatch(/^image\/svg\+xml/u)
    expect(await image.text()).toContain('<svg')
  })
})

test.describe('event cards', () => {
  test('quote an all-in price and a stated availability, and invent no urgency', async ({
    visitor,
  }) => {
    await visitor.goto('/events')
    await expect(pageHeading(visitor, 'What’s on')).toBeVisible()
    await expect(visitor.getByText(SAMPLE_NOTICE)).toHaveCount(0)

    let alpha = null
    let read = 0

    await walkListing(visitor, (cards) => {
      for (const card of cards) {
        read += 1

        // Urgency needs a fact, and a summary carries none.
        expect(card.text, `${card.title} invents urgency`).not.toMatch(FABRICATED_URGENCY)

        // A word from the vocabulary, or no chip when the summary does not say.
        if (card.availability !== null) {
          expect(AVAILABILITY_WORDS, `${card.title} says "${card.availability}"`).toContain(
            card.availability,
          )
        }

        // The API prices every tiered event as checkout would, so no card is
        // left quoting a face value; the only prices without a qualifier are
        // the ones that are not a figure.
        expect(card.text, `${card.title} quotes a face value`).not.toContain(BEFORE_FEES)
        expect(
          card.qualifier === ALL_IN ||
            (card.qualifier === null && ['Free', 'Price to be announced'].includes(card.amount)),
          `${card.title} is priced "${card.amount}" "${card.qualifier}"`,
        ).toBe(true)
      }

      alpha = cards.find((card) => card.title === eventTitle()) ?? null

      // Walked until the alpha card turns up: every card on the way is checked.
      return alpha !== null
    })

    expect(read).toBeGreaterThan(0)
    expect(alpha, 'the alpha event is listed').not.toBeNull()
    // The card's one link opens the event it describes.
    expect(alpha.href).toBe(`/events/alpha-event-${ids().tag}`)

    // PUBLISHED with an ON_SALE tier of a hundred, no sales window: on sale.
    expect(alpha.availability).toBe('On sale')
    // One ticket with the booking fee and any tax, as checkout would charge it
    // — so not the seeded face value, which a card must not pass off as the price.
    expect(alpha.qualifier).toBe(ALL_IN)
    expect(alpha.amount).toMatch(/^₹[\d,]+\.\d{2}$/u)
    expect(alpha.amount).not.toBe(FACE_VALUE)
  })
})

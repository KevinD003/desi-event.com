import { createPrismaClient } from '@desi-event/db'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { statePath } from './support/detail-global-setup.mjs'
import { signIn } from './support/detail-world.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'
import {
  HEADLESS_AGENT,
  VISITOR_AGENT,
  rollUpTrafficNow,
  trafficColumns,
} from './support/traffic.mjs'

/**
 * Visits to an event's page, counted and shown, in a real browser against the
 * real API (SPEC2 D7, §4.N).
 *
 * The site counts a visit without a cookie and without keeping an address, a
 * browser description or an account: a beacon names the event, what happened
 * and where, and the API files it under a code made with a secret that is
 * deleted when the day ends. The roll-up adds the raw rows up into daily
 * totals, which are all any screen reads.
 *
 * ## What only this file can show
 *
 * - **N1** A visitor finds the event by search, opens it and presses "Choose
 *   tickets": three beacons — the card's click from search results, the page
 *   view of a navigation inside the site, the tickets click — each answered
 *   202.
 * - **N2** Repeats fold: two reloads add no page view, and a click on the
 *   event's card on the home page is one more card click, from the home page.
 * - **N3** A robot is answered like anybody and stored as nobody; a browser
 *   that asks not to be tracked is a page view and never a visitor.
 * - **N4** The organiser's own team is not counted: its page sends no beacon
 *   at all, and its link to its own website asks not to be counted.
 * - **N5** The organiser's per-event page: every figure is the baseline plus
 *   exactly what N1–N3 did, in the totals, the sources, the chart and the
 *   day's row, with the website link's state and how fresh the figures are.
 * - **N6** The organisation's view lists its own events only, each linking to
 *   its own figures with the period kept.
 * - **N7** Another organisation's owner, and a viewer without the platform
 *   capability, are refused — on the screens and by the API, including the
 *   platform list (`traffic/events`).
 * - **N8** A platform administrator reads every organisation's events' visits
 *   on a list with no money, drills into one, where it reads the event's money
 *   as a super administrator does (ADR 0018), and is offered the list in the
 *   rail.
 * - **N9** A keyboard's Enter on a card counts as its click.
 *
 * And, throughout: no beacon carries a cookie, a beacon's body names nothing
 * but the event, the kind, the place and a referrer category, no beacon's
 * answer sets a cookie, and no traffic table has a column that could hold an
 * address, a browser description or a web address.
 *
 * ## Counting against a moving world
 *
 * Every figure here is a difference from a baseline read after an explicit
 * roll-up, because other detail specs open gamma's event too — their windows
 * share the device's user agent and the loopback address, so together they
 * are one visitor. This file's visitor has a user agent of its own, carrying
 * the tag (`VISITOR_AGENT`), so it is counted apart. A page view folds into
 * one per visitor per half-hour of the UTC day, so N1 starts with at least
 * six minutes left in the current half-hour: what N1 and N2 send then lands
 * in one slot, which is the rule under test, rather than in two by the clock.
 *
 * ## Isolation
 *
 * Gamma's general-admission event, its owner and link-admin are the feature
 * world's (`seed-feature-world.mjs`); the outsider is beta's owner and the
 * viewer is alpha's, neither of whom this file changes. Nothing here writes a
 * visit total: the roll-up the worker runs adds them up (`support/traffic.mjs`).
 * No code is drawn, so the config's screenshot and trace settings stand.
 *
 * @module e2e/detail-event-analytics
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** Where beacons go. */
const BEACON_PATH = '/api/v1/traffic/beacons'

/** The only keys a beacon's body may carry. */
const BEACON_KEYS = Object.freeze(['eventId', 'kind', 'placement', 'referrer'])

/** A cookie the visitor's window holds, so a beacon that carried cookies would show it. */
const PROBE_COOKIE = Object.freeze({ name: 'desi_e2e_probe', value: 'not-for-beacons' })

/** A day as the analytics screens write it: `Oct 7`. */
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

/** Half an hour: how long one visitor's page views fold into one. */
const PAGE_VIEW_SLOT_MS = 30 * 60_000

/** How much of the half-hour N1 and N2 need. */
const SLOT_ROOM_MS = 6 * 60_000

/**
 * Today, as a UTC day.
 *
 * @returns {string} `YYYY-MM-DD`.
 */
const today = () => new Date().toISOString().slice(0, 10)

/**
 * Where the screens' "Last N days" starts: UTC midnight of the first of the N
 * days, today counted (`periodFrom` in `lib/traffic.js`).
 *
 * @param {number} days How many days.
 * @returns {string} An ISO instant.
 */
const daysFrom = (days) =>
  new Date(Date.parse(`${today()}T00:00:00.000Z`) - (days - 1) * 86_400_000).toISOString()

/**
 * The figures the API gives gamma's owner for the general-admission event.
 *
 * @param {object} page A page signed in as gamma's owner.
 * @param {number} [days] The last this many days, as "Last 7 days" asks; everything when omitted.
 * @returns {Promise<object>} The `traffic` branch.
 */
async function eventTraffic(page, days) {
  const { gammaOrganizationId, gammaGaEventId } = ids()
  const query = new URLSearchParams({
    organizationId: gammaOrganizationId,
    eventId: gammaGaEventId,
    currency: 'USD',
  })

  if (days) query.set('from', daysFrom(days))

  const response = await page.request.get(`/api/v1/analytics/summary?${query}`)

  expect(response.status(), await response.text()).toBe(200)

  const { traffic } = (await response.json()).data

  expect(traffic.event?.id, 'the figures are the event’s own').toBe(gammaGaEventId)

  return traffic
}

/**
 * A figure in the visits section, by its label.
 *
 * @param {object} page The page, on an analytics screen.
 * @param {string} label The figure's label.
 * @returns {object} A locator for the value.
 */
const figure = (page, label) =>
  page
    .getByRole('main')
    .locator('dl > div')
    .filter({
      has: page.getByRole('term').filter({ hasText: new RegExp(`^${label}$`, 'u') }),
    })
    .getByRole('definition')
    .locator('span')
    .first()

/**
 * Wait for the next beacon of a kind, and its answer.
 *
 * @param {object} page The page that sends it.
 * @param {string} kind The beacon's kind.
 * @returns {Promise<object>} The request.
 */
const nextBeacon = (page, kind) =>
  page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === BEACON_PATH &&
      request.method() === 'POST' &&
      JSON.parse(request.postData() ?? '{}').kind === kind,
    { timeout: 15_000 },
  )

/**
 * Assert a beacon was accepted, and return what it said.
 *
 * @param {object} request The beacon's request.
 * @returns {Promise<object>} Its body.
 */
async function accepted(request) {
  const response = await request.response()

  expect(response?.status(), 'the beacon is answered 202').toBe(202)

  return JSON.parse(request.postData())
}

/**
 * Leave enough of the current half-hour for N1 and N2 to fold into it.
 *
 * Arrangement, not a condition on what is asserted: the deltas below are
 * asserted the same either way.
 *
 * The test's time is extended by the wait before the wait begins. Extended
 * after it, as this once was, a wait of up to six minutes ran inside the
 * ninety seconds it was meant to be added to, and the case timed out whenever
 * it started in a half-hour's last six minutes.
 *
 * @returns {Promise<number>} How long it waited, in milliseconds.
 */
async function roomInThisHalfHour() {
  const left = PAGE_VIEW_SLOT_MS - (Date.now() % PAGE_VIEW_SLOT_MS)
  const wait = left >= SLOT_ROOM_MS ? 0 : left + 2_000

  test.setTimeout(90_000 + wait)

  if (wait > 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, wait)
    })
  }

  return wait
}

test.describe.serial('visits to an event’s page', () => {
  /** The visitor's window: signed out, with a user agent of its own. */
  let visitorContext
  /** @type {object} */
  let visitor
  /** Gamma's owner, for reading the API's figures between journeys. */
  let ownerContext
  /** @type {object} */
  let owner
  /** Every beacon the visitor's window sent, and its answer. */
  const beacons = []
  /** The figures before this file did anything. */
  let baseline
  /** The last seven days' figures before this file did anything. */
  let baselineWeek
  /** The figures after N1–N4. */
  let afterTeam

  test.beforeAll(async ({ browser }) => {
    visitorContext = await browser.newContext({ userAgent: VISITOR_AGENT(ids().tag) })
    await visitorContext.addCookies([{ ...PROBE_COOKIE, url: test.info().project.use.baseURL }])
    visitorContext.on('request', (request) => {
      if (new URL(request.url()).pathname === BEACON_PATH) beacons.push(request)
    })
    visitor = arriving(await visitorContext.newPage())

    ownerContext = await browser.newContext({ storageState: statePath('gamma') })
    owner = await ownerContext.newPage()

    await rollUpTrafficNow()
    baseline = await eventTraffic(owner)
    baselineWeek = await eventTraffic(owner, 7)
  })

  test.afterAll(async () => {
    await visitorContext?.close()
    await ownerContext?.close()
  })

  test('N1: from search results to the event to its tickets, three beacons', async () => {
    await roomInThisHalfHour()

    const { gammaGaEventId, gammaGaEventSlug, gammaGaEventTitle } = ids()

    await visitor.goto(`/events?q=${encodeURIComponent(gammaGaEventTitle)}`)

    const card = visitor.getByRole('link', { name: gammaGaEventTitle, exact: true })

    await expect(card).toHaveAttribute('data-traffic-placement', 'SEARCH')

    const cardClick = nextBeacon(visitor, 'CARD_CLICK')
    const view = nextBeacon(visitor, 'PAGE_VIEW')

    await card.click()

    expect(await accepted(await cardClick)).toEqual({
      eventId: gammaGaEventId,
      kind: 'CARD_CLICK',
      placement: 'SEARCH',
    })
    await expect(visitor).toHaveURL(new RegExp(`/events/${gammaGaEventSlug}$`, 'u'))
    // A navigation inside the site: the page view says so, and names no page.
    expect(await accepted(await view)).toEqual({
      eventId: gammaGaEventId,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      referrer: 'SAME_SITE',
    })

    const tickets = nextBeacon(visitor, 'TICKETS_CLICK')

    await visitor.getByRole('link', { name: 'Choose tickets' }).click()
    expect(await accepted(await tickets)).toEqual({
      eventId: gammaGaEventId,
      kind: 'TICKETS_CLICK',
      placement: 'EVENT_PAGE',
    })
  })

  test('N2: repeats fold, and a click on the home page’s card is counted from there', async () => {
    const { gammaGaEventId, gammaGaEventSlug } = ids()

    // Opened, then reloaded twice: three page views sent, one counted.
    for (const open of [
      () => visitor.goto(`/events/${gammaGaEventSlug}`),
      () => visitor.reload(),
      () => visitor.reload(),
    ]) {
      const view = nextBeacon(visitor, 'PAGE_VIEW')

      await open()
      await accepted(await view)
    }

    // The event's card on the home page: in "The next nights out" or as the
    // hero's next night, either of which counts as the home page.
    await visitor.goto('/')

    const homeCard = visitor
      .locator(`a[data-traffic-event="${gammaGaEventId}"][data-traffic-placement="HOME"]`)
      .first()

    await expect(homeCard).toBeVisible()

    const cardClick = nextBeacon(visitor, 'CARD_CLICK')
    const view = nextBeacon(visitor, 'PAGE_VIEW')

    await homeCard.click()
    expect(await accepted(await cardClick)).toEqual({
      eventId: gammaGaEventId,
      kind: 'CARD_CLICK',
      placement: 'HOME',
    })
    await accepted(await view)

    await rollUpTrafficNow()

    const { totals, cardPlacements } = await eventTraffic(owner)
    const placed = Object.fromEntries(cardPlacements.map((row) => [row.placement, row.clicks]))
    const before = Object.fromEntries(
      baseline.cardPlacements.map((row) => [row.placement, row.clicks]),
    )

    // Five page views sent, in one half-hour: one counted, one visitor.
    expect(totals.views - baseline.totals.views).toBe(1)
    expect(totals.visitors - baseline.totals.visitors).toBe(1)
    expect(totals.anonymousViews - baseline.totals.anonymousViews).toBe(0)
    // Two different cards' clicks: from search, and from the home page.
    expect(totals.cardClicks - baseline.totals.cardClicks).toBe(2)
    expect(placed.SEARCH - before.SEARCH).toBe(1)
    expect(placed.HOME - before.HOME).toBe(1)
    expect(placed.LISTING - before.LISTING).toBe(0)
    expect(
      totals.ticketClicks +
        totals.seatClicks -
        baseline.totals.ticketClicks -
        baseline.totals.seatClicks,
    ).toBe(1)
  })

  test('N3: a robot is stored as nobody; a browser that asks not to be tracked is a view, never a visitor', async ({
    browser,
  }) => {
    const { gammaGaEventSlug, tag } = ids()
    const before = (await eventTraffic(owner)).totals

    for (const options of [
      // The default headless browser, which says so in its agent.
      { userAgent: HEADLESS_AGENT() },
      // The visitor's own browser, now sending Global Privacy Control.
      { userAgent: VISITOR_AGENT(tag), extraHTTPHeaders: { 'Sec-GPC': '1' } },
    ]) {
      const context = await browser.newContext(options)

      try {
        const page = arriving(await context.newPage())
        const view = nextBeacon(page, 'PAGE_VIEW')

        await page.goto(`/events/${gammaGaEventSlug}`)
        // Answered exactly as anybody's is: nothing tells a robot it was seen.
        await accepted(await view)
      } finally {
        await context.close()
      }
    }

    await rollUpTrafficNow()

    const { totals } = await eventTraffic(owner)

    // The robot: nothing. The privacy signal: one page view, no visitor.
    expect(totals.views - before.views).toBe(1)
    expect(totals.anonymousViews - before.anonymousViews).toBe(1)
    expect(totals.visitors - before.visitors).toBe(0)
  })

  test('N4: the organiser’s own team is not counted, and its own link says so', async ({
    gamma,
  }) => {
    const { gammaGaEventSlug, gammaSeatedEventSlug } = ids()
    const before = (await eventTraffic(owner)).totals
    const sent = []

    gamma.on('request', (request) => {
      if (new URL(request.url()).pathname === BEACON_PATH) sent.push(request)
    })

    await gamma.goto(`/events/${gammaGaEventSlug}`)
    await gamma.getByRole('link', { name: 'Choose tickets' }).click()
    await gamma.waitForURL(new RegExp(`/events/${gammaGaEventSlug}/checkout`, 'u'))
    // Long enough for a beacon to have been sent if one were going to be.
    await gamma.waitForTimeout(3_000)

    expect(sent.map((request) => request.postData())).toEqual([])

    // The seated event's link is on; for its own team it asks not to be
    // counted, and says why.
    await gamma.goto(`/events/${gammaSeatedEventSlug}`)

    const link = gamma.getByRole('link', { name: 'Visit the organiser’s website', exact: true })

    await expect(link).toHaveAttribute('href', `/events/${gammaSeatedEventSlug}/website?count=no`)
    await expect(gamma.locator('#website-link-note')).toContainText(
      'Visits by the event’s own team and staff at The Desi Events are not counted.',
    )
    expect(sent).toEqual([])

    await rollUpTrafficNow()
    afterTeam = await eventTraffic(owner)

    for (const field of ['views', 'visitors', 'cardClicks', 'ticketClicks', 'seatClicks']) {
      expect(afterTeam.totals[field], field).toBe(before[field])
    }
  })

  test('N5: the organiser’s page for the event shows exactly what was counted', async ({
    gamma,
  }) => {
    const { gammaOrganizationId, gammaGaEventId, gammaGaEventTitle } = ids()
    const totals = afterTeam.totals

    // What N1–N3 added, read back against the baseline.
    expect(totals.views - baseline.totals.views).toBe(2)
    expect(totals.visitors - baseline.totals.visitors).toBe(1)

    await gamma.goto(
      `/analytics?organizationId=${gammaOrganizationId}&eventId=${gammaGaEventId}&range=7`,
    )
    await expect(
      gamma.getByRole('heading', {
        level: 1,
        name: `Analytics for ${gammaGaEventTitle}`,
        exact: true,
      }),
    ).toBeVisible()

    for (const heading of [
      'Visits to this event’s page',
      'Per day',
      'Where visits came from',
      'From visit to payment',
    ]) {
      await expect(
        gamma.getByRole('heading', { level: 2, name: heading, exact: true }),
      ).toBeVisible()
    }

    // "Last 7 days": the screen shows the week's figures, which are the
    // week's baseline plus exactly N1–N3.
    const week = await eventTraffic(owner, 7)
    const clicks = (totals) => totals.ticketClicks + totals.seatClicks
    const dayOf = (traffic) =>
      traffic.byDay.find((day) => day.day === today()) ?? { views: 0, visitors: 0 }

    expect(week.totals.views - baselineWeek.totals.views).toBe(2)
    expect(week.totals.visitors - baselineWeek.totals.visitors).toBe(1)
    expect(clicks(week.totals) - clicks(baselineWeek.totals)).toBe(1)
    expect(dayOf(week).views - dayOf(baselineWeek).views).toBe(2)

    await expect(figure(gamma, 'Page views')).toHaveText(String(week.totals.views))
    await expect(figure(gamma, 'Visitors')).toHaveText(String(week.totals.visitors))
    await expect(figure(gamma, 'Event card clicks')).toHaveText(String(week.totals.cardClicks))
    await expect(figure(gamma, 'Ticket and seat clicks')).toHaveText(String(clicks(week.totals)))

    // A navigation inside the site is a visit from the site's own pages.
    const internal = gamma
      .getByRole('table', { name: 'Where page views came from' })
      .getByRole('row')
      .filter({ has: gamma.getByRole('rowheader', { name: /^The Desi Events pages/u }) })
      .getByRole('cell')
      .first()

    expect(Number((await internal.textContent()).replaceAll(',', ''))).toBeGreaterThanOrEqual(1)

    // The chart is named, and its description names today, the busiest day.
    const chart = gamma.getByRole('img', { name: /page views and visitors per day/iu })

    await expect(chart).toBeVisible()
    await expect(chart).toHaveAccessibleDescription(
      new RegExp(`the most on ${DAY_FORMAT.format(new Date())}`, 'u'),
    )

    // Today's row of the table beside it.
    const todayRow = gamma
      .getByRole('table', { name: 'Visits per day (UTC)' })
      .getByRole('row')
      .filter({ has: gamma.locator(`time[datetime="${today()}"]`) })

    await expect(todayRow.getByRole('cell').first()).toHaveText(String(dayOf(week).views))

    // The website link's state, in words, and how fresh all of this is.
    await expect(gamma.getByText(/^Website link: Off\./u)).toBeVisible()
    await expect(
      gamma.getByText(/These figures run to \d{2}:\d{2} UTC on [A-Z][a-z]{2} \d{1,2}\./u).first(),
    ).toBeVisible()

    // What the funnel does not count is said.
    await expect(gamma.getByRole('heading', { name: 'Not counted', exact: true })).toBeVisible()
  })

  test('N6: the organisation’s view lists its own events, each linking to its figures', async ({
    gamma,
  }) => {
    const { gammaOrganizationId, gammaGaEventId, gammaGaEventTitle } = ids()

    await gamma.goto(`/analytics?organizationId=${gammaOrganizationId}`)
    await expect(gamma.getByRole('heading', { level: 2, name: 'Your events' })).toBeVisible()

    const table = gamma.getByRole('table', { name: 'Your events in this period' })
    const row = table
      .getByRole('row')
      .filter({ has: gamma.getByRole('link', { name: gammaGaEventTitle, exact: true }) })

    await expect(row.getByRole('cell').nth(1)).toHaveText(String(afterTeam.totals.views))

    const link = row.getByRole('link', { name: gammaGaEventTitle, exact: true })
    const href = new URL(await link.getAttribute('href'), 'http://x')

    expect(href.pathname).toBe('/analytics')
    expect(href.searchParams.get('organizationId')).toBe(gammaOrganizationId)
    expect(href.searchParams.get('eventId')).toBe(gammaGaEventId)
    // The period is kept: everything, the default.
    expect(href.searchParams.get('range')).toBe('all')

    // Only gamma's events: every row's link stays in gamma, and every event
    // it names is gamma's in the database.
    const listed = await table.getByRole('rowheader').getByRole('link').all()
    const eventIds = []

    expect(listed.length).toBeGreaterThan(0)

    for (const each of listed) {
      const target = new URL(await each.getAttribute('href'), 'http://x')

      expect(target.searchParams.get('organizationId')).toBe(gammaOrganizationId)
      eventIds.push(target.searchParams.get('eventId'))
    }

    const prisma = createPrismaClient({ connectionString: CONNECTION })

    try {
      const owners = await prisma.event.findMany({
        where: { id: { in: eventIds } },
        select: { organizationId: true },
      })

      expect(owners).toHaveLength(eventIds.length)
      expect(new Set(owners.map((event) => event.organizationId))).toEqual(
        new Set([gammaOrganizationId]),
      )
    } finally {
      await prisma.$disconnect()
    }

    await expect(table).not.toContainText(`Alpha's Evening ${ids().tag}`)

    await link.click()
    await expect(
      gamma.getByRole('heading', { level: 1, name: `Analytics for ${gammaGaEventTitle}` }),
    ).toBeVisible()
  })

  test('N7: another organisation, and a viewer, are refused on the screens and by the API', async ({
    outsider,
    viewer,
  }) => {
    const { gammaOrganizationId, gammaGaEventId, gammaGaEventTitle } = ids()

    await outsider.goto(
      `/analytics?organizationId=${gammaOrganizationId}&eventId=${gammaGaEventId}`,
    )
    await expect(outsider.getByRole('main')).toContainText(/not for you/iu)
    await expect(outsider.getByRole('main')).not.toContainText(gammaGaEventTitle)

    const summary = await outsider.request.get(
      `/api/v1/analytics/summary?organizationId=${gammaOrganizationId}&eventId=${gammaGaEventId}`,
    )

    expect(summary.status()).toBe(403)

    // The platform's list of every event's visits is the platform's alone.
    const platformList = await outsider.request.get('/api/v1/traffic/events')

    expect(platformList.status()).toBe(403)

    await viewer.goto('/analytics/events')
    await expect(
      viewer.getByRole('heading', { level: 1, name: 'Not for you', exact: true }),
    ).toBeVisible()
    await expect(viewer.getByRole('main')).not.toContainText(gammaGaEventTitle)
    expect((await viewer.request.get('/api/v1/traffic/events')).status()).toBe(403)
  })

  test('N8: a platform administrator reads every event’s visits, and one event’s money as a super administrator does (ADR 0018)', async ({
    browser,
  }) => {
    const { gammaGaEventTitle, linkAdminEmail, tag } = ids()
    const context = await browser.newContext()

    try {
      const admin = arriving(await context.newPage())

      // Reads only: no second factor beyond the one signing in asks for.
      await signIn(admin, linkAdminEmail)
      await admin.goto(`/analytics/events?range=7&q=${encodeURIComponent(tag)}`)
      await expect(
        admin.getByRole('heading', { level: 1, name: 'Every event’s visits', exact: true }),
      ).toBeVisible()
      await expect(
        admin.getByRole('heading', { level: 2, name: 'Most visited in this period', exact: true }),
      ).toBeVisible()

      const events = admin.getByRole('table', { name: 'Events, newest start first' })
      const row = events
        .getByRole('row')
        .filter({ has: admin.getByRole('link', { name: gammaGaEventTitle, exact: true }) })

      // The same page views the organiser was shown for the week.
      await expect(row.getByRole('cell').nth(2)).toHaveText(
        String((await eventTraffic(owner, 7)).totals.views),
      )
      // Every organisation's events, not one: alpha's evening is listed too.
      await expect(events).toContainText(`Gamma Collective ${tag}`)
      await expect(events).toContainText(`Alpha Collective ${tag}`)
      // No money, anywhere on the list: it counts visits only.
      await expect(admin.getByRole('main')).not.toContainText('$')

      // The navigation offers the list.
      await expect(
        admin
          .getByRole('navigation', { name: 'Workspace' })
          .getByRole('link', { name: 'Every event’s visits', exact: true }),
      ).toBeVisible()

      await row.getByRole('link', { name: gammaGaEventTitle, exact: true }).click()
      await expect(
        admin.getByRole('heading', {
          level: 1,
          name: `Analytics for ${gammaGaEventTitle}`,
          exact: true,
        }),
      ).toBeVisible()
      // The platform administrator holds finance:view everywhere (ADR 0018),
      // and signed in with its second factor just now, so the server sends the
      // event's money from the ledger, as it does to a super administrator.
      const money = admin.getByRole('region', { name: 'Money, from the ledger', exact: true })

      await expect(money).toBeVisible()
      await expect(money.getByText('Gross collected', { exact: true })).toBeVisible()
      await expect(
        admin.getByText('Money figures are not included for this account', { exact: true }),
      ).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test('N9: a keyboard’s Enter on a card counts as its click', async () => {
    const { gammaGaEventId, gammaGaEventTitle } = ids()
    const before = (await eventTraffic(owner)).cardPlacements

    await visitor.goto('/events')

    const card = visitor.getByRole('link', { name: gammaGaEventTitle, exact: true })

    await expect(card).toHaveAttribute('data-traffic-placement', 'LISTING')

    // Tabbed to, as a keyboard reaches it.
    let reached = false

    for (let presses = 0; presses < 120 && !reached; presses += 1) {
      await visitor.keyboard.press('Tab')
      reached = await card.evaluate((node) => node === document.activeElement)
    }

    expect(reached, 'the card’s link is reached by Tab').toBe(true)

    const cardClick = nextBeacon(visitor, 'CARD_CLICK')

    await visitor.keyboard.press('Enter')
    expect(await accepted(await cardClick)).toEqual({
      eventId: gammaGaEventId,
      kind: 'CARD_CLICK',
      placement: 'LISTING',
    })

    await rollUpTrafficNow()

    const after = Object.fromEntries(
      (await eventTraffic(owner)).cardPlacements.map((row) => [row.placement, row.clicks]),
    )
    const was = Object.fromEntries(before.map((row) => [row.placement, row.clicks]))

    expect(after.LISTING - was.LISTING).toBe(1)
  })

  test('no beacon carries a cookie or anything but its four fields, and no table could keep a visitor', async () => {
    expect(beacons.length).toBeGreaterThanOrEqual(8)

    for (const request of beacons) {
      const headers = await request.allHeaders()
      const body = JSON.parse(request.postData() ?? '{}')

      expect(headers.cookie, 'a beacon carried a cookie').toBeUndefined()
      expect(
        Object.keys(body).every((key) => BEACON_KEYS.includes(key)),
        JSON.stringify(body),
      ).toBe(true)

      const response = await request.response()

      expect(response?.headers()['set-cookie'], 'a beacon’s answer set a cookie').toBeUndefined()
    }

    // The cookie was there to be carried: the window did hold it.
    expect((await visitorContext.cookies()).map((cookie) => cookie.name)).toContain(
      PROBE_COOKIE.name,
    )

    const columns = await trafficColumns()

    expect(columns).toContain('TrafficEvent.visitorHash')

    for (const column of columns) {
      expect(column.split('.')[1]).not.toMatch(
        /address|agent|\bip\b|url|referr|user|cookie|session|email|host/iu,
      )
    }
  })
})

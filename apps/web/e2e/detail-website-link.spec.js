import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import { LINK_ADMIN_NAME, SEATED_LINK_REASON } from './support/seed-feature-world.mjs'
import { confirmIfPrompted } from './support/step-up.mjs'
import { rollUpTrafficNow } from './support/traffic.mjs'

/**
 * The organiser's website link and the administrators' switch, in a real
 * browser against the real API (SPEC2 D6, §4.W).
 *
 * An organiser gives an event their website's address; only a platform
 * administrator at The Desi Events turns the event page's "Visit the organiser’s
 * website" link on or off, for exactly the address on their screen, with a
 * reason the organiser reads beside the administrator's name. The link is the
 * site's own `/events/{slug}/website`, which answers a 302 to the
 * address the administrator approved — never one taken from the request —
 * and counts the visit without keeping who made it.
 *
 * ## What only this file can show
 *
 * - **W1** A visitor is shown no link while it is off, and the route answers
 *   the one 404 page.
 * - **W2** The organiser's editor shows their address, the switch read-only
 *   and waiting, and no control that could move it.
 * - **W3** A moderator sees the switch and cannot decide; there is no
 *   "Website links" entry for them, and the API refuses them.
 * - **W4** A platform administrator finds the address on the waiting list,
 *   is held to the box and a reason, and turns the link on.
 * - **W5** The visitor follows it: a 302 to the approved address with
 *   `no-store`, whatever the request asks for; HEAD, prefetches and
 *   non-document requests are answered without a lookup; the click lands.
 * - **W6** The organiser reads who turned it on, when, and why.
 * - **W7** The organiser changes the address while the link is on: the link
 *   keeps going to the approved address, the organiser is told the new one
 *   waits, a decision taken on the stale page is refused as "The address
 *   changed", and once an administrator approves the new one the link goes
 *   there.
 * - **W8** The administrator turns the seated event's link off with a reason:
 *   the public page loses it and the organiser reads why.
 * - **W9** Visits: only the real click is counted. Every probe of the route
 *   here sends no fetch metadata (Playwright's request API sends none), or
 *   says it is not a page, or asks not to be counted — none is a top-level
 *   navigation the browser vouches for — and the browser's own call to the
 *   server-only lookup is refused at the proxy. After all of them the
 *   organiser's analytics show exactly one visit to their website.
 *
 * ## Isolation
 *
 * Gamma's general-admission event (its address waiting) and seated event (its
 * link on, decided by link-admin) are the feature world's
 * (`seed-feature-world.mjs`); nothing here touches alpha or beta. link-admin
 * and the door moderator are signed in here, each in a window of its own, and
 * nothing here changes anybody's role. The organiser's addresses are on
 * `.test` hosts, which never resolve, so following the link ends at the
 * browser's own "cannot be reached" page: what is asserted is that the
 * browser was sent there, by the route's 302. (A window's request routes do
 * not see the target of a redirect, so the organiser's site cannot be stood
 * in for; nothing here needs it to be.)
 *
 * No show-once code is drawn, so screenshots, traces and video keep the
 * config's defaults. link-admin's decisions need a second factor within the
 * MODERATION window; it was confirmed at sign-in, and the prompt is answered
 * when — and only when — it is offered (`confirmIfPrompted`).
 *
 * @module e2e/detail-website-link
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** What the public page's link says. */
const LINK_LABEL = 'Visit the organiser’s website'

/** The 404 page's heading. */
const NOT_AVAILABLE = 'This website link is not available'

/** The box an administrator ticks before turning a link on. */
const CHECKED_LABEL = 'I have opened this address and it is the organiser’s own site.'

/** What a reader who may not decide is told. */
const CANNOT_DECIDE = 'Only a platform administrator can turn the website link on or off.'

/** The last line of every organiser summary. */
const ONLY_THE_TEAM = 'Only the team at The Desi Events can turn this link on or off.'

/** Why link-admin turns the general-admission event's link on. */
const ON_REASON = 'Checked: gamma’s own site.'

/** Why link-admin approves the organiser's new address. */
const NEW_REASON = 'Checked the new address too.'

/** Why link-admin turns the seated event's link off. */
const OFF_REASON = 'Turned off for the check.'

/**
 * The host of an address, as the sentences name it.
 *
 * @param {string} address An https address.
 * @returns {string} Its host.
 */
const hostOf = (address) => new URL(address).host

/**
 * The general-admission event's new address, which the organiser types in W7.
 *
 * @returns {string} The address, in its stored form.
 */
const newAddress = () => `https://gamma-${ids().tag}-new.test/`

/**
 * Ask the website route where an event's link goes, as a script would: no
 * fetch metadata, no redirect followed. Served, and never counted.
 *
 * @param {object} page Any page; its request context is used.
 * @param {string} slug The event's web address.
 * @param {object} [options] Extra request options.
 * @returns {Promise<object>} The response.
 */
const probe = (page, slug, options = {}) =>
  page.request.get(`/events/${slug}/website${options.query ?? ''}`, {
    maxRedirects: 0,
    headers: options.headers ?? {},
  })

/**
 * The analytics figures the API gives an event's organiser.
 *
 * @param {object} page A page signed in as gamma's owner.
 * @returns {Promise<object>} `traffic.totals`.
 */
async function trafficTotals(page) {
  const { gammaOrganizationId, gammaGaEventId } = ids()
  const response = await page.request.get(
    `/api/v1/analytics/summary?organizationId=${gammaOrganizationId}&eventId=${gammaGaEventId}&currency=USD`,
  )

  expect(response.status(), await response.text()).toBe(200)

  const body = await response.json()

  expect(body.data.traffic.event?.id, 'the figures are the event’s own').toBe(gammaGaEventId)

  return body.data.traffic.totals
}

/**
 * Open an event's editor at its Guest information step.
 *
 * @param {object} page Gamma's owner's page.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The "Your website" box.
 */
async function openGuestStep(page, eventId) {
  await page.goto(`/organizer/events/${eventId}`)
  // The step buttons answer only once the editor has hydrated.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  const step = page
    .getByRole('navigation', { name: 'Editor steps' })
    .getByRole('button', { name: /Guest information$/u })

  await step.click()
  await expect(step).toHaveAttribute('aria-current', 'step')

  return page.getByRole('textbox', { name: 'Your website' })
}

/**
 * The read-only switch under the organiser's website box.
 *
 * @param {object} page Gamma's owner's page.
 * @returns {object} The status group.
 */
const organiserStatus = (page) =>
  page.getByRole('group', { name: 'Website link on your event page', exact: true })

/**
 * The website link panel on an event's review page.
 *
 * @param {object} page The page.
 * @returns {object} The panel.
 */
const linkPanel = (page) => page.getByRole('region', { name: 'Website link', exact: true })

/**
 * Open an event's review page at its website link panel.
 *
 * @param {object} page The page.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The panel.
 */
async function openPanel(page, eventId) {
  await page.goto(`/moderation/events/${eventId}#website-link`)

  const panel = linkPanel(page)

  await expect(panel).toBeVisible()

  return panel
}

/**
 * The row of an event in the administrators' list of website links.
 *
 * @param {object} page The page, on `/moderation/websites`.
 * @param {string} title The event's title.
 * @returns {object} The list item.
 */
const listRow = (page, title) =>
  page.getByRole('listitem').filter({ has: page.getByRole('link', { name: title, exact: true }) })

/**
 * Choose one of the list's filters, by its name.
 *
 * @param {object} page The page, on `/moderation/websites`.
 * @param {string} name The filter's name.
 * @returns {Promise<void>} Resolves once the filtered list is shown.
 */
async function chooseFilter(page, name) {
  const filter = page
    .getByRole('navigation', { name: 'Filter by state' })
    .getByRole('link', { name, exact: true })

  await filter.click()
  await expect(filter).toHaveAttribute('aria-current', 'page')
}

/**
 * Press a decision button and wait for the panel to say it was taken,
 * answering the second-factor prompt if the server asks for one.
 *
 * @param {object} page The administrator's page.
 * @param {string} button The button's name.
 * @param {string} outcome What the panel then says, exactly: "Read again. The
 *   website link is on." must not pass for "The website link is on.".
 * @returns {Promise<void>} Resolves once it is said.
 */
async function decide(page, button, outcome) {
  const panel = linkPanel(page)

  await panel.getByRole('button', { name: button, exact: true }).click()
  await confirmIfPrompted(page, panel.getByText(outcome, { exact: true }).first())
}

test.describe.serial('the organiser’s website link', () => {
  /** link-admin's window, signed in once for the whole story. */
  let adminContext
  /** @type {object} */
  let admin
  /** The visitor's window: nobody signed in. */
  let visitorContext
  /** @type {object} */
  let visitor
  /** Website visits counted for the general-admission event before the click. */
  let redirectsBefore = null

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext()
    admin = arriving(await adminContext.newPage())

    visitorContext = await browser.newContext()
    visitor = arriving(await visitorContext.newPage())
  })

  test.afterAll(async () => {
    await adminContext?.close()
    await visitorContext?.close()
  })

  test('W1: a visitor is shown no link while it is off, and the route says it is not available', async () => {
    const { gammaGaEventSlug, gammaGaEventTitle } = ids()

    await visitor.goto(`/events/${gammaGaEventSlug}`)
    await expect(
      visitor.getByRole('heading', { level: 1, name: gammaGaEventTitle, exact: true }),
    ).toBeVisible()
    await expect(visitor.getByRole('link', { name: LINK_LABEL })).toHaveCount(0)
    // The organiser's address is not on the page in any form while it waits.
    expect(await visitor.content()).not.toContain(`gamma-${ids().tag}.test`)

    const response = await probe(visitor, gammaGaEventSlug)

    expect(response.status()).toBe(404)
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers().location).toBeUndefined()
    expect(await response.text()).toContain(`<h1>${NOT_AVAILABLE}</h1>`)

    // The page a visitor would see says so, and offers a way back.
    await visitor.goto(`/events/${gammaGaEventSlug}/website`)
    await expect(visitor.getByRole('heading', { level: 1, name: NOT_AVAILABLE })).toBeVisible()
    await expect(visitor).toHaveTitle('Website link not available · The Desi Events')
    await expect(visitor.getByRole('link', { name: 'Back to the event' })).toHaveAttribute(
      'href',
      `/events/${gammaGaEventSlug}`,
    )
  })

  test('W2: the organiser’s editor shows the address waiting, and no switch', async ({ gamma }) => {
    const { gammaGaEventId, gammaGaWebsiteUrl } = ids()
    const website = await openGuestStep(gamma, gammaGaEventId)

    await expect(website).toHaveValue(gammaGaWebsiteUrl)

    const status = organiserStatus(gamma)

    await expect(status).toContainText('Off')
    await expect(status).toContainText(
      'Off. Your address is on the list of website links for the team at The Desi Events to look at. It is not shown on your event page until an administrator turns the link on.',
    )
    await expect(status).toContainText(ONLY_THE_TEAM)

    // Nothing on the organiser's screen can move the switch.
    await expect(gamma.getByLabel(CHECKED_LABEL)).toHaveCount(0)
    await expect(gamma.getByRole('button', { name: /turn the link/iu })).toHaveCount(0)
    await expect(gamma.getByRole('button', { name: 'Approve the new address' })).toHaveCount(0)
  })

  test('W3: a moderator sees the switch and cannot decide; the API refuses them', async ({
    browser,
  }) => {
    const { gammaGaEventId, gammaGaWebsiteUrl, doorModeratorEmail } = ids()
    const context = await browser.newContext()

    try {
      const moderator = arriving(await context.newPage())

      await signIn(moderator, doorModeratorEmail)

      const panel = await openPanel(moderator, gammaGaEventId)

      await expect(panel.getByText(CANNOT_DECIDE, { exact: true })).toBeVisible()
      await expect(panel.getByRole('link', { name: /gamma-.+\.test/u }).first()).toHaveAttribute(
        'href',
        gammaGaWebsiteUrl,
      )
      await expect(panel.getByRole('button')).toHaveCount(0)
      await expect(panel.getByLabel(CHECKED_LABEL)).toHaveCount(0)

      // No way to the administrators' list, anywhere on the page.
      await expect(moderator.getByRole('link', { name: 'Website links' })).toHaveCount(0)

      await moderator.goto('/moderation/websites')
      await expect(moderator.getByText('Not for this account', { exact: true })).toBeVisible()
      await expect(moderator.getByRole('link', { name: ids().gammaGaEventTitle })).toHaveCount(0)

      // And the API says the same to a request sent anyway.
      const list = await moderator.request.get('/api/v1/moderation/website-links')

      expect(list.status()).toBe(403)

      const decision = await moderator.request.post(
        `/api/v1/moderation/events/${gammaGaEventId}/website-redirect`,
        { data: { enabled: true, reason: 'A moderator trying.', websiteUrl: gammaGaWebsiteUrl } },
      )

      expect(decision.status()).toBe(403)
    } finally {
      await context.close()
    }

    // Still off.
    expect((await probe(admin, ids().gammaGaEventSlug)).status()).toBe(404)
  })

  test('W4: a platform administrator finds the address waiting and turns the link on', async () => {
    const { gammaGaEventId, gammaGaEventTitle, gammaGaWebsiteUrl, linkAdminEmail } = ids()

    await signIn(admin, linkAdminEmail)
    await admin.goto('/moderation/websites')
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Website links', exact: true }),
    ).toBeVisible()

    // The list opens on what waits for a decision.
    await expect(
      admin
        .getByRole('navigation', { name: 'Filter by state' })
        .getByRole('link', { name: 'Waiting for a decision', exact: true }),
    ).toHaveAttribute('aria-current', 'page')

    const row = listRow(admin, gammaGaEventTitle)

    await expect(row).toContainText(`Address: ${gammaGaWebsiteUrl}`)
    await expect(row).toContainText('Waiting for a decision')

    await row.getByRole('link', { name: gammaGaEventTitle, exact: true }).click()
    await expect(admin).toHaveURL(
      new RegExp(`/moderation/events/${gammaGaEventId}#website-link$`, 'u'),
    )

    const panel = linkPanel(admin)

    await expect(panel.getByText('Waiting since', { exact: true })).toBeVisible()

    // Pressed with neither the box nor a reason: both are named, and nothing
    // is sent.
    await panel.getByRole('button', { name: 'Turn the link on', exact: true }).click()
    await expect(
      panel.getByText('Tick the box to say you have looked at the address.', { exact: true }),
    ).toBeVisible()
    await expect(
      panel.getByText('Give a reason of at least 3 characters.', { exact: true }),
    ).toBeVisible()
    expect((await probe(admin, ids().gammaGaEventSlug)).status()).toBe(404)

    await panel.getByLabel(CHECKED_LABEL).check()
    await panel.getByLabel(/^Reason/u).fill(ON_REASON)
    await decide(admin, 'Turn the link on', 'The website link is on.')

    await expect(panel).toContainText(`going to ${hostOf(gammaGaWebsiteUrl)}`)
    await expect(panel).toContainText(`Turned on by ${LINK_ADMIN_NAME}.`)
    await expect(panel).toContainText(`Reason: ${ON_REASON}`)

    // The list's "On" filter has it now, and "Waiting" no longer does.
    await admin.goto('/moderation/websites')
    await expect(listRow(admin, gammaGaEventTitle)).toHaveCount(0)
    await chooseFilter(admin, 'On')
    await expect(listRow(admin, gammaGaEventTitle)).toContainText(`Address: ${gammaGaWebsiteUrl}`)
    // So does the seeded seated event, whose link the world turned on.
    await expect(listRow(admin, ids().gammaSeatedEventTitle)).toBeVisible()
  })

  test('W5: the visitor follows it — to the approved address, and only there', async ({
    gamma,
  }) => {
    const { gammaGaEventSlug, gammaGaWebsiteUrl } = ids()
    const host = hostOf(gammaGaWebsiteUrl)

    // Everything added up so far, so the one visit below is the only change.
    await rollUpTrafficNow()
    redirectsBefore = (await trafficTotals(gamma)).websiteRedirects

    await visitor.goto(`/events/${gammaGaEventSlug}`)

    const link = visitor.getByRole('link', { name: LINK_LABEL, exact: true })

    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', `/events/${gammaGaEventSlug}/website`)
    await expect(link).toHaveAttribute('rel', 'nofollow')
    await expect(visitor.getByText(`(${host})`, { exact: true })).toBeVisible()
    await expect(
      visitor.getByText(
        `Opens ${host}, which The Desi Events does not run. The Desi Events counts the visit without recording your address, browser or account.`,
        { exact: true },
      ),
    ).toBeVisible()
    // The address itself is never on the public page: only its host.
    expect(await visitor.content()).not.toContain(gammaGaWebsiteUrl)

    // A 302 to the approved address, never stored.
    const followed = await probe(visitor, gammaGaEventSlug)

    expect(followed.status()).toBe(302)
    expect(followed.headers().location).toBe(gammaGaWebsiteUrl)
    expect(followed.headers()['cache-control']).toContain('no-store')

    // Whatever the request says about where to go, it goes there.
    const steered = await probe(visitor, gammaGaEventSlug, {
      query: `?to=${encodeURIComponent('https://evil.test/')}&url=${encodeURIComponent('https://evil.test/')}`,
    })

    expect(steered.status()).toBe(302)
    expect(steered.headers().location).toBe(gammaGaWebsiteUrl)

    // A link checker's HEAD runs no lookup.
    const head = await visitor.request.head(`/events/${gammaGaEventSlug}/website`, {
      maxRedirects: 0,
    })

    expect(head.status()).toBe(405)

    // Fetched ahead of a click: answered 503 with nothing looked up.
    const prefetch = await probe(visitor, gammaGaEventSlug, {
      headers: { 'sec-purpose': 'prefetch' },
    })

    expect(prefetch.status()).toBe(503)
    expect(prefetch.headers().location).toBeUndefined()
    expect(prefetch.headers()['cache-control']).toContain('no-store')

    // Not a page — an image aimed at the route: the 404 page, nothing looked up.
    const image = await probe(visitor, gammaGaEventSlug, {
      headers: {
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
      },
    })

    expect(image.status()).toBe(404)
    expect(image.headers().location).toBeUndefined()

    // A navigation the browser vouches for, that asks not to be counted:
    // served, and `count=no` can only take a count away.
    const uncounted = await probe(visitor, gammaGaEventSlug, {
      query: '?count=no',
      headers: {
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
      },
    })

    expect(uncounted.status()).toBe(302)
    expect(uncounted.headers().location).toBe(gammaGaWebsiteUrl)

    // The lookup behind the route is server to server: the site's proxy
    // refuses it from a browser and never forwards it.
    const direct = await visitor.request.post('/api/v1/traffic/website-visits', {
      data: { slug: gammaGaEventSlug, counted: true },
    })

    expect(direct.status()).toBe(404)
    expect(JSON.stringify(await direct.json())).not.toContain(gammaGaWebsiteUrl)

    // The real click: a top-level navigation the browser vouches for, sent
    // on by the route's 302 to the approved address. The `.test` host does
    // not resolve, so the browser stops there; that it was sent there, and
    // by this route, is the point.
    const landing = visitor.waitForRequest(
      (request) => request.url() === gammaGaWebsiteUrl && request.isNavigationRequest(),
    )

    await link.click()

    const sent = await landing
    const through = sent.redirectedFrom()

    expect(through, 'the browser went there through the route').not.toBeNull()
    expect(new URL(through.url()).pathname).toBe(`/events/${gammaGaEventSlug}/website`)
    expect((await through.response()).status()).toBe(302)
  })

  test('W6: the organiser reads who turned it on, when, and why', async ({ gamma }) => {
    const { gammaGaEventId, gammaGaWebsiteUrl } = ids()

    await openGuestStep(gamma, gammaGaEventId)

    const status = organiserStatus(gamma)

    await expect(status).toContainText('On')
    await expect(status).toContainText(
      new RegExp(
        `On since .+ UTC\\. ${LINK_ADMIN_NAME} of the team at The Desi Events turned it on, with this note: “${ON_REASON}”\\. Your event page shows “${LINK_LABEL}”, which goes to ${hostOf(
          gammaGaWebsiteUrl,
        ).replaceAll('.', '\\.')}\\.`,
        'u',
      ),
    )
    await expect(status).toContainText(ONLY_THE_TEAM)
    // Still nothing the organiser could press.
    await expect(gamma.getByRole('button', { name: /turn the link/iu })).toHaveCount(0)
  })

  test('W7: an address changed while the link is on waits; the link keeps going to the approved one until the new one is approved', async ({
    gamma,
  }) => {
    const { gammaGaEventId, gammaGaEventSlug, gammaGaEventTitle, gammaGaWebsiteUrl } = ids()
    const oldHost = hostOf(gammaGaWebsiteUrl)
    const changed = newAddress()
    const newHost = hostOf(changed)

    // The administrator has the panel open before the organiser changes
    // anything: this page is about to be stale.
    const panel = await openPanel(admin, gammaGaEventId)

    await expect(panel).toContainText(`going to ${oldHost}`)

    // The organiser changes the address, and autosave stores it.
    const website = await openGuestStep(gamma, gammaGaEventId)
    const saved = gamma.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        new URL(response.url()).pathname === `/api/v1/events/${gammaGaEventId}`,
      { timeout: 20_000 },
    )

    await website.fill(changed)
    expect((await saved).status()).toBe(200)
    await expect(gamma.getByTestId('save-status')).toHaveAttribute('data-save-state', 'saved')
    await expect(website).toHaveValue(changed)

    // Told the link still goes to the approved address, and that the new one
    // waits.
    const status = organiserStatus(gamma)
    const waitingSentence = new RegExp(
      `On since .+ UTC, going to ${oldHost.replaceAll('.', '\\.')}\\. Your new address, ${newHost.replaceAll('.', '\\.')}, is on the list for the team at The Desi Events to look at; until an administrator approves it, the link keeps going to ${oldHost.replaceAll('.', '\\.')}\\.`,
      'u',
    )

    await expect(status).toContainText(waitingSentence)
    await expect(status).toContainText('Waiting for a decision')
    // And it is what the server holds, not only what this page remembers.
    await gamma.reload()
    await openGuestStep(gamma, gammaGaEventId)
    await expect(organiserStatus(gamma)).toContainText(waitingSentence)

    // The public link still goes where it was approved to go.
    const stillOld = await probe(visitor, gammaGaEventSlug)

    expect(stillOld.status()).toBe(302)
    expect(stillOld.headers().location).toBe(gammaGaWebsiteUrl)

    // On the administrators' list, the new address waits.
    const list = arriving(await adminContext.newPage())

    try {
      await list.goto('/moderation/websites')

      const row = listRow(list, gammaGaEventTitle)

      await expect(row).toContainText(`Address: ${changed}`)
      await expect(row).toContainText('Waiting for a decision')
    } finally {
      await list.close()
    }

    // A decision taken on the stale page is about the address it showed,
    // which is no longer the organiser's: refused, and nothing changes.
    await panel.getByLabel(/^Reason/u).fill(NEW_REASON)
    await decide(admin, 'Turn the link off', 'The address changed')
    await expect(panel.getByText(`The address now: ${changed}`, { exact: true })).toBeVisible()
    expect((await probe(visitor, gammaGaEventSlug)).headers().location).toBe(gammaGaWebsiteUrl)

    // Read again: the new address, waiting, with the approved one beside it.
    await panel.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(
      panel.getByText('Read again. The website link is on.', { exact: true }),
    ).toBeVisible()
    await expect(
      panel.getByRole('link', { name: new RegExp(`^${changed.replaceAll('.', '\\.')}`, 'u') }),
    ).toHaveAttribute('href', changed)
    await expect(panel.getByText('Waiting since', { exact: true })).toBeVisible()
    await expect(panel).toContainText(
      `The organiser changed the address to ${newHost}; until it is approved, the link keeps going to ${oldHost}.`,
    )

    await panel.getByLabel(CHECKED_LABEL).check()
    await panel.getByLabel(/^Reason/u).fill(NEW_REASON)
    await decide(admin, 'Approve the new address', 'The website link is on.')
    await expect(panel).toContainText(`going to ${newHost}`)

    // Now the link goes to the new address.
    const approved = await probe(visitor, gammaGaEventSlug)

    expect(approved.status()).toBe(302)
    expect(approved.headers().location).toBe(changed)

    await visitor.goto(`/events/${gammaGaEventSlug}`)
    await expect(visitor.getByText(`(${newHost})`, { exact: true })).toBeVisible()

    // And the organiser reads that it was approved, by whom and why.
    await gamma.reload()
    await openGuestStep(gamma, gammaGaEventId)
    await expect(organiserStatus(gamma)).toContainText(
      `${LINK_ADMIN_NAME} of the team at The Desi Events turned it on, with this note: “${NEW_REASON}”.`,
    )
    await expect(organiserStatus(gamma)).toContainText(`which goes to ${newHost}.`)
  })

  test('W8: the administrator turns the seated event’s link off with a reason', async ({
    gamma,
  }) => {
    const {
      gammaSeatedEventId,
      gammaSeatedEventSlug,
      gammaSeatedEventTitle,
      gammaSeatedWebsiteUrl,
    } = ids()
    const host = hostOf(gammaSeatedWebsiteUrl)

    // On, as the world left it: the public page links to the organiser.
    await visitor.goto(`/events/${gammaSeatedEventSlug}`)
    await expect(visitor.getByRole('link', { name: LINK_LABEL, exact: true })).toBeVisible()
    expect((await probe(visitor, gammaSeatedEventSlug)).headers().location).toBe(
      gammaSeatedWebsiteUrl,
    )

    const panel = await openPanel(admin, gammaSeatedEventId)

    await expect(panel).toContainText(`Reason: ${SEATED_LINK_REASON}`)
    await panel.getByLabel(/^Reason/u).fill(OFF_REASON)
    await decide(admin, 'Turn the link off', 'The website link is off.')
    await expect(panel).toContainText(`Turned off by ${LINK_ADMIN_NAME}.`)
    await expect(panel).toContainText(`Reason: ${OFF_REASON}`)

    // Gone from the public page, and the route says so.
    await visitor.goto(`/events/${gammaSeatedEventSlug}`)
    await expect(
      visitor.getByRole('heading', { level: 1, name: gammaSeatedEventTitle, exact: true }),
    ).toBeVisible()
    await expect(visitor.getByRole('link', { name: LINK_LABEL })).toHaveCount(0)
    expect((await probe(visitor, gammaSeatedEventSlug)).status()).toBe(404)

    // The organiser reads who turned it off, and why.
    await openGuestStep(gamma, gammaSeatedEventId)

    const status = organiserStatus(gamma)

    await expect(status).toContainText(
      new RegExp(
        `Off since .+ UTC\\. ${LINK_ADMIN_NAME} of the team at The Desi Events turned it off, with this note: “${OFF_REASON}”\\. Your address is not shown on the event page\\.`,
        'u',
      ),
    )
    await expect(status).not.toContainText(host)

    // On the list it is under "Off" now.
    await admin.goto('/moderation/websites?state=off')
    await expect(listRow(admin, gammaSeatedEventTitle)).toContainText(
      `Address: ${gammaSeatedWebsiteUrl}`,
    )
  })

  test('W9: of every request through the link, only the real click was counted', async ({
    gamma,
  }) => {
    const { gammaOrganizationId, gammaGaEventId } = ids()

    expect(redirectsBefore, 'W5 read the figure before the click').not.toBeNull()

    await rollUpTrafficNow()

    const totals = await trafficTotals(gamma)

    // One click. The probes above — no fetch metadata, an image, `count=no`,
    // a prefetch, a HEAD, and the browser's own call to the lookup — none.
    expect(totals.websiteRedirects - redirectsBefore).toBe(1)
    expect(totals.websiteRedirects).toBe(1)
    expect(totals.websiteRedirectVisitors).toBe(1)

    // And the organiser's own screen says the same.
    await gamma.goto(
      `/analytics?organizationId=${gammaOrganizationId}&eventId=${gammaGaEventId}&range=7`,
    )

    const figure = gamma
      .getByRole('main')
      .locator('dl > div')
      .filter({ has: gamma.getByRole('term').filter({ hasText: /^Visits to your website$/u }) })

    await expect(figure.getByRole('definition').locator('span').first()).toHaveText('1')
  })
})

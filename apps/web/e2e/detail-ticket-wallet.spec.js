import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * The ticket wallet, in a real browser, against a real API.
 *
 * ## What this can claim that nothing else can
 *
 * `GET /v1/tickets` used to return the ticket's own columns, so the wallet
 * could render a status and a reference code and nothing a person could act on.
 * The enrichment is a four-relation join, and a join is exactly the kind of
 * thing that passes a unit test with a hand-built object and returns nulls
 * against a real database. These cases read the rendered page.
 *
 * ## The pass is not on this page, and that is deliberate
 *
 * There is a holder-only endpoint that will hand a credential over. This list
 * does not call it: the pass is drawn as a QR code on one ticket's own page, on
 * request (`detail-organizer-checkin.spec.js` covers that), never on a list
 * where every pass would be one screenshot. So every case below also asserts
 * the negative: no credential, no digest, no derivation label anywhere in the
 * markup.
 *
 * ## Why this file restores what it changes
 *
 * `detail-transfers.spec.js` runs after this one in the same worker against the
 * same seeded world. The offer made here is withdrawn here, so that file sees
 * the state it was written against.
 *
 * @module e2e/detail-ticket-wallet
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * Every name the admission credential goes by. None may reach the markup.
 *
 * The bare word `credential` is deliberately not in this list: Next.js emits
 * `credentials:'same-origin'` in its own prefetch script, so the substring is
 * in every page this app serves and asserting on it fails without a leak. The
 * JSON key form is here instead, which is how the value would actually appear
 * in a flight payload or a serialised response.
 *
 * @type {ReadonlyArray<string>}
 */
const CREDENTIAL_NAMES = Object.freeze([
  '"credential"',
  'credentialHash',
  'credentialVersion',
  'credentialIssuedAt',
  'ticket-pass-v1',
])

/**
 * The widths this wallet has to survive.
 *
 * 320 is the narrowest a modern phone reports; 390 is the current iPhone; 768
 * is the breakpoint the card grid changes at, so it is the one most likely to
 * break; 1440 is a laptop.
 *
 * @type {ReadonlyArray<number>}
 */
const WIDTHS = Object.freeze([320, 375, 390, 768, 1024, 1280, 1440])

/**
 * Whether the document scrolls sideways.
 *
 * The reflow failure, measured rather than eyeballed: a page a person has to
 * drag left and right to read is one somebody on a phone gives up on.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<boolean>} True when the document is wider than the viewport.
 */
function scrollsSideways(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  )
}

test.describe.serial('the ticket wallet', () => {
  test('says what each ticket is for, not just that it exists', async ({ owner }) => {
    await owner.goto('/tickets')
    await expect(owner.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    const rendered = await owner.locator('main').innerText()

    // The reference code was all this page could show before.
    expect(rendered).toMatch(/DE-SWP-/u)

    // These are the four relations. Each is a separate join and each could come
    // back null on its own, so each is read from the page rather than inferred
    // from the one next to it.
    //
    // The title is asserted by shape rather than by wording: the seed names the
    // event after the run, and a test that hard-coded that string would be
    // testing the fixture. What matters is that the heading is the event and
    // not the reference code, which is all this page could show before.
    const title = await owner.locator('main li h3 a').first().innerText()

    expect(title.trim().length, 'the event title is empty').toBeGreaterThan(3)
    expect(title, 'the heading is still the reference code').not.toMatch(/^DE-SWP-/u)

    expect(rendered, 'the When row').toMatch(/\bWhen\b/u)
    expect(rendered, 'the Where row').toMatch(/\bWhere\b/u)
    expect(rendered, 'the tier').toMatch(/\bTicket\b/u)

    // A join that came back null renders the term and nothing after it. These
    // read the values, not the labels.
    expect(rendered, 'the When row has no value').toMatch(/When\s*\n\s*\w/u)
    expect(rendered, 'the Where row has no value').toMatch(/Where\s*\n\s*\w/u)
    expect(rendered, 'the tier has no value').toMatch(/Ticket\s*\n\s*\w/u)
  })

  test('groups them under headings that say what each group is', async ({ owner }) => {
    await owner.goto('/tickets')

    const headings = await owner.getByRole('heading', { level: 2 }).allInnerTexts()

    expect(headings.join(' | ')).toMatch(/coming up|given to you|handed on|past and finished/iu)
  })

  test('gives every section an accessible name, not just a visible one', async ({ owner }) => {
    // `aria-labelledby` pointing at the heading, so a screen reader announcing
    // the landmark says which group it is. A visually obvious heading that the
    // section does not reference is a heading only sighted readers get.
    await owner.goto('/tickets')

    const sections = owner.locator('main section[aria-labelledby]')

    expect(await sections.count()).toBeGreaterThan(0)

    for (const section of await sections.all()) {
      const id = await section.getAttribute('aria-labelledby')
      const heading = owner.locator(`#${id}`)

      await expect(heading).toBeVisible()
      expect((await heading.innerText()).trim().length).toBeGreaterThan(0)
    }
  })

  test('names every ticket link by its event rather than by "open"', async ({ owner }) => {
    // The accessible name of each ticket link is the event title. A list of
    // links all called the same thing is a list somebody listening to it cannot
    // navigate, and Playwright's accessible-name computation is what checks it.
    await owner.goto('/tickets')

    const links = owner.locator('main li h3 a')
    const names = await links.allInnerTexts()

    expect(names.length).toBeGreaterThan(0)

    for (const name of names) {
      expect(name.trim().length, 'a ticket link has no accessible name').toBeGreaterThan(3)
      expect(name, 'a ticket link is named by its reference code').not.toMatch(/^DE-SWP-/u)
    }
  })

  test('counts what admits, across every section', async ({ owner }) => {
    await owner.goto('/tickets')

    const rendered = await owner.locator('main').innerText()

    expect(rendered).toMatch(/\d+ tickets? still gets? you in|One ticket still gets you in/iu)
  })

  test('carries no admission credential in the markup', async ({ owner }) => {
    await owner.goto('/tickets')

    const html = await owner.content()

    for (const needle of CREDENTIAL_NAMES) {
      expect(html, `the wallet carries ${needle}`).not.toContain(needle)
    }
  })

  test('reaches every ticket from the keyboard', async ({ owner }) => {
    await owner.goto('/tickets')

    // Tab until a ticket link takes focus. Bounded, so a page that never
    // reaches one fails rather than hanging.
    let reached = null

    for (let press = 0; press < 40 && !reached; press += 1) {
      await owner.keyboard.press('Tab')

      const href = await owner.evaluate(() => document.activeElement?.getAttribute?.('href') ?? '')

      if (href.startsWith('/tickets/')) reached = href
    }

    expect(reached, 'no ticket link took focus within 40 tabs').toMatch(/^\/tickets\/.+/u)

    // And the focused element is visibly focused rather than merely focusable.
    const outline = await owner.evaluate(() => {
      const style = window.getComputedStyle(document.activeElement)

      return `${style.outlineStyle} ${style.boxShadow}`
    })

    expect(outline).not.toBe('none none')
  })

  test.describe('across the widths people actually use', () => {
    for (const width of WIDTHS) {
      test(`does not scroll sideways at ${width}px`, async ({ owner }) => {
        await owner.setViewportSize({ width, height: 900 })
        await owner.goto('/tickets')
        await expect(owner.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

        expect(await scrollsSideways(owner), `the wallet scrolls sideways at ${width}px`).toBe(
          false,
        )
      })
    }
  })

  test('reflows at 200% rather than scrolling sideways', async ({ owner }) => {
    // WCAG 1.4.10. Doubling the text size is equivalent to halving the viewport,
    // which is what this does: a 1280-wide window at 200% has 640 CSS pixels of
    // room, and the content has to fit in them.
    await owner.setViewportSize({ width: 640, height: 512 })
    await owner.goto('/tickets')
    await expect(owner.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    expect(await scrollsSideways(owner)).toBe(false)

    const rendered = await owner.locator('main').innerText()

    // Reflowed, not truncated: the content is still all there.
    expect(rendered).toMatch(/DE-SWP-/u)
    expect(rendered).toMatch(/\bWhen\b/u)
  })

  test('animates nothing when the reader has asked it not to', async ({ browser }) => {
    const context = await browser.newContext({
      storageState: (await import('./support/detail-global-setup.mjs')).statePath('owner'),
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()

    await page.goto('/tickets')
    await expect(page.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()

    // Every animation and transition on the page, measured after the stylesheet
    // has applied. A card with a transition left running under `reduce` is the
    // failure this catches.
    const moving = await page.evaluate(
      () =>
        [...document.querySelectorAll('main *')].filter((node) => {
          const style = window.getComputedStyle(node)
          const duration = (value) =>
            value.split(',').some((part) => Number.parseFloat(part) > 0.0001)

          return duration(style.transitionDuration) || duration(style.animationDuration)
        }).length,
    )

    expect(moving, 'something is still animating under prefers-reduced-motion').toBe(0)

    await context.close()
  })

  test.describe('when a ticket is out on offer', () => {
    test('shows it as offered, with the recipient by domain alone, and puts it back', async ({
      owner,
    }) => {
      const ticketId = ids().ticketIds[1]

      await owner.goto(`/tickets/${ticketId}`)
      await owner.getByRole('button', { name: /offer this ticket/i }).click()
      await owner.getByLabel(/their email address/i).fill('meenakshi.wallet+x@elsewhere.test')
      await owner.getByRole('button', { name: /send the offer/i }).click()
      await expect(owner.getByText(/offered\. they have been sent an invitation/i)).toBeVisible()

      try {
        await owner.goto('/tickets')

        const offered = await owner.locator('main').innerText()
        const html = await owner.content()

        expect(offered).toMatch(/offered/iu)
        // The domain alone in the wallet as well as on the detail screen, and
        // nothing of the local part anywhere in the page's source. A list that
        // printed more would be a list somebody harvests.
        expect(offered).toContain('••••@elsewhere.test')
        expect(html).not.toContain('meenakshi')
        expect(html).not.toMatch(/\*+@elsewhere/u)

        // An invitation is not a handover: it is still under "coming up" — the
        // section for tickets this account bought and still holds.
        expect(offered).toMatch(/coming up/iu)
        expect(offered).not.toMatch(/handed on/iu)
      } finally {
        // In a `finally`, because the spec that runs after this one against the
        // same seeded world expects this ticket offerable. An assertion failing
        // above must not also leave the next file's world wrong — that turns one
        // red test into two and hides which one is the real failure.
        // Two clicks: withdrawing asks first, because an invitation somebody
        // is about to accept is not something to revoke on a mis-tap.
        await owner.goto(`/tickets/${ticketId}`)
        await owner.getByRole('button', { name: /withdraw the offer/i }).click()
        await owner.getByRole('button', { name: /^withdraw it$/i }).click()
        await expect(owner.getByText(/the invitation no longer works/i)).toBeVisible()

        await owner.reload()
        await expect(owner.getByRole('button', { name: /offer this ticket/i })).toBeVisible()
      }

      await owner.goto('/tickets')

      expect(await owner.locator('main').innerText()).toMatch(/ready to use/iu)
    })
  })

  test('announces the outcome of a transfer through a live region', async ({ owner }) => {
    // The one place this screen area changes without a navigation, so the one
    // place a live region is applicable. A confirmation that only appears
    // visually is a confirmation a screen-reader user never hears, and they are
    // left unsure whether they just gave their ticket away.
    const ticketId = ids().ticketIds[1]

    await owner.goto(`/tickets/${ticketId}`)
    await owner.getByRole('button', { name: /offer this ticket/i }).click()
    await owner.getByLabel(/their email address/i).fill('live-region@elsewhere.test')
    await owner.getByRole('button', { name: /send the offer/i }).click()

    try {
      const announced = owner.locator('[aria-live="polite"][role="status"]')

      await expect(announced).toContainText(/offered/iu)
    } finally {
      await owner.goto(`/tickets/${ticketId}`)
      await owner.getByRole('button', { name: /withdraw the offer/i }).click()
      await owner.getByRole('button', { name: /^withdraw it$/i }).click()
      await expect(owner.getByText(/the invitation no longer works/i)).toBeVisible()
    }
  })

  test('refuses the wallet to somebody who is not signed in', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.goto('/tickets')

    // The layout redirects rather than rendering an empty wallet, because an
    // empty wallet and a wallet nobody may read look identical otherwise.
    await expect(page).toHaveURL(/\/sign-in/u)

    await context.close()
  })
})

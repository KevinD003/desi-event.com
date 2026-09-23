import { expect, test, world } from './support/detail-fixtures.mjs'

/**
 * Buying a ticket, as somebody who has never been here, against the real API.
 *
 * One story, in order: find the seeded event on the listing, read its all-in
 * price, go to checkout signed out and be sent to make an account, come back,
 * hold one ticket, pay for it (simulated), and find it in the wallet and the
 * order history. Serial, and in one browser context created in `beforeAll`,
 * because the account made in the third step is the account that buys in the
 * fourth — a fresh context per test would lose the session the story is about.
 *
 * ## What this proves that the unit tests cannot
 *
 * The basket's tests mock `reserve` and `placeOrder`. So nothing else checks
 * that the figure the event page quotes, the figure the pay button names and
 * the figure the API charges are one figure; that a hold really comes off the
 * stock and a purchase really takes exactly one ticket; or that the reference
 * in the "This order" link is the one the API issued. Each of those is read
 * here from the API itself as well as from the page.
 *
 * ## What it deliberately does not claim
 *
 * That money moved. `PAYMENT_MODE` is `MOCK`; every page on the way says so,
 * and this file asserts the saying, never a charge.
 *
 * That the event page counts down. `components/ticket-tiers.jsx` shows a
 * number only at twenty-five left or fewer, and the seeded tier has a hundred,
 * so the page says "On sale" before and after — and that is asserted, because
 * a count appearing there, that far above the threshold, would be invented
 * urgency. The decrement is read from the API, and the quantity from the order
 * page.
 *
 * ## Credentials
 *
 * The password is typed into a form and posted; it must never reach an
 * address. Every URL the page navigates to is recorded and checked. The pass
 * credential must not be in the wallet's or the ticket page's markup, and the
 * order page must not print the ticket's reference code.
 *
 * ## Sign-ins
 *
 * One request to `/v1/auth/register` and none to `/v1/auth/login`: the buyer is
 * new, and the account is made by the form, which signs it in as it creates it.
 * `@fastify/rate-limit` keeps a separate per-route store for each credential
 * route, so this spends nothing from the sign-in budget global setup used.
 *
 * @module e2e/detail-checkout
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/** The seeded tier. See `support/seed-refusals.mjs`. */
const TIER = 'General admission'

/** Its face value: 100,000 paise, as the seed writes it and the pages print it. */
const FACE = '₹1,000.00'

/**
 * The count threshold in `components/ticket-tiers.jsx`. Above it the event page
 * says "On sale" and no number.
 */
const LOW_STOCK_THRESHOLD = 25

/**
 * The longest a hold may last. `TICKET_HOLD_TTL_SECONDS` defaults to 600 and
 * the detail config does not set it.
 */
const HOLD_TTL_MS = 600_000

/** Who the buyer says they are. */
const DISPLAY_NAME = 'Kavya Buyer'

/**
 * Whether a cookie is the session. `cookieNames` in `packages/auth/src/cookies.js`
 * calls it `desi_session`, with the `__Host-` prefix when cookies are secure.
 *
 * @param {{name: string}} cookie A cookie from the browser context.
 * @returns {boolean} True for the session cookie.
 */
const isSessionCookie = (cookie) => /^(?:__Host-)?desi_session$/u.test(cookie.name)

/** The buyer's password. Test-only, and it says so. At least eight characters. */
const PASSWORD = 'e2e-test-buyer-password-not-a-real-secret'

/**
 * An order reference as `generateOrderReference` issues it: `DE-` and eight of
 * the unambiguous alphabet, which has no 0, 1, I or O.
 *
 * @type {RegExp}
 */
const ORDER_REFERENCE = /^DE-[2-9A-HJ-NP-Z]{8}$/u

/**
 * A ticket code as `generateTicketCode` issues it.
 *
 * @type {RegExp}
 */
const TICKET_CODE = /^DET-[2-9A-HJ-NP-Z]{14}$/u

/** An idempotency key as `crypto.randomUUID` mints it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** A rupee amount as the pages print it, e.g. `₹1,070.99`. */
const RUPEES = /₹[\d,]+\.\d{2}/u

/**
 * Words that sell by pressure rather than by fact. None of them is backed by
 * anything the API sends, so none may appear.
 *
 * @type {RegExp}
 */
const URGENCY = /selling fast|few (?:tickets )?left|almost gone|hurry|last chance|only \d+ left/iu

/**
 * Every name the admission credential goes by. The same list as
 * `detail-ticket-wallet.spec.js`, and for the same reasons: the bare word
 * `credential` is in every Next.js page, the JSON key form is how a leak would
 * actually look.
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
 * Collapse whitespace, so text split across elements and lines compares.
 *
 * @param {string|null|undefined} text Raw text.
 * @returns {string} The text on one line.
 */
function normalise(text) {
  return String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * A printed rupee amount in paise.
 *
 * @param {string} text Text containing one amount, e.g. `₹1,070.99`.
 * @returns {number} The amount in paise.
 */
function paise(text) {
  const match = String(text).match(RUPEES)

  expect(match, `no rupee amount in "${text}"`).not.toBeNull()

  return Number(match[0].replace(/\D/gu, ''))
}

/**
 * The value beside a term in a `<dl>` of `<div><dt/><dd/></div>` rows — the
 * shape the basket summary, the wallet card and both order pages share.
 *
 * @param {object} scope A Playwright locator to look inside.
 * @param {string} term The term, exactly.
 * @returns {object} A locator for the `<dd>`.
 */
function definition(scope, term) {
  const exactly = new RegExp(`^\\s*${term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*$`, 'u')

  return scope
    .locator('dl > div')
    .filter({ has: scope.page().locator('dt').filter({ hasText: exactly }) })
    .locator('dd')
}

/**
 * A predicate matching one proxied API call, for `waitForRequest` and
 * `waitForResponse` alike.
 *
 * @param {string} method The HTTP method.
 * @param {string} path The same-origin path, e.g. `/api/v1/holds`.
 * @returns {function(object): boolean} The predicate.
 */
function isCall(method, path) {
  return (message) => {
    const request = typeof message.request === 'function' ? message.request() : message

    return request.method() === method && new URL(request.url()).pathname === path
  }
}

/**
 * The seeded tier as the API reports it, with live availability: stock less
 * sold, less every active hold.
 *
 * @param {object} request A Playwright request context.
 * @param {string} eventId The event.
 * @returns {Promise<object>} The tier row.
 */
async function liveTier(request, eventId) {
  const response = await request.get(`/api/v1/events/${eventId}/ticket-types`)

  expect(response.ok(), `ticket types answered ${response.status()}`).toBe(true)

  const { data } = await response.json()
  const tier = data.find((row) => row.name === TIER)

  expect(tier, `the API lists no "${TIER}" tier`).toBeTruthy()

  return tier
}

/**
 * Choose one ticket of the seeded tier with the stepper.
 *
 * A press that lands before the basket has hydrated reaches a server-rendered
 * button with no handler and changes nothing. So the press is repeated only
 * while the quantity still reads zero, and the wait is for the quantity to read
 * one — a stepper that added two, or none, still fails.
 *
 * @param {object} page The page.
 * @returns {Promise<void>} Resolves once one ticket is chosen.
 */
async function chooseOne(page) {
  const quantity = page.getByLabel(`Quantity of ${TIER}`)
  const add = page.getByRole('button', { name: `Add one ${TIER}` })

  await expect(quantity).toHaveValue('0')

  await expect(async () => {
    if ((await quantity.inputValue()) === '0') await add.click()

    await expect(quantity).toHaveValue('1', { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

/**
 * A page as the server sends it to this browser's session.
 *
 * The story reaches the wallet and the ticket page by following links, which
 * are client-side navigations: the React Server Components payload for them
 * is fetched and consumed, and never lands in the document that
 * `page.content()` serialises. A credential handed to a client component would
 * travel in exactly that payload. So the page is also fetched whole, with the
 * same cookies, and `expected` — something only the real page prints — proves
 * the answer was that page and not a redirect to sign in.
 *
 * @param {object} page The page whose session to use.
 * @param {string} path A same-origin path.
 * @param {string} expected Text the real page carries.
 * @returns {Promise<string>} The HTML, streamed content and inline payload included.
 */
async function serverHtml(page, path, expected) {
  const response = await page.request.get(path)

  expect(response.status(), `${path} answered ${response.status()}`).toBe(200)

  const html = await response.text()

  expect(html, `${path} did not answer with the page`).toContain(expected)

  return html
}

/**
 * Assert that a page's markup carries no admission credential.
 *
 * @param {string} html The page's markup.
 * @param {string} where What the page is, for the message.
 * @returns {void}
 */
function expectNoCredential(html, where) {
  for (const name of CREDENTIAL_NAMES) {
    expect(html, `${where} carries ${name}`).not.toContain(name)
  }
}

test.describe.serial('buying a ticket as somebody who has never been here', () => {
  /** The buyer's one browser context, kept across every step. */
  let buyerContext
  /** The buyer's one window. */
  let buyer
  /** Every address the buyer's window navigated to, in order. */
  const visited = []

  // What the story learns as it goes, for the steps after.
  let slug
  let title
  let email
  let tierId
  let availableAtStart
  let soldAtStart
  let allIn
  let fee
  let tax
  let holdId
  let reference
  let ticketCode
  let ticketId

  /**
   * Assert that no address visited so far carries the password, a cookie's
   * value, or a parameter a secret would travel in.
   *
   * @returns {Promise<void>} Resolves when checked.
   */
  async function expectNoSecretInAddresses() {
    const cookies = (await buyerContext.cookies()).map((cookie) => cookie.value)
    const secrets = [
      PASSWORD,
      encodeURIComponent(PASSWORD),
      ...cookies.filter((value) => value.length >= 16),
    ]

    for (const address of visited) {
      for (const secret of secrets) {
        expect(address, 'an address carried a secret').not.toContain(secret)
      }

      expect(address).not.toMatch(/[?&](?:password|token|secret|code)=/iu)
    }
  }

  test.beforeAll(async ({ browser }) => {
    buyerContext = await browser.newContext()
    buyer = await buyerContext.newPage()

    // Same-document navigations included, so a client-side route change that
    // put something in the query would be caught as well as a full load.
    buyer.on('framenavigated', (frame) => {
      if (frame === buyer.mainFrame()) visited.push(frame.url())
    })
  })

  test.afterAll(async () => {
    await buyerContext?.close()
  })

  test('the event is listed and priced all in, with nothing invented about how fast it sells', async ({
    visitor,
  }) => {
    const { tag, alphaEventId } = ids()

    slug = `alpha-event-${tag}`

    // What is really left, from the API, before anybody here touches it.
    const tier = await liveTier(visitor.request, alphaEventId)

    tierId = tier.id
    availableAtStart = tier.availableQuantity
    soldAtStart = tier.quantitySold

    // The page draws a number only at twenty-five or fewer. This story relies
    // on being above that, so it says so rather than assuming it.
    expect(availableAtStart).toBeGreaterThan(LOW_STOCK_THRESHOLD + 1)

    await visitor.goto(`/events?q=${encodeURIComponent(tag)}`)
    await expect(visitor.getByRole('heading', { name: 'What’s on', level: 1 })).toBeVisible()
    await expect(visitor.getByTestId('result-count')).toContainText(`matching “${tag}”`)

    const card = visitor
      .getByRole('list', { name: 'Matching events' })
      .getByRole('listitem')
      .filter({ has: visitor.locator(`a[href="/events/${slug}"]`) })

    await expect(card).toHaveCount(1)

    // A word for whether it can be bought, drawn from `salesOpen`.
    await expect(card).toContainText('Availability: On sale')
    // All in, because the API sent `minTotalCents`; "before fees" would mean
    // it had not.
    await expect(card).toContainText('including any fees and tax')

    const cardText = normalise(await card.textContent())
    const cardPrice = cardText.match(/From\s*(₹[\d,]+\.\d{2})/u)?.[1]

    expect(cardPrice, 'the card has no "from" price').toBeTruthy()
    expect(cardText).not.toMatch(URGENCY)

    await card.getByRole('link').click()
    await visitor.waitForURL((url) => url.pathname === `/events/${slug}`)

    // A client-side navigation: wait for the event's own heading rather than
    // reading whichever `h1` is in the document as the address changes.
    const heading = visitor.getByRole('heading', { level: 1 })

    await expect(heading).toContainText(tag)
    title = normalise(await heading.textContent())

    const tickets = visitor.getByRole('complementary', { name: 'Tickets' })
    const tierRow = tickets
      .getByRole('list', { name: 'Ticket types' })
      .getByRole('listitem')
      .filter({ hasText: TIER })

    await expect(tierRow).toContainText(FACE)
    await expect(tierRow).toContainText('Availability: On sale')
    await expect(tierRow).not.toContainText(/Only \d+ left/u)

    await expect(tickets.locator('p').filter({ hasText: /^From / })).toHaveText(`From ${FACE}`)

    // "₹X all in — includes ₹F booking fee and ₹T GST (18%)." The tax clause
    // is drawn only when there is tax, so it is optional here and its absence
    // is then checked against the order.
    const quote = normalise(
      await tickets.locator('p').filter({ hasText: 'all in' }).textContent(),
    ).match(
      /^(₹[\d,]+\.\d{2}) all in — includes (₹[\d,]+\.\d{2}) booking fee(?: and (₹[\d,]+\.\d{2}) [^.]+)?\.$/u,
    )

    expect(quote, 'the event page quotes no all-in price').not.toBeNull()
    ;[, allIn, fee, tax = null] = quote

    // The quote adds up, and it is the listing's figure too.
    expect(paise(allIn)).toBe(paise(FACE) + paise(fee) + (tax ? paise(tax) : 0))
    expect(allIn).toBe(cardPrice)

    await expect(tickets.getByRole('link', { name: 'Choose tickets' })).toHaveAttribute(
      'href',
      `/events/${slug}/checkout`,
    )

    // The only simulated-payment wording on the event page itself is the
    // footer's; checkout carries the full notice, asserted next.
    await expect(visitor.getByRole('contentinfo')).toContainText(
      'Payments on this site are simulated — no card, no money moves.',
    )

    expect(normalise(await visitor.getByRole('main').innerText())).not.toMatch(URGENCY)
  })

  test('at checkout a visitor is sent to sign in, and nothing on the page can take payment', async () => {
    const checkoutPath = `/events/${slug}/checkout`

    await buyer.goto(`/events/${slug}`)
    await buyer.getByRole('link', { name: 'Choose tickets' }).click()
    await buyer.waitForURL((url) => url.pathname === checkoutPath)

    await expect(buyer.getByRole('heading', { level: 1 })).toHaveText(`Tickets for ${title}`)

    const notice = buyer.getByTestId('payment-mode-notice')

    await expect(notice).toContainText('Payments on this site are simulated')
    await expect(notice).toContainText('You will not be asked for a card, no money moves')

    await expect(buyer.getByRole('button', { name: 'Select tickets to continue' })).toBeDisabled()

    await chooseOne(buyer)

    const summary = buyer.getByRole('region', { name: 'Order summary' })

    await expect(summary).toContainText(`1 ticket for ${title}`)
    // The basket prices one ticket as the event page did.
    await expect(buyer.getByTestId('summary-total')).toHaveText(allIn)

    const signIn = buyer.getByRole('link', { name: 'Sign in to buy' })

    await expect(signIn).toHaveAttribute(
      'href',
      `/sign-in?next=${encodeURIComponent(checkoutPath)}`,
    )
    await expect(buyer.getByRole('button', { name: 'Reserve tickets' })).toHaveCount(0)
    await expect(buyer.getByRole('button', { name: /^Pay / })).toHaveCount(0)

    // Choosing, signed out, held nothing: the stock is what it was.
    expect((await liveTier(buyer.request, ids().alphaEventId)).availableQuantity).toBe(
      availableAtStart,
    )

    // And nothing along the way — two pages and an API read through the proxy
    // — gave the visitor a session. The next step is where one is made.
    expect(
      (await buyerContext.cookies()).filter(isSessionCookie),
      'a visitor who has not signed in holds a session',
    ).toEqual([])

    await signIn.click()
    await buyer.waitForURL(
      (url) => url.pathname === '/sign-in' && url.searchParams.get('next') === checkoutPath,
    )
    await expect(buyer.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible()

    await buyer.getByRole('link', { name: 'Create an account' }).click()
    await buyer.waitForURL((url) => url.pathname === '/register')

    const here = new URL(buyer.url())
    const next = here.searchParams.get('next')

    // `next` carried through two pages, and still a path on this site: one
    // leading slash, not two, and resolving to this origin.
    expect(next).toBe(checkoutPath)
    expect(next).toMatch(/^\/(?![/\\])/u)
    expect(new URL(next, here).origin).toBe(here.origin)

    await expect(buyer.getByRole('heading', { name: 'Create an account', level: 1 })).toBeVisible()
    // And the way back to signing in keeps it too.
    await expect(
      buyer.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }),
    ).toHaveAttribute('href', `/sign-in?next=${encodeURIComponent(checkoutPath)}`)
  })

  test('creating an account comes back to this checkout, signed in', async () => {
    const checkoutPath = `/events/${slug}/checkout`

    // The tag marks it as this run's; the suffix keeps it new when the tag is
    // pinned with `DETAIL_E2E_TAG`, because a fixture user is never deleted and
    // a second registration of one address is answered 409.
    email = `buyer-${ids().tag.toLowerCase()}-${Date.now().toString(36)}@attendee.test`

    await buyer.getByLabel('Your name').fill(DISPLAY_NAME)
    await buyer.getByLabel('Email address').fill(email)
    await buyer.getByLabel('Password').fill(PASSWORD)

    const registered = buyer.waitForResponse(isCall('POST', '/api/v1/auth/register'))

    await buyer.getByRole('button', { name: 'Create account' }).click()

    const response = await registered

    expect(response.ok(), `registration answered ${response.status()}`).toBe(true)

    await buyer.waitForURL((url) => url.pathname === checkoutPath && url.search === '')
    await expect(buyer.getByRole('heading', { level: 1 })).toHaveText(`Tickets for ${title}`)

    // Signed in: the header names the new account, from the session the
    // server read on this request.
    await expect(buyer.getByRole('button', { name: `${DISPLAY_NAME}, account` })).toBeVisible()

    // Made by registering, which the previous step showed there was not, and
    // a cookie script cannot read.
    const sessions = (await buyerContext.cookies()).filter(isSessionCookie)

    expect(sessions, 'registering left no session cookie').toHaveLength(1)
    expect(sessions[0].httpOnly).toBe(true)

    await expectNoSecretInAddresses()
  })

  test('reserving holds one ticket off the stock for a stated time, and the pay button names the quoted total', async () => {
    const { alphaEventId } = ids()

    await expect(buyer.getByRole('button', { name: 'Select tickets to continue' })).toBeDisabled()

    await chooseOne(buyer)

    const summary = buyer.getByRole('region', { name: 'Order summary' })

    await expect(buyer.getByTestId('summary-subtotal')).toHaveText(FACE)
    await expect(definition(summary, 'Booking fee')).toHaveText(fee)
    await expect(buyer.getByTestId('summary-total')).toHaveText(allIn)
    await expect(buyer.getByRole('link', { name: 'Sign in to buy' })).toHaveCount(0)

    const held = buyer.waitForResponse(isCall('POST', '/api/v1/holds'))

    await buyer.getByRole('button', { name: 'Reserve tickets' }).click()

    const response = await held

    expect(response.ok(), `the hold answered ${response.status()}`).toBe(true)

    const { data: hold } = await response.json()

    expect(hold).toMatchObject({ ticketTypeId: tierId, quantity: 1 })

    holdId = hold.id

    // A real time limit, set by the server and no longer than it allows.
    const lapsesIn = Date.parse(hold.expiresAt) - Date.now()

    expect(lapsesIn).toBeGreaterThan(0)
    expect(lapsesIn).toBeLessThanOrEqual(HOLD_TTL_MS)

    // The page states that limit, on this browser's clock, as the basket does.
    const until = await buyer.evaluate(
      (at) => new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(new Date(at)),
      hold.expiresAt,
    )
    const heldNotice = buyer.getByRole('status').filter({ hasText: 'Tickets held' })

    await expect(heldNotice).toContainText(`Held for you until ${until}.`)
    await expect(heldNotice).toContainText(
      'Payment on this site is simulated: you will not be asked for a card, and no money moves.',
    )

    // The hold is real: the API counts it against what anybody else can buy.
    expect((await liveTier(buyer.request, alphaEventId)).availableQuantity).toBe(
      availableAtStart - 1,
    )

    await expect(buyer.getByRole('button', { name: `Pay ${allIn} (simulated)` })).toBeEnabled()

    // Nothing on the page could take a card.
    const main = buyer.getByRole('main')
    const words = normalise(await main.innerText()).toLowerCase()

    for (const phrase of ['card number', 'cvc', 'cvv', 'expiry', 'security code', 'name on card']) {
      expect(words, `the checkout mentions ${phrase}`).not.toContain(phrase)
    }

    await expect(buyer.locator('input[autocomplete^="cc-"]')).toHaveCount(0)
    await expect(
      buyer.locator(
        'input[name*="card" i], input[id*="card" i], input[name*="cvc" i], input[name*="cvv" i], input[name*="expir" i]',
      ),
    ).toHaveCount(0)
    await expect(main.locator('iframe')).toHaveCount(0)

    // The one number field is a quantity. None names an amount.
    const numbers = main.locator('input[type="number"]')

    await expect(numbers).toHaveCount(1)
    await expect(numbers).toHaveAccessibleName(`Quantity of ${TIER}`)
    await expect(
      main.locator('input[name*="price" i], input[name*="amount" i], input[name*="total" i]'),
    ).toHaveCount(0)
  })

  test('paying books the order under a reference in the API’s own pattern, and says no money moved', async () => {
    const { alphaEventId } = ids()

    const sent = buyer.waitForRequest(isCall('POST', '/api/v1/orders'))
    const answered = buyer.waitForResponse(isCall('POST', '/api/v1/orders'))

    await buyer.getByRole('button', { name: `Pay ${allIn} (simulated)` }).click()

    const request = await sent
    const response = await answered

    // What the browser sent: what to buy and which hold pays for it, under a
    // key a retry would reuse. No figure — the server prices it again.
    expect(request.headers()['idempotency-key']).toMatch(UUID)

    const body = request.postDataJSON()

    expect(Object.keys(body).sort()).toEqual([
      'buyerEmail',
      'buyerName',
      'eventId',
      'holdIds',
      'items',
    ])
    // The buyer is the signed-in account, as the server read it for the page.
    expect(body).toMatchObject({
      eventId: alphaEventId,
      buyerEmail: email,
      buyerName: DISPLAY_NAME,
      holdIds: [holdId],
      items: [{ ticketTypeId: tierId, quantity: 1 }],
    })
    expect(JSON.stringify(body)).not.toMatch(/cents|price|total|amount/iu)

    // What the API answered: paid, the quoted total, one ticket, no pass.
    expect(response.ok(), `the order answered ${response.status()}`).toBe(true)

    const { data: order } = await response.json()

    expect(order.reference).toMatch(ORDER_REFERENCE)
    expect(order.status).toBe('PAID')
    expect(order.totalCents).toBe(paise(allIn))
    expect(order.tickets).toHaveLength(1)
    expectNoCredential(JSON.stringify(order), 'the order response')

    reference = order.reference

    const booked = buyer
      .getByRole('status')
      .filter({ has: buyer.getByRole('heading', { name: 'Booked' }) })

    await expect(booked).toContainText(`Order ${reference} · 1 ticket · ${allIn}`)
    await expect(booked).toContainText(
      'The payment was simulated: no card was asked for and no money moved.',
    )
    await expect(booked.getByRole('link', { name: 'Your tickets' })).toHaveAttribute(
      'href',
      '/tickets',
    )

    const orderLink = booked.getByRole('link', { name: 'This order' })

    await expect(orderLink).toHaveAttribute('href', `/account/orders/${reference}`)
    expect(decodeURIComponent((await orderLink.getAttribute('href')).split('/').pop())).toMatch(
      ORDER_REFERENCE,
    )

    // The form is gone: there is nothing left to press twice.
    await expect(buyer.getByRole('button', { name: /^Pay / })).toHaveCount(0)
  })

  test('My tickets lists the new ticket for this event, and neither page carries its pass', async () => {
    // Never fetched from this window. The case only checks the pass is
    // offered — from the wallet card and on the ticket page — but a pass is a
    // bearer credential and a failure screenshot of either page must not be
    // able to hold one, so any pass request is answered here, before either
    // page is opened, and never reaches the API (see
    // lib/e2e-pass-hygiene.test.js).
    await buyer.route('**/api/v1/tickets/*/pass', (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    )

    await buyer
      .getByRole('status')
      .filter({ has: buyer.getByRole('heading', { name: 'Booked' }) })
      .getByRole('link', { name: 'Your tickets' })
      .click()
    await buyer.waitForURL((url) => url.pathname === '/tickets')

    await expect(buyer.getByRole('heading', { name: 'My tickets', level: 1 })).toBeVisible()
    // A new account holding exactly what it just bought.
    await expect(buyer.getByText('One ticket still gets you in.')).toBeVisible()

    const card = buyer
      .getByRole('region', { name: 'Coming up' })
      .getByRole('listitem')
      .filter({ hasText: reference })

    await expect(card).toHaveCount(1)
    // Exact: the card's other link, to the pass, carries the title too.
    await expect(card.getByRole('link', { name: title, exact: true })).toBeVisible()
    await expect(card).toContainText('Ready to use')
    // A ticket that admits offers its pass from the card as a plain link to
    // the ticket page's pass section, which still draws nothing until asked.
    await expect(
      card.getByRole('link', { name: `Show my entry pass for ${title}`, exact: true }),
    ).toHaveAttribute('href', /^\/tickets\/[^/#]+#entry-pass$/u)
    await expect(definition(card, 'Ticket')).toHaveText(TIER)
    await expect(definition(card, 'Order')).toHaveText(reference)

    ticketCode = normalise(await definition(card, 'Reference').textContent())
    expect(ticketCode).toMatch(TICKET_CODE)

    expectNoCredential(await buyer.content(), 'the wallet')
    expectNoCredential(await serverHtml(buyer, '/tickets', ticketCode), 'the wallet as served')

    await card.getByRole('link', { name: title, exact: true }).click()
    await buyer.waitForURL((url) => /^\/tickets\/[^/]+$/u.test(url.pathname))

    ticketId = decodeURIComponent(new URL(buyer.url()).pathname.split('/').pop())

    const main = buyer.getByRole('main')

    await expect(buyer.getByRole('heading', { name: title, level: 1 })).toBeVisible()
    await expect(main).toContainText('Admits. Ready to use.')
    await expect(definition(main, 'Reference')).toHaveText(ticketCode)
    // Offered to the holder, and only on request: not drawn until pressed.
    await expect(buyer.getByRole('button', { name: 'Show my entry pass' })).toBeVisible()

    expectNoCredential(await buyer.content(), 'the ticket page')
    expectNoCredential(
      await serverHtml(buyer, `/tickets/${encodeURIComponent(ticketId)}`, ticketCode),
      'the ticket page as served',
    )
  })

  test('Your orders lists the order, and its page adds up to what the pay button said', async () => {
    await buyer.goto('/account/orders')

    const main = buyer.getByRole('main')

    await expect(buyer.getByRole('heading', { name: 'Your orders', level: 1 })).toBeVisible()
    await expect(main).toContainText(
      'Payments on this site are simulated. No card was charged and no money moved for any order here',
    )
    await expect(buyer.getByText('One order, newest first.')).toBeVisible()

    const card = main.getByRole('listitem').filter({ hasText: reference })
    const link = card.getByRole('link', { name: title })

    await expect(card).toHaveCount(1)
    await expect(link).toHaveAttribute('href', `/account/orders/${reference}`)
    await expect(card).toContainText('Paid — simulated')
    await expect(definition(card, 'Reference')).toHaveText(reference)
    await expect(definition(card, 'Tickets')).toHaveText('1')
    await expect(definition(card, 'Total')).toHaveText(allIn)

    await link.click()
    await buyer.waitForURL((url) => url.pathname === `/account/orders/${reference}`)

    await expect(buyer.getByRole('heading', { name: title, level: 1 })).toBeVisible()

    const facts = buyer.getByRole('region', { name: 'The order' })

    await expect(definition(facts, 'Reference')).toHaveText(reference)
    await expect(definition(facts, 'Status')).toContainText('Paid — simulated')

    // One line, of one ticket, at face value: the quantity bought.
    const money = buyer.getByRole('region', { name: 'What it cost' })
    const lines = money.getByRole('listitem')

    await expect(lines).toHaveCount(1)
    await expect(lines).toContainText(`Ticket, 1 × ${FACE}`)

    await expect(definition(money, 'Subtotal')).toHaveText(FACE)
    await expect(definition(money, 'Booking fee')).toHaveText(fee)
    await expect(definition(money, 'Tax')).toHaveCount(tax ? 1 : 0)
    await expect(definition(money, 'Total')).toHaveText(allIn)

    const taxShown = tax ? normalise(await definition(money, 'Tax').textContent()) : null

    expect(taxShown).toBe(tax)
    // The columns add up to the total, which is the figure the button named.
    expect(paise(FACE) + paise(fee) + (taxShown ? paise(taxShown) : 0)).toBe(paise(allIn))

    await expect(money).toContainText('Simulated payment — no card was charged and no money moved.')

    const onOrder = buyer.getByRole('region', { name: 'Tickets on this order' })

    await expect(onOrder.getByRole('link', { name: 'Ticket 1 of 1' })).toHaveAttribute(
      'href',
      `/tickets/${ticketId}`,
    )
    await expect(onOrder).toContainText('Ready to use')

    // The payload carries each ticket's code; the page never prints it.
    const html = await buyer.content()

    expect(html).not.toContain(ticketCode)
    expectNoCredential(html, 'the order page')
  })

  test('the stock went down by exactly the one ticket bought, and the event page still invents no count', async () => {
    const tier = await liveTier(buyer.request, ids().alphaEventId)

    // Sold once, and the hold that paid for it no longer counted as well.
    expect(tier.quantitySold).toBe(soldAtStart + 1)
    expect(tier.availableQuantity).toBe(availableAtStart - 1)

    await buyer.goto(`/events/${slug}`)

    const tierRow = buyer
      .getByRole('complementary', { name: 'Tickets' })
      .getByRole('list', { name: 'Ticket types' })
      .getByRole('listitem')
      .filter({ hasText: TIER })

    // Still above the threshold, so still a word and not a number.
    await expect(tierRow).toContainText('Availability: On sale')
    await expect(tierRow).not.toContainText(/Only \d+ left/u)
    expect(normalise(await buyer.getByRole('main').innerText())).not.toMatch(URGENCY)
  })

  test('no address the buyer’s window visited carried the password or the session', async () => {
    // The recorder saw the journey, so an empty or partial record cannot pass
    // for a clean one.
    const paths = visited.map((address) => new URL(address).pathname)

    for (const path of ['/sign-in', '/register', `/events/${slug}/checkout`, '/tickets']) {
      expect(paths, `the journey never reached ${path}`).toContain(path)
    }

    await expectNoSecretInAddresses()
  })
})

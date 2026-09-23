import { issueTicketCredential } from '../../api/src/lib/ticket-credentials.js'
import { expect, test, world } from './support/detail-fixtures.mjs'
import { AUTH_SECRET, TOTP_SECRET } from './support/seed-refusals.mjs'

/**
 * The attendee's own pages, read as the person they belong to and as three
 * people they do not.
 *
 * ## What this proves that the page tests cannot
 *
 * The unit tests beside `app/account/**` render each page against a mocked
 * `callApi`, which makes them good at words and silent about whose data comes
 * back. Everything here is read from the real API over the real database:
 *
 *   - the account rail offers six pages and each one it offers opens, reached
 *     by clicking rather than by typing an address;
 *   - the seeded order is listed for the account that placed it, with the
 *     status word, the lines, the sums and the tickets the page draws from the
 *     API's payload, and with no ticket code, no ticket pass and no buyer
 *     address in the markup;
 *   - the same reference opened by somebody else — another organisation's
 *     owner, an attendee, and a VIEWER of the very organisation that sold it —
 *     reads exactly as a reference nobody ever used, because a difference
 *     would let anybody find out which references are real;
 *   - the transfers page is built from the wallet, so an offer made on a
 *     ticket appears there, by domain alone, and goes when it is withdrawn;
 *   - the security page marks the session in use, shows no second-factor
 *     secret, and the password form's refusal is the API's own sentence;
 *   - the privacy and limitations pages name what this build cannot do in the
 *     recorded words, and a signed-out visitor is sent to sign in carrying the
 *     page they asked for.
 *
 * ## Why a literal `..` is not one of the malformed references
 *
 * A browser resolves `..` and `%2e%2e` as dot segments before the request
 * leaves it, so `/account/orders/..` arrives as `/account/`: no browser can
 * hand the order page that reference. `lib/account-api.test.js` holds
 * `getMyOrder` to refusing `.`, `..` and `%2e%2e` without a request. This file
 * uses the malformed shapes a browser does deliver, including a climb whose
 * slashes are encoded once — the one shape that becomes `../../…` inside the
 * page, because Next.js decodes a dynamic segment once before handing it over.
 *
 * What a browser cannot see is whether a request was made: the API answers a
 * malformed reference with the same 400 the page's own shape check raises, on
 * purpose, so both read alike. What it can see is a climb that got through —
 * see the malformed-reference case for how.
 *
 * ## What this file changes, and puts back
 *
 * One thing: an offer on the second seeded ticket, withdrawn before the test
 * ends and in a `finally` if an assertion fails first. `detail-ticket-wallet`
 * and `detail-transfers` run later in the same worker against the same world
 * and expect that ticket offerable. The password form is sent a wrong current
 * password, which the API refuses without changing anything; nobody is signed
 * in from here, because the credential budget is spent in global setup.
 *
 * @module e2e/detail-account
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
 * The run's four-character suffix, as the seeds put it into order references.
 *
 * @returns {string} Upper-cased, as the references carry it.
 */
const suffix = () => ids().tag.slice(-4).toUpperCase()

/**
 * The door order's reference.
 *
 * `seedDoor` returns the order's id and not its reference, so this repeats the
 * seed's own derivation.
 *
 * @returns {string} Something like `DE-DOORAB12`.
 */
const doorReference = () => `DE-DOOR${suffix()}`

/**
 * A reference shaped like a real one that no order carries.
 *
 * Well formed, so the API answers it with a 404 rather than refusing its shape:
 * the comparison below is between "not yours" and "does not exist", not
 * between either of those and "malformed".
 *
 * @returns {string} Something like `DE-NOSUCHAB12`.
 */
const missingReference = () => `DE-NOSUCH${suffix()}`

/**
 * The seeded event's title, as `seed-refusals.mjs` writes it.
 *
 * @returns {string} The title.
 */
const eventTitle = () => `Alpha's Evening ${ids().tag}`

/**
 * The account rail, the six entries `accountItems` offers, and the heading
 * each page opens with.
 *
 * Listed in the rail's order, which is the order a person reads them in.
 *
 * @type {ReadonlyArray<{label: string, path: string, heading: string}>}
 */
const ACCOUNT_PAGES = Object.freeze([
  { label: 'Overview', path: '/account', heading: 'Your account' },
  { label: 'My tickets', path: '/tickets', heading: 'My tickets' },
  { label: 'Orders', path: '/account/orders', heading: 'Your orders' },
  { label: 'Transfers', path: '/account/transfers', heading: 'Transfers' },
  { label: 'Security', path: '/account/security', heading: 'Account security' },
  { label: 'Privacy', path: '/account/privacy', heading: 'Privacy' },
])

/**
 * Every limitation the public page lists, with its recorded status, in order.
 *
 * Written out here rather than imported from `lib/limitations.js`: a test that
 * read the page's own table would agree with whatever the table said.
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

/** Where the offer in the transfers case is addressed. Fictional, on a `.test` domain. */
const RECIPIENT = 'kavya.account+offer@elsewhere.test'

/** The account rail's name, from `AccountShell`. */
const RAIL_NAME = 'Your account'

/**
 * The account rail on the page.
 *
 * @param {object} page The Playwright page.
 * @returns {object} A locator for the rail's navigation landmark.
 */
function rail(page) {
  return page.getByRole('navigation', { name: RAIL_NAME, exact: true })
}

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
 * A titled section of the page, by its heading.
 *
 * Every section on these pages is a `<section aria-labelledby>`, which is a
 * region landmark named by its heading.
 *
 * @param {object} page The Playwright page.
 * @param {string} name The heading's words, exactly.
 * @returns {object} A locator for the region.
 */
function region(page, name) {
  return page.getByRole('region', { name, exact: true })
}

/**
 * The term and value pairs of one description list, in order.
 *
 * Read from the DOM rather than from `innerText`, so what is asserted is which
 * value sits against which term, not how a browser lays out a flex row.
 *
 * @param {object} list A locator for one `<dl>`.
 * @returns {Promise<Array<Array<string>>>} The pairs, each a term and its value.
 */
function pairsOf(list) {
  return list.evaluate((dl) =>
    [...dl.querySelectorAll(':scope > div')].map((row) => [
      (row.querySelector('dt')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      (row.querySelector('dd')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
    ]),
  )
}

/**
 * The polite status region that says a given thing.
 *
 * Every alert on these pages is `role="status"`, and a page can hold several,
 * so one is always picked out by its words.
 *
 * @param {object} page The Playwright page.
 * @param {string} words What it says.
 * @returns {object} A locator for the region.
 */
function statusSaying(page, words) {
  return page.getByRole('status').filter({ hasText: words })
}

/**
 * Withdraw the outstanding offer on the ticket page that is open.
 *
 * Two presses, because the page asks first.
 *
 * @param {object} page The Playwright page, on a ticket's own page.
 * @returns {Promise<void>} Resolves once the page says it is withdrawn.
 */
async function withdrawOffer(page) {
  await page.getByRole('button', { name: 'Withdraw the offer', exact: true }).click()
  await page.getByRole('button', { name: 'Withdraw it', exact: true }).click()
  await expect(statusSaying(page, 'Withdrawn. The invitation no longer works.')).toBeVisible()
}

/**
 * The session cookie this window is signed in with.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<string>} Its value.
 */
async function sessionCookie(page) {
  const cookies = await page.context().cookies()
  const session = cookies.find((cookie) => /^(__Host-)?desi_session$/u.test(cookie.name))

  expect(session, 'the saved state carries no session cookie').toBeTruthy()

  return session.value
}

test.describe('the account rail', () => {
  test('offers the six account pages, and each one it offers opens', async ({ owner }) => {
    await owner.goto('/account')
    await expect(pageHeading(owner, 'Your account')).toBeVisible()

    // Exactly these, in this order: a missing entry is a page nobody can reach
    // without typing its address, and an extra one is a door somebody added
    // without deciding it belonged here.
    await expect(rail(owner).getByRole('link')).toHaveText(
      ACCOUNT_PAGES.map((entry) => entry.label),
    )

    // Round the rail and back to where it started, by clicking. A link that
    // pointed at the wrong page, or a page whose heading had drifted from the
    // rail's word for it, fails here.
    for (const entry of [...ACCOUNT_PAGES.slice(1), ACCOUNT_PAGES[0]]) {
      await rail(owner).getByRole('link', { name: entry.label, exact: true }).click()

      await expect(owner).toHaveURL((url) => url.pathname === entry.path && url.search === '')
      await expect(pageHeading(owner, entry.heading)).toBeVisible()
      // Marked as where you are, for somebody listening as well as looking.
      await expect(
        rail(owner).getByRole('link', { name: entry.label, exact: true }),
      ).toHaveAttribute('aria-current', 'page')
    }
  })

  test('the overview is the signed-in account, read from the API', async ({ owner, holder }) => {
    await owner.goto('/account')
    await expect(pageHeading(owner, 'Your account')).toBeVisible()

    expect(Object.fromEntries(await pairsOf(region(owner, 'Signed in as').locator('dl')))).toEqual({
      Name: 'Alpha Collective Owner',
      'Email address': ids().alphaOwnerEmail,
      'Two-step sign-in': 'On — signing in asks for a code as well as your password.',
    })
    // An owner runs an organisation, so the workspace is one of the places to go.
    await expect(
      region(owner, 'Where to go').getByRole('link', { name: /^Workspace/u }),
    ).toHaveAttribute('href', '/organizer')

    // Somebody who has only bought tickets: no second factor, and no
    // workspace, because they belong to no organisation.
    await holder.goto('/account')
    await expect(pageHeading(holder, 'Your account')).toBeVisible()

    expect(Object.fromEntries(await pairsOf(region(holder, 'Signed in as').locator('dl')))).toEqual(
      {
        Name: 'Asha Door',
        'Email address': ids().holderEmail,
        'Two-step sign-in': 'Off.',
      },
    )
    await expect(region(holder, 'Where to go').getByRole('link')).toHaveCount(5)
    await expect(
      region(holder, 'Where to go').getByRole('link', { name: /^Workspace/u }),
    ).toHaveCount(0)
  })
})

test.describe('orders', () => {
  test('lists the seeded order by its reference, its status and its total', async ({ owner }) => {
    const reference = ids().orderReference

    await owner.goto('/account/orders')
    await expect(pageHeading(owner, 'Your orders')).toBeVisible()

    // Said once near the top, in a full sentence, whatever each status says.
    await expect(
      owner.getByText('Payments on this site are simulated.', { exact: true }),
    ).toBeVisible()

    const card = owner.locator('main li').filter({ hasText: reference })

    await expect(card).toHaveCount(1)
    await expect(card.getByRole('heading', { level: 2 })).toHaveText(eventTitle())
    await expect(card).toContainText('Paid — simulated')
    // A paid order never "succeeded": the only status word is the simulated one.
    await expect(card).not.toContainText(/succeeded/iu)

    expect(Object.fromEntries(await pairsOf(card.locator('dl')))).toEqual({
      When: expect.stringMatching(/\d/u),
      Reference: reference,
      Tickets: '2',
      Total: '₹2,000.00',
    })

    // The API lists by the account that placed the order. The holder's door
    // order is for the same event and must not be here.
    await expect(owner.locator('main')).not.toContainText(doorReference())

    // `GET /v1/orders` returns the buyer's address with each order; the list
    // never draws it.
    expect(await owner.content()).not.toContain(`holder-${ids().tag}@attendee.test`)
  })

  test('opens the order: its lines, its sums and the tickets it gave', async ({ owner }) => {
    const { orderReference: reference, ticketIds, tag } = ids()

    await owner.goto('/account/orders')

    const card = owner.locator('main li').filter({ hasText: reference })

    await card.getByRole('link', { name: eventTitle(), exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === `/account/orders/${reference}`)
    await expect(pageHeading(owner, eventTitle())).toBeVisible()
    await expect(
      owner.getByRole('navigation', { name: 'Breadcrumb' }).locator('[aria-current="page"]'),
    ).toHaveText(reference)

    expect(Object.fromEntries(await pairsOf(region(owner, 'The order').locator('dl')))).toEqual({
      Reference: reference,
      Status: 'Paid — simulated',
      Placed: expect.stringMatching(/\d/u),
      Paid: expect.stringMatching(/\d/u),
    })

    const money = region(owner, 'What it cost')

    // A line reads "Tickets, 2 × ₹1,000.00" and its subtotal: no tier name,
    // because the payload carries none.
    const lines = await money
      .locator('ul > li')
      .evaluateAll((items) =>
        items.map((item) =>
          [...item.children].map((part) => part.textContent.replace(/\s+/gu, ' ').trim()),
        ),
      )

    expect(lines).toEqual([['Tickets, 2 × ₹1,000.00', '₹2,000.00']])

    // Discount and tax are drawn only when there is one; the booking fee always
    // is. Exactly these three rows, so a zero tax line appearing, or the fee
    // line going, is a failure.
    expect(await pairsOf(money.locator('dl'))).toEqual([
      ['Subtotal', '₹2,000.00'],
      ['Booking fee', '₹0.00'],
      ['Total', '₹2,000.00'],
    ])
    await expect(money).toContainText('Simulated payment — no card was charged and no money moved.')

    const tickets = region(owner, 'Tickets on this order')
    const links = tickets.getByRole('link', { name: /^Ticket \d of 2$/u })

    await expect(links).toHaveCount(2)

    const hrefs = await links.evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')))

    // The account's own tickets, each linked to its own page.
    expect([...hrefs].sort()).toEqual(ticketIds.map((id) => `/tickets/${id}`).sort())

    for (const row of await tickets.getByRole('listitem').all()) {
      await expect(row).toContainText('Ready to use')
    }

    await expect(tickets).toContainText(
      'Open a ticket to show its pass at the door or, unless it is for a reserved seat, to hand it on.',
    )

    // The payload carries each ticket's code and the buyer's address; the page
    // draws neither. A list of every code on an order is every pass on it.
    const html = await owner.content()

    expect(html, 'a ticket code is in the order page').not.toContain(`DE-SWP-${tag}-`)
    expect(html, 'the buyer address is in the order page').not.toContain(
      `holder-${tag}@attendee.test`,
    )

    for (const needle of ['credentialHash', 'ticket-pass-v1']) {
      expect(html, `the order page carries ${needle}`).not.toContain(needle)
    }

    // And the link opens: the ticket is this account's, so its page is the
    // event's and not "Not for you".
    await links.first().click()
    await expect(owner).toHaveURL((url) => hrefs.includes(url.pathname))
    await expect(pageHeading(owner, eventTitle())).toBeVisible()
  })

  test('the holder’s orders are theirs, and only theirs', async ({ holder }) => {
    const { doorCodes, doorTicketIds, orderReference } = ids()
    const reference = doorReference()

    await holder.goto('/account/orders')
    await expect(pageHeading(holder, 'Your orders')).toBeVisible()

    const card = holder.locator('main li').filter({ hasText: reference })

    await expect(card).toHaveCount(1)
    await expect(card).toContainText('Paid — simulated')
    expect(Object.fromEntries(await pairsOf(card.locator('dl')))).toMatchObject({
      Reference: reference,
      Tickets: '6',
      Total: '₹6,000.00',
    })
    await expect(holder.locator('main')).not.toContainText(orderReference)

    await card.getByRole('link', { name: eventTitle(), exact: true }).click()
    await expect(holder).toHaveURL((url) => url.pathname === `/account/orders/${reference}`)

    const money = region(holder, 'What it cost')
    const firstLine = money.locator('ul > li').first()

    await expect(firstLine).toContainText('Tickets, 6 × ₹1,000.00')
    await expect(firstLine).toContainText('₹6,000.00')

    const links = region(holder, 'Tickets on this order').getByRole('link', {
      name: /^Ticket \d of 6$/u,
    })

    await expect(links).toHaveCount(6)

    const hrefs = await links.evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')))

    expect([...hrefs].sort()).toEqual(doorTicketIds.map((id) => `/tickets/${id}`).sort())

    const html = await holder.content()

    for (const code of doorCodes) {
      expect(html, `the door ticket code ${code} is in the order page`).not.toContain(code)
    }

    // Unlike the owner's, these tickets were issued with a pass. Each pass is
    // derived again here exactly as the seed issued it, and neither the pass
    // nor its digest may be anywhere in the page's source. Compared as a
    // boolean, so a failure names the ticket without printing its pass.
    for (const [index, ticketId] of doorTicketIds.entries()) {
      const { credential, credentialHash } = issueTicketCredential({
        secret: AUTH_SECRET,
        ticketId,
        version: 1,
      })

      expect(html.includes(credential), `the pass of ticket ${index + 1} is in the page`).toBe(
        false,
      )
      expect(
        html.includes(credentialHash),
        `the pass digest of ticket ${index + 1} is in the page`,
      ).toBe(false)
    }

    for (const needle of ['credentialHash', 'ticket-pass-v1']) {
      expect(html, `the order page carries ${needle}`).not.toContain(needle)
    }
  })

  test('somebody else’s order reads exactly as one that does not exist', async ({
    outsider,
    holder,
    viewer,
  }) => {
    const reference = ids().orderReference

    // Three different refusals behind one sentence. The outsider and the
    // holder are refused by the API (403). The VIEWER holds `order:view` in
    // the organisation that sold the order, so the API answers — without the
    // buyer's address — and the page declines to draw an organiser's read as
    // one of "your orders". The imaginary reference is a 404.
    for (const [who, page] of [
      ['another organisation’s owner', outsider],
      ['an attendee who did not buy it', holder],
      ['a VIEWER of the selling organisation', viewer],
    ]) {
      await page.goto(`/account/orders/${reference}`)
      await expect(pageHeading(page, 'Order not found'), who).toBeVisible()

      const theirs = await page.locator('main').innerText()

      await page.goto(`/account/orders/${missingReference()}`)
      await expect(pageHeading(page, 'Order not found'), who).toBeVisible()

      const imaginary = await page.locator('main').innerText()

      expect(theirs, `${who} can tell a real reference from an imaginary one`).toBe(imaginary)
      expect(theirs).toContain('There is no order with that reference on this account.')

      // It takes nothing from the request, so it cannot echo the reference,
      // and it shows nothing of the order.
      expect(theirs).not.toContain(reference)
      expect(theirs).not.toContain(eventTitle())
      expect(theirs).not.toContain('₹')
    }
  })

  test('a malformed reference gets the same answer and reaches nothing else', async ({ owner }) => {
    await owner.goto(`/account/orders/${missingReference()}`)
    await expect(pageHeading(owner, 'Order not found')).toBeVisible()

    const missing = await owner.locator('main').innerText()

    // `...` is three dots, which no browser collapses into a parent. It holds
    // the wording: the page's own shape refusal must read as the API's 400
    // does. It cannot show whether a request was made, because the API would
    // refuse it with the same 400.
    //
    // `..%2F..%2Fhealth` is one segment to the browser, and Next.js decodes a
    // dynamic segment once (`decodeURIComponent` in its route matcher), so the
    // page is handed `../../health`. Refused by its shape, it reads as above.
    // A page that let it through unencoded would ask for
    // `/v1/orders/../../health`, which resolves to the API's own `/health`:
    // that answers 200 with no `data`, and the page would draw its refusal
    // under an "Order" heading rather than this one. A climb that reached
    // `/v1/auth/me` instead would not show — that payload has no buyer
    // address, so the page would still say "not found" — which is why the
    // climb goes to `/health`.
    for (const malformed of ['...', '..%2F..%2Fhealth']) {
      await owner.goto(`/account/orders/${malformed}`)
      await expect(pageHeading(owner, 'Order not found'), malformed).toBeVisible()

      expect(await owner.locator('main').innerText(), malformed).toBe(missing)
    }
  })
})

test.describe('transfers', () => {
  test('says what the seeded tickets produce: nothing offered, given or handed on', async ({
    owner,
  }) => {
    await owner.goto('/account/transfers')
    await expect(pageHeading(owner, 'Transfers')).toBeVisible()

    // Both seeded tickets were bought by this account and are still held by
    // it, so the wallet has nothing for any section of this page.
    await expect(owner.getByText('Nothing handed on or received', { exact: true })).toBeVisible()
    await expect(
      owner.getByText(
        'You have no offers waiting for an answer, you have not handed a ticket on, and nobody has handed you one that still gets you in.',
        { exact: true },
      ),
    ).toBeVisible()

    for (const absent of ['Offers you have made', 'Given to you', 'Handed on']) {
      await expect(region(owner, absent), absent).toHaveCount(0)
    }

    // The code is never the sender's, and nothing emails it: said as it is.
    const accept = region(owner, 'Accept a ticket')

    await expect(accept.locator('p')).toHaveText(
      'An offer is accepted with the invitation code issued with it. The person who made the offer never sees that code, and this site delivers no email, so it does not arrive on its own. If you have one, enter the code to accept the ticket.',
    )
    await expect(
      accept.getByRole('link', { name: 'enter the code to accept the ticket', exact: true }),
    ).toHaveAttribute('href', '/tickets/accept')

    await expect(region(owner, 'Reserved seats').locator('p')).toHaveText(
      'Tickets for reserved seats cannot be handed on. An offer for one is refused, and the ticket stays with you.',
    )
  })

  test('an offer made on a ticket is listed, by domain alone, until it is withdrawn', async ({
    owner,
  }) => {
    const ticketId = ids().ticketIds[1]

    await owner.goto(`/tickets/${ticketId}`)
    await owner.getByRole('button', { name: 'Offer this ticket to somebody', exact: true }).click()
    await owner.getByLabel(/^Their email address/u).fill(RECIPIENT)
    await owner.getByRole('button', { name: 'Send the offer', exact: true }).click()
    await expect(statusSaying(owner, 'Offered. The invitation is recorded')).toBeVisible()

    let withdrawn = false

    try {
      await rail(owner).getByRole('link', { name: 'Transfers', exact: true }).click()
      await expect(pageHeading(owner, 'Transfers')).toBeVisible()

      const offers = region(owner, 'Offers you have made')
      const card = offers.getByRole('listitem')

      await expect(card).toHaveCount(1)
      await expect(card.getByRole('heading', { level: 3 })).toHaveText(eventTitle())
      await expect(card).toContainText('Offered — still yours until they accept')

      expect(Object.fromEntries(await pairsOf(card.locator('dl')))).toEqual({
        When: expect.stringMatching(/\d/u),
        Ticket: 'General admission',
        'Offered to': '••••@elsewhere.test',
        'Open until': expect.stringMatching(/\d/u),
      })
      await expect(card).toContainText(
        'The ticket is still yours, and still gets you in, until they accept.',
      )

      // One ticket, one card: the offered ticket is not counted again anywhere.
      await expect(owner.getByText('Nothing handed on or received', { exact: true })).toHaveCount(0)

      // Nothing of the local part, anywhere in the source.
      const html = await owner.content()

      expect(html).not.toContain('kavya')
      expect(html).not.toContain('+offer')

      // The one action is the ticket's own page, where the offer is withdrawn.
      await card.getByRole('link', { name: 'Withdraw or view this offer', exact: true }).click()
      await expect(owner).toHaveURL((url) => url.pathname === `/tickets/${ticketId}`)
      await withdrawOffer(owner)
      withdrawn = true
    } finally {
      // The two specs after this one expect this ticket offerable. An
      // assertion failing above must not also break their world.
      if (!withdrawn) {
        await owner.goto(`/tickets/${ticketId}`)
        await withdrawOffer(owner)
      }
    }

    await owner.goto('/account/transfers')
    await expect(owner.getByText('Nothing handed on or received', { exact: true })).toBeVisible()
    await expect(region(owner, 'Offers you have made')).toHaveCount(0)
  })
})

test.describe('security', () => {
  test('marks the session in use, and shows no second-factor secret', async ({ owner }) => {
    await owner.goto('/account/security')
    await expect(pageHeading(owner, 'Account security')).toBeVisible()

    // The owner enrolled a factor in the seed, and the page says so from
    // `GET /v1/auth/mfa` rather than offering to set one up.
    const twoStep = region(owner, 'Two-step sign-in')

    await expect(twoStep).toContainText(
      'On. Signing in asks for a code from your authenticator app as well as your password.',
    )
    await expect(
      twoStep.getByRole('button', { name: 'Turn off two-step sign-in', exact: true }),
    ).toBeVisible()
    await expect(twoStep.getByRole('button', { name: 'Set up two-step sign-in' })).toHaveCount(0)

    // The secret and the recovery codes exist only in the moments after
    // enrolment. On load there is neither, nor the QR code that carries one.
    await expect(
      owner.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toHaveCount(0)
    await expect(owner.getByRole('heading', { name: 'Save your recovery codes now' })).toHaveCount(
      0,
    )

    const html = await owner.content()

    expect(html, 'the TOTP secret is in the page').not.toContain(TOTP_SECRET)
    expect(html, 'the grouped TOTP secret is in the page').not.toContain(
      TOTP_SECRET.match(/.{1,4}/gu)
        .slice(0, 2)
        .join(' '),
    )
    expect(html, 'a provisioning URI is in the page').not.toContain('otpauth:')

    // The session this window is using, marked as such, once — and offered as
    // signing out rather than as revoking somebody else.
    const sessions = region(owner, 'Sessions')
    const current = sessions.getByRole('listitem').filter({ hasText: 'This session' })

    await expect(current).toHaveCount(1)
    await expect(current).toContainText(/Signed in .+ · last used .+/u)
    await expect(current.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
    await expect(current.getByRole('button', { name: /^Sign out of /u })).toHaveCount(0)

    // No token: not the cookie this window is signed in with, in the markup or
    // the address.
    const token = await sessionCookie(owner)

    expect(html, 'the session token is in the page').not.toContain(token)
    expect(owner.url()).not.toContain(token)
  })

  test('the password form keeps its fields out of the address, and the refusal is the API’s', async ({
    owner,
  }) => {
    const wrong = 'not-this-accounts-password'
    const replacement = 'a-new-password-never-applied'

    await owner.goto('/account/security')
    await expect(pageHeading(owner, 'Account security')).toBeVisible()

    const form = region(owner, 'Password').locator('form')

    // Every field is a password field with no `name`. The form declares no
    // method, so a submission made before the script loads is a native GET to
    // this page — and an unnamed field is not serialised into one.
    await expect(form.locator('input')).toHaveCount(3)
    await expect(form.locator('input:not([type="password"])')).toHaveCount(0)
    await expect(form.locator('input[name]')).toHaveCount(0)

    const current = form.getByLabel(/^Current password/u)
    const fresh = form.getByLabel(/^New password(?! again)/u)
    const again = form.getByLabel(/^New password again/u)
    const submit = form.getByRole('button', { name: 'Change password', exact: true })

    // Waited for rather than assumed: the length rule is drawn by the form's
    // own state, so seeing it means the form is hydrated and a press will be
    // handled by it rather than by the browser.
    await expect(async () => {
      await fresh.fill('')
      await fresh.fill('short')
      await expect(form.getByText('Use at least 8 characters.', { exact: true })).toBeVisible({
        timeout: 1_000,
      })
    }).toPass({ timeout: 15_000 })
    await expect(submit).toBeDisabled()

    await fresh.fill(replacement)
    await again.fill(replacement)
    await current.fill(wrong)
    await expect(submit).toBeEnabled()
    await submit.click()

    // The API checks the current password even for a signed-in caller, and
    // its own sentence is what the form shows.
    const refusal = statusSaying(owner, 'That is not your current password.')

    await expect(refusal).toBeVisible()
    await expect(refusal).toContainText('That did not work')
    await expect(statusSaying(owner, 'Password changed')).toHaveCount(0)

    const url = new URL(owner.url())

    expect(url.pathname).toBe('/account/security')
    expect(url.search).toBe('')
    expect(owner.url()).not.toContain(wrong)
    expect(owner.url()).not.toContain(replacement)
  })
})

test.describe('what this build cannot do', () => {
  test('the privacy page names the missing capabilities as missing', async ({ owner }) => {
    await owner.goto('/account/privacy')
    await expect(pageHeading(owner, 'Privacy')).toBeVisible()

    await expect(
      region(owner, 'What cannot be done from here').locator('li > p:first-child'),
    ).toHaveText([
      'Download a copy of your data — not available in this build.',
      'Delete your account — not available in this build.',
      'Email from this site — not available in this build.',
      'Automatic deletion after a set time — not available in this build.',
    ])

    // The controls that do exist are linked, not described.
    const controls = region(owner, 'What you can do here')

    await expect(
      controls.getByRole('link', { name: 'Account security', exact: true }),
    ).toHaveAttribute('href', '/account/security')
    await expect(controls.getByRole('link', { name: 'Transfers', exact: true })).toHaveAttribute(
      'href',
      '/account/transfers',
    )
  })

  test('the limitations page shows every recorded status word exactly', async ({ owner }) => {
    await owner.goto('/account/privacy')
    await expect(pageHeading(owner, 'Privacy')).toBeVisible()

    // Reached from the footer every page carries.
    await owner
      .getByRole('contentinfo')
      .getByRole('link', { name: 'What this site does not do', exact: true })
      .click()

    await expect(owner).toHaveURL((url) => url.pathname === '/limitations')
    await expect(pageHeading(owner, 'What this site does not do')).toBeVisible()

    const recorded = await owner
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

    // Every name with its word, in order, and nothing else: a status reworded,
    // softened or dropped fails here.
    expect(recorded).toEqual(RECORDED_LIMITATIONS)

    // Payments are simulated, and the page says so rather than implying a charge.
    await expect(
      owner.getByRole('listitem', { name: 'Real payments, Stripe and Connect payouts' }),
    ).toContainText(
      'Payments on this site are simulated. No card is asked for, nothing is charged, no refund returns money and no organiser is paid out.',
    )
  })
})

test.describe('signed out', () => {
  test('opening the orders page is sent to sign in, carrying the page', async ({ visitor }) => {
    await visitor.goto('/account/orders')

    await expect(visitor).toHaveURL(
      (url) => url.pathname === '/sign-in' && url.searchParams.get('next') === '/account/orders',
    )
    await expect(pageHeading(visitor, 'Sign in')).toBeVisible()
    await expect(pageHeading(visitor, 'Your orders')).toHaveCount(0)
    // Creating an account instead keeps the same destination.
    await expect(
      visitor.getByRole('link', { name: 'Create an account', exact: true }),
    ).toHaveAttribute('href', '/register?next=%2Faccount%2Forders')

    // The page itself, not the top of the area: a link to one order comes
    // back to that order, and nothing of it is drawn on the way.
    const reference = ids().orderReference

    await visitor.goto(`/account/orders/${reference}`)
    await expect(visitor).toHaveURL(
      (url) =>
        url.pathname === '/sign-in' &&
        url.searchParams.get('next') === `/account/orders/${reference}`,
    )
    await expect(pageHeading(visitor, 'Sign in')).toBeVisible()
    await expect(visitor.locator('main')).not.toContainText(eventTitle())
  })
})

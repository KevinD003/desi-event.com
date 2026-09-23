import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import {
  CONNECTION,
  PASSWORD,
  TOTP_SECRET,
  currentCode,
  forgetCodeUse,
} from './support/seed-refusals.mjs'

/**
 * The organiser and operations lists this phase added, and the scoping fix
 * behind "Your events", read against the real API over the real database.
 *
 * ## What this proves that the page tests cannot
 *
 * The unit tests beside `app/organizer/team`, `app/finance/refunds` and
 * `app/operations/**` render each page against a mocked `callApi`. They are
 * good at words and silent about whose rows come back. Everything here is
 * whose rows come back:
 *
 *   - the workspace rail offers each account exactly the doors its session
 *     opens — Team to an organisation's members and not to a platform reader,
 *     Notifications to the platform and not to an organisation's owner — and
 *     following Team opens the alpha team;
 *   - the team list carries the four alpha members, their roles and door
 *     scopes, and carries addresses only for the owner who confirmed a second
 *     factor recently. A VIEWER may read the list (`VIEWER` grants
 *     `organization:view_members`) and is *sent* no address, not merely shown
 *     none; a door SCANNER may not read it at all;
 *   - "Your events" lists alpha's events and nobody else's, where it used to
 *     list the public catalogue;
 *   - the refund, reconciliation and notification lists show the seeded rows,
 *     say what order they are in, and carry no provider reference, payment id,
 *     recipient or payload; a page past the end of a list says so, with the
 *     API's own count;
 *   - the operations board links each queue to its whole list, and every
 *     detail page's breadcrumb leads back to the list it came from.
 *
 * ## Why some cases confirm a second factor first
 *
 * The finance and reconciliation reads sit behind the `FINANCE_VIEW` step-up
 * window (fifteen minutes) and team addresses behind `MEMBER_EMAIL_VIEW` (ten).
 * The saved sessions were confirmed once, in global setup, and this file runs
 * after every other detail spec, so whether a window is still open when a case
 * starts depends on how long the run has taken. So a case that reads behind a
 * window uses the page's own "Confirm it is you" when — and only when — the
 * page offers it, then asserts unconditionally. That is arrangement, not a
 * conditional assertion: every expectation after it runs whichever way the
 * page arrived. Nobody is signed in from here; a step-up is its own endpoint
 * with its own budget, and it does not rotate the session.
 *
 * ## What this file writes, and removes
 *
 * Two rows, each written directly in the way the world's own seeds write
 * theirs, and deleted in `afterAll`:
 *
 *   - **A published event belonging to the beta organisation.** The world
 *     holds none, and in a fresh database the only public event is alpha's own
 *     — so a "Your events" that listed the public catalogue again would list
 *     exactly what the scoped one does, and the case could not fail. With one
 *     other organisation's public event present, it can.
 *   - **One dead-lettered outbox message** with a recipient address, a payload
 *     marker and a stored error quoting the address. Nothing in the detail
 *     world enqueues mail, and an empty outbox would make every "shows no
 *     recipient" assertion true by having nothing to show.
 *
 * @module e2e/detail-workspace
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
 * The alpha organisation's draft.
 *
 * @returns {string} The title.
 */
const draftTitle = () => `Alpha's Draft ${ids().tag}`

/**
 * The unverified organisation's event: approved, never published.
 *
 * @returns {string} The title.
 */
const approvedTitle = () => `Unverified Evening ${ids().tag}`

/**
 * The alpha organisation's name, as the seed writes it.
 *
 * @returns {string} The name.
 */
const alphaName = () => `Alpha Collective ${ids().tag}`

/**
 * The beta organisation's name, as the seed writes it.
 *
 * @returns {string} The name.
 */
const betaName = () => `Beta Collective ${ids().tag}`

/**
 * The other organisation's public event this file writes.
 *
 * @returns {{title: string, slug: string}} Its title and slug.
 */
const betaEvent = () => ({
  title: `Beta's Evening ${ids().tag}`,
  slug: `beta-evening-${ids().tag}`,
})

/**
 * The outbox message this file writes.
 *
 * The recipient is fictional, on a `.test` domain. The marker is what the
 * payload carries, so its absence from a page is the payload's absence.
 *
 * @returns {{template: string, dedupeKey: string, recipient: string, marker: string}} Its fields.
 */
const probe = () => ({
  template: `workspace-probe-${ids().tag}`,
  dedupeKey: `workspace-probe:${ids().tag}`,
  recipient: `outbox-probe-${ids().tag}@attendee.test`,
  marker: `payload-probe-${ids().tag}`,
})

/**
 * The outbox message's id, set once it is written.
 *
 * @type {string|null}
 */
let probeId = null

/**
 * What the owner's rail offers, in order: `WORKSPACE_GROUPS` asked of an alpha
 * OWNER whose platform role is ORGANIZER.
 *
 * Written out rather than imported: a test that read the navigation's own
 * table would agree with whatever the table said.
 *
 * @type {ReadonlyArray<string>}
 */
const OWNER_RAIL = Object.freeze([
  'Overview',
  'Events',
  'Venues',
  'Check-in',
  'Team',
  'Analytics',
  'Finance',
  'Operations',
  'Privacy',
])

/**
 * What the platform reader's rail offers: a SUPER_ADMIN with no membership, so
 * nothing that needs one — Check-in, Team, Analytics — and every platform door.
 *
 * @type {ReadonlyArray<string>}
 */
const PLATFORM_RAIL = Object.freeze([
  'Overview',
  'Events',
  'Venues',
  'Finance',
  'Operations',
  'Notifications',
  'Moderation',
  'Privacy',
  'Retention',
])

/**
 * What an alpha VIEWER's rail offers: the workspace, the team and the counts.
 *
 * @type {ReadonlyArray<string>}
 */
const VIEWER_RAIL = Object.freeze(['Overview', 'Team', 'Analytics'])

/**
 * What an alpha SCANNER's rail offers: the workspace and its door.
 *
 * @type {ReadonlyArray<string>}
 */
const SCANNER_RAIL = Object.freeze(['Overview', 'Check-in'])

/**
 * The workspace rail on the page.
 *
 * @param {object} page The Playwright page.
 * @returns {object} A locator for the rail's navigation landmark.
 */
function rail(page) {
  return page.getByRole('navigation', { name: 'Workspace', exact: true })
}

/**
 * An area's row of tabs, named after the area.
 *
 * @param {object} page The Playwright page.
 * @param {string} area The area's label: `Finance`, `Operations`.
 * @returns {object} A locator for the tabs' navigation landmark.
 */
function tabs(page, area) {
  return page.getByRole('navigation', { name: area, exact: true })
}

/**
 * The page's breadcrumb trail.
 *
 * @param {object} page The Playwright page.
 * @returns {object} A locator for the trail's navigation landmark.
 */
function crumbs(page) {
  return page.getByRole('navigation', { name: 'Breadcrumb', exact: true })
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
 * The polite status region that says a given thing.
 *
 * Every alert outside the door is `role="status"`, and a page can hold
 * several, so one is always picked out by its words.
 *
 * @param {object} page The Playwright page.
 * @param {string} words What it says.
 * @returns {object} A locator for the region.
 */
function statusSaying(page, words) {
  return page.getByRole('status').filter({ hasText: words })
}

/**
 * The table row holding a link to one address.
 *
 * @param {object} page The Playwright page.
 * @param {string} href The link's exact address.
 * @returns {object} A locator for the row.
 */
function rowLinkingTo(page, href) {
  return page.getByRole('row').filter({ has: page.locator(`a[href="${href}"]`) })
}

/**
 * The one row of a team table whose name cell says a given thing.
 *
 * @param {object} table A locator for the members table.
 * @param {string} name The row header's words, exactly.
 * @returns {object} A locator for the row.
 */
function memberRow(table, name) {
  return table.getByRole('row').filter({
    has: table.page().getByRole('rowheader', { name, exact: true }),
  })
}

/**
 * Confirm a second factor with the page's own prompt, if and only if the page
 * offers it.
 *
 * See the module note: this is arrangement. Whether a window is still open
 * depends on how long the run has taken, and everything asserted afterwards is
 * asserted either way.
 *
 * The offer is drawn on the server and works once React has hydrated it, so
 * the press is repeated until the form it opens is there rather than assumed
 * to have landed.
 *
 * @param {object} page The Playwright page, arrived.
 * @returns {Promise<void>} Resolves once the page no longer asks.
 */
async function confirmIfAsked(page) {
  const offer = page.getByRole('button', { name: 'Confirm and continue', exact: true })

  if ((await offer.count()) === 0) return

  const password = page.getByLabel(/^Your password/u)

  await expect(async () => {
    if (await offer.isVisible()) await offer.click()
    await expect(password).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 15_000 })

  // The seeded factor's last code is forgotten first, as the sign-in helper
  // does, so a code another case used inside the same thirty seconds is not
  // refused as a replay.
  await forgetCodeUse()

  const code = currentCode()

  await password.fill(PASSWORD)
  await page.getByLabel(/^Code from your authenticator/u).fill(code)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Confirm it is you' })).toHaveCount(0)

  // Typed into fields and sent in a request body, never in the address.
  expect(page.url(), 'the address carries the password').not.toContain(PASSWORD)
  expect(page.url(), 'the address carries the code').not.toContain(code)
}

/**
 * Assert that neither the page nor its address carries a credential.
 *
 * The team list is built from user rows, which hold a password digest and a
 * sealed factor; every list here is built from rows a provider or a sign-in
 * touched. None of these belongs on a page.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<void>} Resolves when checked.
 */
async function expectNoCredentials(page) {
  const html = await page.content()

  for (const needle of [
    'credentialHash',
    'ticket-pass-v1',
    'passwordHash',
    'secretSealed',
    TOTP_SECRET,
    PASSWORD,
  ]) {
    expect(html, `the page carries ${needle}`).not.toContain(needle)
    expect(page.url(), `the address carries ${needle}`).not.toContain(needle)
  }
}

test.beforeAll(async () => {
  const { betaOrganizationId } = ids()
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    // Upserted, because a failed case restarts the worker and this hook runs
    // again for the cases after it.
    const { title, slug } = betaEvent()
    const startsAt = new Date(Date.now() + 60 * 86_400_000)
    const event = {
      organizationId: betaOrganizationId,
      title,
      summary: 'Another organisation’s public event, which no alpha list may show.',
      description:
        'Published so that a list of one organisation’s events has something public from elsewhere to leave out.',
      category: 'MUSIC_CONCERT',
      status: 'PUBLISHED',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
      timezone: 'Asia/Kolkata',
      publishedAt: new Date(),
    }

    await prisma.event.upsert({ where: { slug }, update: event, create: { slug, ...event } })

    const { template, dedupeKey, recipient, marker } = probe()
    const message = {
      template,
      channel: 'EMAIL',
      recipient,
      payload: { note: marker },
      status: 'DEAD_LETTER',
      attempts: 5,
      maxAttempts: 5,
      // Oldest of all, so it heads the queue's first page: dead letters come
      // first, longest-waiting first.
      scheduledFor: new Date('2000-01-01T00:00:00.000Z'),
      lastAttemptAt: new Date(Date.now() - 3_600_000),
      failureCategory: 'PERMANENT',
      lastError: `mailbox ${recipient} refused the message`,
    }

    const row = await prisma.notificationOutbox.upsert({
      where: { dedupeKey },
      update: message,
      create: { dedupeKey, ...message },
    })

    probeId = row.id
  } finally {
    await prisma.$disconnect()
  }
})

test.afterAll(async () => {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    await prisma.event.deleteMany({ where: { slug: betaEvent().slug } })
    await prisma.notificationOutbox.deleteMany({ where: { dedupeKey: probe().dedupeKey } })
  } finally {
    await prisma.$disconnect()
  }
})

test.describe('the workspace rail', () => {
  test('offers the owner their organisation’s doors, Team among them, and no platform one', async ({
    owner,
  }) => {
    await owner.goto('/organizer')
    await expect(pageHeading(owner, 'Organiser workspace')).toBeVisible()

    // Exactly these, in this order. A missing entry is a page nobody reaches
    // without typing its address; an extra one is a door the shell refuses.
    await expect(rail(owner).getByRole('link')).toHaveText([...OWNER_RAIL])
    await expect(rail(owner).getByRole('link', { name: 'Notifications', exact: true })).toHaveCount(
      0,
    )
  })

  test('offers the platform reader the platform’s doors and no Team, which it cannot open', async ({
    platform,
  }) => {
    await platform.goto('/operations')
    await expect(pageHeading(platform, 'Operations')).toBeVisible()

    await expect(rail(platform).getByRole('link')).toHaveText([...PLATFORM_RAIL])
    await expect(rail(platform).getByRole('link', { name: 'Team', exact: true })).toHaveCount(0)

    // Not offered, and not a door that opens when typed either: a platform
    // role is not a team, and the page asks the memberships the rail asks.
    await platform.goto('/organizer/team')

    await expect(pageHeading(platform, 'Not for you')).toBeVisible()
    await expect(
      platform.getByText(/^Team is not something this account can open\./u),
    ).toBeVisible()
    await expect(pageHeading(platform, 'Team and roles')).toHaveCount(0)
  })
})

test.describe('the team screen', () => {
  test('opens from the rail on the alpha team, with addresses for an owner who confirmed recently', async ({
    owner,
  }) => {
    const { alphaOwnerEmail, viewerEmail, scannerEmail, stewardEmail } = ids()

    await owner.goto('/organizer')
    await rail(owner).getByRole('link', { name: 'Team', exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === '/organizer/team')
    await expect(pageHeading(owner, 'Team and roles')).toBeVisible()
    await expect(rail(owner).getByRole('link', { name: 'Team', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(owner.getByText(`Who is in ${alphaName()}, in which role`)).toBeVisible()

    await confirmIfAsked(owner)

    // FULL: an OWNER holds `team:role_manage` through the membership itself,
    // and the second factor was confirmed inside the ten-minute window.
    await expect(
      owner.getByText(
        'Addresses are shown because you manage this team and confirmed your second factor recently. Nobody else who can read this list sees them.',
        { exact: true },
      ),
    ).toBeVisible()

    const table = owner.getByRole('region', { name: 'Members', exact: true })

    await expect(table.getByRole('columnheader')).toHaveText([
      'Name',
      'Email',
      'Role',
      'Joined',
      'Door scope',
      'Actions',
    ])

    // The four alpha members, oldest membership first, which is the API's
    // order: the owner from the refusals seed, the viewer from the commerce
    // seed, then the door's scanner and steward.
    await expect(table.getByRole('rowheader')).toHaveText([
      'Alpha Collective Owner (you)',
      'Listings Assistant',
      'Door Scanner',
      'Unassigned Steward',
    ])

    for (const member of [
      {
        name: 'Alpha Collective Owner (you)',
        email: alphaOwnerEmail,
        role: 'Owner',
        door: 'Any event of this organisation',
      },
      {
        name: 'Listings Assistant',
        email: viewerEmail,
        role: 'Viewer',
        door: 'Does not work a door',
      },
      {
        name: 'Door Scanner',
        email: scannerEmail,
        role: 'Door scanner',
        // The scope row the door seed wrote, named by the event it points at.
        door: `Admits to: ${eventTitle()}`,
      },
      {
        name: 'Unassigned Steward',
        email: stewardEmail,
        role: 'Staff',
        door: 'Admits nobody: no event named',
      },
    ]) {
      const cells = memberRow(table, member.name).getByRole('cell')

      await expect(cells.nth(0)).toHaveText(member.email)
      await expect(cells.nth(1)).toHaveText(member.role)
      await expect(cells.nth(3)).toHaveText(member.door)
    }

    // The owner may change and remove the other three, and nobody may change
    // their own membership from here.
    await expect(
      memberRow(table, 'Alpha Collective Owner (you)').getByRole('cell').nth(4),
    ).toHaveText('Your own role and membership are changed by somebody else here.')

    for (const name of ['Listings Assistant', 'Door Scanner', 'Unassigned Steward']) {
      const row = memberRow(table, name)

      await expect(row.getByRole('button', { name: `Change ${name}’s role` })).toBeVisible()
      await expect(row.getByRole('button', { name: `Remove ${name} from the team` })).toBeVisible()
    }

    // No invite form, because nothing in this build could deliver one.
    await expect(
      owner.getByText(
        'Inviting someone new needs email delivery, which this build does not have. Existing invitations are listed so they can be withdrawn.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(owner.locator('main input[type="email"]')).toHaveCount(0)

    await expectNoCredentials(owner)
  })

  test('is offered to a VIEWER, who is sent the members and not one address', async ({
    viewer,
  }) => {
    await viewer.goto('/organizer')
    await expect(rail(viewer).getByRole('link')).toHaveText([...VIEWER_RAIL])

    await rail(viewer).getByRole('link', { name: 'Team', exact: true }).click()

    await expect(viewer).toHaveURL((url) => url.pathname === '/organizer/team')
    await expect(pageHeading(viewer, 'Team and roles')).toBeVisible()

    // HIDDEN: a VIEWER may read the list and does not manage it. No second
    // factor would change that, so none is offered.
    await expect(
      viewer.getByText(
        'Email addresses are shown only to owners and administrators who have confirmed a second factor recently.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(viewer.getByRole('button', { name: 'Confirm and continue' })).toHaveCount(0)

    const table = viewer.getByRole('region', { name: 'Members', exact: true })

    // No email column and, holding neither `team:role_manage` nor
    // `team:remove`, no actions column either.
    await expect(table.getByRole('columnheader')).toHaveText([
      'Name',
      'Role',
      'Joined',
      'Door scope',
    ])
    await expect(table.getByRole('rowheader')).toHaveText([
      'Alpha Collective Owner',
      'Listings Assistant (you)',
      'Door Scanner',
      'Unassigned Steward',
    ])
    await expect(table).not.toContainText('@')

    // Nowhere in the page's source either, serialised props included.
    expect(await viewer.content()).not.toContain('@organiser.test')

    // And not sent: the server decided HIDDEN, and a HIDDEN list has no
    // address field to carry one. A screen that hid addresses it had been
    // sent would pass every check above.
    const response = await viewer.request.get(
      `/api/v1/organizations/${ids().alphaOrganizationId}/members`,
    )

    expect(response.status()).toBe(200)

    const text = await response.text()
    const { data } = JSON.parse(text)

    expect(data.emailVisibility).toBe('HIDDEN')
    expect(data.members).toHaveLength(4)
    expect(data.members.every((member) => !('email' in member))).toBe(true)
    expect(text).not.toContain('@')
  })

  test('is neither offered to a door SCANNER nor opened for one', async ({ scanner }) => {
    // SCANNER carries `ticket:check_in` and nothing else — deliberately no
    // read of who else is on the team.
    await scanner.goto('/organizer/team')

    await expect(rail(scanner).getByRole('link')).toHaveText([...SCANNER_RAIL])
    await expect(pageHeading(scanner, 'Not for you')).toBeVisible()
    await expect(scanner.getByText(/^Team is not something this account can open\./u)).toBeVisible()
    await expect(scanner.getByRole('link', { name: 'Back to the workspace' })).toHaveAttribute(
      'href',
      '/organizer',
    )
    await expect(scanner.getByRole('region', { name: 'Members', exact: true })).toHaveCount(0)

    const response = await scanner.request.get(
      `/api/v1/organizations/${ids().alphaOrganizationId}/members`,
    )

    expect(response.status()).toBe(403)
    expect(await response.text()).not.toContain('@')
  })
})

test.describe('your events', () => {
  test('lists the alpha organisation’s events and nobody else’s, each opening its editor', async ({
    owner,
  }) => {
    const { tag, alphaEventId } = ids()

    await owner.goto('/organizer')
    await rail(owner).getByRole('link', { name: 'Events', exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === '/organizer/events')
    await expect(pageHeading(owner, 'Your events')).toBeVisible()
    await expect(owner.getByRole('link', { name: eventTitle(), exact: true })).toBeVisible()

    const titles = await owner
      .getByRole('main')
      .getByRole('heading', { level: 2 })
      .allTextContents()

    // Before the fix this was `GET /v1/events` unscoped: the public catalogue
    // plus alpha's drafts. Beta's published event is public, and would be the
    // first row of that; every other run's alpha event is public too, and
    // carries a different tag.
    expect(titles).toContain(eventTitle())
    expect(titles).toContain(draftTitle())
    expect(titles).not.toContain(betaEvent().title)
    expect(titles).not.toContain(approvedTitle())

    for (const title of titles) {
      expect(title, `"${title}" is not this run's alpha event`).toContain(tag)
    }

    // One organisation, so no organisation names and no platform-wide note.
    await expect(owner.getByText(/every organisation’s events/u)).toHaveCount(0)
    await expect(owner.getByText(betaName())).toHaveCount(0)

    await owner.getByRole('link', { name: eventTitle(), exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === `/organizer/events/${alphaEventId}`)
    await expect(pageHeading(owner, eventTitle())).toBeVisible()
  })

  test('is every organisation’s events for the platform reader, and says so', async ({
    platform,
  }) => {
    await platform.goto('/organizer/events')
    await expect(pageHeading(platform, 'Your events')).toBeVisible()

    await expect(
      platform.getByText(
        'This account runs the platform and belongs to no organisation, so this is every organisation’s events, not a list of its own.',
        { exact: true },
      ),
    ).toBeVisible()

    // The newest event on the platform, from another organisation, with the
    // organisation named because it could be any of them.
    const item = platform
      .getByRole('listitem')
      .filter({ has: platform.getByRole('heading', { name: betaEvent().title, exact: true }) })

    await expect(item).toContainText(betaName())
  })
})

test.describe('the refund list', () => {
  test('is a finance tab that lists the seeded refund, in its order, with no provider reference', async ({
    owner,
  }) => {
    const { refundId, orderReference, paymentId, tag } = ids()

    await owner.goto('/finance')
    await expect(pageHeading(owner, 'Finance')).toBeVisible()
    await expect(tabs(owner, 'Finance').getByRole('link')).toHaveText([
      'Overview',
      'Refunds',
      'Payout setup',
    ])

    await tabs(owner, 'Finance').getByRole('link', { name: 'Refunds', exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === '/finance/refunds')
    await expect(pageHeading(owner, 'Refunds')).toBeVisible()
    await expect(
      tabs(owner, 'Finance').getByRole('link', { name: 'Refunds', exact: true }),
    ).toHaveAttribute('aria-current', 'page')

    await confirmIfAsked(owner)

    // The order is stated, not left to be inferred from the rows.
    await expect(
      owner.getByText(
        `Every refund in ${alphaName()}: asked for, sent, settled, declined and cancelled alike, the ones still in flight first and the newest of those first.`,
      ),
    ).toBeVisible()
    // Simulated, and said before any figure is read.
    await expect(statusSaying(owner, 'DEMO — no money moved.')).toBeVisible()

    const link = owner.locator(`main a[href="/finance/refunds/${refundId}"]`)

    await expect(link).toHaveText(`Refund on ${orderReference}`)

    const cells = rowLinkingTo(owner, `/finance/refunds/${refundId}`).getByRole('cell')

    await expect(cells.nth(0)).toHaveText(/1,000\.00/u)
    await expect(cells.nth(1)).toHaveText('Requested')
    await expect(cells.nth(2)).toHaveText('customer request')

    // The list payload carries the payment's id and a provider reference
    // field; a list has no use for either, and the seeded payment's
    // reference, the refund's idempotency key and the buyer are not on it.
    const html = await owner.content()

    for (const needle of [
      `mock_${tag}`,
      paymentId,
      `sweep-refund-${tag}`,
      `holder-${tag}@attendee.test`,
      'providerRefundId',
    ]) {
      expect(html, `the refund list carries ${needle}`).not.toContain(needle)
    }

    await expectNoCredentials(owner)
  })

  test('says a page past the end is past the end, with the real count, and links to the first', async ({
    owner,
  }) => {
    const { alphaOrganizationId, refundId } = ids()

    await owner.goto('/finance/refunds?page=99')
    await expect(pageHeading(owner, 'Refunds')).toBeVisible()

    await confirmIfAsked(owner)

    await expect(
      owner.getByText('Page 99 is past the end of this list', { exact: true }),
    ).toBeVisible()

    // The count the page states is the API's, asked the way the page asked.
    const response = await owner.request.get(
      `/api/v1/refunds?organizationId=${alphaOrganizationId}&page=99&perPage=50`,
    )

    expect(response.status()).toBe(200)

    const { data, pagination } = await response.json()
    const { total, totalPages } = pagination

    expect(data).toHaveLength(0)
    // The seeded refund, at least: a list with nothing in it is a different
    // state, and the one this case must not be confused with.
    expect(total).toBeGreaterThanOrEqual(1)

    await expect(
      owner.getByText(
        `There ${total === 1 ? 'is' : 'are'} ${total} refund${total === 1 ? '' : 's'} in all, on ${totalPages} page${totalPages === 1 ? '' : 's'}.`,
        { exact: true },
      ),
    ).toBeVisible()
    await expect(owner.getByText('No refunds', { exact: true })).toHaveCount(0)

    await owner.getByRole('link', { name: 'Go to the first page', exact: true }).click()

    await expect(owner).toHaveURL(
      (url) =>
        url.pathname === '/finance/refunds' &&
        url.searchParams.get('organizationId') === alphaOrganizationId &&
        !url.searchParams.has('page'),
    )
    await expect(owner.locator(`main a[href="/finance/refunds/${refundId}"]`)).toBeVisible()
  })
})

test.describe('the reconciliation list', () => {
  test('is scoped to the alpha organisation for its owner, and lists the seeded item', async ({
    owner,
  }) => {
    const { reconciliationTaskId, orderReference, orderId, paymentId, tag } = ids()

    await owner.goto('/operations')
    await expect(tabs(owner, 'Operations').getByRole('link')).toHaveText([
      'Board',
      'Reconciliation',
    ])

    await tabs(owner, 'Operations')
      .getByRole('link', { name: 'Reconciliation', exact: true })
      .click()

    await expect(owner).toHaveURL((url) => url.pathname === '/operations/reconciliation')
    await expect(pageHeading(owner, 'Reconciliation')).toBeVisible()

    await confirmIfAsked(owner)

    await expect(
      owner.getByText(
        `Every item where the system did not know what happened to money, for ${alphaName()}: open, claimed, escalated and resolved alike, the unresolved ones first and the oldest of those first.`,
      ),
    ).toBeVisible()

    const href = `/operations/reconciliation/${reconciliationTaskId}`

    await expect(owner.locator(`main a[href="${href}"]`)).toHaveText('Payment timeout')

    const cells = rowLinkingTo(owner, href).getByRole('cell')

    await expect(cells.nth(0)).toHaveText(`Order ${orderReference}`)
    await expect(cells.nth(1)).toContainText('Open')
    await expect(cells.nth(1)).toContainText('Nobody has claimed it.')
    // Seeded ninety-six hours old, past the seventy-two-hour threshold.
    await expect(cells.nth(2)).toContainText('Overdue')
    await expect(cells.nth(3)).toHaveText('1')

    // The list payload is the detail's shape; a row reads none of the ids or
    // the provider's reference.
    const html = await owner.content()

    for (const needle of [`mock_${tag}`, paymentId, orderId]) {
      expect(html, `the reconciliation list carries ${needle}`).not.toContain(needle)
    }
  })

  test('is every organisation’s for the platform reader', async ({ platform }) => {
    const { reconciliationTaskId } = ids()

    await platform.goto('/operations/reconciliation')
    await expect(pageHeading(platform, 'Reconciliation')).toBeVisible()

    await confirmIfAsked(platform)

    // A reader with no membership is offered one scope, so the page draws no
    // "Whose items" picker; it says whose items these are in the sentence and
    // the table's caption instead.
    await expect(
      platform.getByText(
        /^Every item where the system did not know what happened to money, for every organisation:/u,
      ),
    ).toBeVisible()
    await expect(
      platform.getByRole('table', { name: 'Reconciliation items for every organisation' }),
    ).toBeVisible()
    await expect(
      platform.getByText('There is no reconciliation item at all, in any state.'),
    ).toHaveCount(0)

    // Every organisation's includes alpha's, although this reader belongs to
    // none of them: the seeded item is unresolved, so it is in the first tier.
    await expect(
      platform.locator(`main a[href="/operations/reconciliation/${reconciliationTaskId}"]`),
    ).toHaveText('Payment timeout')
  })

  test('never shows the outsider the alpha item, whatever the address asks for', async ({
    outsider,
  }) => {
    const { alphaOrganizationId, reconciliationTaskId } = ids()
    const href = `/operations/reconciliation/${reconciliationTaskId}`

    await outsider.goto('/operations/reconciliation')
    await expect(pageHeading(outsider, 'Reconciliation')).toBeVisible()

    await confirmIfAsked(outsider)

    // Their own organisation's items, of which there are none.
    await expect(outsider.getByText(new RegExp(`, for ${betaName()}:`, 'u'))).toBeVisible()
    await expect(
      outsider.getByText(`There is no reconciliation item for ${betaName()}, in any state.`),
    ).toBeVisible()
    await expect(outsider.locator(`a[href="${href}"]`)).toHaveCount(0)

    // Naming alpha in the address is not a scope: the page offers only the
    // organisations this session holds finance access in.
    await outsider.goto(`/operations/reconciliation?organizationId=${alphaOrganizationId}`)
    await expect(pageHeading(outsider, 'Reconciliation')).toBeVisible()

    await expect(outsider.getByText(new RegExp(`, for ${betaName()}:`, 'u'))).toBeVisible()
    await expect(outsider.getByText(alphaName())).toHaveCount(0)
    await expect(outsider.locator(`a[href="${href}"]`)).toHaveCount(0)

    // And the API refuses it for want of `finance:view` in alpha — not for a
    // lapsed step-up, which the page has just confirmed.
    const response = await outsider.request.get(
      `/api/v1/operations/reconciliation?organizationId=${alphaOrganizationId}`,
    )
    const text = await response.text()

    expect(response.status()).toBe(403)
    expect(JSON.parse(text).error.code).toBe('FORBIDDEN')
    expect(text).not.toContain(reconciliationTaskId)
  })
})

test.describe('the notification queue', () => {
  test('is a platform tab, and shows a dead letter with no recipient and no payload', async ({
    platform,
  }) => {
    const { template, recipient, marker } = probe()
    const href = `/operations/notifications/${probeId}`

    await platform.goto('/operations')
    await expect(tabs(platform, 'Operations').getByRole('link')).toHaveText([
      'Board',
      'Reconciliation',
      'Notifications',
    ])

    await tabs(platform, 'Operations')
      .getByRole('link', { name: 'Notifications', exact: true })
      .click()

    await expect(platform).toHaveURL((url) => url.pathname === '/operations/notifications')
    await expect(pageHeading(platform, 'Notification queue')).toBeVisible()

    const row = rowLinkingTo(platform, href)
    const cells = row.getByRole('cell')

    await expect(platform.locator(`main a[href="${href}"]`)).toHaveText(template)
    // The stored error quoted the recipient; the API replaced the address
    // before it left the server.
    await expect(row).toContainText('mailbox Hidden email refused the message')
    await expect(cells.nth(0)).toHaveText('Dead letter')
    await expect(cells.nth(1)).toHaveText('5 of 5')
    await expect(cells.nth(4)).toHaveText('Not handed over')
    await expect(cells.nth(5)).toHaveText('Permanent: it will fail the same way again')
    await expect(row).not.toContainText(/payload/iu)

    // No address and no payload in any cell of any row, this run's or anybody
    // else's: the payload has no recipient field for this page to draw, and
    // every stored error is scrubbed.
    await expect(platform.getByRole('table')).not.toContainText('@')
    await expect(platform.getByRole('table')).not.toContainText(/payload/iu)

    const html = await platform.content()

    for (const needle of [recipient, `outbox-probe-${ids().tag}`, marker]) {
      expect(html, `the queue carries ${needle}`).not.toContain(needle)
    }
  })

  test('is refused to an organisation’s owner, on the page and at the API', async ({ owner }) => {
    await owner.goto('/operations/notifications')

    await expect(pageHeading(owner, 'Not for you')).toBeVisible()
    await expect(
      owner.getByText(/^The notification queue is not something this account can open\./u),
    ).toBeVisible()
    await expect(owner.getByRole('link', { name: 'Back to operations' })).toHaveAttribute(
      'href',
      '/operations',
    )
    await expect(owner.getByRole('table')).toHaveCount(0)

    // One message's own page answers the same, and carries nothing of it.
    await owner.goto(`/operations/notifications/${probeId}`)

    await expect(pageHeading(owner, 'Not for you')).toBeVisible()
    expect(await owner.content()).not.toContain(probe().template)

    const response = await owner.request.get('/api/v1/operations/notifications')
    const text = await response.text()

    expect(response.status()).toBe(403)
    expect(JSON.parse(text).error.code).toBe('FORBIDDEN')
    expect(text).not.toContain(probe().template)
  })
})

test.describe('the operations board', () => {
  test('links the platform reader from each platform queue to its whole list', async ({
    platform,
  }) => {
    await platform.goto('/operations')
    await expect(pageHeading(platform, 'Operations')).toBeVisible()

    // The stuck message is on the board too, by template and status, with the
    // address in its error already replaced.
    const stuck = platform.getByRole('region', { name: /^Notifications that did not go/u })

    await expect(stuck).toContainText(probe().template)
    await expect(stuck).toContainText('mailbox Hidden email refused the message')
    await expect(stuck).not.toContainText('@')

    // A reader with no membership has no organisation's refunds to link to.
    await expect(
      platform.getByRole('link', { name: 'Every refund, settled ones included' }),
    ).toHaveCount(0)

    await platform
      .getByRole('link', { name: 'Every reconciliation item, resolved ones included', exact: true })
      .click()

    await expect(platform).toHaveURL((url) => url.pathname === '/operations/reconciliation')
    await expect(pageHeading(platform, 'Reconciliation')).toBeVisible()

    await confirmIfAsked(platform)

    await expect(
      platform.getByRole('table', { name: 'Reconciliation items for every organisation' }),
    ).toBeVisible()

    await platform.goto('/operations')
    await platform
      .getByRole('link', { name: 'Every message in the outbox, sent ones included', exact: true })
      .click()

    await expect(platform).toHaveURL((url) => url.pathname === '/operations/notifications')
    await expect(pageHeading(platform, 'Notification queue')).toBeVisible()
    await expect(
      platform.locator(`main a[href="/operations/notifications/${probeId}"]`),
    ).toBeVisible()
  })

  test('links the owner from the refund queue to the whole refund list, and no further', async ({
    owner,
  }) => {
    const { alphaOrganizationId, refundId } = ids()

    await owner.goto('/operations')
    await expect(pageHeading(owner, 'Operations')).toBeVisible()

    await expect(
      owner.getByText(
        'This board shows your organisation’s refunds, below. The notification queue is platform work and is not shown to an organisation; your organisation’s reconciliation items are on the Reconciliation tab.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(
      owner.getByRole('link', { name: 'Every reconciliation item, resolved ones included' }),
    ).toHaveCount(0)
    await expect(
      owner.getByRole('link', { name: 'Every message in the outbox, sent ones included' }),
    ).toHaveCount(0)

    await owner
      .getByRole('link', { name: 'Every refund, settled ones included', exact: true })
      .click()

    await expect(owner).toHaveURL(
      (url) =>
        url.pathname === '/finance/refunds' &&
        url.searchParams.get('organizationId') === alphaOrganizationId,
    )
    await expect(pageHeading(owner, 'Refunds')).toBeVisible()

    await confirmIfAsked(owner)

    await expect(owner.locator(`main a[href="/finance/refunds/${refundId}"]`)).toBeVisible()
  })
})

test.describe('the detail pages crumb back to their lists', () => {
  test('a refund leads back to the refund list it belongs to', async ({ owner }) => {
    const { alphaOrganizationId, refundId, orderReference } = ids()

    await owner.goto(`/finance/refunds/${refundId}`)
    await confirmIfAsked(owner)

    await expect(pageHeading(owner, `Refund on ${orderReference}`)).toBeVisible()
    await expect(crumbs(owner).getByRole('link')).toHaveText(['Finance', 'Refunds'])
    await expect(crumbs(owner).locator('[aria-current="page"]')).toHaveText(orderReference)

    await crumbs(owner).getByRole('link', { name: 'Refunds', exact: true }).click()

    await expect(owner).toHaveURL(
      (url) =>
        url.pathname === '/finance/refunds' &&
        url.searchParams.get('organizationId') === alphaOrganizationId,
    )
    await expect(pageHeading(owner, 'Refunds')).toBeVisible()
    await expect(owner.locator(`main a[href="/finance/refunds/${refundId}"]`)).toBeVisible()
  })

  test('a reconciliation item leads back to the reconciliation list', async ({ owner }) => {
    const { reconciliationTaskId } = ids()
    const href = `/operations/reconciliation/${reconciliationTaskId}`

    await owner.goto(href)
    await confirmIfAsked(owner)

    await expect(pageHeading(owner, 'payment timeout')).toBeVisible()
    await expect(crumbs(owner).getByRole('link')).toHaveText(['Operations', 'Reconciliation'])
    await expect(crumbs(owner).locator('[aria-current="page"]')).toHaveText('payment timeout')

    await crumbs(owner).getByRole('link', { name: 'Reconciliation', exact: true }).click()

    await expect(owner).toHaveURL((url) => url.pathname === '/operations/reconciliation')
    await expect(pageHeading(owner, 'Reconciliation')).toBeVisible()

    await confirmIfAsked(owner)

    await expect(owner.locator(`main a[href="${href}"]`)).toBeVisible()
  })

  test('a message leads back to the queue, and shows neither who it was to nor what it said', async ({
    platform,
  }) => {
    const { template, recipient, marker } = probe()
    const href = `/operations/notifications/${probeId}`

    await platform.goto(href)

    await expect(pageHeading(platform, template)).toBeVisible()
    await expect(
      platform.getByText(
        'Email message, template version 1. Neither who it is to nor what it says is shown here.',
      ),
    ).toBeVisible()
    await expect(platform.getByText('mailbox Hidden email refused the message')).toBeVisible()

    const main = platform.getByRole('main')

    await expect(main).not.toContainText('@')
    await expect(main).not.toContainText(/payload/iu)

    const html = await platform.content()

    for (const needle of [recipient, `outbox-probe-${ids().tag}`, marker]) {
      expect(html, `the message page carries ${needle}`).not.toContain(needle)
    }

    await expect(crumbs(platform).getByRole('link')).toHaveText(['Operations', 'Notifications'])
    await expect(crumbs(platform).locator('[aria-current="page"]')).toHaveText(template)

    await crumbs(platform).getByRole('link', { name: 'Notifications', exact: true }).click()

    await expect(platform).toHaveURL((url) => url.pathname === '/operations/notifications')
    await expect(pageHeading(platform, 'Notification queue')).toBeVisible()
    await expect(platform.locator(`main a[href="${href}"]`)).toBeVisible()
  })
})

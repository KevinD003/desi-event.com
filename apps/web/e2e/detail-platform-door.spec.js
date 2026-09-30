import AxeBuilder from '@axe-core/playwright'
import { createPrismaClient } from '@desi-event/db'

import { expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import { CONNECTION } from './support/seed-refusals.mjs'

/**
 * The platform's own door, in a real browser (ADR 0007).
 *
 * A platform super administrator may admit at any event's door on the
 * platform's own authority, with no membership in the organisation running it
 * — and only a super administrator: another platform role, however much else
 * it may do, is refused at the door like anybody else, and the refusal is
 * written down against the account.
 *
 * ## What only this file can show
 *
 * - The door screen offers the administrator a filter — an organisation and a
 *   search, as a plain `GET` form — says on whose authority every lookup is
 *   made, and can be worked from the keyboard alone.
 * - A typed code looked up and admitted there writes one `CheckIn` naming the
 *   administrator, and two audit rows that say it was the platform's
 *   authority: the admission's own, and one on the event's record.
 * - A MODERATOR — a platform role that is not door authority — is shown no
 *   door, and the API refuses a lookup sent anyway, with the refusal recorded.
 *
 * Whether each of those happened is read from PostgreSQL. A screen that said
 * "Admitted" over a row nobody wrote would pass every page assertion.
 *
 * ## Isolation
 *
 * The ticket is the feature world's platform ticket on gamma's first night
 * (`seed-feature-world.mjs`): nobody else admits it, and gamma is not alpha,
 * whose counts later specs assert. The platform reader holds no membership
 * anywhere, which the first case checks rather than assumes. The moderator is
 * the feature world's own, signed in here and nowhere else, and nothing in
 * this file changes anybody's role.
 *
 * @module e2e/detail-platform-door
 */

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * Run a read against the test database, and disconnect.
 *
 * @param {function(object): Promise<*>} read What to read.
 * @returns {Promise<*>} What it read.
 */
async function fromDatabase(read) {
  const prisma = createPrismaClient({ connectionString: CONNECTION })

  try {
    return await read(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The platform reader's user row, looked up by the address the world seeded.
 *
 * @returns {Promise<{id: string, role: string}>} Its id and platform role.
 */
function platformUser() {
  return fromDatabase((prisma) =>
    prisma.user.findUniqueOrThrow({
      where: { email: ids().platformReaderEmail },
      select: { id: true, role: true },
    }),
  )
}

/**
 * Open the door screen and wait for it, filtered or not.
 *
 * @param {object} page The page.
 * @param {string} [query] A query string, with its `?`.
 * @returns {Promise<void>}
 */
async function openDoor(page, query = '') {
  await page.goto(`/organizer/check-in${query}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()
}

/**
 * The scanner's findings for a page, at WCAG 2.2 AA.
 *
 * The same tags as the accessibility sweep, and no rule turned off. Next's
 * development overlay is left out because no deployment ships it.
 *
 * @param {object} page The page.
 * @returns {Promise<object[]>} The violations.
 */
async function violationsOn(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .exclude('nextjs-portal')
    .analyze()

  return results.violations.map((violation) => `${violation.id}: ${violation.help}`)
}

test.describe.serial('the platform’s own door', () => {
  test('a super administrator with no membership is offered every door, on the platform’s authority', async ({
    platform,
  }) => {
    const { id, role } = await platformUser()
    const memberships = await fromDatabase((prisma) =>
      prisma.membership.count({ where: { userId: id } }),
    )

    // The premise, read rather than assumed: a super administrator, and a
    // member of nothing — so every door below is the platform's authority.
    expect(role).toBe('SUPER_ADMIN')
    expect(memberships).toBe(0)

    await openDoor(platform)

    // Said once, persistently, before anything is looked up.
    const notice = platform
      .getByRole('status')
      .filter({ hasText: 'Platform administrator authority' })

    await expect(notice).toBeVisible()
    await expect(notice).toContainText(
      'Every lookup and admission is recorded against your account',
    )

    const filter = platform.getByRole('search', { name: 'Find an event' })

    await expect(filter).toBeVisible()
    // Every organisation with a door open now is a choice, gamma among them.
    await expect(
      filter.getByLabel('Organisation', { exact: true }).locator('option', {
        hasText: ids().gammaOrganizationName,
      }),
    ).toHaveCount(1)
  })

  test('the filter narrows the list by organisation and by name, from the keyboard alone', async ({
    platform,
  }) => {
    const { gammaOrganizationId, gammaOrganizationName, gammaGaEventTitle } = ids()

    await openDoor(platform)

    const filter = platform.getByRole('search', { name: 'Find an event' })
    const organisation = filter.getByLabel('Organisation', { exact: true })
    const search = filter.getByLabel('Event or organisation name')

    // Keys only: the organisation is chosen by typing its name into the
    // focused select, the search is typed, and Enter submits the form.
    await organisation.focus()
    await platform.keyboard.type(gammaOrganizationName)
    await expect(organisation).toHaveValue(gammaOrganizationId)
    await platform.keyboard.press('Tab')
    await expect(search).toBeFocused()
    await platform.keyboard.type('Garba Nights')
    await platform.keyboard.press('Enter')

    // A plain GET: the filter is in the address, and neither value is a secret.
    await platform.waitForURL(
      (url) =>
        url.pathname === '/organizer/check-in' &&
        url.searchParams.get('organizationId') === gammaOrganizationId &&
        url.searchParams.get('q') === 'Garba Nights',
    )
    await expect(platform.getByRole('heading', { level: 1, name: 'Check-in' })).toBeVisible()

    // One event matches, so it is shown rather than offered in a list, with
    // its organisation and the authority the door would use.
    const event = platform.getByRole('region', { name: 'Event' })

    await expect(event.getByText(gammaGaEventTitle, { exact: true })).toBeVisible()
    await expect(event.getByText(gammaOrganizationName, { exact: true })).toBeVisible()
    await expect(
      event.getByText('Any event on the platform (platform administrator)', { exact: true }),
    ).toBeVisible()
    // The form keeps what was asked, so the next search starts from it.
    await expect(filter.getByLabel('Organisation', { exact: true })).toHaveValue(
      gammaOrganizationId,
    )
    await expect(filter.getByLabel('Event or organisation name')).toHaveValue('Garba Nights')

    // A search that matches nothing says so, and offers no door.
    await openDoor(
      platform,
      `?organizationId=${encodeURIComponent(gammaOrganizationId)}&q=${encodeURIComponent('no such night anywhere')}`,
    )
    await expect(
      platform.getByText('No event with its door open now matches that', { exact: true }),
    ).toBeVisible()
    await expect(platform.getByLabel(/^Printed ticket code/u)).toHaveCount(0)

    // Clear takes the filter away, and the list is the whole platform's again.
    await platform.getByRole('link', { name: 'Clear', exact: true }).click()
    await platform.waitForURL((url) => url.pathname === '/organizer/check-in' && !url.search)
    await expect(platform.getByLabel('Event you are admitting to')).toBeVisible()

    // The filter form and the door around it, scanned.
    await openDoor(platform, `?organizationId=${encodeURIComponent(gammaOrganizationId)}`)
    expect(await violationsOn(platform)).toEqual([])
  })

  test('admits a ticket at a door it holds no membership for, and records on what authority', async ({
    platform,
  }) => {
    const { gammaOrganizationId, gammaGaEventId, platformTicketId, platformTicketCode } = ids()
    const { id: administratorId } = await platformUser()
    const admissions = () =>
      fromDatabase((prisma) =>
        prisma.checkIn.findMany({
          where: { ticketId: platformTicketId },
          select: { method: true, scannedByUserId: true },
        }),
      )

    await openDoor(
      platform,
      `?organizationId=${encodeURIComponent(gammaOrganizationId)}&q=${encodeURIComponent('Garba Nights')}`,
    )

    // The garba has two nights and this ticket is for the first: the door
    // says which night it is admitting to.
    const night = platform.getByLabel('Night you are admitting to')
    const nightValue = await night
      .locator('option', { hasText: /^Night 1 · /u })
      .getAttribute('value')

    await night.selectOption(nightValue)
    await expect(night).toHaveValue(nightValue)

    await platform.getByLabel(/^Printed ticket code/u).fill(platformTicketCode)
    await platform.getByRole('button', { name: 'Look up' }).click()

    await expect(
      platform.getByRole('heading', { name: 'Check the ticket, then admit' }),
    ).toBeFocused()
    await expect(platform.getByText('Nikhil Varma', { exact: true })).toBeVisible()
    // A lookup is a preview: nothing is admitted until Admit.
    expect(await admissions()).toEqual([])

    await platform.getByRole('button', { name: 'Admit', exact: true }).click()

    await expect(platform.getByRole('heading', { name: 'Admitted', exact: true })).toBeFocused()

    // One admission, by the administrator, typed.
    expect(await admissions()).toEqual([
      { method: 'MANUAL_CODE', scannedByUserId: administratorId },
    ])

    const audit = await fromDatabase((prisma) =>
      prisma.auditLog.findMany({
        where: {
          actorId: administratorId,
          OR: [
            { action: 'ticket.checked_in', entityId: platformTicketId },
            { action: 'ticket.admission_platform_authority', entityId: gammaGaEventId },
          ],
        },
        select: { action: true, entityType: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    )
    const checkedIn = audit.filter((row) => row.action === 'ticket.checked_in')
    const onTheEvent = audit.filter((row) => row.action === 'ticket.admission_platform_authority')

    // The admission's own row says whose authority it was.
    expect(checkedIn).toHaveLength(1)
    expect(checkedIn[0].metadata).toMatchObject({ authority: 'PLATFORM_ROLE' })

    // And the event's record carries the lookup and the admission, as the
    // organisation reading it would want to see them: ids and outcomes only.
    expect(onTheEvent.map((row) => row.entityType)).toEqual(['Event', 'Event'])
    expect(onTheEvent.map((row) => row.metadata.operation)).toEqual(['preview', 'check_in'])

    for (const row of onTheEvent) {
      expect(row.metadata).toMatchObject({
        authority: 'PLATFORM_ROLE',
        organizationId: gammaOrganizationId,
        ticketId: platformTicketId,
      })
      expect(JSON.stringify(row.metadata), 'the audit keeps what was presented').not.toContain(
        platformTicketCode,
      )
    }

    // Presented again: already in, and there is no way to admit it twice.
    await platform.getByRole('button', { name: 'Next ticket' }).click()
    await platform.getByLabel(/^Printed ticket code/u).fill(platformTicketCode)
    await platform.getByRole('button', { name: 'Look up' }).click()

    await expect(
      platform.getByRole('heading', { name: 'Already admitted — do not admit again' }),
    ).toBeVisible()
    await expect(platform.getByRole('button', { name: 'Admit', exact: true })).toHaveCount(0)
    expect(await admissions()).toHaveLength(1)
  })

  test('a moderator is shown no door, and a lookup sent anyway is refused and recorded', async ({
    browser,
  }) => {
    const { doorModeratorEmail, doorModeratorId, gammaGaEventId, platformTicketCode } = ids()
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      // A platform role with a second factor and capabilities of its own —
      // none of them the door's, and no organisation's. The workspace does
      // not open for it at all.
      await signIn(page, doorModeratorEmail)
      await page.goto('/organizer/check-in')

      await expect(page.getByRole('heading', { level: 1, name: 'Not for you' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: 'Check-in' })).toHaveCount(0)
      await expect(page.getByRole('search', { name: 'Find an event' })).toHaveCount(0)
      await expect(page.getByLabel(/^Printed ticket code/u)).toHaveCount(0)
      await expect(page.getByText('Platform administrator authority')).toHaveCount(0)

      // The API's own answer is the same: no door, on no authority.
      const doors = await page.request.get('/api/v1/tickets/admission/events')

      expect(doors.status()).toBe(200)

      const listed = await doors.json()

      expect(listed.data).toEqual([])
      expect(listed.meta.scope).toBe('MEMBERSHIPS')

      const refusalsBefore = await fromDatabase((prisma) =>
        prisma.auditLog.count({
          where: { action: 'ticket.admission_refused', actorId: doorModeratorId },
        }),
      )

      // Sent as the page would send it — this origin, the CSRF token echoed
      // from its cookie — so the refusal can only be the door's.
      const csrf = (await context.cookies()).find(({ name }) => name.endsWith('desi_csrf'))

      expect(csrf, 'the session carries no CSRF cookie to echo').toBeTruthy()

      const response = await page.request.post('/api/v1/tickets/admission/preview', {
        data: { code: platformTicketCode, expectedEventId: gammaGaEventId },
        headers: {
          origin: new URL(page.url()).origin,
          'x-desi-csrf': decodeURIComponent(csrf.value),
        },
      })

      expect(response.status()).toBe(403)
      expect((await response.json()).error.code).toBe('FORBIDDEN')

      // The attempt is on the record, against the account, with why — and
      // without what was presented.
      const refusals = await fromDatabase((prisma) =>
        prisma.auditLog.findMany({
          where: { action: 'ticket.admission_refused', actorId: doorModeratorId },
          select: { metadata: true },
          orderBy: { createdAt: 'asc' },
        }),
      )

      expect(refusals).toHaveLength(refusalsBefore + 1)
      expect(refusals.at(-1).metadata).toMatchObject({
        operation: 'preview',
        reason: 'PLATFORM_ROLE_IS_NOT_DOOR_AUTHORITY',
        platformRole: 'MODERATOR',
      })
      expect(JSON.stringify(refusals.at(-1).metadata)).not.toContain(platformTicketCode)
    } finally {
      await context.close()
    }
  })
})

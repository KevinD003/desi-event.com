import { totp } from '@desi-event/auth'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import {
  cleanupTeam,
  createdOrganization,
  liveSessionsOf,
  seedTeam,
  superAdministrators,
} from './support/seed-team.mjs'
import {
  acceptOrganiserInvitation,
  handOver,
  inviteOrganiser,
} from './support/organiser-invitations.mjs'
import { confirmIfPrompted, waitOutCredentialBudget } from './support/step-up.mjs'

// Invitation codes are drawn on these pages and read back by this file. A code
// is a credential until it is used, and a screenshot, a trace or a film would
// keep one in an artefact that CI uploads, so none is taken here
// (`lib/e2e-code-hygiene.test.js`).
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

/**
 * Starting an organisation, building its team without email, and the platform
 * roles above it — in a real browser, against the real API.
 *
 * ## The story
 *
 *   1. The super administrator invites an attendee to start an organisation —
 *      organisations are never started from an account, only by an invitation
 *      from the team at The Desi Events — and the attendee accepts it from their
 *      account page, becomes its owner, and finds it verified from the start.
 *   2. They invite somebody as staff. Codes are not emailed in this build's
 *      delivery mode, so the code is shown once, to them, to hand over —
 *      copied exactly, never in an address, never in storage, and gone once
 *      they say it is handed over.
 *   3. They issue a new code for the same invitation, which kills the first.
 *   4. Somebody else's account cannot use the code; the invited account cannot
 *      use the dead one, and joins with the new one.
 *   5. The super administrator finds an account by address — in a request
 *      body, never a query string — and makes it a moderator, through a
 *      second-factor confirmation, which ends every session the account held.
 *      Their own row offers no change, and the API refuses one: the only super
 *      administrator cannot be demoted by anybody.
 *   6. The new moderator signs in, finds an organisation waiting — one made
 *      before invitations were the only way in, still asking to be verified —
 *      and verifies it; its owner sees it verified.
 *   7. The super administrator puts that account into the organisation as an
 *      administrator, which ends its sessions.
 *   8. The owner hands the organisation to that administrator and becomes an
 *      administrator themselves.
 *   9. The super administrator puts the moderator's platform role back to
 *      attendee, through the same page.
 *  10. An attendee with no second factor — the way most people arrive — is
 *      invited to start an organisation, accepts, is told the workspace will
 *      not open until two-step sign-in is set up, sets it up from the key on
 *      the security page, and reaches the workspace. The organisation is in no
 *      public directory: it has nothing on sale.
 *
 * ## Who is who
 *
 * The creators, the invitee and the grandfathered organisation's owner are
 * fresh (`support/seed-team.mjs`): they gain privileges, and a privilege gain
 * ends every other session the account holds.
 * The role target is the feature world's, never signed in by global setup, for
 * the same reason. The platform reader and the taker are the saved sessions,
 * and neither's privileges change: the super administrator changes other
 * people's roles, and the taker's attempt is refused. The other three windows
 * are opened here and kept for the whole story, because their sessions rotate
 * as their privileges change, and a window re-opened from saved state would
 * carry a cookie the server has already replaced.
 *
 * ## The credential budget
 *
 * Signing in and confirming a second factor share a budget of ten requests a
 * minute per address, and this story does both several times. Each step that
 * spends it goes through `waitOutCredentialBudget` (or the sign-in helper's own
 * wait), which waits as long as the server says and tries once more.
 *
 * @module e2e/detail-team-and-organisations
 */

/** The creator's window, kept open for the whole story. @type {object} */
let creator
/** The invitee's window. @type {object} */
let invitee
/** The role target's window. @type {object} */
let target
/** Every context this file opened, closed in `afterAll`. @type {object[]} */
const contexts = []

/** The seeded team accounts. @type {object} */
let team
/** The organisation the creator makes. @type {{id: string, slug: string}} */
let organization
/** The first code, reissued away in journey 3. @type {string} */
let firstCode
/** The code that works. @type {string} */
let secondCode

/** Every address any window of this file asked for, to search for codes. */
const requested = []

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * The organisation's name, as the creator types it.
 *
 * @returns {string} The name.
 */
const orgName = () => team.organizationName

/**
 * The role target's display name, as the feature world seeds it.
 *
 * @type {string}
 */
const TARGET_NAME = 'Role Target'

/**
 * A page of the platform reader's, found by its level-one heading.
 *
 * @param {object} page The Playwright page.
 * @param {string} name The heading.
 * @returns {object} The heading's locator.
 */
function pageHeading(page, name) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

/**
 * Open a signed-out window that records every address it asks for.
 *
 * @param {object} browser The browser under test.
 * @param {object} [options] Context options.
 * @returns {Promise<object>} An arriving page.
 */
async function openWindow(browser, options = {}) {
  const context = await browser.newContext(options)
  const page = arriving(await context.newPage())

  contexts.push(context)
  page.on('request', (request) => requested.push(request.url()))

  return page
}

/**
 * Make a page record every address it asks for.
 *
 * @param {object} page A fixture's page.
 * @returns {object} The same page.
 */
function recording(page) {
  page.on('request', (request) => requested.push(request.url()))

  return page
}

/**
 * Everything a browser keeps that a code must never be in: the address, both
 * storages and the cookies.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<string>} All of it, as one string.
 */
async function keptByTheBrowser(page) {
  const storage = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  )
  const cookies = JSON.stringify(await page.context().cookies())

  return `${page.url()}\n${storage}\n${cookies}`
}

/**
 * Answer the page's step-up prompt if it asks, then wait for the outcome, with
 * the credential budget honoured.
 *
 * @param {object} page The Playwright page, just after the action.
 * @param {object} outcome What appears once the action has succeeded.
 * @returns {Promise<void>} Resolves once the outcome is visible.
 */
async function confirmed(page, outcome) {
  await waitOutCredentialBudget(page, () => confirmIfPrompted(page, outcome), {
    refusedAt: /^\/api\/v1\/auth\//u,
  })
}

/**
 * Type a code on the page where an invitation is accepted, and press join.
 *
 * @param {object} page The Playwright page.
 * @param {string} code The code.
 * @returns {Promise<void>} Resolves once pressed.
 */
async function typeCode(page, code) {
  await page.goto('/account/invitations')
  await expect(pageHeading(page, 'Join an organisation')).toBeVisible()

  const field = page.getByLabel(/^Invitation code/u)

  // A code is typed, like a password, and never read from the address.
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill(code)
  await page.getByRole('button', { name: 'Join the organisation', exact: true }).click()
}

/** The one sentence every unusable code is refused with, whatever the reason. */
const UNUSABLE =
  'That code cannot be used by this account. It may have expired, been withdrawn or used already, or it was issued to a different email address — sign in with the address the invitation was sent to.'

test.describe.serial('an organisation, its team and the platform roles above it', () => {
  test.beforeAll(async ({ browser }) => {
    team = await seedTeam(ids().tag)

    creator = await openWindow(browser, { permissions: ['clipboard-read', 'clipboard-write'] })
    await signIn(creator, team.creatorEmail)
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupTeam(ids().tag)
  })

  test('journey 1: the super administrator invites the creator as an organiser, and the creator accepts', async ({
    platform,
  }) => {
    recording(platform)

    // Nobody starts an organisation from their account: the account page
    // offers accepting an invitation, and the team at The Desi Events sends one.
    await creator.goto('/account')
    await expect(
      creator
        .getByRole('region', { name: 'Where to go', exact: true })
        .getByRole('link', { name: /^Create an organisation/u }),
    ).toHaveCount(0)

    await platform.goto('/admin/organizer-invitations')
    await expect(pageHeading(platform, 'Organiser invitations')).toBeVisible()

    const { code, panel } = await inviteOrganiser(platform, {
      email: team.creatorEmail,
      organizationName: orgName(),
    })

    // In the page and in the response that minted it, and nowhere else.
    expect(await keptByTheBrowser(platform)).not.toContain(code)
    await handOver(panel)
    expect(await platform.content()).not.toContain(code)

    await creator
      .getByRole('region', { name: 'Where to go', exact: true })
      .getByRole('link', { name: /^Accept an organiser invitation/u })
      .click()
    await expect(pageHeading(creator, 'Accept an organiser invitation')).toBeVisible()
    // What it does is said before the form, not after it.
    await expect(
      creator.getByText(
        /It is verified from the start, because the team at The Desi Events invited you\./u,
      ),
    ).toBeVisible()

    await waitOutCredentialBudget(
      creator,
      async () => {
        await acceptOrganiserInvitation(creator, code, { timezone: 'America/Chicago' })
        await expect(creator.getByText(`${orgName()} is yours`, { exact: true })).toBeVisible()
      },
      { refusedAt: /^\/api\/v1\/organizer-invitations\//u },
    )
    await expect(creator.getByText(/You are its owner, and it is verified\./u)).toBeVisible()
    // Spent, so cleared from the form rather than left for autofill.
    await expect(creator.getByLabel(/^Invitation code/u)).toHaveCount(0)
    expect(await keptByTheBrowser(creator)).not.toContain(code)

    // Neither window ever asked for an address carrying the code.
    for (const url of requested) expect(url, 'a code reached an address').not.toContain(code)

    organization = await createdOrganization(ids().tag)
    expect(organization, 'the organisation was not written').not.toBeNull()

    // The account already has a second factor, so it is sent to the
    // organisation rather than to set one up.
    await creator.getByRole('link', { name: 'Open its organisation page', exact: true }).click()
    await expect(pageHeading(creator, orgName())).toBeVisible()

    const verification = creator.getByRole('region', { name: 'Verification', exact: true })

    // Verified at once: the team at The Desi Events vouched for it by inviting
    // it, and the history says so. There is nothing to ask for.
    await expect(verification.getByText('Verification: Verified')).toBeVisible()
    await expect(verification.getByText('It may publish events and be paid.').first()).toBeVisible()
    await expect(
      verification.getByText(
        'Created from an organiser invitation sent by the team at The Desi Events.',
      ),
    ).toBeVisible()
    await expect(creator.getByRole('form', { name: 'Ask for verification' })).toHaveCount(0)
    await expect(
      creator.getByRole('link', { name: `/organizers/${organization.slug}` }),
    ).toBeVisible()
  })

  test('journey 2: an invitation code is shown once, copied exactly, and kept nowhere', async () => {
    await creator.goto('/organizer/team')
    await expect(pageHeading(creator, 'Team and roles')).toBeVisible()

    const invite = creator.getByRole('form', { name: 'Invite somebody' })

    await invite.getByLabel(/^Their email address/u).fill(team.inviteeEmail)
    await expect(invite.getByLabel(/^Role/u)).toHaveValue('STAFF')
    await invite.getByRole('button', { name: 'Invite them', exact: true }).click()

    const panel = creator.getByRole('region', { name: `Invitation code for ${team.inviteeEmail}` })
    const field = panel.getByLabel('Invitation code', { exact: true })

    await expect(field).toHaveAttribute('readonly', '')
    firstCode = await field.inputValue()
    expect(firstCode.length).toBeGreaterThanOrEqual(16)

    // Focus goes to the panel, so a keyboard user is taken to the code.
    await expect(
      panel.getByRole('heading', { name: `Invitation code for ${team.inviteeEmail}` }),
    ).toBeFocused()

    // Copying puts exactly the code on the clipboard, and says so politely.
    await panel.getByRole('button', { name: 'Copy the code', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('Copied the code to your clipboard.')
    expect(await creator.evaluate(() => navigator.clipboard.readText())).toBe(firstCode)

    // In the page and in the response that minted it, and nowhere else.
    expect(await keptByTheBrowser(creator)).not.toContain(firstCode)

    await panel.getByRole('button', { name: 'I have handed it over', exact: true }).click()
    await expect(panel).toHaveCount(0)
    expect(await creator.content()).not.toContain(firstCode)

    // The invitation is listed, with how its code went out.
    const invitations = creator.getByRole('table', { name: /Invitations waiting to be accepted/u })
    const row = invitations
      .getByRole('row')
      .filter({ hasText: 'Shown once to whoever invited them' })

    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Staff')
  })

  test('journey 3: a new code for the same invitation stops the first one working', async () => {
    await creator.goto('/organizer/team')

    await creator
      .getByRole('button', { name: 'Issue a new code for the invitation to join as staff' })
      .click()

    const confirm = creator.getByRole('group', {
      name: 'Issue a new code for the invitation to join as staff?',
    })

    await expect(confirm).toContainText('The code issued before stops working at once.')
    await confirm.getByRole('button', { name: 'Issue a new code', exact: true }).click()

    const panel = creator.getByRole('region', { name: 'New invitation code' })
    const field = panel.getByLabel('Invitation code', { exact: true })

    secondCode = await field.inputValue()
    expect(secondCode.length).toBeGreaterThanOrEqual(16)
    expect(secondCode).not.toBe(firstCode)
    expect(await keptByTheBrowser(creator)).not.toContain(secondCode)

    await panel.getByRole('button', { name: 'I have handed it over', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await expect(creator.getByRole('status').filter({ hasText: /is handed over/u })).toBeVisible()
    expect(await creator.content()).not.toContain(secondCode)

    // Still one open invitation to that address: the old one was replaced, not joined.
    const invitations = creator.getByRole('table', { name: /Invitations waiting to be accepted/u })

    await expect(
      invitations.getByRole('row').filter({ hasText: 'Shown once to whoever invited them' }),
    ).toHaveCount(1)
  })

  test('journey 4: only the invited account joins, and only with the live code', async ({
    browser,
    taker,
  }) => {
    // Somebody else, signed in, with the live code: refused in the one
    // sentence every unusable code gets, and the code is not spent by it.
    recording(taker)
    await typeCode(taker, secondCode)
    await expect(taker.getByText(UNUSABLE, { exact: true })).toBeVisible()
    expect(await keptByTheBrowser(taker)).not.toContain(secondCode)

    invitee = await openWindow(browser)
    await signIn(invitee, team.inviteeEmail)

    // The invited account with the code that was replaced: refused alike.
    await typeCode(invitee, firstCode)
    await expect(invitee.getByText(UNUSABLE, { exact: true })).toBeVisible()

    // And with the live one: joined, as the role it was invited to.
    await typeCode(invitee, secondCode)
    await expect(invitee.getByText('You have joined', { exact: true })).toBeVisible()
    await expect(
      invitee.getByText(`You are now in ${orgName()} as staff.`, { exact: false }),
    ).toBeVisible()
    // Spent, so cleared from the form rather than left for autofill.
    await expect(invitee.getByLabel(/^Invitation code/u)).toHaveCount(0)
    expect(await keptByTheBrowser(invitee)).not.toContain(secondCode)

    // The workspace now offers the team this account belongs to.
    await invitee.goto('/organizer')

    const rail = invitee.getByRole('navigation', { name: 'Workspace', exact: true })

    await expect(rail.getByRole('link', { name: 'Team', exact: true })).toBeVisible()
    await rail.getByRole('link', { name: 'Team', exact: true }).click()
    await expect(pageHeading(invitee, 'Team and roles')).toBeVisible()
    await expect(
      invitee.getByRole('row').filter({ hasText: 'Farhan Qureshi (you)' }),
    ).toContainText('Staff')

    // A member of a team is not on the team at The Desi Events: the platform's
    // administration area is refused as a whole, before any page in it.
    await invitee.goto('/admin/users')
    await expect(pageHeading(invitee, 'Not for you')).toBeVisible()
    await expect(
      invitee.getByText(
        'This area is for the platform administrators at The Desi Events: inviting organisers, and changing who can do what across the platform. Nothing on this page can grant it.',
        { exact: true },
      ),
    ).toBeVisible()
    await expect(pageHeading(invitee, 'People and roles')).toHaveCount(0)

    // No window of this story ever asked for an address carrying a code.
    for (const url of requested) {
      expect(url, 'a code reached an address').not.toContain(firstCode)
      expect(url, 'a code reached an address').not.toContain(secondCode)
    }
  })

  test('journey 5: the super administrator makes an account a moderator, and cannot change their own role', async ({
    browser,
    platform,
  }) => {
    recording(platform)

    // The account is signed in somewhere when its role changes, so the
    // sessions the change ends are real ones.
    target = await openWindow(browser)
    await signIn(target, ids().roleTargetEmail)
    expect(await liveSessionsOf(ids().roleTargetEmail)).toBeGreaterThan(0)

    await platform.goto('/admin/users')
    await expect(pageHeading(platform, 'People and roles')).toBeVisible()

    const search = platform.getByRole('form', { name: 'Find an account' })
    const sent = platform.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/v1/platform/users/search',
    )

    await search.getByLabel(/^Email address, name or account id/u).fill(ids().roleTargetEmail)
    await search.getByRole('button', { name: 'Search', exact: true }).click()

    // An address is looked up in the body of a POST, never in a query string
    // an access log would keep.
    const request = await sent

    expect(request.method()).toBe('POST')
    expect(new URL(request.url()).search).toBe('')
    expect(request.postDataJSON()).toMatchObject({ q: ids().roleTargetEmail })

    const card = platform.getByRole('article', { name: TARGET_NAME })

    await expect(card).toContainText('Platform role: Attendee')
    await card.getByRole('button', { name: `Change ${TARGET_NAME}’s platform role` }).click()
    await card.getByLabel(/^New platform role/u).selectOption('MODERATOR')
    await card
      .getByLabel(/^Reason/u)
      .first()
      .fill('Joining the trust team to review organisations.')
    await expect(card).toContainText(`Saving signs ${TARGET_NAME} out everywhere`)
    await card.getByRole('button', { name: 'Change the role', exact: true }).click()

    // A platform role changes only after a second factor within two minutes.
    await confirmed(
      platform,
      card.getByText(`${TARGET_NAME}’s platform role is now Moderator.`, { exact: false }),
    )
    await expect(card).toContainText('Platform role: Moderator')

    // Every session the account held ended with the change, in the same
    // transaction, and the window it was signed in on is sent to sign in.
    expect(await liveSessionsOf(ids().roleTargetEmail)).toBe(0)
    await target.goto('/account', { waitUntil: 'commit' })
    await expect(target).toHaveURL(/\/sign-in/u)

    // Their own row offers no change, and says who can make one.
    await search.getByLabel(/^Email address, name or account id/u).fill(ids().platformReaderEmail)
    await search.getByRole('button', { name: 'Search', exact: true }).click()

    const own = platform.getByRole('article', { name: /\(you\)/u })

    await expect(
      own.getByRole('button', { name: 'Change platform role', exact: true }),
    ).toBeDisabled()
    await expect(own).toContainText(
      'This is your own account. Another super administrator must change your platform role.',
    )

    // Nor will the API do it for a client that asks anyway. Nobody changes
    // their own platform role, so the last super administrator can never be
    // the one who removes the last super administrator — in this run's
    // database this account is the only one there is.
    const before = await superAdministrators()

    expect(before).toBeGreaterThan(0)

    const refused = await platform.evaluate(async (id) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
      const response = await fetch(`/api/v1/platform/users/${id}/role`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
        },
        body: JSON.stringify({ role: 'ATTENDEE', reason: 'Stepping down.' }),
      })
      const body = await response.json()

      return { status: response.status, message: body?.error?.message ?? null }
    }, ids().platformReaderId)

    expect(refused).toEqual({
      status: 403,
      message: 'You cannot change your own platform role. Ask another super administrator.',
    })
    expect(await superAdministrators()).toBe(before)
  })

  test('journey 6: the new moderator verifies a grandfathered organisation, and its owner sees it', async ({
    browser,
  }) => {
    // The window journey 5 opened, whose session the role change ended.
    expect(target, 'journey 5 opened no window for the role target').toBeDefined()
    await signIn(target, ids().roleTargetEmail)

    await target.goto('/moderation/organizations')
    await expect(pageHeading(target, 'Organisation checks')).toBeVisible()

    // Waiting, beside the feature world's own pending organisation, with the
    // note its owner sent. Made before invitations were the only way in: an
    // invited organisation is verified from the start and never waits here.
    await expect(target.getByRole('link', { name: ids().pendingOrganizationName })).toBeVisible()
    await expect(target.getByRole('listitem').filter({ hasText: orgName() })).toHaveCount(0)

    const waiting = team.grandfatheredName
    const card = target.getByRole('listitem').filter({ hasText: waiting })

    await expect(card).toContainText(team.grandfatheredNote)
    await card.getByRole('link', { name: waiting, exact: true }).click()

    await expect(pageHeading(target, waiting)).toBeVisible()
    await expect(target.getByText('State: Waiting for a moderator').first()).toBeVisible()

    await target
      .getByRole('group', { name: 'Decisions' })
      .getByRole('button', { name: 'Verify' })
      .click()

    const decision = target.getByRole('group', { name: `Verify: ${waiting}` })

    await decision.getByLabel(/^Reason/u).fill('Checked the organiser’s past events.')
    await decision.getByRole('button', { name: 'Record: verify', exact: true }).click()

    await confirmed(target, target.getByText(`Recorded: verify ${waiting}.`))
    await expect(target.getByText('State: Verified').first()).toBeVisible()

    // Its owner, signed in for the first time in this story, sees it.
    const owner = await openWindow(browser)

    await signIn(owner, team.grandfatheredOwnerEmail)
    await owner.goto(`/organizer/organization?organizationId=${team.grandfatheredId}`)
    const verification = owner.getByRole('region', { name: 'Verification', exact: true })

    await expect(verification.getByText('Verification: Verified')).toBeVisible()
    await expect(verification.getByText('It may publish events and be paid.').first()).toBeVisible()
    await expect(verification.getByText('Waiting for a moderator → Verified')).toBeVisible()
  })

  test('journey 7: the super administrator puts the moderator into the organisation, which signs them out', async ({
    platform,
  }) => {
    expect(await liveSessionsOf(ids().roleTargetEmail)).toBeGreaterThan(0)

    await platform.goto('/admin/users')

    const search = platform.getByRole('form', { name: 'Find an account' })

    await search.getByLabel(/^Email address, name or account id/u).fill(ids().roleTargetEmail)
    await search.getByRole('button', { name: 'Search', exact: true }).click()

    const card = platform.getByRole('article', { name: TARGET_NAME })

    await card.getByRole('button', { name: `Put ${TARGET_NAME} into an organisation` }).click()

    const find = card.getByRole('form', { name: 'Find an organisation' })

    await find.getByLabel(/^Organisation name or web address/u).fill(orgName())
    await find.getByRole('button', { name: 'Find organisations', exact: true }).click()
    await card.getByRole('radio', { name: new RegExp(orgName(), 'u') }).check()
    await card.getByLabel(new RegExp(`^Role in ${orgName()}`, 'u')).selectOption('ADMIN')
    await card
      .getByLabel(/^Reason/u)
      .last()
      .fill('Their trust work needs the organisation’s events.')
    await card.getByRole('button', { name: 'Give them the role', exact: true }).click()

    await confirmed(
      platform,
      card.getByText(`${TARGET_NAME} is now administrator of ${orgName()}.`, { exact: false }),
    )
    await expect(card).toContainText(`${orgName()} · Administrator`)

    // Every session the account held ended in the same transaction.
    expect(await liveSessionsOf(ids().roleTargetEmail)).toBe(0)

    await target.goto('/moderation/organizations', { waitUntil: 'commit' })
    await expect(target).toHaveURL(/\/sign-in/u)
  })

  test('journey 8: the owner hands the organisation over and becomes an administrator', async () => {
    await creator.goto(`/organizer/team?organizationId=${organization.id}`)

    const ownership = creator.getByRole('region', { name: 'Ownership', exact: true })

    // Only somebody who already creates events here can take it: the
    // administrator is offered, the staff member is not.
    await expect(ownership).toContainText(
      'Ownership can go only to somebody who already creates events here.',
    )
    await expect(ownership).toContainText(`${TARGET_NAME} · Administrator`)
    await expect(ownership).not.toContainText('Farhan Qureshi')
    await ownership.getByRole('button', { name: `Hand ownership to ${TARGET_NAME}` }).click()

    const confirm = creator.getByRole('group', {
      name: `Hand ${orgName()} to ${TARGET_NAME}?`,
    })

    await expect(confirm).toContainText('you become an administrator, in one step')
    await confirm
      .getByRole('button', { name: `Make ${TARGET_NAME} the owner`, exact: true })
      .click()

    // Handing an organisation on is a security change: a fresh second factor.
    await confirmed(
      creator,
      creator.getByText(`${TARGET_NAME} is now the owner. You are an administrator.`),
    )

    await creator.goto(`/organizer/team?organizationId=${organization.id}`)
    await expect(pageHeading(creator, 'Team and roles')).toBeVisible()

    const members = creator.getByRole('table', { name: /^Members of/u })

    await expect(members.getByRole('row').filter({ hasText: 'Nandini Rao (you)' })).toContainText(
      'Administrator',
    )
    await expect(members.getByRole('row').filter({ hasText: TARGET_NAME })).toContainText('Owner')
    // Only an owner is offered the hand-over.
    await expect(creator.getByRole('region', { name: 'Ownership', exact: true })).toHaveCount(0)
  })

  test('journey 9: the super administrator puts the moderator back to attendee, through the page', async ({
    platform,
  }) => {
    await platform.goto('/admin/users')

    const search = platform.getByRole('form', { name: 'Find an account' })

    await search.getByLabel(/^Email address, name or account id/u).fill(ids().roleTargetEmail)
    await search.getByRole('button', { name: 'Search', exact: true }).click()

    const card = platform.getByRole('article', { name: TARGET_NAME })

    await expect(card).toContainText('Platform role: Moderator')
    await card.getByRole('button', { name: `Change ${TARGET_NAME}’s platform role` }).click()
    await card.getByLabel(/^New platform role/u).selectOption('ATTENDEE')
    await card
      .getByLabel(/^Reason/u)
      .first()
      .fill('The trust work is finished; back to an ordinary account.')
    await card.getByRole('button', { name: 'Change the role', exact: true }).click()

    await confirmed(
      platform,
      card.getByText(`${TARGET_NAME}’s platform role is now Attendee.`, { exact: false }),
    )
    await expect(card).toContainText('Platform role: Attendee')
    // The organisation role is separate, and stays.
    await expect(card).toContainText(`${orgName()} · Owner`)
    expect(await liveSessionsOf(ids().roleTargetEmail)).toBe(0)
  })

  test('journey 10: an attendee with no second factor is invited, accepts, sets one up, and reaches the workspace', async ({
    browser,
    platform,
  }) => {
    recording(platform)
    await platform.goto('/admin/organizer-invitations')

    const { code, panel } = await inviteOrganiser(platform, {
      email: team.soloEmail,
      organizationName: team.soloOrganizationName,
    })

    await handOver(panel)

    const solo = await openWindow(browser)

    // No factor, so signing in asks for none.
    await signIn(solo, team.soloEmail)
    await waitOutCredentialBudget(
      solo,
      async () => {
        await acceptOrganiserInvitation(solo, code, { timezone: 'America/New_York' })
        await expect(
          solo.getByText(`${team.soloOrganizationName} is yours`, { exact: true }),
        ).toBeVisible()
      },
      { refusedAt: /^\/api\/v1\/organizer-invitations\//u },
    )
    expect(await keptByTheBrowser(solo)).not.toContain(code)
    for (const url of requested) expect(url, 'a code reached an address').not.toContain(code)

    const made = await createdOrganization(ids().tag, { who: 'solo' })

    expect(made, 'the organisation was not written').not.toBeNull()

    // An owner must use two-step sign-in and this account has none, so it is
    // sent to set one up — not to an organisation page that would refuse it.
    await expect(
      solo.getByText(/the workspace will not open for this account until it is set up/u),
    ).toBeVisible()
    await expect(
      solo.getByRole('link', { name: 'Open its organisation page', exact: true }),
    ).toHaveCount(0)

    await solo.getByRole('link', { name: 'Set up two-step sign-in', exact: true }).click()
    await expect(solo).toHaveURL((url) => url.pathname === '/account/security')

    const twoStep = solo.getByRole('region', { name: 'Two-step sign-in', exact: true })

    await twoStep.getByRole('button', { name: 'Set up two-step sign-in', exact: true }).click()
    // The key an authenticator would scan, typed in instead, as the page
    // offers for a phone that cannot scan.
    await twoStep.getByText('Cannot scan? Type this key into the app instead').click()

    const key = (await twoStep.locator('details p').innerText()).replace(/\s+/gu, '')

    expect(key).toMatch(/^[A-Z2-7]{16,}$/u)
    await twoStep.getByLabel(/^Six-digit code from your app/u).fill(totp(key))
    await twoStep.getByRole('button', { name: 'Confirm', exact: true }).click()

    await expect(solo.getByRole('heading', { name: 'Save your recovery codes now' })).toBeVisible()
    await solo.getByRole('button', { name: 'I have saved them', exact: true }).click()
    await expect(twoStep).toContainText(
      'On. Signing in asks for a code from your authenticator app as well as your password.',
    )

    // And now the workspace opens, on the organisation it made — verified
    // from the start, because the team at The Desi Events invited it.
    await solo.goto(`/organizer/organization?organizationId=${made.id}`)
    await expect(pageHeading(solo, team.soloOrganizationName)).toBeVisible()
    await expect(solo.getByText('Verification: Verified')).toBeVisible()

    // Nothing on sale, so no public directory lists it yet.
    await solo.goto('/organizers')
    await expect(pageHeading(solo, 'Who is putting on the nights')).toBeVisible()
    await expect(
      solo.getByRole('link', { name: team.soloOrganizationName, exact: true }),
    ).toHaveCount(0)
  })
})

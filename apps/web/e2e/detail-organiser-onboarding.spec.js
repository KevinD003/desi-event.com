import AxeBuilder from '@axe-core/playwright'

import { arriving, expect, test, world } from './support/detail-fixtures.mjs'
import { signIn } from './support/detail-world.mjs'
import {
  acceptOrganiserInvitation,
  handOver,
  inviteOrganiser,
  organiserCodePanel,
} from './support/organiser-invitations.mjs'
import {
  cleanupOnboarding,
  currentCode,
  draftEventFor,
  eventState,
  expireStepUp,
  forgetCodeUse,
  heldBy,
  onboardingNames,
  seatAdministratorInGamma,
  seedOnboarding,
  studioOrganization,
  unseatAdministratorFromGamma,
} from './support/seed-onboarding.mjs'
import { PASSWORD } from './support/seed-refusals.mjs'
import { confirmIfPrompted, waitOutCredentialBudget } from './support/step-up.mjs'

// Organiser invitation codes, and the ready-to-send message that carries one,
// are drawn on these pages and read back by this file. A code is a credential
// until it is used, and a screenshot, a trace or a film would keep one in an
// artefact that CI uploads, so none is taken here (`lib/e2e-code-hygiene.test.js`).
test.use({ screenshot: 'off', trace: 'off', video: 'off' })

/**
 * How anybody comes to post events on Desi-Event: by an invitation from the
 * Desi-Event team, and never by making themselves an organiser — in a real
 * browser, against the real API.
 *
 * ## The story
 *
 *   J1. A platform administrator invites somebody to start an organisation,
 *       whose name keeps its Gujarati. The code is shown once, with a message
 *       to send from their own email; both copy exactly, neither reaches an
 *       address or storage, and both go when they are handed over.
 *   J2. Nobody makes themselves an organiser: the workspace refuses an
 *       attendee, the old self-service route answers 403, registering offers
 *       no role, and somebody else holding the code cannot use it.
 *   J3. The administrator issues a new code, which stops the first working;
 *       the person invited is refused the first, accepts with the second, and
 *       the organisation is verified from the start with the description the
 *       administrator wrote.
 *   J4. Its owner can add only roles that do not post events.
 *   J5. An event is public only after the Desi-Event team reviews it: publish
 *       is not offered to a draft, the administrator approves through a fresh
 *       second factor, the owner publishes, and the API refuses to publish a
 *       draft that was never reviewed, or to approve without saying which
 *       version was seen.
 *   J6. An administrator who belongs to an organisation does not review its
 *       events.
 *   J7. A posting role in an existing organisation comes from the super
 *       administrator; its owner may move a posting member only downwards.
 *   J8. What a platform administrator cannot do, and that a moderator is not
 *       admitted to the area at all.
 *
 * ## Who is who
 *
 * Everybody whose privileges change is fresh (`support/seed-onboarding.mjs`):
 * a privilege change ends every other session the account holds, so no
 * account global setup saved is one of them. The super administrator (the
 * saved `platform` session) changes other people's roles and never its own;
 * the feature world's moderator is signed in here, in its own window, and
 * its role does not change.
 *
 * ## The credential budget
 *
 * Signing in, confirming a second factor and accepting an invitation share a
 * budget of ten requests a minute per address. Each step that spends it goes
 * through `waitOutCredentialBudget` (or the sign-in helper's own wait), which
 * waits as long as the server says and tries once more.
 *
 * @module e2e/detail-organiser-onboarding
 */

/** Every context this file opened, closed in `afterAll`. @type {object[]} */
const contexts = []

/** Every address any window of this file asked for, to search for codes. */
const requested = []

/** The administrator's window, kept for the whole story. @type {object} */
let admin
/** The owner's window, from J3. @type {object} */
let owner

/** The seeded ids. @type {object} */
let seeded
/** The organisation the owner starts. @type {{id: string, slug: string, name: string}} */
let studio
/** The two drafts written into it. @type {{first: object, second: object}} */
let drafts
/** The first code, replaced in J3. @type {string} */
let firstCode
/** The code that works. @type {string} */
let secondCode

/**
 * This run's seeded ids.
 *
 * @returns {object} The world.
 */
const ids = () => world()

/**
 * This run's onboarding names.
 *
 * @returns {object} The names.
 */
const names = () => onboardingNames(ids().tag)

/**
 * What a platform administrator's rail offers, in order: the platform's
 * moderation and visit pages, inviting organisers, every organisation's events
 * and imports, and nothing that needs a membership, money, privacy, retention
 * or the power to change roles.
 *
 * Written out rather than imported: a test that read the navigation's own
 * table would agree with whatever the table said.
 *
 * @type {ReadonlyArray<string>}
 */
const ADMIN_RAIL = Object.freeze([
  'Analytics',
  'Every event’s visits',
  'Moderation',
  'Organisation checks',
  'Pictures waiting',
  'Website links',
  'Organiser invitations',
  'All events',
  // SPEC3 §12.10: the Desi-Event team's referral codes and booking fee refunds.
  'Referral codes',
  'Booking fee refunds',
  'Imports',
])

/** The one sentence every unusable organiser code is refused with. */
const UNUSABLE =
  'That code cannot be used by this account. It may have expired, been withdrawn or used already, or it was sent to a different email address — sign in with the address the invitation was sent to.'

/** What the old self-service route says now, to anybody. */
const INVITATION_REQUIRED =
  'Organisations are not created from an account here. Organisers join Desi-Event by invitation from the Desi-Event team; if they have sent you an organiser invitation code, enter it at Your account → Accept an organiser invitation (/account/organizations/new).'

/** What the API says to a posting role asked for from a team page. */
const POSTING_REFUSAL =
  'Roles that create or publish events — event manager, manager, administrator and owner — are given by the Desi-Event team, not from this page. Ask the Desi-Event team to add this person to your organisation.'

/** What the team page says beside its invite form. */
const POSTING_SENTENCE =
  'Roles that create or publish events — event manager, manager, administrator and owner — are given by the Desi-Event team, not from this page. To add somebody who will create events, ask the Desi-Event team to add them to your organisation.'

/** What a member of the organisation is told on its event's review page. */
const CONFLICT_NOTICE =
  'You belong to this organisation, so somebody else on the Desi-Event team has to decide this.'

/** What the platform administration area says to somebody it does not admit. */
const ADMIN_AREA_REFUSAL =
  'This area is for the Desi-Event team’s platform administrators: inviting organisers, and changing who can do what across the platform. Nothing on this page can grant it.'

/** What People and roles says to a platform administrator. */
const PEOPLE_AND_ROLES_REFUSAL =
  'Changing platform roles and putting people into organisations directly are held by platform super administrators alone. Your role, platform administrator, does not include them, and nothing on this page can grant them.'

/**
 * A page's level-one heading.
 *
 * @param {object} page The Playwright page.
 * @param {string} name The heading.
 * @returns {object} The heading's locator.
 */
function pageHeading(page, name) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}

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
 * Make a fixture's page record every address it asks for.
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
 * Send one request to the API from the page, as a client would that went
 * round the screens: through the web's proxy, with the page's own session and
 * its CSRF token.
 *
 * @param {object} page The Playwright page, signed in.
 * @param {string} method The HTTP method.
 * @param {string} path The API path, starting `/api/v1/`.
 * @param {object} [body] The JSON body.
 * @returns {Promise<{status: number, code: string|null, message: string|null, text: string}>} What came back.
 */
function callApi(page, method, path, body) {
  return page.evaluate(
    async ({ method: verb, path: address, body: sent }) => {
      const token = document.cookie.match(/(?:^|;\s*)(?:__Host-)?desi_csrf=([^;]*)/u)
      const response = await fetch(address, {
        method: verb,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'x-desi-csrf': decodeURIComponent(token[1]) } : {}),
        },
        body: sent === undefined ? undefined : JSON.stringify(sent),
      })
      const text = await response.text()
      let parsed = null

      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }

      return {
        status: response.status,
        code: parsed?.error?.code ?? null,
        message: parsed?.error?.message ?? null,
        text,
      }
    },
    { method, path, body },
  )
}

/**
 * Confirm the page's session's second factor through the step-up endpoint,
 * the request the prompt itself sends, so the next privileged write reaches
 * its handler whatever the time since the last confirmation.
 *
 * For a refusal that is decided past the step-up: without it, a lapsed window
 * would answer `STEP_UP_REQUIRED` first, and the case would not reach the rule
 * it is about. The password and the code go in the body, never an address.
 *
 * @param {object} page The Playwright page, signed in with the seeded factor.
 * @returns {Promise<void>} Resolves once confirmed.
 */
async function freshFactor(page) {
  await waitOutCredentialBudget(
    page,
    async () => {
      await forgetCodeUse()

      const answer = await callApi(page, 'POST', '/api/v1/auth/step-up', {
        password: PASSWORD,
        code: currentCode(),
      })

      expect(answer.status, answer.text).toBe(200)
    },
    { refusedAt: /^\/api\/v1\/auth\//u },
  )
}

/**
 * WCAG 2.2 AA violations on the page, in words.
 *
 * @param {object} page The Playwright page.
 * @returns {Promise<string[]>} One line per violation.
 */
async function violationsOn(page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
    .exclude('nextjs-portal')
    .analyze()

  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} — ${violation.nodes
        .slice(0, 2)
        .map((node) => node.target.join(' '))
        .join(', ')}`,
  )
}

/**
 * The invitations table, whatever filter it is under.
 *
 * @param {object} page The Playwright page, on `/admin/organizer-invitations`.
 * @returns {object} The table's locator.
 */
function invitationsTable(page) {
  return page.getByRole('table', { name: /^Organiser invitations, /u })
}

/**
 * Open an event's editor on its review step.
 *
 * @param {object} page The organiser's page.
 * @param {string} eventId Which event.
 * @returns {Promise<void>} Resolves once the step is open.
 */
async function openReviewStep(page, eventId) {
  await page.goto(`/organizer/events/${eventId}`)
  // The step buttons answer only once the editor has hydrated.
  await expect(
    page.locator('[data-enhanced="true"]:has(nav[aria-label="Editor steps"])'),
  ).toBeAttached()

  // In the steps nav: the details step has a "Preview" button of its own,
  // whose name contains "review" too.
  const button = page
    .getByRole('navigation', { name: 'Editor steps' })
    .getByRole('button', { name: /review/iu })

  await button.click()
  await expect(button).toHaveAttribute('aria-current', 'step')
}

test.describe.serial('organisers join by invitation, and events go public after review', () => {
  test.beforeAll(async ({ browser }) => {
    seeded = await seedOnboarding(ids().tag)

    admin = await openWindow(browser, { permissions: ['clipboard-read', 'clipboard-write'] })
    await signIn(admin, names().adminEmail)
  })

  test.afterAll(async () => {
    for (const context of contexts) await context.close().catch(() => {})

    await cleanupOnboarding(ids().tag)
  })

  test('J1: the administrator invites a new organiser; the code is shown once, with a message to send', async () => {
    const { ownerEmail, studioName, studioDescription, studioWebsite, studioNote, adminName } =
      names()

    // A platform administrator's rail: the Desi-Event team's pages, and none
    // that needs a membership, money or the power to change roles.
    await admin.goto('/moderation/events')
    await expect(pageHeading(admin, 'Review queue')).toBeVisible()
    await expect(rail(admin).getByRole('link')).toHaveText([...ADMIN_RAIL])

    await rail(admin).getByRole('link', { name: 'Organiser invitations', exact: true }).click()
    await expect(admin).toHaveURL((url) => url.pathname === '/admin/organizer-invitations')
    await expect(pageHeading(admin, 'Organiser invitations')).toBeVisible()
    // How codes go out in this build is said before anything is pressed.
    await expect(
      admin.getByText(
        'Codes are not emailed from this site, so each code is shown to you once, with a message you can send from your own email. Hand it to them yourself.',
        { exact: true },
      ),
    ).toBeVisible()

    expect(await violationsOn(admin), 'the invitations page').toEqual([])

    // Issuing a code needs a second factor confirmed within the last two
    // minutes. The administrator's is made older than that, so the prompt
    // comes for certain and is answered from the page: drawn beside the
    // invite form, it sends the invitation once more and the code appears,
    // rather than the page reloading with nothing shown.
    await expireStepUp(names().adminEmail)

    const { code, panel, prompted } = await inviteOrganiser(admin, {
      email: ownerEmail,
      organizationName: studioName,
      description: studioDescription,
      website: studioWebsite,
      note: studioNote,
    })

    expect(prompted, 'the invite form asked for a second factor').toBe(true)
    firstCode = code

    // Focus goes to the panel, so a keyboard user is taken to the code; the
    // field cannot be typed over.
    await expect(
      panel.getByRole('heading', { name: `Organiser invitation code for ${ownerEmail}` }),
    ).toBeFocused()
    await expect(panel.getByLabel('Invitation code', { exact: true })).toHaveAttribute(
      'readonly',
      '',
    )

    // The message to send: the code once, on a line of its own with no
    // address on it, the page where it is typed, and the organisation's name
    // and the administrator's note in the scripts they were written in.
    const letter = await panel.getByLabel('Message to send them', { exact: true }).inputValue()

    expect(letter.split(code).length - 1, 'the code appears once in the message').toBe(1)
    expect(letter).toContain('/account/organizations/new')
    expect(letter).toContain(studioName)
    expect(letter).toContain(studioNote)
    expect(letter).toContain(adminName)
    expect(
      letter.split('\n').filter((line) => line.includes(code) && line.includes('http')),
      'a line carries both the code and an address',
    ).toEqual([])

    // Copying puts exactly the code on the clipboard, then exactly the
    // message, and says so politely each time.
    await panel.getByRole('button', { name: 'Copy the code', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('Copied the code to your clipboard.')
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(code)

    await panel.getByRole('button', { name: 'Copy the message', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('Copied the message to your clipboard.')
    expect(await admin.evaluate(() => navigator.clipboard.readText())).toBe(letter)

    expect(await violationsOn(admin), 'the invitations page with the code panel open').toEqual([])

    // In the page and in the response that minted it, and nowhere else.
    expect(await keptByTheBrowser(admin)).not.toContain(code)
    for (const url of requested) expect(url, 'a code reached an address').not.toContain(code)

    // Handed over: the code and the message go together, and the list shows
    // the invitation waiting, with how its code went out.
    await handOver(panel)
    expect(await admin.content()).not.toContain(code)

    const row = invitationsTable(admin).getByRole('row').filter({ hasText: ownerEmail })

    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Waiting')
    await expect(row).toContainText('Shown once to whoever sent it')
    await expect(row).toContainText(`New organisation: ${studioName}`)
    await expect(row).toContainText(`Website: ${studioWebsite}`)

    expect(await violationsOn(admin), 'the invitations page after the hand-over').toEqual([])
  })

  test('J2: nobody makes themselves an organiser', async ({ browser, visitor }) => {
    const stranger = await openWindow(browser)

    // No factor, so signing in asks for none.
    await signIn(stranger, names().strangerEmail)

    // The workspace refuses an attendee, and points at the two ways in that
    // are theirs to take — neither of which is a way round anybody.
    await stranger.goto('/organizer')
    await expect(pageHeading(stranger, 'Not for you')).toBeVisible()
    await expect(
      stranger
        .locator('main')
        .getByRole('link', { name: 'Accept an organiser invitation', exact: true }),
    ).toHaveAttribute('href', '/account/organizations/new')

    // The old self-service route says where to go, whatever it is sent, and
    // writes nothing.
    const created = await callApi(stranger, 'POST', '/api/v1/organizations', {
      name: `Stranger Collective ${ids().tag}`,
      timezone: 'America/Chicago',
      verificationStatus: 'VERIFIED',
    })

    expect(created.status, created.text).toBe(403)
    expect(created.code).toBe('ORGANIZER_INVITATION_REQUIRED')
    expect(created.message).toBe(INVITATION_REQUIRED)
    expect((await heldBy(names().strangerEmail)).memberships).toEqual([])

    // Registering offers no role to choose: every new account is an attendee.
    recording(visitor)
    await visitor.goto('/register')
    await expect(pageHeading(visitor, 'Create an account')).toBeVisible()

    const register = visitor.locator('main form')

    await expect(register.getByRole('radio')).toHaveCount(0)
    await expect(register.getByRole('combobox')).toHaveCount(0)
    await expect(register.getByLabel(/role|organi[sz]er/iu)).toHaveCount(0)

    // Somebody else holding the owner's code cannot use it, is told in the one
    // sentence every unusable code gets, and does not spend it.
    await waitOutCredentialBudget(
      stranger,
      async () => {
        await acceptOrganiserInvitation(stranger, firstCode)
        await expect(stranger.getByText(UNUSABLE, { exact: true })).toBeVisible()
      },
      { refusedAt: /^\/api\/v1\/organizer-invitations\//u },
    )
    expect(await keptByTheBrowser(stranger)).not.toContain(firstCode)

    await admin.goto('/admin/organizer-invitations')
    await expect(
      invitationsTable(admin).getByRole('row').filter({ hasText: names().ownerEmail }),
    ).toContainText('Waiting')
  })

  test('J3: a new code stops the first; the owner accepts, and the organisation is verified from the start', async ({
    browser,
  }) => {
    const { ownerEmail, studioName, studioDescription } = names()

    await admin.goto('/admin/organizer-invitations')

    const row = invitationsTable(admin).getByRole('row').filter({ hasText: ownerEmail })

    await row.getByRole('button', { name: `Issue a new code for ${ownerEmail}` }).click()

    const confirm = admin.getByRole('group', { name: `Issue a new code for ${ownerEmail}?` })

    await expect(confirm).toContainText('The code issued before stops working at once.')

    // Issuing a code needs a second factor confirmed within two minutes; the
    // last one is made older than that, so the prompt comes for certain.
    await expireStepUp(names().adminEmail)
    await confirm.getByRole('button', { name: 'Issue a new code', exact: true }).click()

    const panel = organiserCodePanel(admin, ownerEmail, { reissued: true })
    const prompted = await waitOutCredentialBudget(admin, () => confirmIfPrompted(admin, panel), {
      refusedAt: /^\/api\/v1\/auth\//u,
    })

    expect(prompted, 'a new code was issued without a fresh second factor').toBe(true)

    secondCode = await panel.getByLabel('Invitation code', { exact: true }).inputValue()
    expect(secondCode.length).toBeGreaterThanOrEqual(16)
    expect(secondCode).not.toBe(firstCode)
    await expect(panel.getByLabel('Message to send them', { exact: true })).toHaveValue(
      new RegExp(`^(?:.|\\n)*${secondCode}(?:.|\\n)*$`, 'u'),
    )
    expect(await keptByTheBrowser(admin)).not.toContain(secondCode)

    await handOver(panel)
    await expect(
      admin
        .getByRole('status')
        .filter({ hasText: `The new code for ${ownerEmail} is handed over.` }),
    ).toBeVisible()
    expect(await admin.content()).not.toContain(secondCode)

    // Still one invitation waiting for that address: the old one was replaced.
    await expect(
      invitationsTable(admin).getByRole('row').filter({ hasText: ownerEmail }),
    ).toHaveCount(1)

    // The owner, from their account page.
    owner = await openWindow(browser)
    await signIn(owner, ownerEmail)
    await owner.goto('/account')
    await owner
      .getByRole('region', { name: 'Where to go', exact: true })
      .getByRole('link', { name: /^Accept an organiser invitation/u })
      .click()
    await expect(pageHeading(owner, 'Accept an organiser invitation')).toBeVisible()

    // The code that was replaced: refused alike, and nothing is created.
    await waitOutCredentialBudget(
      owner,
      async () => {
        await acceptOrganiserInvitation(owner, firstCode)
        await expect(owner.getByText(UNUSABLE, { exact: true })).toBeVisible()
      },
      { refusedAt: /^\/api\/v1\/organizer-invitations\//u },
    )
    expect(await studioOrganization(ids().tag)).toBeNull()

    // And the live one, in Central time.
    await waitOutCredentialBudget(
      owner,
      async () => {
        await acceptOrganiserInvitation(owner, secondCode, { timezone: 'America/Chicago' })
        await expect(owner.getByText(`${studioName} is yours`, { exact: true })).toBeVisible()
      },
      { refusedAt: /^\/api\/v1\/organizer-invitations\//u },
    )
    // Spent, so cleared from the form rather than left for autofill.
    await expect(owner.getByLabel(/^Invitation code/u)).toHaveCount(0)
    expect(await keptByTheBrowser(owner)).not.toContain(secondCode)
    for (const url of requested) {
      expect(url, 'a code reached an address').not.toContain(firstCode)
      expect(url, 'a code reached an address').not.toContain(secondCode)
    }

    studio = await studioOrganization(ids().tag)
    expect(studio, 'the organisation was not written').not.toBeNull()
    expect(studio.name).toBe(studioName)
    // Its web address is made from the Latin part of its name.
    expect(studio.slug).toMatch(/^[a-z0-9-]+$/u)

    // Verified from the start, with the description the administrator wrote:
    // the person invited wrote none of it.
    await owner.getByRole('link', { name: 'Open its organisation page', exact: true }).click()
    await expect(pageHeading(owner, studioName)).toBeVisible()
    await expect(owner.locator('main')).toContainText(studioDescription)

    const verification = owner.getByRole('region', { name: 'Verification', exact: true })

    await expect(verification.getByText('Verification: Verified')).toBeVisible()
    await expect(
      verification.getByText('Created from an organiser invitation sent by the Desi-Event team.'),
    ).toBeVisible()
    await expect(owner.getByRole('form', { name: 'Ask for verification' })).toHaveCount(0)

    // The administrator's list, filtered to accepted invitations, links the
    // organisation it made.
    await admin.goto('/admin/organizer-invitations')
    await admin
      .getByRole('navigation', { name: 'Filter by status', exact: true })
      .getByRole('link', { name: 'Accepted', exact: true })
      .click()
    await expect(admin).toHaveURL(/status=ACCEPTED/u)

    const accepted = invitationsTable(admin).getByRole('row').filter({ hasText: ownerEmail })

    await expect(accepted).toContainText('Accepted')
    await expect(accepted.getByRole('link', { name: studioName, exact: true })).toHaveAttribute(
      'href',
      `/moderation/organizations/${studio.id}`,
    )
  })

  test('J4: the owner can add only roles that do not post events', async () => {
    await owner.goto(`/organizer/team?organizationId=${studio.id}`)
    await expect(pageHeading(owner, 'Team and roles')).toBeVisible()

    const invite = owner.getByRole('form', { name: 'Invite somebody' })

    // Finance, staff, scanner and viewer — the four an owner may give — and
    // none of the roles that create or publish events.
    await expect(invite.getByLabel(/^Role/u).locator('option')).toHaveText([
      'Finance',
      'Staff',
      'Door scanner',
      'Viewer',
    ])
    await expect(owner.getByText(POSTING_SENTENCE, { exact: true })).toBeVisible()

    // Nor will the API make one for a client that asks anyway, and nothing is
    // written.
    const email = `onboard-poster-${ids().tag}@attendee.test`
    const refused = await waitOutCredentialBudget(owner, async () => {
      const answer = await callApi(
        owner,
        'POST',
        `/api/v1/organizations/${studio.id}/invitations`,
        {
          email,
          role: 'EVENT_MANAGER',
        },
      )

      if (answer.status === 429) throw new Error('refused by the credential limiter')

      return answer
    })

    expect(refused.status, refused.text).toBe(403)
    expect(refused.code).toBe('POSTING_ROLE_NEEDS_PLATFORM')
    expect(refused.message).toBe(POSTING_REFUSAL)

    await owner.reload()
    await expect(pageHeading(owner, 'Team and roles')).toBeVisible()
    await expect(owner.locator('main')).not.toContainText(email)
  })

  test('J5: an event is public only after the Desi-Event team reviews it', async ({ visitor }) => {
    const { firstDraftTitle } = names()

    drafts = await draftEventFor(studio.id, ids().tag)

    // A draft: publishing is not offered, and the page says what comes first.
    await openReviewStep(owner, drafts.first.id)
    await expect(owner.getByText('State: Draft').first()).toBeVisible()
    await expect(
      owner
        .getByText('Nobody can see this but your team. Send it for review when it is ready.')
        .first(),
    ).toBeVisible()
    await expect(owner.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)

    await owner.getByRole('button', { name: 'Send for review' }).click()
    await owner.getByRole('button', { name: /yes, send for review/iu }).click()
    await expect(owner.getByText(/waiting for review\. a moderator has it/iu)).toBeVisible()
    await expect(owner.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)

    // Nothing public: not the page, and not a search for it. The page answers
    // as an address that was never an event does, so a draft's existence is
    // not given away.
    await visitor.goto(`/events/${drafts.first.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()
    await visitor.goto(`/events?q=${encodeURIComponent(firstDraftTitle)}`)
    await expect(pageHeading(visitor, 'What’s on')).toBeVisible()
    // The search echoes what was typed; the results hold nothing.
    await expect(visitor.getByTestId('result-count')).toHaveText(
      `0 events matching “${firstDraftTitle}”`,
    )
    await expect(visitor.locator('#event-results')).not.toContainText(firstDraftTitle)
    await expect(visitor.locator(`a[href*="${drafts.first.slug}"]`)).toHaveCount(0)

    // The administrator approves from the review queue, through a second
    // factor confirmed within the moderation window: the last one is made
    // older than that, so the prompt comes for certain.
    await admin.goto('/moderation/events')
    await admin.getByRole('link', { name: firstDraftTitle, exact: true }).click()
    await expect(admin).toHaveURL(new RegExp(`/moderation/events/${drafts.first.id}`, 'u'))

    await expireStepUp(names().adminEmail)
    await admin.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(admin.getByText(/the organiser chooses when to publish/iu)).toBeVisible()
    await admin.getByRole('button', { name: /yes, approve/iu }).click()

    const approved = admin.getByText(/this event is now APPROVED/iu)
    const prompted = await waitOutCredentialBudget(
      admin,
      () => confirmIfPrompted(admin, approved),
      { refusedAt: /^\/api\/v1\/auth\//u },
    )

    expect(prompted, 'an event was approved without a fresh second factor').toBe(true)
    expect((await eventState(drafts.first.id)).status).toBe('APPROVED')

    // Approving without saying which version was seen is refused before
    // anything is decided, with the reason named.
    const unseen = await callApi(
      admin,
      'POST',
      `/api/v1/moderation/events/${drafts.second.id}/decision`,
      { decision: 'approve' },
    )

    expect(unseen.status, unseen.text).toBe(400)
    expect(unseen.text).toContain(
      'Send the revision you reviewed, so a version you have not seen cannot be approved.',
    )
    expect((await eventState(drafts.second.id)).status).toBe('DRAFT')

    // Approved is not public until the owner publishes it.
    await visitor.goto(`/events/${drafts.first.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()

    await openReviewStep(owner, drafts.first.id)
    await expect(owner.getByText(/approved, not public/iu).first()).toBeVisible()
    await owner.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(owner.getByText(/publishing makes this page public/iu)).toBeVisible()
    await owner.getByRole('button', { name: /yes, publish/iu }).click()
    await waitOutCredentialBudget(
      owner,
      () => confirmIfPrompted(owner, owner.getByText(/the page is live/iu).first()),
      { refusedAt: /^\/api\/v1\/auth\//u },
    )

    await visitor.goto(`/events/${drafts.first.slug}`)
    await expect(pageHeading(visitor, firstDraftTitle)).toBeVisible()

    // A draft nobody reviewed cannot be published by asking the API either,
    // even straight after a second factor was confirmed.
    const unreviewed = await callApi(
      owner,
      'POST',
      `/api/v1/events/${drafts.second.id}/publish`,
      {},
    )

    expect(unreviewed.status, unreviewed.text).toBe(409)
    expect((await eventState(drafts.second.id)).status).toBe('DRAFT')
    await visitor.goto(`/events/${drafts.second.slug}`)
    await expect(visitor.getByTestId('not-found-view')).toBeVisible()
  })

  test('J6: an administrator who belongs to the organisation does not review its event', async () => {
    await seatAdministratorInGamma(ids().tag)

    try {
      await admin.goto(`/moderation/events/${seeded.waitingEventId}`)
      await expect(pageHeading(admin, names().waitingTitle)).toBeVisible()

      // Said, and no decision offered.
      await expect(admin.getByText(CONFLICT_NOTICE, { exact: true })).toBeVisible()
      await expect(admin.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)

      // Nor taken by asking the API, even with a fresh second factor and the
      // revision the page showed.
      await freshFactor(admin)

      const decided = await callApi(
        admin,
        'POST',
        `/api/v1/moderation/events/${seeded.waitingEventId}/decision`,
        { decision: 'approve', revision: seeded.waitingEventRevision },
      )

      expect(decided.status, decided.text).toBe(403)
      expect(decided.code).toBe('CONFLICT_OF_INTEREST')
      expect(decided.message).toBe(CONFLICT_NOTICE)
      expect((await eventState(seeded.waitingEventId)).status).toBe('REVIEW_PENDING')
    } finally {
      await unseatAdministratorFromGamma(ids().tag)
    }
  })

  test('J7: posting roles in an existing organisation come from the super administrator, and move only downwards', async ({
    browser,
    platform,
  }) => {
    const {
      joinerEmail,
      joinerName,
      gammaName,
      gammaOwnerEmail,
      gammaAdministratorName,
      gammaViewerName,
    } = names()

    recording(platform)

    // The super administrator puts the joiner into Onboard Gamma as an event
    // manager, from People and roles, through a second factor.
    await platform.goto('/admin/users')
    await expect(pageHeading(platform, 'People and roles')).toBeVisible()

    const search = platform.getByRole('form', { name: 'Find an account' })

    await search.getByLabel(/^Email address, name or account id/u).fill(joinerEmail)
    await search.getByRole('button', { name: 'Search', exact: true }).click()

    const card = platform.getByRole('article', { name: joinerName })

    await card.getByRole('button', { name: `Put ${joinerName} into an organisation` }).click()

    const find = card.getByRole('form', { name: 'Find an organisation' })

    await find.getByLabel(/^Organisation name or web address/u).fill(gammaName)
    await find.getByRole('button', { name: 'Find organisations', exact: true }).click()
    await card.getByRole('radio', { name: new RegExp(gammaName, 'u') }).check()
    await card.getByLabel(new RegExp(`^Role in ${gammaName}`, 'u')).selectOption('EVENT_MANAGER')
    await card
      .getByLabel(/^Reason/u)
      .last()
      .fill('Runs the autumn season’s events for the organisation.')
    await card.getByRole('button', { name: 'Give them the role', exact: true }).click()

    await waitOutCredentialBudget(
      platform,
      () =>
        confirmIfPrompted(
          platform,
          card.getByText(`${joinerName} is now event manager of ${gammaName}.`, { exact: false }),
        ),
      { refusedAt: /^\/api\/v1\/auth\//u },
    )
    expect((await heldBy(joinerEmail)).memberships).toEqual([
      { organizationId: seeded.gammaOrganizationId, role: 'EVENT_MANAGER' },
    ])

    // The owner's team page shows them, as an event manager.
    const gammaOwner = await openWindow(browser)

    await signIn(gammaOwner, gammaOwnerEmail)
    await gammaOwner.goto(`/organizer/team?organizationId=${seeded.gammaOrganizationId}`)
    await expect(pageHeading(gammaOwner, 'Team and roles')).toBeVisible()

    const members = gammaOwner.getByRole('table', { name: /^Members of/u })

    await expect(members.getByRole('row').filter({ hasText: joinerName })).toContainText(
      'Event manager',
    )

    // The owner cannot make a viewer an event manager: the screen does not
    // offer it, and the API refuses a client that asks anyway.
    const viewerRow = members.getByRole('row').filter({ hasText: gammaViewerName })

    await viewerRow.getByRole('button', { name: `Change ${gammaViewerName}’s role` }).click()

    const viewerPanel = gammaOwner.getByRole('group', { name: `Change ${gammaViewerName}’s role` })

    const viewerChoices = viewerPanel.getByLabel(/^New role/u).locator('option')

    await expect(viewerChoices.first()).toBeAttached()

    const offered = await viewerChoices.allTextContents()

    for (const posting of ['Event manager', 'Manager', 'Administrator', 'Owner']) {
      expect(offered, `a viewer is offered ${posting}`).not.toContain(posting)
    }
    await viewerPanel.getByRole('button', { name: 'Cancel', exact: true }).click()

    const promoted = await callApi(
      gammaOwner,
      'PATCH',
      `/api/v1/organizations/${seeded.gammaOrganizationId}/members/${seeded.gammaViewerMembershipId}`,
      { role: 'EVENT_MANAGER' },
    )

    expect(promoted.status, promoted.text).toBe(403)
    expect(promoted.code).toBe('POSTING_ROLE_NEEDS_PLATFORM')
    expect((await heldBy(names().gammaViewerEmail)).memberships).toEqual([
      { organizationId: seeded.gammaOrganizationId, role: 'VIEWER' },
    ])

    // And can move a posting member downwards: the administrator becomes an
    // event manager.
    const administratorRow = members.getByRole('row').filter({ hasText: gammaAdministratorName })

    await administratorRow
      .getByRole('button', { name: `Change ${gammaAdministratorName}’s role` })
      .click()

    const administratorPanel = gammaOwner.getByRole('group', {
      name: `Change ${gammaAdministratorName}’s role`,
    })

    await administratorPanel.getByLabel(/^New role/u).selectOption('EVENT_MANAGER')
    await administratorPanel.getByRole('button', { name: 'Save the new role', exact: true }).click()
    await waitOutCredentialBudget(
      gammaOwner,
      () =>
        confirmIfPrompted(
          gammaOwner,
          gammaOwner.getByText(`${gammaAdministratorName} is now event manager.`),
        ),
      { refusedAt: /^\/api\/v1\/auth\//u },
    )
    await expect(
      members.getByRole('row').filter({ hasText: gammaAdministratorName }),
    ).toContainText('Event manager')
  })

  test('J8: what a platform administrator cannot do, and a moderator is not admitted', async ({
    browser,
    platform,
  }) => {
    // People and roles is the super administrators' alone.
    await admin.goto('/admin/users')
    await expect(pageHeading(admin, 'Not for you')).toBeVisible()
    await expect(admin.getByText(PEOPLE_AND_ROLES_REFUSAL, { exact: true })).toBeVisible()
    await expect(
      admin
        .getByRole('navigation', { name: 'Platform administration', exact: true })
        .getByRole('link', { name: 'People and roles', exact: true }),
    ).toHaveCount(0)

    // And the API agrees, for a client that asks anyway, with nothing changed.
    const changed = await callApi(
      admin,
      'POST',
      `/api/v1/platform/users/${seeded.strangerId}/role`,
      {
        role: 'MODERATOR',
        reason: 'Joining the trust team to review organisations.',
      },
    )

    expect(changed.status, changed.text).toBe(403)
    expect((await heldBy(names().strangerEmail)).role).toBe('ATTENDEE')

    // The super administrator sees both pages, and changes nothing here.
    await platform.goto('/admin/organizer-invitations')
    await expect(pageHeading(platform, 'Organiser invitations')).toBeVisible()

    const tabs = platform.getByRole('navigation', { name: 'Platform administration', exact: true })

    await expect(
      tabs.getByRole('link', { name: 'Organiser invitations', exact: true }),
    ).toBeVisible()
    await expect(tabs.getByRole('link', { name: 'People and roles', exact: true })).toBeVisible()

    // A moderator reviews events and is not on the team that invites
    // organisers: the whole area is refused.
    const moderator = await openWindow(browser)

    await signIn(moderator, ids().doorModeratorEmail)
    await moderator.goto('/admin/organizer-invitations')
    await expect(pageHeading(moderator, 'Not for you')).toBeVisible()
    await expect(moderator.getByText(ADMIN_AREA_REFUSAL, { exact: true })).toBeVisible()
    await expect(pageHeading(moderator, 'Organiser invitations')).toHaveCount(0)

    // No window of this story ever asked for an address carrying a code.
    for (const url of requested) {
      expect(url, 'a code reached an address').not.toContain(firstCode)
      expect(url, 'a code reached an address').not.toContain(secondCode)
    }
  })
})

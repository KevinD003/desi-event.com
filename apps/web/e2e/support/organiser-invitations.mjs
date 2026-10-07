/**
 * Inviting an organiser from `/admin/organizer-invitations`, as the Desi-Event
 * team does, and reading the code the page shows once.
 *
 * Organisers join only by such an invitation, so every journey that needs an
 * organisation of somebody's own starts here: the team-and-organisations
 * story invites its creators, the onboarding story is about the invitation
 * itself, and the accessibility sweep measures the panel with its letter.
 * Written once so that each of them drives the form the same way and reads
 * the code from the same place — the read-only field in the panel, never an
 * address or storage, which every caller asserts on its own.
 *
 * Every spec that imports this keeps no screenshot, trace or film: a code on
 * screen is a credential until it is used (`lib/e2e-code-hygiene.test.js`).
 *
 * @module e2e/support/organiser-invitations
 */

import { expect } from '@playwright/test'

import { confirmIfPrompted, waitOutCredentialBudget } from './step-up.mjs'

/**
 * The invite form on the invitations page.
 *
 * @param {object} page The Playwright page, on `/admin/organizer-invitations`.
 * @returns {object} The form's locator.
 */
export function organiserInviteForm(page) {
  return page.getByRole('form', { name: 'Invite an organiser', exact: true })
}

/**
 * The panel that shows a new invitation's code, by the address it is for.
 *
 * @param {object} page The Playwright page.
 * @param {string} email The address invited.
 * @param {object} [options] Options.
 * @param {boolean} [options.reissued] Whether it is a new code for an invitation already sent.
 * @returns {object} The panel's locator.
 */
export function organiserCodePanel(page, email, { reissued = false } = {}) {
  return page.getByRole('region', {
    name: `${reissued ? 'New organiser' : 'Organiser'} invitation code for ${email}`,
    exact: true,
  })
}

/**
 * Fill the invite form and press its button.
 *
 * @param {object} page The Playwright page, on `/admin/organizer-invitations`.
 * @param {object} fields What to write.
 * @param {string} fields.email The address to invite.
 * @param {string} fields.organizationName The organisation it starts.
 * @param {string} [fields.description] Its public description.
 * @param {string} [fields.website] Its website.
 * @param {string} [fields.note] A note for the person invited.
 * @returns {Promise<void>} Resolves once pressed.
 */
export async function fillOrganiserInvitation(
  page,
  { email, organizationName, description, website, note },
) {
  const form = organiserInviteForm(page)

  await form.getByLabel(/^Their email address/u).fill(email)
  await form.getByLabel(/^Organisation name/u).fill(organizationName)
  if (description) {
    await form.getByLabel(/^Public description of the organisation/u).fill(description)
  }
  if (website) await form.getByLabel(/^The organisation’s website/u).fill(website)
  if (note) await form.getByLabel(/^A note for them/u).fill(note)
  await form.getByRole('button', { name: 'Create the invitation', exact: true }).click()
}

/**
 * Invite an organiser and return the code the page showed, once.
 *
 * Issuing needs a second factor confirmed within the SECURITY_ROLE window, so
 * the prompt is answered if, and only if, it comes, with the credential budget
 * honoured. The code is read from the panel's read-only field. The panel is
 * left open: the caller decides when it is handed over, since some callers
 * assert the panel first.
 *
 * @param {object} page The Playwright page, on `/admin/organizer-invitations`.
 * @param {object} fields As {@link fillOrganiserInvitation} takes them.
 * @returns {Promise<{code: string, panel: object, prompted: boolean}>} The code, the panel showing it, and whether a second factor was asked for on the way.
 */
export async function inviteOrganiser(page, fields) {
  const panel = organiserCodePanel(page, fields.email)

  await expect(organiserInviteForm(page)).toBeVisible()
  await fillOrganiserInvitation(page, fields)

  const prompted = await waitOutCredentialBudget(page, () => confirmIfPrompted(page, panel), {
    refusedAt: /^\/api\/v1\/auth\//u,
  })
  const code = await panel.getByLabel('Invitation code', { exact: true }).inputValue()

  expect(code.length, 'no code was shown').toBeGreaterThanOrEqual(16)

  return { code, panel, prompted }
}

/**
 * Say a code panel's code is handed over, and wait for the panel to go.
 *
 * @param {object} panel The panel's locator.
 * @returns {Promise<void>} Resolves once it has gone.
 */
export async function handOver(panel) {
  await panel.getByRole('button', { name: 'I have handed it over', exact: true }).click()
  await expect(panel).toHaveCount(0)
}

/**
 * Type an organiser invitation code at `/account/organizations/new` and press
 * accept.
 *
 * @param {object} page The Playwright page, signed in as the person invited.
 * @param {string} code The code.
 * @param {object} [options] Options.
 * @param {string} [options.timezone] The time zone to choose.
 * @returns {Promise<void>} Resolves once pressed.
 */
export async function acceptOrganiserInvitation(page, code, { timezone } = {}) {
  await page.goto('/account/organizations/new')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Accept an organiser invitation', exact: true }),
  ).toBeVisible()

  const form = page.getByRole('form', { name: 'Accept an organiser invitation', exact: true })
  const field = form.getByLabel(/^Invitation code/u)

  // A code is typed, like a password, and never read from the address.
  await expect(field).toHaveAttribute('type', 'password')
  await field.fill(code)
  if (timezone) await form.getByLabel(/^Time zone/u).selectOption(timezone)
  await form.getByRole('button', { name: 'Accept the invitation', exact: true }).click()
}

/**
 * Accepting an organiser invitation sends the code and only what an organiser
 * may choose, keeps the code out of sight and out of storage, and says plainly
 * what accepting did. Rewritten from the create-an-organisation form's test,
 * which this form replaces: organisations are not made from an account here.
 * The refusals that survive — a web address taken, a name that makes no web
 * address, a limit reached — are kept.
 *
 * @file app/account/organizations/new/organizer-invitation-accept-form.test.jsx
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../../lib/api-fetch.js')
const {
  NO_ADDRESS_FROM_NAME,
  NO_CODE,
  OrganizerInvitationAcceptForm,
  PART_OF_A_CODE,
  SLUG_TAKEN,
  TEAM_CODE_HERE,
  UNUSABLE_CODE,
} = await import('./organizer-invitation-accept-form.jsx')
const { default: AcceptOrganizerInvitationPage } = await import('./page.jsx')

const CODE = 'Pq7_wE0-rT3yU6iO9pA2sD5fG8hJ1kL4zX7cV0bN3m'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @param {object} [headers] Response headers.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  }
}

/**
 * What the API answers for an accepted invitation.
 *
 * @param {object} session What the session now needs.
 * @returns {object} The body.
 */
function accepted(session) {
  return {
    data: {
      organization: {
        id: 'org00000000000000000009',
        name: 'Bay Lights Garba Co.',
        slug: 'bay-lights-garba-co',
        description: null,
        websiteUrl: null,
        timezone: 'America/Los_Angeles',
        legalName: null,
        verificationStatus: 'VERIFIED',
        eligible: true,
        createdAt: '2026-10-05T15:00:00.000Z',
      },
      role: 'OWNER',
      session,
    },
  }
}

/**
 * Type the code and press Accept.
 *
 * @param {object} user The user-event instance.
 * @param {string} [code] What to type.
 * @returns {Promise<void>} Resolves once pressed.
 */
async function acceptWith(user, code = CODE) {
  if (code) await user.type(screen.getByLabelText(/^Invitation code/u), code)
  await user.click(screen.getByRole('button', { name: 'Accept the invitation' }))
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the accept-an-organiser-invitation page', () => {
  it('says organisers join by invitation, and what accepting does, before the form', () => {
    render(<AcceptOrganizerInvitationPage />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'Accept an organiser invitation' }),
    ).toBeVisible()
    expect(
      screen.getByText(/Organisers join Desi-Event by invitation from the Desi-Event team/u),
    ).toBeVisible()
    expect(screen.getByText(/It\s+is verified from the start/u)).toBeVisible()
    expect(
      screen.getByText(
        'Every event you create is reviewed by the Desi-Event team before it can be published.',
      ),
    ).toBeVisible()
    expect(screen.getByText(/Payments on this site are simulated/u)).toBeVisible()
    expect(screen.getByRole('link', { name: 'What this site does not do' })).toHaveAttribute(
      'href',
      '/limitations',
    )
    expect(screen.getByText(/It is not shown publicly/u)).toBeVisible()
    expect(screen.getByText(/Owners must use two-step sign-in/u)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Join an organisation’s team' })).toHaveAttribute(
      'href',
      '/account/invitations',
    )
    expect(screen.getByRole('form', { name: 'Accept an organiser invitation' })).toBeVisible()
  })

  it('reads no code from its address: it takes no props, and nothing is pre-filled', () => {
    expect(AcceptOrganizerInvitationPage.length).toBe(0)

    render(
      <AcceptOrganizerInvitationPage searchParams={Promise.resolve({ token: CODE, code: CODE })} />,
    )

    expect(screen.getByLabelText(/^Invitation code/u)).toHaveValue('')
    expect(document.body.innerHTML).not.toContain(CODE)
  })

  it('offers no way to make an organisation of your own', () => {
    const { container } = render(<AcceptOrganizerInvitationPage />)

    expect(container.textContent).not.toMatch(/create an organisation|starts unverified/iu)
    expect(screen.queryByLabelText(/^Name/u)).toBeNull()
  })
})

describe('the accept form', () => {
  it('hides the code as it is typed and keeps it out of autofill', () => {
    render(<OrganizerInvitationAcceptForm />)

    const field = screen.getByLabelText(/^Invitation code/u)

    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('spellcheck', 'false')
  })

  it('sends the code, the time zone and a typed web address — never a name, contact or currency', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, accepted({ mfaRequired: true, mfaEnrolled: true })))
    render(<OrganizerInvitationAcceptForm />)

    await user.selectOptions(screen.getByLabelText(/Time zone/u), 'America/Los_Angeles')
    await user.type(screen.getByLabelText(/Web address on this site/u), ' bay-lights ')
    await acceptWith(user, `  ${CODE} `)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/organizer-invitations/accept')

    const sent = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(sent).toEqual({ token: CODE, timezone: 'America/Los_Angeles', slug: 'bay-lights' })

    for (const key of [
      'name',
      'description',
      'websiteUrl',
      'contactEmail',
      'payoutCurrency',
      'verificationStatus',
    ]) {
      expect(Object.keys(sent)).not.toContain(key)
    }
  })

  it('leaves the web address out when none was typed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, accepted({ mfaRequired: true, mfaEnrolled: true })))
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      token: CODE,
      timezone: 'America/New_York',
    })
  })

  it('sends nothing that cannot be a code, and says why in the field', async () => {
    const user = userEvent.setup()

    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user, '')

    expect(screen.getByText(NO_CODE)).toBeVisible()

    await acceptWith(user, 'abc123')

    expect(screen.getByText(PART_OF_A_CODE)).toBeVisible()
    expect(apiFetch).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText(/^Invitation code/u)).toHaveFocus())
  })

  it('clears the code once it is accepted, says what it made, and sends an owner with no second factor to set one up', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValue(answer(201, accepted({ mfaRequired: true, mfaEnrolled: false })))

    const { container } = render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByText('Bay Lights Garba Co. is yours')).toBeVisible()
    expect(screen.getByText(/You are its owner, and it is verified/u)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
    expect(screen.queryByRole('link', { name: 'Open its organisation page' })).toBeNull()
    expect(screen.queryByLabelText(/^Invitation code/u)).toBeNull()
    expect(container.innerHTML).not.toContain(CODE)
    expect(setItem).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  it('sends an owner who has a second factor to the new organisation’s page, and moves focus there', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, accepted({ mfaRequired: true, mfaEnrolled: true })))
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByRole('link', { name: 'Open its organisation page' })).toHaveAttribute(
      'href',
      '/organizer/organization?organizationId=org00000000000000000009',
    )

    const panel = screen.getByText(/You are its owner/u).closest('[tabindex="-1"]')

    await waitFor(() => expect(panel).toHaveFocus())
  })

  it('repeats the one sentence for a code this account cannot use', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'INVITATION_UNUSABLE', message: UNUSABLE_CODE } }),
    )
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    const sentence = await screen.findByText(UNUSABLE_CODE)

    await waitFor(() => expect(sentence.closest('[tabindex="-1"]')).toHaveFocus())
    // The field still holds the code: nothing was spent, and it can be checked.
    expect(screen.getByLabelText(/^Invitation code/u)).toHaveValue(CODE)
  })

  it('treats a malformed code as one more code this account cannot use', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(400, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request',
          issues: [{ path: 'body.token', message: 'Invalid token' }],
        },
      }),
    )
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByText(UNUSABLE_CODE)).toBeVisible()
  })

  it('sends a team invitation’s code to where team codes go', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: { code: 'WRONG_INVITATION_KIND', message: 'That is a team invitation code.' },
      }),
    )
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByText(TEAM_CODE_HERE)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Join an organisation’s team' })).toHaveAttribute(
      'href',
      '/account/invitations',
    )
  })

  it('repeats the API’s sentence for a staff account', async () => {
    const user = userEvent.setup()
    const sentence =
      'This account holds a Desi-Event staff role, so it cannot accept an organiser invitation. A super administrator can add a staff account to an organisation directly.'

    apiFetch.mockResolvedValue(answer(403, { error: { code: 'STAFF_ACCOUNT', message: sentence } }))
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByText(sentence)).toBeVisible()
  })

  it('says the code is still good when two-step sign-in has to come first', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'MFA_ENROLMENT_REQUIRED', message: 'Enrol one.' } }),
    )
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    expect(await screen.findByText(/Your code has not been used/u)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Set up two-step sign-in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
  })

  it('says, under the web address and in the form’s own words, when the name makes no web address', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message:
            'That name makes no web address, because it has no letters from A to Z or digits. Supply "slug".',
        },
      }),
    )
    render(<OrganizerInvitationAcceptForm />)

    await acceptWith(user)

    const sentences = await screen.findAllByText(NO_ADDRESS_FROM_NAME)

    expect(sentences.length).toBeGreaterThan(0)
    // The form has no field called "slug"; it has a web address.
    expect(screen.queryByText(/slug/iu)).toBeNull()
    expect(screen.getByLabelText(/Web address on this site/u)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('repeats the API’s sentence for a taken web address, and says how long to wait after a limit', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(409, { error: { code: 'CONFLICT', message: SLUG_TAKEN } }))
      .mockResolvedValueOnce(
        answer(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '3600' }),
      )
    render(<OrganizerInvitationAcceptForm />)

    await user.type(screen.getByLabelText(/Web address on this site/u), 'rangoli-collective')
    await acceptWith(user)

    expect(await screen.findByText(`${SLUG_TAKEN} Your code has not been used.`)).toBeVisible()
    expect(screen.getByLabelText(/Web address on this site/u)).toHaveAttribute(
      'aria-invalid',
      'true',
    )

    await user.click(screen.getByRole('button', { name: 'Accept the invitation' }))

    expect(await screen.findByText(/Wait about 1 hours?, then try again/u)).toBeVisible()
  })

  it('claims nothing for the time zone that the organisation’s zone does not do', () => {
    render(<OrganizerInvitationAcceptForm />)

    const field = screen.getByLabelText(/Time zone/u)
    const help = document.getElementById(field.getAttribute('aria-describedby').split(' ')[0])

    // Reports and sales windows use each event's own zone, not this one.
    expect(help.textContent).not.toMatch(/report|sales window/iu)
    expect(help.textContent).toMatch(/public page/u)
  })
})

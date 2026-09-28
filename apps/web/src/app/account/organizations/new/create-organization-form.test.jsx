/**
 * Creating an organisation sends only what a person may choose, and says
 * plainly what a new organisation cannot do.
 *
 * @file app/account/organizations/new/create-organization-form.test.jsx
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../../lib/api-fetch.js')
const { CreateOrganizationForm, NO_ADDRESS_FROM_NAME } =
  await import('./create-organization-form.jsx')
const { default: CreateOrganizationPage } = await import('./page.jsx')

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
 * What the API answers for a new organisation.
 *
 * @param {object} session What the session now needs.
 * @returns {object} The body.
 */
function created(session) {
  return {
    data: {
      id: 'org00000000000000000009',
      name: 'Bay Lights Garba Co.',
      slug: 'bay-lights-garba-co',
      description: null,
      websiteUrl: null,
      timezone: 'America/Los_Angeles',
      legalName: null,
      verificationStatus: 'UNVERIFIED',
      eligible: false,
      createdAt: '2026-09-28T15:00:00.000Z',
      role: 'OWNER',
      session,
    },
  }
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('the create-an-organisation page', () => {
  it('says what a new organisation cannot do, before the form', () => {
    render(<CreateOrganizationPage />)

    expect(screen.getByText(/It starts unverified/u)).toBeVisible()
    expect(
      screen.getByText(/cannot publish them or be paid until a moderator has verified it/u),
    ).toBeVisible()
    expect(screen.getByText(/Payments on this site are simulated/u)).toBeVisible()
    expect(screen.getByRole('link', { name: 'What this site does not do' })).toHaveAttribute(
      'href',
      '/limitations',
    )
    expect(screen.getByText(/recorded as its contact address/u)).toBeVisible()
    expect(screen.getByText(/It is\s+not shown publicly/u)).toBeVisible()
    expect(screen.getByText(/Owners must use two-step sign-in/u)).toBeVisible()
  })
})

describe('the create form', () => {
  it('sends only the name, time zone and the optional fields filled in', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, created({ mfaRequired: true, mfaEnrolled: true })))
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), '  Bay Lights Garba Co. ')
    await user.selectOptions(screen.getByLabelText(/Time zone/u), 'America/Los_Angeles')
    await user.type(screen.getByLabelText(/Its website/u), 'https://baylights.example')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe('/v1/organizations')

    const sent = JSON.parse(apiFetch.mock.calls[0][1].body)

    expect(sent).toEqual({
      name: 'Bay Lights Garba Co.',
      timezone: 'America/Los_Angeles',
      websiteUrl: 'https://baylights.example',
    })
    expect(Object.keys(sent)).not.toContain('contactEmail')
    expect(Object.keys(sent)).not.toContain('payoutCurrency')
    expect(Object.keys(sent)).not.toContain('verificationStatus')
  })

  it('sends a new owner with no second factor to set one up', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, created({ mfaRequired: true, mfaEnrolled: false })))
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), 'Bay Lights Garba Co.')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    expect(await screen.findByRole('link', { name: 'Set up two-step sign-in' })).toHaveAttribute(
      'href',
      '/account/security',
    )
    expect(
      screen.queryByRole('link', { name: 'Open its organisation page' }),
    ).not.toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('sends an owner who has one to the new organisation’s page', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, created({ mfaRequired: true, mfaEnrolled: true })))
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), 'Bay Lights Garba Co.')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    expect(await screen.findByRole('link', { name: 'Open its organisation page' })).toHaveAttribute(
      'href',
      '/organizer/organization?organizationId=org00000000000000000009',
    )
    expect(screen.getByText(/It is unverified/u)).toBeVisible()
  })

  it('repeats the API’s sentence for a taken web address, and says how long after a limit', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: 'CONFLICT',
            message: 'That web address is taken by another organisation. Choose another.',
          },
        }),
      )
      .mockResolvedValueOnce(
        answer(429, { error: { code: 'RATE_LIMITED', message: 'x' } }, { 'retry-after': '3600' }),
      )
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), 'Bay Lights')
    await user.type(screen.getByLabelText(/Web address on this site/u), 'rangoli-collective')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    expect(await screen.findByText(/That web address is taken/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    expect(await screen.findByText(/Wait about 1 hours?, then try again/u)).toBeInTheDocument()
  })

  it('says, in the form’s own words, when a name makes no web address', async () => {
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
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), 'गरबा रात')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    const sentence = await screen.findByText(NO_ADDRESS_FROM_NAME)

    expect(sentence).toBeInTheDocument()
    // The form has no field called "slug" or "title"; it has a web address.
    expect(screen.queryByText(/slug|title/iu)).not.toBeInTheDocument()
    await waitFor(() => expect(sentence.closest('[tabindex="-1"]')).toHaveFocus())
  })

  it('moves focus to what it created, since the form and its button are gone', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, created({ mfaRequired: true, mfaEnrolled: true })))
    render(<CreateOrganizationForm />)

    await user.type(screen.getByLabelText(/^Name/u), 'Bay Lights Garba Co.')
    await user.click(screen.getByRole('button', { name: 'Create the organisation' }))

    const panel = (await screen.findByText(/It is unverified/u)).closest('[tabindex="-1"]')

    expect(panel).not.toBeNull()
    await waitFor(() => expect(panel).toHaveFocus())
  })

  it('claims nothing for the time zone that the organisation’s zone does not do', () => {
    render(<CreateOrganizationForm />)

    const field = screen.getByLabelText(/Time zone/u)
    const help = document.getElementById(field.getAttribute('aria-describedby').split(' ')[0])

    // Reports and sales windows use each event's own zone, not this one.
    expect(help.textContent).not.toMatch(/report|sales window/iu)
    expect(help.textContent).toMatch(/public page/u)
  })

  it('waits for a name of at least two characters', async () => {
    const user = userEvent.setup()

    render(<CreateOrganizationForm />)

    expect(screen.getByRole('button', { name: 'Create the organisation' })).toBeDisabled()

    await user.type(screen.getByLabelText(/^Name/u), 'B')

    expect(screen.getByRole('button', { name: 'Create the organisation' })).toBeDisabled()
  })
})

/**
 * The join page takes a code typed in, and never one from its address; says
 * how the code arrives in the delivery mode the session reports; and points
 * an organiser invitation's holder to the page where that code works.
 *
 * @module app/account/invitations/page.test
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../../lib/session.js')
const { default: JoinOrganisationPage, HOW_THE_CODE_ARRIVES } = await import('./page.jsx')

const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

/**
 * Render the page for a delivery mode.
 *
 * @param {'MANUAL'|'EMAIL'|null} [deliveryMode] What `auth.me` reports.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(deliveryMode = 'MANUAL') {
  readSession.mockResolvedValue({ user: { displayName: 'Meera' }, deliveryMode })

  return render(await JoinOrganisationPage())
}

beforeEach(() => {
  readSession.mockReset()
})

describe('the join page', () => {
  it('asks for the code in a hidden field and says why it is typed, not linked', async () => {
    await renderPage()

    const field = screen.getByLabelText(/Invitation code/u)

    expect(screen.getByRole('heading', { name: 'Join an organisation' })).toBeInTheDocument()
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText(/never carried in a web address/u)).toBeVisible()
  })

  it('says, when codes are not emailed, that whoever invited you hands it over', async () => {
    const { container } = await renderPage('MANUAL')

    expect(screen.getByText(/whoever invited you hands it to you themselves/u)).toBeVisible()
    expect(container.textContent).not.toMatch(/sends no email/iu)
  })

  it('says, when codes are emailed, that it went to the invited address', async () => {
    const { container } = await renderPage('EMAIL')

    expect(container.textContent).toContain(HOW_THE_CODE_ARRIVES.EMAIL)
    expect(container.textContent).not.toMatch(/hands it to you themselves/u)
  })

  it('says nothing about how the code arrived when the mode is not known', async () => {
    const { container } = await renderPage(null)

    for (const sentence of Object.values(HOW_THE_CODE_ARRIVES)) {
      expect(container.textContent).not.toContain(sentence)
    }
  })

  it('points an organiser invitation’s code to the page where it works', async () => {
    await renderPage()

    expect(
      screen.getByText(/Sent an organiser invitation by the team at The Desi Events\?/u),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Accept an organiser invitation' })).toHaveAttribute(
      'href',
      '/account/organizations/new',
    )
  })

  it('ignores a code put in its address: nothing is read or pre-filled', async () => {
    // The page takes no searchParams at all; a code in the query string has
    // nowhere to go.
    readSession.mockResolvedValue({ user: { displayName: 'Meera' }, deliveryMode: 'MANUAL' })
    render(
      await JoinOrganisationPage({ searchParams: Promise.resolve({ token: CODE, code: CODE }) }),
    )

    expect(screen.getByLabelText(/Invitation code/u)).toHaveValue('')
    expect(document.body.innerHTML).not.toContain(CODE)
    expect(JoinOrganisationPage.length).toBe(0)
  })
})

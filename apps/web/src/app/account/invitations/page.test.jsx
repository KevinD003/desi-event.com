/**
 * The join page takes a code typed in, and never one from its address.
 *
 * @module app/account/invitations/page.test
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const { default: JoinOrganisationPage } = await import('./page.jsx')

const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

describe('the join page', () => {
  it('asks for the code in a hidden field and says why it is typed, not linked', () => {
    render(<JoinOrganisationPage />)

    const field = screen.getByLabelText(/Invitation code/u)

    expect(screen.getByRole('heading', { name: 'Join an organisation' })).toBeInTheDocument()
    expect(field).toHaveAttribute('type', 'password')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(screen.getByText(/never carried in a web address/u)).toBeVisible()
    expect(screen.getByText(/whoever invited you hands it to you themselves/u)).toBeVisible()
  })

  it('ignores a code put in its address: nothing is read or pre-filled', () => {
    // The page takes no searchParams at all; a code in the query string has
    // nowhere to go.
    render(<JoinOrganisationPage searchParams={Promise.resolve({ token: CODE, code: CODE })} />)

    expect(screen.getByLabelText(/Invitation code/u)).toHaveValue('')
    expect(document.body.innerHTML).not.toContain(CODE)
    expect(JoinOrganisationPage.length).toBe(0)
  })
})

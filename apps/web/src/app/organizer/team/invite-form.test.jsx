/**
 * The invite form sends what the API expects, and keeps the code it gets back
 * where it was put.
 *
 * The properties worth pinning:
 *
 *   - it posts the address and the role, and only roles the caller may grant
 *     are offered — never Owner;
 *   - a MANUAL answer draws the code once in the one-time panel, which "I have
 *     handed it over" removes, and only then is the page read again;
 *   - the code never reaches browser storage, a link or the address bar;
 *   - an EMAIL answer draws no code at all;
 *   - refusals are the API's own sentences, and a rate limit says how long.
 *
 * @module app/organizer/team/invite-form.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { InviteForm } = await import('./invite-form.jsx')

const ORG = 'org00000000000000000001'
const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

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
 * An invitation as the API answers it.
 *
 * @param {object} delivery The delivery block.
 * @returns {object} The body.
 */
function invited(delivery) {
  return {
    data: {
      id: 'inv00000000000000000001',
      email: 'new.person@example.com',
      role: 'STAFF',
      status: 'PENDING',
      invitedByName: 'Admin',
      expiresAt: '2026-10-12T15:00:00.000Z',
      createdAt: '2026-09-28T15:00:00.000Z',
      deliveryMode: delivery.mode,
      delivery,
    },
  }
}

/**
 * Fill the form and send it.
 *
 * @param {object} user A userEvent instance.
 * @returns {Promise<void>} Resolves once sent.
 */
async function invite(user) {
  await user.type(screen.getByLabelText(/Their email address/u), 'new.person@example.com')
  await user.click(screen.getByRole('button', { name: 'Invite them' }))
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('the invite form', () => {
  it('posts the address and the chosen role, and offers only grantable roles', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, invited({ mode: 'MANUAL', invitationCode: CODE })))
    render(<InviteForm organizationId={ORG} assignableRoles={['OWNER', 'MANAGER', 'STAFF']} />)

    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/Role/u), 'MANAGER')
    await invite(user)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORG}/invitations`)
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      email: 'new.person@example.com',
      role: 'MANAGER',
    })
  })

  it('shows the code once, and only reads the page again after it is handed over', async () => {
    const user = userEvent.setup()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    apiFetch.mockResolvedValue(answer(201, invited({ mode: 'MANUAL', invitationCode: CODE })))

    const { container } = render(<InviteForm organizationId={ORG} assignableRoles={['STAFF']} />)

    await invite(user)

    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)
    expect(
      screen.getByText(/only for someone signed in as new\.person@example\.com/u),
    ).toBeVisible()
    // Not yet: a re-render now could lose the code before it is handed over.
    expect(refresh).not.toHaveBeenCalled()

    // Nowhere but the field: no storage, no link, no address.
    expect(setItem).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(CODE)
    for (const element of container.querySelectorAll('[href]')) {
      expect(element.getAttribute('href')).not.toContain(CODE)
    }

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(container.innerHTML).not.toContain(CODE)
    expect(refresh).toHaveBeenCalledTimes(1)

    setItem.mockRestore()
  })

  it('shows no code when the invitation was emailed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, invited({ mode: 'EMAIL', invitationCode: null })))

    const { container } = render(<InviteForm organizationId={ORG} assignableRoles={['STAFF']} />)

    await invite(user)

    expect(
      await screen.findByText('An invitation was emailed to new.person@example.com.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument()
    expect(container.innerHTML).not.toContain(CODE)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('repeats the API’s own sentence when it refuses, and draws no code', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: { code: 'CONFLICT', message: 'That person is already in this organisation.' },
      }),
    )
    render(<InviteForm organizationId={ORG} assignableRoles={['STAFF']} />)

    await invite(user)

    expect(
      await screen.findByText('That person is already in this organisation.'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument()
  })

  it('says how long to wait when rate limited', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(
        429,
        { error: { code: 'RATE_LIMITED', message: 'Too many.' } },
        { 'retry-after': '30' },
      ),
    )
    render(<InviteForm organizationId={ORG} assignableRoles={['STAFF']} />)

    await invite(user)

    expect(await screen.findByText(/Wait about a minute, then try again/u)).toBeInTheDocument()
  })

  it('says a door role admits nobody until its events are chosen', async () => {
    const user = userEvent.setup()

    render(<InviteForm organizationId={ORG} assignableRoles={['SCANNER', 'VIEWER']} />)
    await user.selectOptions(screen.getByLabelText(/Role/u), 'SCANNER')

    expect(screen.getByText(/A door role admits nobody until you choose its events/u)).toBeVisible()
  })

  it('draws nothing when no role may be granted', () => {
    const { container } = render(<InviteForm organizationId={ORG} assignableRoles={['OWNER']} />)

    expect(container).toBeEmptyDOMElement()
  })
})

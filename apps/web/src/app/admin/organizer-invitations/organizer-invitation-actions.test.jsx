/**
 * Withdrawing an organiser invitation, and issuing a new code for it: each
 * asks first, the reissue asks for a recent second factor when the API does,
 * and the outcome and any new code are held above the table, where the
 * refresh that removes the row cannot take them with it.
 *
 * @module app/admin/organizer-invitations/organizer-invitation-actions.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))
vi.mock('../../../components/step-up-prompt.jsx', () => ({
  StepUpPrompt: ({ action, onConfirmed }) => (
    <button type="button" onClick={onConfirmed}>
      Confirm to {action}
    </button>
  ),
}))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { OrganizerInvitationActions } = await import('./organizer-invitation-actions.jsx')
const { InvitationAnnouncer } = await import('./organizer-invitation-announcer.jsx')
const { ORGANIZER_INVITATION_REFUSALS } = await import('./organizer-invitation-vocabulary.js')

const CODE = 'Mn4_bV7-cX0zL3kJ6hG9fD2sA5pO8iU1yT4rE7wQ0'

/**
 * A response the mocked `apiFetch` resolves with.
 *
 * @param {number} status The HTTP status.
 * @param {object} body The parsed body.
 * @returns {object} A Response-shaped stub.
 */
function answer(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
  }
}

/**
 * One invitation, as the list answers it.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The summary.
 */
function invitation(overrides = {}) {
  return {
    id: 'inv00000000000000000001',
    email: 'priya@rangoli.example',
    organizationName: 'Rangoli Collective',
    note: null,
    status: 'PENDING',
    deliveryMode: 'MANUAL',
    expiresAt: '2026-10-15T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * The reissue answer.
 *
 * @param {'MANUAL'|'EMAIL'} mode How the new code went out.
 * @returns {object} The body.
 */
function reissued(mode) {
  return {
    data: {
      ...invitation({ id: 'inv00000000000000000002', deliveryMode: mode }),
      supersedesId: 'inv00000000000000000001',
      expiresAt: '2026-10-19T10:00:00.000Z',
      delivery: { mode, invitationCode: mode === 'MANUAL' ? CODE : null },
    },
  }
}

/**
 * The table's stand-in: an announcer above, and a row that a refresh can take away.
 *
 * @param {object} props Component props.
 * @param {boolean} props.withRow Whether the row is still listed.
 * @returns {JSX.Element} The harness.
 */
function Table({ withRow }) {
  return (
    <InvitationAnnouncer>
      {withRow ? <OrganizerInvitationActions invitation={invitation()} /> : <p>No row</p>}
    </InvitationAnnouncer>
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('withdrawing an invitation', () => {
  it('asks first, says the code stops at once, then withdraws and says so above the table', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: invitation({ status: 'REVOKED' }) }))
    render(<Table withRow />)

    await user.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to priya@rangoli.example' }),
    )

    const group = screen.getByRole('group', {
      name: 'Withdraw the invitation to priya@rangoli.example?',
    })

    expect(group).toHaveTextContent('The code stops working at once.')
    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(apiFetch.mock.calls[0][0]).toBe(
      '/v1/platform/organizer-invitations/inv00000000000000000001/revoke',
    )
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')

    const region = await screen.findByText(
      'The invitation to priya@rangoli.example was withdrawn. Its code no longer works.',
    )

    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('withdraws nothing when cancelled, and gives focus back', async () => {
    const user = userEvent.setup()

    render(<Table withRow />)

    const opener = screen.getByRole('button', {
      name: 'Withdraw the invitation to priya@rangoli.example',
    })

    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(apiFetch).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Withdraw the invitation to priya@rangoli.example' }),
      ).toHaveFocus(),
    )
  })
})

describe('issuing a new code', () => {
  it('asks first, asks for a second factor when the API does, and holds the new code above the table', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'x' } }))
      .mockResolvedValueOnce(answer(201, reissued('MANUAL')))

    const { container, rerender } = render(<Table withRow />)

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for priya@rangoli.example' }),
    )

    expect(
      screen.getByRole('group', { name: 'Issue a new code for priya@rangoli.example?' }),
    ).toHaveTextContent('The code issued before stops working at once.')

    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))
    await user.click(
      await screen.findByRole('button', {
        name: 'Confirm to issue a new code for priya@rangoli.example',
      }),
    )

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(apiFetch.mock.calls[1][0]).toBe(
      '/v1/platform/organizer-invitations/inv00000000000000000001/reissue',
    )
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)
    expect(screen.getByLabelText('Message to send them').value).toContain(`    ${CODE}\n`)
    expect(refresh).not.toHaveBeenCalled()

    // The refresh the next action causes removes the old invitation's row.
    // The code is held above it, so it is still there to hand over.
    rerender(<Table withRow={false} />)

    expect(screen.getByText('No row')).toBeInTheDocument()
    expect(screen.getByLabelText('Invitation code')).toHaveValue(CODE)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(container.innerHTML).not.toContain(CODE)
    expect(
      screen.getByText('The new code for priya@rangoli.example is handed over.'),
    ).toBeInTheDocument()
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('says where a new code went when codes are emailed, and shows none', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, reissued('EMAIL')))

    const { container } = render(<Table withRow />)

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for priya@rangoli.example' }),
    )
    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))

    expect(
      await screen.findByText(
        /^A new code was emailed to priya@rangoli\.example\. It works until October 19, 2026/u,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Invitation code')).toBeNull()
    expect(container.innerHTML).not.toContain(CODE)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('repeats the API’s sentence when there is no code left to replace', async () => {
    const user = userEvent.setup()
    const sentence = ORGANIZER_INVITATION_REFUSALS.NOT_OUTSTANDING

    apiFetch.mockResolvedValue(
      answer(409, { error: { code: 'NOT_OUTSTANDING', message: sentence } }),
    )
    render(<Table withRow />)

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for priya@rangoli.example' }),
    )
    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))

    expect(await screen.findByText(sentence)).toBeVisible()
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('holds a new code in the row itself when it is drawn on its own', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(201, reissued('MANUAL')))
    render(<OrganizerInvitationActions invitation={invitation()} />)

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for priya@rangoli.example' }),
    )
    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))

    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('what a row offers', () => {
  it('offers an expired invitation a new code and nothing to withdraw', () => {
    render(<OrganizerInvitationActions invitation={invitation({ status: 'EXPIRED' })} />)

    expect(
      screen.getByRole('button', { name: 'Issue a new code for priya@rangoli.example' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Withdraw/u })).toBeNull()
  })

  it.each(['ACCEPTED', 'REVOKED'])('offers a %s invitation nothing', (status) => {
    const { container } = render(<OrganizerInvitationActions invitation={invitation({ status })} />)

    expect(container).toBeEmptyDOMElement()
  })
})

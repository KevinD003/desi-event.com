/**
 * The team controls send what the API expects, and never less than the whole
 * door scope.
 *
 * The properties worth pinning:
 *
 *   - **Removal needs a reason** of at least four characters before anything
 *     is sent, and the reason is what is sent.
 *   - **Owner is never offered**, even if a payload listed it.
 *   - **A role change carries the whole scope** for a door role — including
 *     scoped events the picker could not list — and none for any other role.
 *   - **A door role cannot be saved blind** when the events could not be read,
 *     because the API would clear the scope and the person would admit nobody.
 *   - **An owner is not demoted by one click**: a role that cannot be kept
 *     starts on no choice, and the panel says what the member is now.
 *   - **The picker says when it could not list every event.**
 *   - **Refusals are the API's words where they are specific**, and a lapsed
 *     step-up is offered the step-up rather than a dead end — for withdrawing
 *     an invitation as well as for changing a member.
 *
 * @module app/organizer/team/member-actions.test
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const refresh = vi.fn()

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }))

const { apiFetch } = await import('../../../lib/api-fetch.js')
const { InvitationActions, MemberActions } = await import('./member-actions.jsx')

/** The organisation. */
const ORG = 'org00000000000000000001'

/** The events the picker offers. */
const EVENTS = [
  { id: 'evt1', title: 'Garba Night', when: 'Sat, 10 Oct 2026' },
  { id: 'evt2', title: 'Diwali Mela', when: 'Sun, 8 Nov 2026' },
]

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
 * Render the member controls.
 *
 * @param {object} [overrides] Props to change.
 * @returns {object} The render result.
 */
function draw(overrides = {}) {
  return render(
    <MemberActions
      organizationId={ORG}
      member={{ id: 'mem1', name: 'Asha Rao', role: 'STAFF', scopedEventIds: ['evt1'] }}
      assignableRoles={['OWNER', 'MANAGER', 'STAFF', 'SCANNER', 'VIEWER']}
      events={EVENTS}
      offerRoleChange
      offerRemove
      {...overrides}
    />,
  )
}

beforeEach(() => {
  apiFetch.mockReset()
  refresh.mockReset()
})

describe('removing somebody', () => {
  it('will not send until a reason of four characters is given, then sends it', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw()

    await user.click(screen.getByRole('button', { name: 'Remove Asha Rao from the team' }))

    const confirm = screen.getByRole('button', { name: 'Remove Asha Rao' })

    expect(confirm).toBeDisabled()

    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'no')
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.type(screen.getByRole('textbox', { name: /Why/u }), 't needed any more')
    expect(confirm).toBeEnabled()
    await user.click(confirm)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/organizations/${ORG}/members/mem1/remove`)
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ reason: 'not needed any more' })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(screen.getByText('Asha Rao is no longer on this team.')).toBeInTheDocument()
  })

  it('repeats the API’s own refusal and says nothing changed', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(422, {
        error: {
          code: 'UNPROCESSABLE',
          message: 'This is the only owner of the organisation. Make somebody else an owner first.',
        },
      }),
    )
    draw()

    await user.click(screen.getByRole('button', { name: 'Remove Asha Rao from the team' }))
    await user.type(screen.getByRole('textbox', { name: /Why/u }), 'leaving the company')
    await user.click(screen.getByRole('button', { name: 'Remove Asha Rao' }))

    expect(await screen.findByText(/only owner of the organisation/u)).toBeInTheDocument()
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('changing a role', () => {
  it('never offers Owner, even when a payload lists it', async () => {
    const user = userEvent.setup()

    draw()
    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))

    const options = screen.getAllByRole('option').map((option) => option.textContent)

    expect(options).not.toContain('Owner')
    expect(options).toEqual(['Manager', 'Staff', 'Door scanner', 'Viewer'])
  })

  it('sends the whole door scope for a door role, starting from the one they have', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'SCANNER')

    expect(screen.getByRole('checkbox', { name: /Garba Night/u })).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: /Diwali Mela/u }))
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    const [path, options] = apiFetch.mock.calls[0]

    expect(path).toBe(`/v1/organizations/${ORG}/members/mem1`)
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ role: 'SCANNER', eventIds: ['evt1', 'evt2'] })
  })

  it('keeps scoped events the picker could not list rather than dropping them', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw({
      member: { id: 'mem1', name: 'Asha Rao', role: 'STAFF', scopedEventIds: ['evt1', 'evt-far'] },
    })

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'MANAGER')

    expect(screen.getByText(/One event in their scope is not in this list/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the new role' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      role: 'MANAGER',
      eventIds: ['evt1', 'evt-far'],
    })
  })

  it('sends no scope for a role that does not work a door, and says the scope goes', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'VIEWER')

    expect(screen.getByText(/Their door scope is cleared/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the new role' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ role: 'VIEWER' })
  })

  it('starts an owner’s role change on no choice, so saving needs one', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw({
      member: { id: 'mem1', name: 'Priya', role: 'OWNER', scopedEventIds: [] },
      assignableRoles: ['ADMIN', 'MANAGER', 'VIEWER'],
    })

    await user.click(screen.getByRole('button', { name: 'Change Priya’s role' }))

    const select = screen.getByRole('combobox', { name: /New role/u })
    const save = screen.getByRole('button', { name: 'Save the new role' })

    expect(screen.getByText('Now: Owner.')).toBeInTheDocument()
    expect(select).toHaveValue('')
    expect(save).toBeDisabled()
    await user.click(save)
    expect(apiFetch).not.toHaveBeenCalled()

    await user.selectOptions(select, 'ADMIN')
    expect(save).toBeEnabled()
    await user.click(save)

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ role: 'ADMIN' })
  })

  it('says how many events the picker leaves out when there are more than it lists', async () => {
    const user = userEvent.setup()

    draw({ eventTotal: 150 })

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))

    expect(
      screen.getByText(
        'Only the 2 latest-starting of this organisation’s 150 events are listed; the 148 that start earliest are left out.',
      ),
    ).toBeInTheDocument()
  })

  it('will not save a door role when the events could not be read', async () => {
    const user = userEvent.setup()

    draw({ events: null })

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'SCANNER')

    expect(screen.getByText(/events could not be read/u)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save the new role' })).toBeDisabled()
  })

  it('offers the step-up when the API asks for one, not a dead end', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth' } }),
    )
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'VIEWER')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()
  })

  it('says so when the API refuses a change to your own role', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(403, {
        error: {
          code: 'FORBIDDEN',
          message:
            'You cannot change your own role. Ask somebody else in the organisation to do it.',
        },
      }),
    )
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'VIEWER')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    expect(await screen.findByText(/cannot change your own role/u)).toBeInTheDocument()
  })

  it('says how long to wait when rate limited', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue({
      ...answer(429, { error: { code: 'RATE_LIMITED' } }),
      headers: new Headers({ 'retry-after': '120' }),
    })
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'VIEWER')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    expect(await screen.findByText(/Wait about 2 minutes/u)).toBeInTheDocument()
  })

  it('says nothing reached the service when the request never arrived', async () => {
    const user = userEvent.setup()

    apiFetch.mockRejectedValue(new TypeError('offline'))
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'VIEWER')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    expect(await screen.findByText(/Nothing reached Desi-Event/u)).toBeInTheDocument()
  })
})

describe('what is drawn', () => {
  it('draws nothing when neither action is offered', () => {
    const { container } = draw({ offerRoleChange: false, offerRemove: false })

    expect(container).toBeEmptyDOMElement()
  })

  it('does not offer a role change when the caller may grant no role', () => {
    draw({ assignableRoles: ['OWNER'] })

    expect(screen.queryByRole('button', { name: /Change/u })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Asha Rao from the team' }),
    ).toBeInTheDocument()
  })
})

describe('withdrawing an invitation', () => {
  it('asks first, then posts to the revoke route', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    render(<InvitationActions organizationId={ORG} invitation={{ id: 'inv1', role: 'SCANNER' }} />)

    await user.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to join as door scanner' }),
    )
    expect(apiFetch).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORG}/invitations/inv1/revoke`)
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(await screen.findByText(/can no longer be accepted/u)).toBeInTheDocument()
  })

  it('offers the step-up when the API asks for one, then withdraws it', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, { ok: true }))
    render(<InvitationActions organizationId={ORG} invitation={{ id: 'inv1', role: 'SCANNER' }} />)

    await user.click(
      screen.getByRole('button', { name: 'Withdraw the invitation to join as door scanner' }),
    )
    await user.click(screen.getByRole('button', { name: 'Withdraw it' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      `/v1/organizations/${ORG}/invitations/inv1/revoke`,
      '/v1/auth/step-up',
      `/v1/organizations/${ORG}/invitations/inv1/revoke`,
    ])
    expect(await screen.findByText(/can no longer be accepted/u)).toBeInTheDocument()
  })

  it('can be backed out of without sending anything', async () => {
    const user = userEvent.setup()

    render(<InvitationActions organizationId={ORG} invitation={{ id: 'inv1', role: 'VIEWER' }} />)

    await user.click(screen.getByRole('button', { name: /Withdraw the invitation/u }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Withdraw the invitation/u })).toBeInTheDocument()
  })
})

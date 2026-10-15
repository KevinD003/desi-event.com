/**
 * The team controls send what the API expects, and never less than the whole
 * door scope.
 *
 * The properties worth pinning:
 *
 *   - **Removal needs a reason** of at least four characters before anything
 *     is sent, and the reason is what is sent.
 *   - **The roles offered are exactly the API's `roleChoices`** for the
 *     member, Owner never among them even if a payload listed it. A member who
 *     does not post events is told that the roles which do come from the
 *     team at The Desi Events, and the API's own refusal is shown when it gives one.
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
const {
  INVITATION_DELIVERY_COPY,
  InvitationActions,
  MemberActions,
  POSTING_ROLES_HINT,
  TransferOwnership,
} = await import('./member-actions.jsx')
const { TeamAnnouncer } = await import('./team-announcer.jsx')

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
      member={{
        id: 'mem1',
        name: 'Asha Rao',
        role: 'STAFF',
        postsEvents: false,
        scopedEventIds: ['evt1'],
      }}
      // What the API lists for an owner acting on a staff member
      // (`roleChoices`), with a stray Owner that must still never be offered.
      roleChoices={['OWNER', 'FINANCE', 'STAFF', 'SCANNER', 'VIEWER']}
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
  it('offers exactly the API’s choices for the member, and never Owner', async () => {
    const user = userEvent.setup()

    draw()
    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))

    const options = screen.getAllByRole('option').map((option) => option.textContent)

    expect(options).not.toContain('Owner')
    expect(options).toEqual(['Finance', 'Staff', 'Door scanner', 'Viewer'])
  })

  it('offers somebody who does not post events no role that does, and says who gives those', async () => {
    const user = userEvent.setup()

    draw({
      member: {
        id: 'mem1',
        name: 'Asha Rao',
        role: 'VIEWER',
        postsEvents: false,
        scopedEventIds: [],
      },
      roleChoices: ['FINANCE', 'STAFF', 'SCANNER', 'VIEWER'],
    })
    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))

    const options = screen.getAllByRole('option').map((option) => option.textContent)

    for (const posting of ['Event manager', 'Manager', 'Administrator', 'Owner']) {
      expect(options).not.toContain(posting)
    }

    expect(screen.getByText(POSTING_ROLES_HINT)).toBeVisible()
    expect(POSTING_ROLES_HINT).toMatch(/given by the team at The Desi Events/u)
  })

  it('offers somebody who posts events the roles below theirs, administrator included', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { ok: true }))
    draw({
      member: { id: 'mem1', name: 'Dev', role: 'ADMIN', postsEvents: true, scopedEventIds: [] },
      roleChoices: ['ADMIN', 'MANAGER', 'FINANCE', 'EVENT_MANAGER', 'STAFF', 'SCANNER', 'VIEWER'],
    })
    await user.click(screen.getByRole('button', { name: 'Change Dev’s role' }))

    const select = screen.getByRole('combobox', { name: /New role/u })

    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Administrator',
      'Manager',
      'Finance',
      'Event manager',
      'Staff',
      'Door scanner',
      'Viewer',
    ])
    expect(select).toHaveValue('ADMIN')
    expect(screen.queryByText(POSTING_ROLES_HINT)).not.toBeInTheDocument()

    await user.selectOptions(select, 'EVENT_MANAGER')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ role: 'EVENT_MANAGER' })
  })

  it('shows the API’s sentence when it refuses a move into a role that posts events', async () => {
    const user = userEvent.setup()
    const sentence =
      'Roles that create or publish events — event manager, manager, administrator and owner — are given by the team at The Desi Events, not from this page. Ask the team at The Desi Events to add this person to your organisation.'

    apiFetch.mockResolvedValue(
      answer(403, { error: { code: 'POSTING_ROLE_NEEDS_PLATFORM', message: sentence } }),
    )
    draw()

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'FINANCE')
    await user.click(screen.getByRole('button', { name: 'Save the new role' }))

    expect(await screen.findByText(sentence)).toBeVisible()
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
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
      member: {
        id: 'mem1',
        name: 'Asha Rao',
        role: 'STAFF',
        postsEvents: false,
        scopedEventIds: ['evt1', 'evt-far'],
      },
    })

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))
    await user.selectOptions(screen.getByRole('combobox', { name: /New role/u }), 'SCANNER')

    expect(screen.getByText(/One event in their scope is not in this list/u)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save the new role' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      role: 'SCANNER',
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
      member: { id: 'mem1', name: 'Priya', role: 'OWNER', postsEvents: true, scopedEventIds: [] },
      roleChoices: ['ADMIN', 'MANAGER', 'VIEWER'],
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

    expect(await screen.findByText(/Nothing reached The Desi Events/u)).toBeInTheDocument()
  })
})

describe('what is drawn', () => {
  it('draws nothing when neither action is offered', () => {
    const { container } = draw({ offerRoleChange: false, offerRemove: false })

    expect(container).toBeEmptyDOMElement()
  })

  it('does not offer a role change when the caller may grant no role', () => {
    draw({ roleChoices: ['OWNER'] })

    expect(screen.queryByRole('button', { name: /Change/u })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Asha Rao from the team' }),
    ).toBeInTheDocument()
  })

  it('does not offer a role change when the only choice is the role they have', () => {
    draw({ roleChoices: ['STAFF'] })

    expect(screen.queryByRole('button', { name: /Change/u })).not.toBeInTheDocument()
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

  it.each(['MANUAL', 'EMAIL'])(
    'says who is told, truly when codes go out %s',
    async (deliveryMode) => {
      const user = userEvent.setup()
      const { container } = render(
        <InvitationActions
          organizationId={ORG}
          invitation={{ id: 'inv1', role: 'VIEWER' }}
          reissuable
          deliveryMode={deliveryMode}
        />,
      )

      await user.click(screen.getByRole('button', { name: /Withdraw the invitation/u }))

      expect(screen.getByText(INVITATION_DELIVERY_COPY[deliveryMode].withdraw)).toBeVisible()
      expect(container.textContent).not.toMatch(/sends no email/iu)

      await user.click(screen.getByRole('button', { name: 'Keep it' }))
      await user.click(screen.getByRole('button', { name: /Issue a new code/u }))

      expect(screen.getByText(INVITATION_DELIVERY_COPY[deliveryMode].reissue)).toBeVisible()
    },
  )

  it('keeps the shown-once wording only for codes that are not emailed', () => {
    expect(INVITATION_DELIVERY_COPY.MANUAL.reissue).toMatch(
      /shown to you once, to hand over yourself/u,
    )
    expect(INVITATION_DELIVERY_COPY.EMAIL.reissue).toMatch(/emailed .* You will not see it\./u)
    expect(INVITATION_DELIVERY_COPY.EMAIL.reissue).not.toMatch(/shown to you/u)
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

describe('issuing a new code for an invitation', () => {
  const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

  it('is offered only when the role is grantable', () => {
    render(<InvitationActions organizationId={ORG} invitation={{ id: 'inv1', role: 'ADMIN' }} />)

    expect(screen.queryByRole('button', { name: /Issue a new code/u })).not.toBeInTheDocument()
  })

  it('asks first, posts to the reissue route, and shows the new code once', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, {
        data: {
          id: 'inv2',
          role: 'SCANNER',
          status: 'PENDING',
          expiresAt: '2026-10-12T15:00:00.000Z',
          createdAt: '2026-09-28T15:00:00.000Z',
          deliveryMode: 'MANUAL',
          delivery: { mode: 'MANUAL', invitationCode: CODE },
        },
      }),
    )

    const { container } = render(
      <InvitationActions
        organizationId={ORG}
        invitation={{ id: 'inv1', role: 'SCANNER' }}
        reissuable
        neverDelivered
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Issue a new code for the invitation to join as door scanner',
      }),
    )
    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/The code issued before stops working at once/u)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORG}/invitations/inv1/reissue`)
    expect(apiFetch.mock.calls[0][1].method).toBe('POST')
    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)
    // Addressless: this caller was not given the address, so nobody is named.
    expect(screen.getByText(/Send this code to the person it is for yourself/u)).toBeVisible()
    expect(refresh).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(container.innerHTML).not.toContain(CODE)
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps the new code on the page when the withdrawn invitation’s row goes', async () => {
    // Issuing a code withdraws the invitation it replaces, so its row goes at
    // the next refresh — and anything on the page can refresh it. The code
    // must outlive the row until the person says it is handed over.
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(201, {
        data: {
          id: 'inv2',
          role: 'STAFF',
          status: 'PENDING',
          expiresAt: '2026-10-12T15:00:00.000Z',
          createdAt: '2026-09-28T15:00:00.000Z',
          deliveryMode: 'MANUAL',
          delivery: { mode: 'MANUAL', invitationCode: CODE },
        },
      }),
    )

    /**
     * The team page's shape: the announcer above, the invitation's row below.
     *
     * @param {{row: boolean}} props Whether the old invitation's row is still listed.
     * @returns {JSX.Element} The tree.
     */
    function Page({ row }) {
      return (
        <TeamAnnouncer>
          {row ? (
            <InvitationActions
              organizationId={ORG}
              invitation={{ id: 'inv1', role: 'STAFF' }}
              reissuable
            />
          ) : null}
        </TeamAnnouncer>
      )
    }

    const { container, rerender } = render(<Page row />)

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for the invitation to join as staff' }),
    )
    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))

    expect(await screen.findByLabelText('Invitation code')).toHaveValue(CODE)

    // A refresh from anywhere drops the withdrawn invitation's row.
    rerender(<Page row={false} />)

    expect(screen.getByLabelText('Invitation code')).toHaveValue(CODE)

    await user.click(screen.getByRole('button', { name: 'I have handed it over' }))

    expect(container.innerHTML).not.toContain(CODE)
    expect(
      await screen.findByText(/The new code for the invitation to join as staff is handed over/u),
    ).toBeInTheDocument()
  })

  it('repeats the API’s refusal and shows no code', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(
      answer(409, {
        error: {
          code: 'CONFLICT',
          message: 'This invitation is no longer outstanding, so there is no code to replace.',
        },
      }),
    )
    render(
      <InvitationActions
        organizationId={ORG}
        invitation={{ id: 'inv1', role: 'STAFF' }}
        reissuable
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Issue a new code for the invitation to join as staff' }),
    )
    await user.click(screen.getByRole('button', { name: 'Issue a new code' }))

    expect(await screen.findByText(/no longer outstanding/u)).toBeInTheDocument()
    expect(screen.queryByLabelText('Invitation code')).not.toBeInTheDocument()
  })
})

describe('handing ownership on', () => {
  it('asks first, then posts the member to the ownership route', async () => {
    const user = userEvent.setup()

    apiFetch.mockResolvedValue(answer(200, { data: { previousOwnerRole: 'ADMIN' } }))
    render(
      <TransferOwnership
        organizationId={ORG}
        organizationName="Rangoli"
        member={{ id: 'mem1', name: 'Asha Rao' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Hand ownership to Asha Rao' }))
    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByText(/you become an administrator, in one step/u)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Make Asha Rao the owner' }))
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1))

    expect(apiFetch.mock.calls[0][0]).toBe(`/v1/organizations/${ORG}/ownership`)
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ toMemberId: 'mem1' })
    expect(await screen.findByText(/Asha Rao is now the owner/u)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('offers the step-up when the API asks for one, then sends it again', async () => {
    const user = userEvent.setup()

    apiFetch
      .mockResolvedValueOnce(
        answer(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Authenticate at /v1/auth' } }),
      )
      .mockResolvedValueOnce(answer(200, { data: { ok: true } }))
      .mockResolvedValueOnce(answer(200, { data: { previousOwnerRole: 'ADMIN' } }))
    render(
      <TransferOwnership
        organizationId={ORG}
        organizationName="Rangoli"
        member={{ id: 'mem1', name: 'Asha Rao' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Hand ownership to Asha Rao' }))
    await user.click(screen.getByRole('button', { name: 'Make Asha Rao the owner' }))

    expect(await screen.findByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(screen.queryByText(/\/v1\/auth/u)).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/Your password/u), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(3))
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual([
      `/v1/organizations/${ORG}/ownership`,
      '/v1/auth/step-up',
      `/v1/organizations/${ORG}/ownership`,
    ])
    expect(await screen.findByText(/Asha Rao is now the owner/u)).toBeInTheDocument()
  })

  it('shows the API’s heir sentence when the member does not create events, and changes nothing', async () => {
    const user = userEvent.setup()
    // The API's own words (`HEIR_MUST_POST_EVENTS_SENTENCE` in routes/teams.js).
    const sentence =
      'Ownership can go only to somebody who already creates events here — an event manager, manager or administrator.'

    apiFetch.mockResolvedValue(
      answer(422, { error: { code: 'HEIR_MUST_POST_EVENTS', message: sentence } }),
    )
    render(
      <TransferOwnership
        organizationId={ORG}
        organizationName="Rangoli"
        member={{ id: 'mem1', name: 'Asha Rao' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Hand ownership to Asha Rao' }))
    await user.click(screen.getByRole('button', { name: 'Make Asha Rao the owner' }))

    expect(await screen.findByText(sentence)).toBeVisible()
    expect(screen.getByText('Nothing was changed')).toBeInTheDocument()
    // The panel stays open with the refusal in it, and is focused.
    await waitFor(() =>
      expect(screen.getByRole('group', { name: 'Hand Rangoli to Asha Rao?' })).toHaveFocus(),
    )
    expect(screen.queryByText(/is now the owner/u)).toBeNull()
    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('can be backed out of without sending anything', async () => {
    const user = userEvent.setup()

    render(
      <TransferOwnership
        organizationId={ORG}
        organizationName="Rangoli"
        member={{ id: 'mem1', name: 'Asha Rao' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Hand ownership to Asha Rao' }))
    await user.click(screen.getByRole('button', { name: 'Keep ownership' }))

    expect(apiFetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Hand ownership to Asha Rao' })).toBeInTheDocument()
  })
})

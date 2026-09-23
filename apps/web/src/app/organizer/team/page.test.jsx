/**
 * The team screen draws exactly what the server decided about addresses, and
 * offers only what this session could do in this organisation.
 *
 * The properties worth pinning:
 *
 *   - **Addresses.** Under `FULL` every address the payload carries is shown
 *     and nothing else; under `STEP_UP_REQUIRED` and `HIDDEN` the rendered
 *     markup contains no `@` at all — even when a hostile or broken payload
 *     smuggled an `email` into a member, an invitation or a name.
 *   - **Offers follow capability in this organisation.** Holding
 *     `team:role_manage` in another organisation offers nothing here.
 *   - **Nobody changes their own role here**, and nobody is offered power over
 *     a role above their own.
 *   - **No invite form**, because nothing could deliver the invitation.
 *   - **Door scopes say what the API enforces**: a door role with no scope
 *     admits nobody.
 *
 * @module app/organizer/team/page.test
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/organizer/team',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))

const readSession = vi.fn()

vi.mock('../../../lib/session.js', async () => {
  const actual = await vi.importActual('../../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../lib/workspace-api.js')

  return { ...actual, getTeam: vi.fn(), listOrganizationEvents: vi.fn() }
})

const { getTeam, listOrganizationEvents } = await import('../../../lib/workspace-api.js')
const { default: TeamPage } = await import('./page.jsx')

/** The organisation these tests act in. */
const ORG = 'org00000000000000000001'

/** Another organisation. */
const OTHER = 'org00000000000000000002'

/** Everything an administrator holds for the team screen. */
const ADMIN_CAPABILITIES = [
  'organization:view_members',
  'team:invite',
  'team:remove',
  'team:role_manage',
]

/**
 * A session with the given memberships.
 *
 * @param {object[]} memberships The memberships.
 * @returns {object} The session.
 */
function session(memberships) {
  return { user: { displayName: 'Admin' }, capabilities: [], memberships }
}

/**
 * An administrator of {@link ORG}.
 *
 * @returns {object} The session.
 */
function admin() {
  return session([
    {
      organizationId: ORG,
      organizationName: 'Rangoli',
      role: 'ADMIN',
      capabilities: ADMIN_CAPABILITIES,
    },
  ])
}

/**
 * One member.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The member.
 */
function member(overrides = {}) {
  return {
    id: 'mem00000000000000000001',
    userId: 'usr00000000000000000001',
    displayName: 'Asha Rao',
    role: 'STAFF',
    capabilities: [],
    scopedEventIds: [],
    joinedAt: '2026-01-02T10:00:00.000Z',
    self: false,
    ...overrides,
  }
}

/**
 * One invitation.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The invitation.
 */
function invitation(overrides = {}) {
  return {
    id: 'inv00000000000000000001',
    role: 'SCANNER',
    status: 'PENDING',
    invitedByName: 'Admin',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * A team payload.
 *
 * @param {string} emailVisibility The server's decision.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The payload.
 */
function team(emailVisibility, overrides = {}) {
  return {
    emailVisibility,
    members: [
      member({ id: 'mem-self', displayName: 'Admin', role: 'ADMIN', self: true }),
      member(),
    ],
    invitations: [invitation()],
    // What the API computes for an administrator (`assignableRoles` in
    // apps/api/src/routes/teams.js): ADMIN included, since an administrator
    // holds every capability an administrator does.
    assignableRoles: ['ADMIN', 'MANAGER', 'FINANCE', 'EVENT_MANAGER', 'STAFF', 'SCANNER', 'VIEWER'],
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} options What the API and the session answer.
 * @param {object} [options.as] The session.
 * @param {object|Error} options.answer The team payload, or an error to throw.
 * @param {object} [options.events] The events payload.
 * @param {object} [options.query] The query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage({ as = admin(), answer, events, query = {} }) {
  readSession.mockResolvedValue(as)

  if (answer instanceof Error) getTeam.mockRejectedValue(answer)
  else getTeam.mockResolvedValue(answer)

  if (events instanceof Error) listOrganizationEvents.mockRejectedValue(events)
  else listOrganizationEvents.mockResolvedValue(events ?? { events: [], pagination: null })

  return render(await TeamPage({ searchParams: Promise.resolve(query) }))
}

/**
 * An error as `callApi` throws it.
 *
 * @param {object} fields Status and code.
 * @returns {Error} The error.
 */
function refused(fields) {
  return Object.assign(new Error('Raw API words naming /v1/organizations'), fields)
}

beforeEach(() => {
  getTeam.mockReset()
  listOrganizationEvents.mockReset()
})

describe('addresses are drawn exactly as the server decided', () => {
  it('shows every address a FULL payload carries, and no other', async () => {
    const { container } = await renderPage({
      answer: team('FULL', {
        members: [
          member({ id: 'm1', email: 'asha@example.com' }),
          member({ id: 'm2', displayName: 'Dev', email: 'dev@example.org' }),
        ],
        invitations: [invitation({ email: 'new.person@example.net' })],
      }),
    })

    expect(screen.getByText('asha@example.com')).toBeInTheDocument()
    expect(screen.getByText('dev@example.org')).toBeInTheDocument()
    expect(screen.getByText('new.person@example.net')).toBeInTheDocument()
    expect(container.innerHTML.match(/@/gu)).toHaveLength(3)
  })

  it('offers the step-up and renders no @ at all under STEP_UP_REQUIRED, even from a hostile payload', async () => {
    const { container } = await renderPage({
      answer: team('STEP_UP_REQUIRED', {
        members: [
          member({ id: 'm1', email: 'smuggled@example.com' }),
          member({ id: 'm2', displayName: 'Dev dev@example.org' }),
        ],
        invitations: [
          invitation({ email: 'also.smuggled@example.com', invitedByName: 'x y@example.in' }),
        ],
      }),
    })

    expect(container.innerHTML).not.toMatch(/@/u)
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
    expect(
      screen.getByText(/after a recent confirmation of your second factor/u),
    ).toBeInTheDocument()
  })

  it('renders no @, no email column and no way to reveal one under HIDDEN', async () => {
    const { container } = await renderPage({
      answer: team('HIDDEN', {
        members: [member({ id: 'm1', email: 'smuggled@example.com' })],
        invitations: [invitation({ email: 'also.smuggled@example.com' })],
      }),
    })

    expect(container.innerHTML).not.toMatch(/@/u)
    expect(screen.queryByRole('columnheader', { name: 'Email' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Confirm it is you' })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Email addresses are shown only to owners and administrators who have confirmed a second factor recently.',
      ),
    ).toBeInTheDocument()
  })

  it('treats a visibility it does not recognise as hidden', async () => {
    const { container } = await renderPage({
      answer: team('SOMETHING_NEW', { members: [member({ email: 'smuggled@example.com' })] }),
    })

    expect(container.innerHTML).not.toMatch(/@/u)
  })
})

describe('what is offered', () => {
  it('offers role changes and removal to somebody holding both here', async () => {
    await renderPage({ answer: team('HIDDEN') })

    expect(screen.getByRole('button', { name: 'Change Asha Rao’s role' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Asha Rao from the team' }),
    ).toBeInTheDocument()
  })

  it('offers nothing when the capability is held in a different organisation', async () => {
    await renderPage({
      as: session([
        {
          organizationId: ORG,
          organizationName: 'Rangoli',
          role: 'VIEWER',
          capabilities: ['organization:view_members'],
        },
        {
          organizationId: OTHER,
          organizationName: 'Elsewhere',
          role: 'ADMIN',
          capabilities: ADMIN_CAPABILITIES,
        },
      ]),
      // The roles the API lists are left as an administrator's, so the only
      // thing between this viewer and the buttons is the capability check,
      // asked in the organisation being viewed rather than in any of theirs.
      answer: team('HIDDEN'),
      query: { organizationId: ORG },
    })

    expect(getTeam).toHaveBeenCalledWith(ORG)
    expect(screen.queryByRole('button', { name: /Change .* role/u })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/u })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Withdraw/u })).not.toBeInTheDocument()
  })

  it('never offers changing your own role or removing yourself, though your role is grantable', async () => {
    const payload = team('HIDDEN', {
      members: [
        member({ id: 'mem-self', displayName: 'Admin', role: 'ADMIN', self: true }),
        member({ id: 'mem-peer', displayName: 'Peer Admin', role: 'ADMIN' }),
      ],
    })

    // The caller's own role is one they may grant, so the only thing between
    // their own row and the buttons is the self check.
    expect(payload.assignableRoles).toContain('ADMIN')

    await renderPage({ answer: payload })

    const own = screen.getByText('(you)').closest('tr')

    expect(within(own).queryByRole('button')).not.toBeInTheDocument()
    expect(within(own).getByText(/changed by somebody else here/u)).toBeInTheDocument()
    // Another administrator's row is offered both, so the role reaches.
    expect(screen.getByRole('button', { name: 'Change Peer Admin’s role' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove Peer Admin from the team' }),
    ).toBeInTheDocument()
  })

  it('offers nothing over a member whose role is above the caller’s', async () => {
    await renderPage({
      answer: team('HIDDEN', {
        members: [member({ id: 'owner', displayName: 'Priya', role: 'OWNER' })],
      }),
    })

    expect(screen.queryByRole('button', { name: /Priya/u })).not.toBeInTheDocument()
    expect(screen.getByText('Your role here cannot change this member’s.')).toBeInTheDocument()
  })

  it('offers withdrawing an invitation only with team:invite here', async () => {
    await renderPage({ answer: team('HIDDEN') })

    expect(
      screen.getByRole('button', { name: 'Withdraw the invitation to join as door scanner' }),
    ).toBeInTheDocument()
  })

  it('has no invite form, and says why', async () => {
    const { container } = await renderPage({ answer: team('FULL') })

    expect(container.querySelector('input[type="email"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /invite/iu })).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'Inviting someone new needs email delivery, which this build does not have. Existing invitations are listed so they can be withdrawn.',
      ),
    ).toBeInTheDocument()
  })
})

describe('door scopes', () => {
  it('says a door role with no scope admits nobody, and names the events of one with a scope', async () => {
    await renderPage({
      answer: team('HIDDEN', {
        members: [
          member({ id: 'a', displayName: 'Nobody Door', role: 'SCANNER', scopedEventIds: [] }),
          member({ id: 'b', displayName: 'Scoped Door', role: 'STAFF', scopedEventIds: ['e1'] }),
          member({ id: 'c', displayName: 'Boss', role: 'ADMIN' }),
          member({ id: 'd', displayName: 'Money', role: 'FINANCE' }),
        ],
      }),
      events: {
        events: [
          {
            id: 'e1',
            title: 'Garba Night',
            startsAt: '2026-10-11T14:00:00.000Z',
            timezone: 'Asia/Kolkata',
          },
        ],
        pagination: null,
      },
    })

    expect(screen.getByText('Admits nobody: no event named')).toBeInTheDocument()
    expect(screen.getByText('Admits to: Garba Night')).toBeInTheDocument()
    expect(screen.getByText('Any event of this organisation')).toBeInTheDocument()
    expect(screen.getByText('Does not work a door')).toBeInTheDocument()
  })

  it('says how many events the picker leaves out when the organisation has more than it lists', async () => {
    const user = userEvent.setup()

    await renderPage({
      answer: team('HIDDEN', { members: [member({ role: 'SCANNER', scopedEventIds: [] })] }),
      events: {
        events: [
          {
            id: 'e1',
            title: 'Garba Night',
            startsAt: '2026-10-11T14:00:00.000Z',
            timezone: 'Asia/Kolkata',
          },
        ],
        pagination: { page: 1, perPage: 100, total: 240, totalPages: 3, hasNextPage: true },
      },
    })

    await user.click(screen.getByRole('button', { name: 'Change Asha Rao’s role' }))

    expect(
      screen.getByText(
        'Only the 1 latest-starting of this organisation’s 240 events are listed; the 239 that start earliest are left out.',
      ),
    ).toBeInTheDocument()
  })

  it('shows a scope as a count when the events could not be read', async () => {
    await renderPage({
      answer: team('HIDDEN', {
        members: [member({ role: 'SCANNER', scopedEventIds: ['e1', 'e2'] })],
      }),
      events: refused({ status: 503 }),
    })

    expect(screen.getByText('Admits to 2 named events')).toBeInTheDocument()
    expect(screen.getByText(/events could not be read/u)).toBeInTheDocument()
  })
})

describe('refusals', () => {
  it('refuses an account with no membership that may read a team', async () => {
    await renderPage({
      as: session([
        {
          organizationId: ORG,
          organizationName: 'Rangoli',
          role: 'SCANNER',
          capabilities: ['ticket:check_in'],
        },
      ]),
      answer: team('HIDDEN'),
    })

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(getTeam).not.toHaveBeenCalled()
  })

  it('draws a 403 and a 404 the same way, without the API’s words', async () => {
    const { container: forbidden } = await renderPage({ answer: refused({ status: 403 }) })
    const forbiddenText = forbidden.textContent

    forbidden.remove()

    const { container: missing } = await renderPage({ answer: refused({ status: 404 }) })

    expect(forbiddenText).toMatch(/Not for this account/u)
    expect(missing.textContent).toBe(forbiddenText)
    expect(missing.textContent).not.toMatch(/\/v1\//u)
  })

  it('offers the step-up when the read itself needs one', async () => {
    await renderPage({ answer: refused({ status: 403, code: 'STEP_UP_REQUIRED' }) })

    expect(screen.getByRole('heading', { name: 'Confirm it is you' })).toBeInTheDocument()
  })

  it('says the service is not answering when nothing came back', async () => {
    await renderPage({ answer: new TypeError('fetch failed') })

    expect(screen.getByText(/could not be loaded/u)).toBeInTheDocument()
    expect(screen.getByText(/nothing was changed/iu)).toBeInTheDocument()
  })
})

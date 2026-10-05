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
 *   - **The invite form is offered to a holder of `team:invite` here**, with a
 *     role it may grant, and nowhere else; every open invitation says how its
 *     code went out, and a new code is offered only for a grantable role.
 *     What the page says about the code is true in the delivery mode the
 *     session reports, and it says that roles which post events come from the
 *     Desi-Event team.
 *   - **A role change offers the API's `roleChoices`**, and removal reaches a
 *     member whose role posts events when the caller's role contains it.
 *   - **Ownership is offered only to an owner of this organisation**, and
 *     only towards a member who already creates events here.
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
const {
  HEIR_SENTENCE,
  INVITE_DELIVERY_SENTENCES,
  POSTING_ROLES_SENTENCE,
  default: TeamPage,
} = await import('./page.jsx')

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
 * @param {'MANUAL'|'EMAIL'|null} [deliveryMode] How codes go out, as `auth.me` reports it.
 * @returns {object} The session.
 */
function session(memberships, deliveryMode = 'MANUAL') {
  return { user: { displayName: 'Admin' }, capabilities: [], memberships, deliveryMode }
}

/** What the API offers an owner or administrator for a member who does not post events. */
const NON_POSTING_CHOICES = ['FINANCE', 'STAFF', 'SCANNER', 'VIEWER']

/** What the API offers an owner or administrator for an administrator member. */
const ADMIN_MEMBER_CHOICES = [
  'ADMIN',
  'MANAGER',
  'FINANCE',
  'EVENT_MANAGER',
  'STAFF',
  'SCANNER',
  'VIEWER',
]

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
    postsEvents: false,
    roleChoices: NON_POSTING_CHOICES,
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
    deliveryMode: 'MANUAL',
    ...overrides,
  }
}

/** Everything an owner holds for the team screen. */
const OWNER_CAPABILITIES = [...ADMIN_CAPABILITIES, 'organization:manage']

/**
 * An owner of {@link ORG}.
 *
 * @returns {object} The session.
 */
function owner() {
  return session([
    {
      organizationId: ORG,
      organizationName: 'Rangoli',
      role: 'OWNER',
      capabilities: OWNER_CAPABILITIES,
    },
  ])
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
      member({
        id: 'mem-self',
        displayName: 'Admin',
        role: 'ADMIN',
        self: true,
        postsEvents: true,
        roleChoices: [],
      }),
      member(),
    ],
    invitations: [invitation()],
    // What the API computes for an administrator (`assignableRoles` in
    // apps/api/src/routes/teams.js): the roles that do not create or publish
    // events, since those are given by the Desi-Event team.
    assignableRoles: NON_POSTING_CHOICES,
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

  it('never offers changing your own role or removing yourself, though a payload lists choices for it', async () => {
    const payload = team('HIDDEN', {
      members: [
        // The API lists no choices for the caller's own row; a payload that
        // did must still not put a button there.
        member({
          id: 'mem-self',
          displayName: 'Admin',
          role: 'ADMIN',
          self: true,
          postsEvents: true,
          roleChoices: ADMIN_MEMBER_CHOICES,
        }),
        member({
          id: 'mem-peer',
          displayName: 'Peer Admin',
          role: 'ADMIN',
          postsEvents: true,
          roleChoices: ADMIN_MEMBER_CHOICES,
        }),
      ],
    })

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
        members: [
          member({
            id: 'owner',
            displayName: 'Priya',
            role: 'OWNER',
            postsEvents: true,
            roleChoices: [],
          }),
        ],
      }),
    })

    expect(screen.queryByRole('button', { name: /Priya/u })).not.toBeInTheDocument()
    expect(screen.getByText('Your role here cannot change this member’s.')).toBeInTheDocument()
  })

  it('offers removing a member whose role posts events when the caller’s role contains it', async () => {
    // Removal reaches by capability, as the API's `assertMayActOn` does: an
    // administrator may remove an event manager, though nobody may invite one.
    await renderPage({
      answer: team('HIDDEN', {
        members: [
          member({
            id: 'em',
            displayName: 'Dev',
            role: 'EVENT_MANAGER',
            postsEvents: true,
            roleChoices: ['FINANCE', 'EVENT_MANAGER', 'STAFF', 'SCANNER', 'VIEWER'],
          }),
        ],
      }),
    })

    expect(screen.getByRole('button', { name: 'Remove Dev from the team' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change Dev’s role' })).toBeInTheDocument()
  })

  it('offers no role change when the API lists nothing but the role the member has', async () => {
    await renderPage({
      answer: team('HIDDEN', { members: [member({ roleChoices: ['STAFF'] })] }),
    })

    expect(screen.queryByRole('button', { name: 'Change Asha Rao’s role' })).toBeNull()
  })

  it('offers withdrawing an invitation only with team:invite here', async () => {
    await renderPage({ answer: team('HIDDEN') })

    expect(
      screen.getByRole('button', { name: 'Withdraw the invitation to join as door scanner' }),
    ).toBeInTheDocument()
  })

  it('offers the invite form to a holder of team:invite here, and says the code is handed over by hand', async () => {
    const { container } = await renderPage({ answer: team('FULL') })

    expect(screen.getByRole('heading', { name: 'Invite somebody' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Their email address/u)).toHaveAttribute('type', 'email')
    expect(screen.getByRole('button', { name: 'Invite them' })).toBeInTheDocument()
    expect(screen.getByText(INVITE_DELIVERY_SENTENCES.MANUAL)).toBeInTheDocument()
    expect(INVITE_DELIVERY_SENTENCES.MANUAL).toMatch(
      /shown to you once, and you hand it to them yourself/u,
    )
    expect(container.textContent).not.toMatch(/sends no email/iu)
    // Only the roles that do not post events; Owner never.
    const invite = screen.getByRole('form', { name: 'Invite somebody' })

    expect(
      within(invite)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Finance', 'Staff', 'Door scanner', 'Viewer'])
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('says, when codes are emailed, that the code goes to the address and the inviter will not see it', async () => {
    const { container } = await renderPage({
      as: session(admin().memberships, 'EMAIL'),
      answer: team('FULL'),
    })

    expect(
      screen.getByText('The code is emailed to that address. You will not see it.'),
    ).toBeInTheDocument()
    expect(container.textContent).not.toContain(INVITE_DELIVERY_SENTENCES.MANUAL)
  })

  it('says to a holder of team:invite that roles which post events come from the Desi-Event team', async () => {
    await renderPage({ answer: team('HIDDEN') })

    expect(screen.getByText(POSTING_ROLES_SENTENCE)).toBeInTheDocument()
    expect(POSTING_ROLES_SENTENCE).toMatch(
      /event manager, manager, administrator and owner — are given by the Desi-Event team/u,
    )
  })

  it('does not say it to somebody who cannot invite here', async () => {
    await renderPage({
      as: session([
        {
          organizationId: ORG,
          organizationName: 'Rangoli',
          role: 'VIEWER',
          capabilities: ['organization:view_members'],
        },
      ]),
      answer: team('HIDDEN'),
    })

    expect(screen.queryByText(POSTING_ROLES_SENTENCE)).not.toBeInTheDocument()
  })

  it('offers no invite form when team:invite is held only in another organisation', async () => {
    const { container } = await renderPage({
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
      answer: team('HIDDEN'),
      query: { organizationId: ORG },
    })

    expect(container.querySelector('input[type="email"]')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invite somebody' })).not.toBeInTheDocument()
  })

  it('offers no invite form when the caller may grant no role', async () => {
    const { container } = await renderPage({ answer: team('FULL', { assignableRoles: [] }) })

    expect(container.querySelector('input[type="email"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Invite them' })).not.toBeInTheDocument()
  })

  it('says how each open invitation’s code went out, including one nobody ever received', async () => {
    await renderPage({
      answer: team('HIDDEN', {
        invitations: [
          invitation({ id: 'manual', role: 'STAFF', deliveryMode: 'MANUAL' }),
          invitation({ id: 'email', role: 'VIEWER', deliveryMode: 'EMAIL' }),
          invitation({ id: 'never', role: 'SCANNER', deliveryMode: null }),
        ],
      }),
    })

    expect(screen.getByRole('columnheader', { name: 'How the code went out' })).toBeInTheDocument()
    expect(screen.getByText('Shown once to whoever invited them')).toBeInTheDocument()
    expect(screen.getByText('Sent by email')).toBeInTheDocument()
    expect(
      screen.getByText('No code was ever handed out. Issue a new one to invite them.'),
    ).toBeInTheDocument()
  })

  it('offers a new code only for an invitation to a role the caller may grant', async () => {
    await renderPage({
      as: session([
        {
          organizationId: ORG,
          organizationName: 'Rangoli',
          role: 'MANAGER',
          capabilities: ['organization:view_members', 'team:invite'],
        },
      ]),
      answer: team('HIDDEN', {
        invitations: [
          invitation({ id: 'staff', role: 'STAFF' }),
          invitation({ id: 'admin', role: 'ADMIN' }),
        ],
        assignableRoles: ['STAFF', 'SCANNER', 'VIEWER'],
      }),
    })

    expect(
      screen.getByRole('button', { name: 'Issue a new code for the invitation to join as staff' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Issue a new code for the invitation to join as administrator',
      }),
    ).not.toBeInTheDocument()
    // Withdrawing is still offered for both.
    expect(
      screen.getByRole('button', { name: 'Withdraw the invitation to join as administrator' }),
    ).toBeInTheDocument()
  })

  it('offers handing ownership on to an owner of this organisation, only towards somebody who creates events here', async () => {
    await renderPage({
      as: owner(),
      answer: team('HIDDEN', {
        members: [
          member({
            id: 'mem-self',
            displayName: 'Admin',
            role: 'OWNER',
            self: true,
            postsEvents: true,
            roleChoices: [],
          }),
          member(),
          member({
            id: 'em',
            displayName: 'Dev',
            role: 'EVENT_MANAGER',
            postsEvents: true,
            roleChoices: ['FINANCE', 'EVENT_MANAGER', 'STAFF', 'SCANNER', 'VIEWER'],
          }),
        ],
      }),
    })

    expect(screen.getByRole('heading', { name: 'Ownership' })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(HEIR_SENTENCE, 'u'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hand ownership to Dev' })).toBeInTheDocument()
    // A staff member does not create events, so the API would refuse them.
    expect(screen.queryByRole('button', { name: 'Hand ownership to Asha Rao' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Hand ownership to Admin' }),
    ).not.toBeInTheDocument()
  })

  it('says there is nobody to hand ownership to when nobody else creates events here', async () => {
    await renderPage({ as: owner(), answer: team('HIDDEN') })

    expect(
      screen.getByText(
        'Nobody else on this team creates events here, so there is nobody to hand it to.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hand ownership/u })).toBeNull()
  })

  it('offers no ownership section to an administrator, or to an owner of another organisation', async () => {
    const { container } = await renderPage({ answer: team('HIDDEN') })

    expect(screen.queryByRole('heading', { name: 'Ownership' })).not.toBeInTheDocument()

    container.remove()

    await renderPage({
      as: session([
        {
          organizationId: ORG,
          organizationName: 'Rangoli',
          role: 'ADMIN',
          capabilities: ADMIN_CAPABILITIES,
        },
        {
          organizationId: OTHER,
          organizationName: 'Elsewhere',
          role: 'OWNER',
          capabilities: OWNER_CAPABILITIES,
        },
      ]),
      answer: team('HIDDEN'),
      query: { organizationId: ORG },
    })

    expect(screen.queryByRole('heading', { name: 'Ownership' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hand ownership/u })).not.toBeInTheDocument()
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

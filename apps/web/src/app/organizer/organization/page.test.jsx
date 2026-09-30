/**
 * The organisation screen offers a verification request only where one can
 * be made, and only to somebody who may make it here.
 *
 * @module app/organizer/organization/page.test
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/organizer/organization',
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

  return { ...actual, getOrganizationProfile: vi.fn(), getVerification: vi.fn() }
})

const { getOrganizationProfile, getVerification } = await import('../../../lib/workspace-api.js')
const { default: OrganizationPage } = await import('./page.jsx')

const ORG = 'org00000000000000000001'
const OTHER = 'org00000000000000000002'

/**
 * A session with one membership.
 *
 * @param {string[]} capabilities What the membership holds.
 * @param {object[]} [extra] More memberships.
 * @returns {object} The session.
 */
function session(capabilities, extra = []) {
  return {
    user: { displayName: 'Meera' },
    capabilities: [],
    memberships: [
      { organizationId: ORG, organizationName: 'Bay Lights', role: 'OWNER', capabilities },
      ...extra,
    ],
  }
}

const OWNER = ['organization:view_members', 'organization:submit_verification']

/**
 * The profile.
 *
 * @returns {object} The profile.
 */
function profile() {
  return {
    id: ORG,
    name: 'Bay Lights',
    slug: 'bay-lights',
    description: null,
    websiteUrl: null,
    timezone: 'America/Los_Angeles',
    legalName: null,
    verificationStatus: 'UNVERIFIED',
    eligible: false,
    createdAt: '2026-09-01T00:00:00.000Z',
  }
}

/**
 * A verification state.
 *
 * @param {string} status The state.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The state.
 */
function verification(status, overrides = {}) {
  return {
    organizationId: ORG,
    status,
    eligible: status === 'VERIFIED',
    note: null,
    updatedAt: null,
    history: [],
    ...overrides,
  }
}

/**
 * Render the page.
 *
 * @param {object} options What the API and the session answer.
 * @param {object} [options.as] The session.
 * @param {object} [options.state] The verification the API answers.
 * @param {object} [options.query] The page's query string.
 * @returns {Promise<object>} The render result.
 */
async function renderPage({ as = session(OWNER), state = verification('UNVERIFIED'), query = {} }) {
  readSession.mockResolvedValue(as)
  getOrganizationProfile.mockResolvedValue(profile())
  getVerification.mockResolvedValue(state)

  return render(await OrganizationPage({ searchParams: Promise.resolve(query) }))
}

beforeEach(() => {
  getOrganizationProfile.mockReset()
  getVerification.mockReset()
})

describe('the organisation screen', () => {
  it('shows the public page, the state and the request form to an owner of an unverified one', async () => {
    await renderPage({})

    expect(screen.getByRole('link', { name: '/organizers/bay-lights' })).toHaveAttribute(
      'href',
      '/organizers/bay-lights',
    )
    expect(screen.getByText('Unverified')).toBeInTheDocument()
    expect(screen.getByText('It may not publish events or be paid.')).toBeInTheDocument()
    // Only publishing and selling wait for verification: its events can still
    // be sent for review and approved, and the page must not say otherwise.
    expect(
      screen.getByText(
        /Until then its events can be drafted, sent for review and approved, but not published or sold\./u,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/events stay drafts/u)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask for verification' })).toBeInTheDocument()
    expect(
      screen.getByText(/No documents, bank details or tax\s+numbers are collected here/u),
    ).toBeInTheDocument()
  })

  it.each(['PENDING', 'VERIFIED', 'SUSPENDED'])(
    'offers no request while it is %s',
    async (status) => {
      await renderPage({ state: verification(status) })

      expect(
        screen.queryByRole('button', { name: /Ask for verification|Send the answer/u }),
      ).not.toBeInTheDocument()
    },
  )

  it('offers no request to a member who may not make one here', async () => {
    await renderPage({
      as: session(
        ['organization:view_members'],
        [
          {
            organizationId: OTHER,
            organizationName: 'Elsewhere',
            role: 'OWNER',
            capabilities: OWNER,
          },
        ],
      ),
      query: { organizationId: ORG },
    })

    expect(getVerification).toHaveBeenCalledWith(ORG)
    expect(screen.queryByRole('button', { name: 'Ask for verification' })).not.toBeInTheDocument()
  })

  it('shows what the moderator asked for, and asks for the answer', async () => {
    await renderPage({
      state: verification('REQUIRES_INFORMATION', {
        note: 'Send the registered business name.',
        history: [
          {
            id: 'h1',
            fromStatus: 'PENDING',
            toStatus: 'REQUIRES_INFORMATION',
            reason: 'Need the legal entity.',
            createdAt: '2026-09-10T00:00:00.000Z',
          },
        ],
      }),
    })

    expect(screen.getByText('What the moderator asked for')).toBeInTheDocument()
    expect(screen.getByText('Send the registered business name.')).toBeInTheDocument()
    expect(screen.getByText('Need the legal entity.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send the answer' })).toBeDisabled()
  })

  it('refuses an account with no membership that may read it', async () => {
    readSession.mockResolvedValue({ user: {}, capabilities: [], memberships: [] })

    render(await OrganizationPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(getOrganizationProfile).not.toHaveBeenCalled()
  })
})

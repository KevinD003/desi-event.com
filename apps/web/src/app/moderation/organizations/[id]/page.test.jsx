/**
 * The organisation review shows what a decision is made from, and offers the
 * decisions open from its state.
 *
 * @file app/moderation/organizations/id/page.test.jsx
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../../lib/session.js', () => ({ readSession: vi.fn() }))
vi.mock('../../../../lib/workspace-api.js', async () => {
  const actual = await vi.importActual('../../../../lib/workspace-api.js')

  return { ...actual, getVerificationReview: vi.fn() }
})

const { getVerificationReview } = await import('../../../../lib/workspace-api.js')
const { readSession } = await import('../../../../lib/session.js')
const { default: ReviewOrganizationPage } = await import('./page.jsx')
const { CONFLICT_OF_INTEREST_NOTICE } = await import('../../../../lib/review-independence.js')

const ORG = 'org00000000000000000001'

/**
 * A review payload.
 *
 * @param {string} status The verification state.
 * @returns {object} The review.
 */
function review(status) {
  return {
    organization: {
      id: ORG,
      name: 'Bay Lights Garba Co.',
      slug: 'bay-lights-garba-co',
      description: 'Four nights of garba.',
      websiteUrl: 'https://baylights.example',
      timezone: 'America/Los_Angeles',
      legalName: 'Bay Lights LLC',
      verificationStatus: status,
      eligible: false,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
    verification: {
      organizationId: ORG,
      status,
      eligible: status === 'VERIFIED',
      note: null,
      updatedAt: '2026-09-01T10:00:00.000Z',
      history: [
        {
          id: 'h1',
          fromStatus: 'UNVERIFIED',
          toStatus: 'PENDING',
          reason: 'We have run four nights a year.',
          createdAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    },
    memberCount: 3,
    eventCount: 1,
  }
}

beforeEach(() => {
  getVerificationReview.mockReset()
  readSession.mockReset()
  readSession.mockResolvedValue({
    user: { displayName: 'Mod' },
    capabilities: ['moderation:review'],
    memberships: [],
  })
})

describe('the organisation review', () => {
  it('shows the profile, the counts and the history, and the three decisions from PENDING', async () => {
    getVerificationReview.mockResolvedValue(review('PENDING'))

    render(await ReviewOrganizationPage({ params: Promise.resolve({ id: ORG }) }))

    expect(getVerificationReview).toHaveBeenCalledWith(ORG)
    expect(screen.getByRole('heading', { level: 1, name: 'Bay Lights Garba Co.' })).toBeVisible()
    expect(screen.getByText('Bay Lights LLC')).toBeVisible()
    expect(screen.getByText('We have run four nights a year.')).toBeVisible()
    for (const label of ['Verify', 'Ask for more information', 'Reject']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
  })

  it('offers suspending and revoking a verified organisation, and nothing else', async () => {
    getVerificationReview.mockResolvedValue(review('VERIFIED'))

    render(await ReviewOrganizationPage({ params: Promise.resolve({ id: ORG }) }))

    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('draws the refusal without the API’s words when the read is refused', async () => {
    getVerificationReview.mockRejectedValue(
      Object.assign(new Error('Raw words naming /v1/moderation'), { status: 404 }),
    )

    const { container } = render(
      await ReviewOrganizationPage({ params: Promise.resolve({ id: ORG }) }),
    )

    expect(container.textContent).not.toMatch(/\/v1\//u)
    expect(
      screen.getAllByRole('link', { name: 'Back to organisation checks' }).length,
    ).toBeGreaterThan(0)
  })
})

describe('a reviewer who belongs to the organisation', () => {
  it('is told somebody else decides, and is offered no decision', async () => {
    getVerificationReview.mockResolvedValue(review('PENDING'))
    readSession.mockResolvedValue({
      user: { displayName: 'Mod' },
      capabilities: ['moderation:review'],
      memberships: [{ organizationId: ORG, role: 'STAFF', capabilities: [] }],
    })

    render(await ReviewOrganizationPage({ params: Promise.resolve({ id: ORG }) }))

    expect(screen.getByText(CONFLICT_OF_INTEREST_NOTICE)).toBeVisible()

    for (const label of ['Verify', 'Ask for more information', 'Reject']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
  })

  it('is offered the decisions when the membership is in another organisation', async () => {
    getVerificationReview.mockResolvedValue(review('PENDING'))
    readSession.mockResolvedValue({
      user: { displayName: 'Mod' },
      capabilities: ['moderation:review'],
      memberships: [{ organizationId: 'org00000000000000000099', role: 'OWNER', capabilities: [] }],
    })

    render(await ReviewOrganizationPage({ params: Promise.resolve({ id: ORG }) }))

    expect(screen.queryByText(CONFLICT_OF_INTEREST_NOTICE)).toBeNull()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })
})

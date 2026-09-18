/**
 * The retention shell asks the platform question, and must not be talked into
 * the organisation one.
 *
 * `retention:view` is in `PLATFORM_ONLY_CAPABILITIES`, which is asserted at
 * module load never to appear in any organisation role. So the shell's check
 * has to consult the *platform* capability list — the mirror image of the
 * privacy shell next door, which walks memberships because `privacy:redact` is
 * organisation-scoped and the unscoped question there is the NF-05 inversion.
 *
 * Getting it backwards here would be quiet: a membership walk would search a
 * list that can never contain `retention:view` and refuse everybody, including
 * the platform readers the area exists for.
 *
 * @module app/retention/layout.test
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const readSession = vi.fn()
const redirect = vi.fn()

vi.mock('../../lib/session.js', async () => {
  const actual = await vi.importActual('../../lib/session.js')

  return { ...actual, readSession: (...args) => readSession(...args) }
})
vi.mock('next/navigation', () => ({ redirect: (...args) => redirect(...args) }))

const { default: RetentionLayout } = await import('./layout.jsx')

/** An organisation the fixtures act in. */
const ORGANIZATION = 'org00000000000000000001'

/**
 * A session payload.
 *
 * @param {object} [overrides] Fields to change.
 * @returns {object} The session.
 */
function session(overrides = {}) {
  return {
    user: { displayName: 'Ops' },
    capabilities: [],
    memberships: [],
    ...overrides,
  }
}

/**
 * Render the shell for a session.
 *
 * @param {object|null} value What `readSession` resolves with.
 * @returns {Promise<void>} Resolves once rendered.
 */
async function renderShell(value) {
  readSession.mockResolvedValue(value)

  render(await RetentionLayout({ children: <p>inside</p> }))
}

describe('who the shell admits', () => {
  it('admits a session holding retention:view platform-wide', async () => {
    await renderShell(session({ capabilities: ['retention:view'] }))

    expect(screen.getByText('inside')).toBeInTheDocument()
  })

  it('refuses a session with no capabilities at all', async () => {
    await renderShell(session())

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
    expect(screen.queryByText('inside')).not.toBeInTheDocument()
  })

  it('refuses an organisation owner who holds every organisation capability', async () => {
    // The inversion this guards against, from the other side: no membership can
    // carry a platform-only capability, so a membership that somehow listed it
    // must not be believed by the shell either.
    await renderShell(
      session({
        memberships: [
          {
            organizationId: ORGANIZATION,
            role: 'OWNER',
            capabilities: ['privacy:redact', 'organization:manage', 'retention:view'],
          },
        ],
      }),
    )

    expect(screen.getByRole('heading', { name: 'Not for you' })).toBeInTheDocument()
  })

  it('redirects an unauthenticated visitor to sign in, carrying where they were going', async () => {
    readSession.mockResolvedValue(null)
    redirect.mockClear()

    // `redirect` is mocked, so the component keeps going and would throw on the
    // null session; the assertion is that it asked for the redirect first.
    await RetentionLayout({ children: <p>inside</p> }).catch(() => {})

    expect(redirect).toHaveBeenCalledWith('/sign-in?next=/retention')
  })
})

describe('what the shell says when it refuses', () => {
  it('explains that no organisation role can grant this', async () => {
    // So somebody refused here asks the right person, rather than their
    // organisation owner who cannot help.
    await renderShell(session())

    expect(screen.getByText(/not held by any role inside an organisation/i)).toBeInTheDocument()
  })
})

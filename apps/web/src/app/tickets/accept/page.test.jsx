/**
 * Accepting a ticket: the page says how the code arrived, truly in the
 * delivery mode the session reports, and reads no code from its address.
 *
 * @module app/tickets/accept/page.test
 */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('../../../lib/api-fetch.js', () => ({ apiFetch: vi.fn() }))
vi.mock('../../../lib/session.js', () => ({ readSession: vi.fn() }))

const { readSession } = await import('../../../lib/session.js')
const { default: AcceptTransferPage, HOW_THE_CODE_ARRIVES } = await import('./page.jsx')

/**
 * Render the page for a delivery mode.
 *
 * @param {'MANUAL'|'EMAIL'|null} deliveryMode What `auth.me` reports.
 * @returns {Promise<object>} The render result.
 */
async function renderPage(deliveryMode) {
  readSession.mockResolvedValue({ user: { displayName: 'Meera' }, deliveryMode })

  return render(await AcceptTransferPage())
}

beforeEach(() => {
  readSession.mockReset()
})

describe('the accept-a-ticket page', () => {
  it('says, when codes are not emailed, that the sender hands the code over', async () => {
    const { container } = await renderPage('MANUAL')

    expect(container.textContent).toContain(HOW_THE_CODE_ARRIVES.MANUAL)
    expect(container.textContent).not.toMatch(/sends no email/iu)
  })

  it('says, when codes are emailed, that it went to the address the ticket was offered to', async () => {
    const { container } = await renderPage('EMAIL')

    expect(container.textContent).toContain(HOW_THE_CODE_ARRIVES.EMAIL)
    expect(container.textContent).not.toContain(HOW_THE_CODE_ARRIVES.MANUAL)
  })

  it('says only how to accept when the mode is not known', async () => {
    const { container } = await renderPage(null)

    for (const sentence of Object.values(HOW_THE_CODE_ARRIVES)) {
      expect(container.textContent).not.toContain(sentence)
    }

    expect(
      screen.getByText(/Sign in with the address the ticket was offered to, then paste the code/u),
    ).toBeVisible()
  })

  it('takes no props, so a code in its address has nowhere to go', () => {
    expect(AcceptTransferPage.length).toBe(0)
  })
})

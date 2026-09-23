/**
 * The public limitations page says the recorded status of everything this
 * build does not do, word for word, and promises nothing.
 *
 * The statuses are pinned as literals here rather than read back from the
 * list, so that a change of word in the list — "PENDING" softened to
 * "planned", say — fails a test instead of quietly disagreeing with the
 * report.
 *
 * @module app/limitations/page.test
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import LimitationsPage from './page.jsx'

afterEach(cleanup)

/** Each recorded limitation, and the status it must carry, word for word. */
const RECORDED = [
  ['Handing on a reserved-seat ticket', 'BLOCKED — UNIQUE-SEAT TRANSFER DEFECT'],
  ['Group booking', 'NOT IMPLEMENTED'],
  ['Check-in without a connection', 'NOT IMPLEMENTED'],
  ['Ticket passes on real phones', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Door scanning in Safari and Firefox', 'EXTERNAL DEVICE VERIFICATION PENDING'],
  ['Real payments, Stripe and Connect payouts', 'EXTERNAL VERIFICATION PENDING'],
  ['Text messages', 'NOT IMPLEMENTED'],
  ['Email', 'NOT IMPLEMENTED'],
  ['Automatic deletion after a set time', 'DISABLED'],
]

describe('LimitationsPage', () => {
  it.each(RECORDED)('gives “%s” the status %s', (name, status) => {
    render(<LimitationsPage />)

    const entry = screen.getByRole('heading', { level: 2, name }).closest('li')

    expect(within(entry).getByText(status, { exact: true })).toBeTruthy()
  })

  it('lists nothing it does not record', () => {
    render(<LimitationsPage />)

    expect(screen.getAllByRole('listitem').filter((item) => item.querySelector('h2'))).toHaveLength(
      RECORDED.length,
    )
  })

  it('says payments are simulated, and claims no money moved', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).toMatch(/payments on this site are simulated/i)
    expect(container.textContent).toMatch(/nothing is charged/i)
    expect(container.textContent).not.toMatch(/\b(paid out to|money was sent|charged your)\b/i)
  })

  it('promises nothing', () => {
    const { container } = render(<LimitationsPage />)

    expect(container.textContent).not.toMatch(/coming soon|\bsoon\b|\byet\b|in a future|planned/i)
  })

  it('makes no request of its own', () => {
    const fetch = vi.spyOn(globalThis, 'fetch')

    render(<LimitationsPage />)

    expect(fetch).not.toHaveBeenCalled()
    fetch.mockRestore()
  })
})

/**
 * The page's content box, crossfaded between pages: a real box, marked with
 * which shell it is in, so the shell around it can stay where it is.
 *
 * @module components/page-transition.test
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** What the mocked router reports; set per test. */
const location = { pathname: '/organizer/events' }

vi.mock('next/navigation', () => ({ usePathname: () => location.pathname }))

const { PAGE_FADE, PageTransition } = await import('./page-transition.jsx')

/**
 * A page with a little state of its own, to tell a re-render from a remount.
 *
 * @returns {JSX.Element} The page.
 */
function Counter() {
  const [count, setCount] = useState(0)

  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      {`Pressed ${count}`}
    </button>
  )
}

afterEach(cleanup)

describe('PageTransition', () => {
  it('wraps the page in one real box, marked as the public site’s by default', () => {
    render(
      <PageTransition>
        <p>page</p>
      </PageTransition>,
    )

    const box = screen.getByText('page').parentElement

    expect(box.getAttribute('data-page-content')).toBe('public')
    expect(box.className).toBe('flex flex-1 flex-col')
    // A box the transition can capture: never `display: contents`.
    expect(box.className).not.toMatch(/\bcontents\b/u)
  })

  it('marks the workspace’s content as its own, with the shell’s classes', () => {
    render(
      <PageTransition kind="workspace" className="px-4">
        <p>page</p>
      </PageTransition>,
    )

    const box = screen.getByText('page').parentElement

    expect(box.getAttribute('data-page-content')).toBe('workspace')
    expect(box.className).toBe('px-4')
  })

  it('swaps its boundary when the path changes, so a navigation is an exit and an entrance', () => {
    const { rerender } = render(
      <PageTransition kind="workspace">
        <Counter />
      </PageTransition>,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveTextContent('Pressed 1')

    // The same page drawn again (a refresh, a changed query) is an update,
    // which does not fade, and keeps what the page holds.
    rerender(
      <PageTransition kind="workspace">
        <Counter />
      </PageTransition>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Pressed 1')

    // Another page is another boundary.
    location.pathname = '/organizer/team'
    rerender(
      <PageTransition kind="workspace">
        <Counter />
      </PageTransition>,
    )
    expect(screen.getByRole('button')).toHaveTextContent('Pressed 0')
    location.pathname = '/organizer/events'
  })

  it('fades the two shells under their own names, which the stylesheet times', () => {
    expect(PAGE_FADE).toEqual({ public: 'page-fade', workspace: 'workspace-fade' })
  })
})

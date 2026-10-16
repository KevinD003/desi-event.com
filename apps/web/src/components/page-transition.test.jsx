/**
 * The page's content box, crossfaded between pages: a real box, marked with
 * which shell it is in, so the shell around it can stay where it is.
 *
 * @module components/page-transition.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PAGE_FADE, PageTransition } from './page-transition.jsx'

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

  it('fades the two shells under their own names, which the stylesheet times', () => {
    expect(PAGE_FADE).toEqual({ public: 'page-fade', workspace: 'workspace-fade' })
  })
})

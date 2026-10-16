/**
 * The public shell: the site header, the page in `main`, and the footer
 * plate, with exactly one of each landmark.
 *
 * @module components/public-shell.test
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The header reads the session on the server; here it is a plain banner.
vi.mock('./site-header.jsx', () => ({ SiteHeader: () => <header>header</header> }))

const { PublicShell } = await import('./public-shell.jsx')

afterEach(cleanup)

describe('PublicShell', () => {
  it('draws one banner, one main and one contentinfo, in that order', () => {
    render(
      <PublicShell>
        <h1>Page</h1>
      </PublicShell>,
    )

    const [banner, main, footer] = [
      screen.getByRole('banner'),
      screen.getByRole('main'),
      screen.getByRole('contentinfo'),
    ]

    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
    expect(banner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('gives the skip link its target, and puts the page in the crossfaded box', () => {
    render(
      <PublicShell>
        <h1>Page</h1>
      </PublicShell>,
    )

    const main = screen.getByRole('main')

    expect(main.id).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('heading', { name: 'Page' }).parentElement).toHaveAttribute(
      'data-page-content',
      'public',
    )
  })
})

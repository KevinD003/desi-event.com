import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PageHero } from './page-hero.jsx'

describe('PageHero', () => {
  it('holds the page’s one h1, and is a region named by it', () => {
    render(<PageHero headingId="page-heading" title="Venues" lead="Where the circle forms." />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Venues' })

    expect(heading.id).toBe('page-heading')
    expect(screen.getAllByRole('heading')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Venues' })).toContainElement(heading)
    expect(screen.getByText('Where the circle forms.')).toBeInTheDocument()
  })

  it('puts the eyebrow before the heading and the trail before both', () => {
    const { container } = render(
      <PageHero
        headingId="page-heading"
        eyebrow="Organisers"
        title="Who is putting on the nights"
        breadcrumbs={<nav aria-label="Breadcrumb">trail</nav>}
      />,
    )

    const order = [...container.querySelectorAll('nav, p, h1')].map((element) =>
      element.tagName.toLowerCase(),
    )

    expect(order.slice(0, 3)).toEqual(['nav', 'p', 'h1'])
    expect(screen.getByText('Organisers')).toBeInTheDocument()
  })

  it('keeps its artwork away from assistive technology', () => {
    const { container } = render(
      <PageHero headingId="page-heading" title="Categories" art={<svg data-testid="art" />} />,
    )

    expect(screen.getByTestId('art').closest('[aria-hidden="true"]')).not.toBeNull()
    // The toran and the hem are decoration too; nothing but the words is announced.
    for (const svg of container.querySelectorAll('svg:not([data-testid])')) {
      expect(svg.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('renders what the page adds beneath the lead', () => {
    render(
      <PageHero headingId="page-heading" title="A venue">
        <p>This venue record was merged into another one.</p>
      </PageHero>,
    )

    expect(screen.getByText(/merged into another one/)).toBeInTheDocument()
  })
})

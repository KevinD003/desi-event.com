import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AsOf, Breadcrumbs, Empty, Failure, Forbidden, Loading } from './page-state.jsx'

describe('Breadcrumbs', () => {
  it('names the trail as a navigation landmark', () => {
    render(
      <Breadcrumbs
        trail={[
          { href: '/', label: 'Home' },
          { href: null, label: 'Analytics' },
        ]}
      />,
    )

    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  it('does not link the page the reader is already on', () => {
    render(
      <Breadcrumbs
        trail={[
          { href: '/', label: 'Home' },
          { href: '/analytics', label: 'Analytics' },
        ]}
      />,
    )

    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument()
    expect(screen.getByText('Analytics')).toHaveAttribute('aria-current', 'page')
  })

  it('marks the separators decorative so a reader hears labels, not slashes', () => {
    const { container } = render(
      <Breadcrumbs
        trail={[
          { href: '/', label: 'Home' },
          { href: null, label: 'Analytics' },
        ]}
      />,
    )

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1)
  })
})

describe('Failure', () => {
  it('announces itself, because it replaces content the reader was waiting for', () => {
    render(<Failure what="The analytics" />)

    expect(screen.getByRole('status')).toHaveTextContent('The analytics could not be loaded')
  })

  it('says the figures are absent rather than stale', () => {
    render(<Failure what="The refund" detail="the service timed out" />)

    const alert = screen.getByRole('status')

    expect(alert).toHaveTextContent('The service timed out.')
    expect(alert).toHaveTextContent(/absent/i)
  })

  it('keeps a detail that is already a sentence as one, without doubling its full stop', () => {
    render(<Failure what="The refund" detail="Nothing reached Desi-Event. Try again." />)

    const text = screen.getByRole('status').textContent

    expect(text).toContain(
      'The refund could not be loaded. Nothing reached Desi-Event. Try again. ',
    )
    expect(text).not.toMatch(/\.\.|: Nothing/)
  })
})

describe('Forbidden', () => {
  it('says the same words whether the thing exists or not', () => {
    const { container: missing } = render(<Forbidden area="Refund RF-404" />)
    const absent = missing.textContent.replace('RF-404', 'ID')

    const { container: theirs } = render(<Forbidden area="Refund ID" />)

    expect(absent).toBe(theirs.textContent)
  })

  it('offers a way out that is not the thing being refused', () => {
    render(<Forbidden area="Reconciliation" backHref="/analytics" backLabel="Back to analytics" />)

    expect(screen.getByRole('link', { name: 'Back to analytics' })).toHaveAttribute(
      'href',
      '/analytics',
    )
  })

  it('never hints at what would have granted access', () => {
    render(<Forbidden area="Reconciliation" />)

    expect(document.body.textContent).not.toMatch(/capability|role|platform:|finance:view/i)
  })
})

describe('Empty and Loading', () => {
  it('distinguishes nothing-to-show from something-went-wrong', () => {
    render(<Empty title="No refunds yet" description="Nobody has asked for one." />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByText('No refunds yet')).toBeInTheDocument()
  })

  it('announces work in progress to a reader who cannot see a spinner', () => {
    render(<Loading label="the analytics" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading the analytics…')
  })
})

describe('AsOf', () => {
  it('stamps the snapshot in a machine-readable element', () => {
    const { container } = render(<AsOf asOf="2026-09-16T12:00:00.000Z" />)

    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-09-16T12:00:00.000Z')
  })

  it('warns that the page does not refresh itself', () => {
    render(<AsOf asOf="2026-09-16T12:00:00.000Z" />)

    expect(document.body.textContent).toMatch(/does not refresh itself/i)
  })
})

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Button, ButtonLink } from './Button.jsx'
import { buttonClasses, textLinkClasses } from './buttonClasses.js'
import { TextLink } from './TextLink.jsx'

describe('ButtonLink', () => {
  it('is a link, not a button pretending to navigate', () => {
    render(<ButtonLink href="/events/garba/checkout">Choose tickets</ButtonLink>)

    const link = screen.getByRole('link', { name: 'Choose tickets' })

    expect(link).toHaveAttribute('href', '/events/garba/checkout')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('looks exactly like the button of the same variant and size, bar the press gate', () => {
    render(
      <>
        <Button variant="accent" size="lg">
          Same
        </Button>
        <ButtonLink href="#x" variant="accent" size="lg">
          Same
        </ButtonLink>
      </>,
    )

    const strip = (element) =>
      [...element.classList]
        .filter((cls) => !/scale-|disabled:/.test(cls))
        .sort()
        .join(' ')

    expect(strip(screen.getByRole('link'))).toBe(strip(screen.getByRole('button')))
    // A link has no :enabled state, so its press is gated on motion-safe alone.
    expect(screen.getByRole('link')).toHaveClass('motion-safe:active:scale-[0.98]')
    expect(screen.getByRole('button')).toHaveClass('motion-safe:enabled:active:scale-[0.98]')
  })

  it('renders through the router link the app hands it, keeping every prop', () => {
    /**
     * A stand-in for Next's Link.
     *
     * @param {object} props Component props, forwarded to the anchor.
     * @returns {JSX.Element} An anchor marked as routed.
     */
    function RouterLink(props) {
      return <a data-routed="" {...props} />
    }

    render(
      <ButtonLink as={RouterLink} href="/tickets" variant="secondary" aria-describedby="hint">
        My tickets
      </ButtonLink>,
    )

    const link = screen.getByRole('link', { name: 'My tickets' })

    expect(link).toHaveAttribute('data-routed')
    expect(link).toHaveAttribute('aria-describedby', 'hint')
    expect(link).toHaveAttribute('data-variant', 'secondary')
  })

  it('draws the one focus outline and is at least 44px tall at md and lg', () => {
    render(
      <>
        <ButtonLink href="#a">Medium</ButtonLink>
        <ButtonLink href="#b" size="lg">
          Large
        </ButtonLink>
      </>,
    )

    for (const [name, height] of [
      ['Medium', 'min-h-11'],
      ['Large', 'min-h-12'],
    ]) {
      const link = screen.getByRole('link', { name })

      expect(link).toHaveClass(
        height,
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-focus',
      )
      expect(link.className).not.toMatch(/focus-visible:(ring-|outline-none)/)
    }
  })
})

describe('buttonClasses', () => {
  it('lets the caller’s classes win a conflict', () => {
    const classes = buttonClasses({ size: 'sm', className: 'min-h-11' }).split(' ')

    expect(classes).toContain('min-h-11')
    expect(classes).not.toContain('min-h-9')
  })

  it('falls back to the primary variant and the medium size for unknown names', () => {
    expect(buttonClasses({ variant: 'fuchsia', size: 'xxl' })).toBe(buttonClasses())
  })

  it('stretches to the container when asked', () => {
    expect(buttonClasses({ fullWidth: true }).split(' ')).toContain('w-full')
  })
})

describe('TextLink', () => {
  it.each([
    ['accent', 'text-accent-strong'],
    ['ink', 'text-ink'],
    ['inverse', 'text-accent-inverse'],
  ])('is underlined in the %s tone, so it is never told by colour alone', (tone, colour) => {
    render(
      <TextLink href="/limitations" tone={tone}>
        What this site does not do
      </TextLink>,
    )

    expect(screen.getByRole('link', { name: 'What this site does not do' })).toHaveClass(
      'underline',
      colour,
      'focus-visible:outline-focus',
    )
  })

  it('never changes weight on hover, which would reflow the line', () => {
    for (const tone of ['accent', 'ink', 'inverse']) {
      expect(textLinkClasses({ tone })).not.toMatch(/hover:font-/)
    }
  })
})

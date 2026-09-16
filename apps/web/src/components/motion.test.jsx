import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const useReducedMotion = vi.fn()

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')

  return { ...actual, useReducedMotion }
})

const { FadeIn, HoverLift, RevealOnScroll } = await import('./motion.jsx')

afterEach(() => {
  useReducedMotion.mockReset()
})

describe.each([
  ['FadeIn', FadeIn],
  ['RevealOnScroll', RevealOnScroll],
  ['HoverLift', HoverLift],
])('%s', (_name, Component) => {
  it('renders its children when motion is welcome', () => {
    useReducedMotion.mockReturnValue(false)
    render(<Component>Nine nights of garba</Component>)

    expect(screen.getByText('Nine nights of garba')).toBeInTheDocument()
  })

  it('still renders its children when the platform asks for reduced motion', () => {
    useReducedMotion.mockReturnValue(true)
    render(<Component>Nine nights of garba</Component>)

    expect(screen.getByText('Nine nights of garba')).toBeInTheDocument()
  })

  it('consults the platform preference rather than animating unconditionally', () => {
    useReducedMotion.mockReturnValue(true)
    render(<Component>Content</Component>)

    expect(useReducedMotion).toHaveBeenCalled()
  })

  it('renders the element the caller asked for', () => {
    useReducedMotion.mockReturnValue(false)
    render(
      <ul>
        <Component as="li">A list item</Component>
      </ul>,
    )

    expect(screen.getByRole('listitem')).toHaveTextContent('A list item')
  })

  it('leaves no inline transform behind under reduced motion', () => {
    useReducedMotion.mockReturnValue(true)
    const { container } = render(<Component>Still</Component>)

    expect(container.firstChild.getAttribute('style')).toBeNull()
  })

  it('keeps the caller’s classes', () => {
    useReducedMotion.mockReturnValue(true)
    const { container } = render(<Component className="text-marigold-700">Styled</Component>)

    expect(container.firstChild).toHaveClass('text-marigold-700')
  })
})

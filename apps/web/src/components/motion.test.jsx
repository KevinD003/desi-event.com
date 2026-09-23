import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'

const useReducedMotion = vi.fn()

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')

  return { ...actual, useReducedMotion }
})

const {
  DURATION,
  EASE,
  FadeIn,
  HoverLift,
  HoverZoom,
  Reveal,
  RevealOnScroll,
  STAGGER_STEP,
  Stagger,
  StaggerItem,
  useScrolledPast,
} = await import('./motion.jsx')

afterEach(() => {
  useReducedMotion.mockReset()
})

/**
 * The shared theme, read from source so the motion constants are checked
 * against the tokens rather than against a copy of them.
 *
 * @returns {Promise<string>} The stylesheet.
 */
async function themeCss() {
  const { readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))

  return readFileSync(
    path.join(here, '..', '..', '..', '..', 'packages', 'config', 'src', 'tailwind.css'),
    'utf8',
  )
}

describe.each([
  ['FadeIn', FadeIn],
  ['Reveal', Reveal],
  ['RevealOnScroll', RevealOnScroll],
  ['Stagger', Stagger],
  ['StaggerItem', StaggerItem],
  ['HoverLift', HoverLift],
  ['HoverZoom', HoverZoom],
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
    // Nor on anything it wraps the content in.
    expect(container.querySelector('[style]')).toBeNull()
  })

  it('keeps the caller’s classes', () => {
    useReducedMotion.mockReturnValue(true)
    const { container } = render(<Component className="text-marigold-700">Styled</Component>)

    expect(container.firstChild).toHaveClass('text-marigold-700')
  })

  it('marks everything the server renders hidden, so the theme can reveal it', () => {
    // The server cannot know the visitor's preference and renders the
    // animated branch. Anything it inlines at opacity 0 must carry
    // `data-motion`, or the reduced-motion and no-script rules in the theme
    // cannot reach it and the content never appears.
    useReducedMotion.mockReturnValue(false)
    const markup = renderToStaticMarkup(
      <Component>
        <StaggerItem>Inside</StaggerItem>
      </Component>,
    )
    const document = new DOMParser().parseFromString(markup, 'text/html')
    const hidden = [...document.body.querySelectorAll('[style]')].filter((element) =>
      /opacity:\s*0(?![.\d])/.test(element.getAttribute('style')),
    )

    expect(hidden.filter((element) => !element.hasAttribute('data-motion'))).toEqual([])
  })
})

describe('entrances', () => {
  it.each([
    ['FadeIn', FadeIn],
    ['Reveal', Reveal],
  ])('%s starts 12px low and transparent, and no further', (_name, Component) => {
    useReducedMotion.mockReturnValue(false)
    const markup = renderToStaticMarkup(<Component>Rising</Component>)

    expect(markup).toContain('data-motion=""')
    expect(markup).toMatch(/opacity:0/)
    expect(markup).toMatch(/translateY\(12px\)/)
  })

  it('renders a staggered group’s items hidden until their turn, and marked', () => {
    useReducedMotion.mockReturnValue(false)
    const markup = renderToStaticMarkup(
      <Stagger trigger="mount">
        <StaggerItem>One</StaggerItem>
        <StaggerItem>Two</StaggerItem>
      </Stagger>,
    )

    expect(
      markup.match(/data-motion=""[^>]*style="opacity:0;transform:translateY\(12px\)/g),
    ).toHaveLength(2)
  })

  it('renders a staggered group plainly under reduced motion', () => {
    useReducedMotion.mockReturnValue(true)
    const { container } = render(
      <Stagger as="ul">
        <StaggerItem as="li">One</StaggerItem>
        <StaggerItem as="li">Two</StaggerItem>
      </Stagger>,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('[style]')).toBeNull()
    expect(container.querySelectorAll('[data-motion]')).toHaveLength(3)
  })
})

describe('HoverLift', () => {
  it('lifts while something inside it has keyboard focus, as it would on hover', () => {
    useReducedMotion.mockReturnValue(false)
    render(
      <>
        <HoverLift data-testid="card">
          <a href="#one">One event</a>
          <button type="button">Save</button>
        </HoverLift>
        <button type="button">Elsewhere</button>
      </>,
    )

    const card = screen.getByTestId('card')

    expect(card).not.toHaveAttribute('data-lifted')

    act(() => screen.getByRole('link', { name: 'One event' }).focus())
    expect(card).toHaveAttribute('data-lifted')

    // Moving between two controls inside the card does not drop it.
    act(() => screen.getByRole('button', { name: 'Save' }).focus())
    expect(card).toHaveAttribute('data-lifted')

    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    expect(card).not.toHaveAttribute('data-lifted')
  })

  it('never lifts under reduced motion, and still passes focus handlers on', () => {
    useReducedMotion.mockReturnValue(true)
    const onFocus = vi.fn()
    render(
      <HoverLift data-testid="card" onFocus={onFocus}>
        <a href="#one">One event</a>
      </HoverLift>,
    )

    act(() => screen.getByRole('link').focus())

    expect(screen.getByTestId('card')).not.toHaveAttribute('data-lifted')
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it('calls the caller’s focus and blur handlers when motion is welcome too', () => {
    useReducedMotion.mockReturnValue(false)
    const onFocus = vi.fn()
    const onBlur = vi.fn()
    render(
      <>
        <HoverLift onFocus={onFocus} onBlur={onBlur}>
          <a href="#one">One event</a>
        </HoverLift>
        <button type="button">Elsewhere</button>
      </>,
    )

    act(() => screen.getByRole('link').focus())
    act(() => screen.getByRole('button').focus())

    expect(onFocus).toHaveBeenCalledTimes(1)
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
})

describe('HoverZoom', () => {
  it('clips its content to a frame, so a zoomed poster stays inside its edges', () => {
    useReducedMotion.mockReturnValue(false)
    const { container } = render(
      <HoverZoom as="figure" className="rounded-card">
        Poster
      </HoverZoom>,
    )

    const frame = container.firstChild

    expect(frame.tagName).toBe('FIGURE')
    expect(frame).toHaveClass('overflow-hidden', 'rounded-card')
    expect(frame.firstChild).toHaveAttribute('data-motion')
    expect(frame.firstChild).toHaveTextContent('Poster')
  })

  it('keeps the same structure under reduced motion, so hydration matches the server', () => {
    useReducedMotion.mockReturnValue(false)
    const moving = render(<HoverZoom>Poster</HoverZoom>).container.innerHTML.replace(
      / style="[^"]*"/g,
      '',
    )

    useReducedMotion.mockReturnValue(true)
    const still = render(<HoverZoom>Poster</HoverZoom>).container.innerHTML

    expect(still).toBe(moving)
  })
})

describe('useScrolledPast', () => {
  /**
   * A header stand-in that reports whether the page is scrolled.
   *
   * @param {object} props Component props.
   * @param {number} [props.offset] Passed to the hook.
   * @returns {JSX.Element} A paragraph saying yes or no.
   */
  function Probe({ offset }) {
    return <p>{useScrolledPast(offset) ? 'scrolled' : 'at top'}</p>
  }

  /**
   * Scroll the window to a position and tell the page.
   *
   * @param {number} y Pixels from the top.
   * @returns {void}
   */
  function scrollTo(y) {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    act(() => window.dispatchEvent(new Event('scroll')))
  }

  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('says whether the page has scrolled past the offset, both ways', () => {
    render(<Probe />)

    expect(screen.getByText('at top')).toBeInTheDocument()

    scrollTo(40)
    expect(screen.getByText('scrolled')).toBeInTheDocument()

    scrollTo(0)
    expect(screen.getByText('at top')).toBeInTheDocument()
  })

  it('takes its own offset', () => {
    render(<Probe offset={100} />)

    scrollTo(60)
    expect(screen.getByText('at top')).toBeInTheDocument()

    scrollTo(160)
    expect(screen.getByText('scrolled')).toBeInTheDocument()
  })

  it('stops listening when the header goes away', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Probe />)

    unmount()

    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})

describe('DURATION', () => {
  it('matches the theme’s duration tokens, and none is longer than 250 ms', async () => {
    const css = await themeCss()

    for (const [name, seconds] of Object.entries(DURATION)) {
      const declared = css.match(new RegExp(`--duration-${name}:\\s*([0-9]+)ms`, 'u'))?.[1]

      expect(Number(declared), name).toBe(Math.round(seconds * 1000))
      expect(seconds * 1000, name).toBeGreaterThanOrEqual(120)
      expect(seconds * 1000, name).toBeLessThanOrEqual(250)
    }
  })
})

describe('EASE and STAGGER_STEP', () => {
  it('use the theme’s one easing curve', async () => {
    const css = await themeCss()
    const declared = css
      .match(/--ease-standard:\s*cubic-bezier\(([^)]+)\)/u)?.[1]
      .split(',')
      .map(Number)

    expect([...EASE]).toEqual(declared)
  })

  it('space a staggered group 40-60 ms apart', () => {
    expect(STAGGER_STEP * 1000).toBeGreaterThanOrEqual(40)
    expect(STAGGER_STEP * 1000).toBeLessThanOrEqual(60)
  })
})

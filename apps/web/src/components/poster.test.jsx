import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { EventPoster, reactAttributeName } from './poster.jsx'

const EVENT = Object.freeze({
  slug: 'navratri-night-one-edison',
  title: 'Navratri Night One: Garba Under the Lights',
  category: 'GARBA_DANDIYA',
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * The ids an SVG defines and the ids its paints refer to.
 *
 * @param {Element} svg A rendered poster.
 * @returns {{defined: string[], referenced: string[]}} Both lists.
 */
function gradientIds(svg) {
  return {
    defined: [...svg.querySelectorAll('[id]')].map((element) => element.id),
    referenced: [...svg.querySelectorAll('[fill^="url("]')].map(
      (element) => /^url\(#([^)]+)\)$/.exec(element.getAttribute('fill'))[1],
    ),
  }
}

describe('EventPoster', () => {
  it('is one image, named for what it shows and whose poster it is', () => {
    render(<EventPoster event={EVENT} />)

    expect(
      screen.getByRole('img', {
        name: 'Illustration of garba dancers circling a lit lamp under festival lights for Navratri Night One: Garba Under the Lights',
      }),
    ).toBeInTheDocument()
  })

  it.each([
    ['WORKSHOP', 'Illustration of crossed dandiya sticks over a mandala for A class'],
    [
      'CULTURAL_FESTIVAL',
      'Illustration of a festival mandala under a toran of bunting for A class',
    ],
  ])('describes a %s poster by its own motif', (category, name) => {
    render(<EventPoster event={{ slug: 'a-class', title: 'A class', category }} />)

    expect(screen.getByRole('img', { name })).toBeInTheDocument()
  })

  it('still has a name when the event has no title', () => {
    render(<EventPoster event={{ slug: 'untitled', category: 'GARBA_DANDIYA' }} />)

    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/ for this event$/)
  })

  it('crops to its frame rather than letterboxing', () => {
    render(<EventPoster event={EVENT} />)

    const svg = screen.getByRole('img')

    expect(svg).toHaveAttribute('viewBox', '0 0 600 400')
    expect(svg).toHaveAttribute('preserveAspectRatio', 'xMidYMid slice')
  })

  it('sizes a card at the drawing’s 3:2 and a hero as a banner', () => {
    const { rerender } = render(<EventPoster event={EVENT} className="rounded-card" />)

    expect(screen.getByRole('img')).toHaveClass('block', 'w-full', 'aspect-[3/2]', 'rounded-card')

    rerender(<EventPoster event={EVENT} variant="hero" />)

    expect(screen.getByRole('img')).toHaveClass('aspect-[4/3]', 'lg:aspect-[16/7]')
  })

  it('gives each poster on a page its own gradients, even for the same event', () => {
    render(
      <>
        <EventPoster event={EVENT} />
        <EventPoster event={EVENT} variant="hero" />
      </>,
    )

    const [first, second] = screen.getAllByRole('img').map(gradientIds)

    expect(first.defined.length).toBeGreaterThan(0)
    expect(first.defined.filter((id) => second.defined.includes(id))).toEqual([])
    // And each paints only with gradients it defines itself.
    expect(first.referenced.filter((id) => !first.defined.includes(id))).toEqual([])
    expect(second.referenced.filter((id) => !second.defined.includes(id))).toEqual([])
  })

  it('renders the drawing as SVG elements, with no warning from React', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<EventPoster event={EVENT} />)

    const svg = screen.getByRole('img')

    expect(svg.querySelectorAll('circle').length).toBeGreaterThan(10)
    expect(svg.querySelector('linearGradient stop')).toHaveAttribute('stop-color')
    expect(svg.querySelector('[fill-opacity]')).not.toBeNull()
    expect(error).not.toHaveBeenCalled()
  })

  it('draws nothing but shapes: no text, script, link or foreign content', () => {
    render(<EventPoster event={EVENT} variant="hero" />)

    expect(
      screen.getByRole('img').querySelector('text, script, a, foreignObject, image, use'),
    ).toBeNull()
  })
})

describe('reactAttributeName', () => {
  it.each([
    ['fill-opacity', 'fillOpacity'],
    ['stroke-dasharray', 'strokeDasharray'],
    ['stop-color', 'stopColor'],
    ['viewBox', 'viewBox'],
    ['cx', 'cx'],
  ])('spells %s as %s', (svg, react) => {
    expect(reactAttributeName(svg)).toBe(react)
  })
})

describe('EventPoster with a drawing it does not recognise', () => {
  it('renders only the elements the poster vocabulary allows', async () => {
    vi.resetModules()
    vi.doMock('../lib/poster-art.js', async () => {
      const actual = await vi.importActual('../lib/poster-art.js')

      return {
        ...actual,
        posterArt: () => ({
          viewBox: '0 0 600 400',
          palette: 'test',
          children: [
            { tag: 'rect', attrs: { width: 600, height: 400, fill: 'none' }, children: [] },
            { tag: 'foreignObject', attrs: {}, children: [] },
            { tag: 'script', attrs: {}, children: [] },
          ],
        }),
      }
    })

    const { EventPoster: Mocked } = await import('./poster.jsx')

    render(<Mocked event={EVENT} />)

    const svg = screen.getByRole('img')

    expect(svg.querySelector('rect')).not.toBeNull()
    expect(svg.querySelector('foreignObject, script')).toBeNull()

    vi.doUnmock('../lib/poster-art.js')
  })
})

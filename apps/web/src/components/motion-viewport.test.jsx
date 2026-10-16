import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/*
 * Its own file on purpose: these tests install their own IntersectionObserver
 * and matchMedia stand-ins, and the setup file's always-visible stub must not
 * leak into them or they into the rest of the suite.
 */

/** How much of a very tall list a phone can show at once: 700px of 5,000. */
const TALL_RATIO = 700 / 5000

/** Every observer the component under test created, newest last. */
const observers = []

/**
 * An IntersectionObserver that behaves as a browser would for a list far
 * taller than the viewport, scrolled so that it fills the screen: the
 * visible share never rises above {@link TALL_RATIO}, so a threshold above
 * that is never crossed. It reports only when told to, as a scroll would.
 */
class TallListObserver {
  /**
   * @param {Function} callback Invoked with the observed entries.
   * @param {object} [options] The observer's options.
   */
  constructor(callback, options = {}) {
    this.callback = callback
    this.threshold = options.threshold ?? 0
    this.targets = []
    this.disconnected = false
    observers.push(this)
  }

  /**
   * @param {Element} target The observed element.
   * @returns {void}
   */
  observe(target) {
    this.targets.push(target)
  }

  /**
   * Scroll the list on screen: report it as its threshold would see it.
   *
   * @returns {void}
   */
  scrollIntoView() {
    const isIntersecting = this.threshold === 0 ? TALL_RATIO > 0 : TALL_RATIO >= this.threshold

    this.callback(
      this.targets.map((target) => ({ target, isIntersecting, intersectionRatio: TALL_RATIO })),
      this,
    )
  }

  /** @returns {void} */
  unobserve() {}

  /** @returns {void} */
  disconnect() {
    this.disconnected = true
  }

  /** @returns {object[]} Nothing pending. */
  takeRecords() {
    return []
  }
}

vi.stubGlobal('IntersectionObserver', TallListObserver)

const { Reveal, Stagger, StaggerItem, VIEWPORT } = await import('./motion.jsx')

/** Whether the visitor's platform asks for reduced motion, per test. */
let reduce = false

beforeEach(() => {
  reduce = false
  observers.length = 0
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query.includes('reduce') ? reduce : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  vi.unstubAllGlobals()
})

/**
 * Place every element a given distance from the top of the viewport, as the
 * layout would after hydration.
 *
 * @param {number} top Pixels from the top of the viewport.
 * @returns {void}
 */
function placeAt(top) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + 5000,
    left: 0,
    right: 390,
    width: 390,
    height: 5000,
    x: 0,
    y: top,
  })
}

describe('scroll-triggered entrances on content taller than the screen', () => {
  it('count any intersection as in view, rather than a share of the element', () => {
    expect(VIEWPORT).toMatchObject({ once: true, amount: 'some' })
  })

  it('hold back a Reveal below the fold, then show it once any of it is on screen', () => {
    placeAt(window.innerHeight + 400)
    render(
      <Reveal as="section" data-testid="list">
        A long list of events
      </Reveal>,
    )

    const list = screen.getByTestId('list')

    expect(list).toHaveAttribute('data-reveal', 'pending')
    // A threshold of 0, so a 5,000px list reaching 14% of itself still counts.
    expect(observers.at(-1).threshold).toBe(0)

    observers.at(-1).scrollIntoView()

    expect(list).toHaveAttribute('data-reveal', 'shown')
    expect(observers.at(-1).disconnected).toBe(true)
  })

  it('show a Stagger group as long as the organiser directory can be', () => {
    placeAt(window.innerHeight + 10)
    const organisers = Array.from({ length: 40 }, (_, index) => `Organiser ${index + 1}`)

    render(
      <Stagger as="ul" aria-label="Organisers">
        {organisers.map((name) => (
          <StaggerItem as="li" key={name}>
            {name}
          </StaggerItem>
        ))}
      </Stagger>,
    )

    const list = screen.getByRole('list', { name: 'Organisers' })

    expect(list).toHaveAttribute('data-reveal', 'pending')
    observers.at(-1).scrollIntoView()
    expect(list).toHaveAttribute('data-reveal', 'shown')
  })
})

describe('what a reveal never hides', () => {
  it('content already on screen, or above it', () => {
    for (const top of [0, 200, -3000]) {
      placeAt(top)
      const { unmount } = render(<Reveal data-testid="seen">Seen</Reveal>)

      expect(screen.getByTestId('seen')).not.toHaveAttribute('data-reveal')
      unmount()
    }
  })

  it('anything, for a reader who asked for reduced motion', () => {
    reduce = true
    placeAt(window.innerHeight + 400)
    render(<Reveal data-testid="still">Still</Reveal>)

    expect(screen.getByTestId('still')).not.toHaveAttribute('data-reveal')
    expect(observers).toHaveLength(0)
  })

  it('anything, where there is no IntersectionObserver to show it again', () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    placeAt(window.innerHeight + 400)
    render(<Reveal data-testid="plain">Plain</Reveal>)

    expect(screen.getByTestId('plain')).not.toHaveAttribute('data-reveal')
    vi.stubGlobal('IntersectionObserver', TallListObserver)
  })

  it('an element torn down before it was shown, whose node survives', () => {
    placeAt(window.innerHeight + 400)
    const { unmount } = render(<Reveal data-testid="gone">Gone</Reveal>)
    const node = screen.getByTestId('gone')

    unmount()

    expect(node).toHaveAttribute('data-reveal', 'shown')
  })
})

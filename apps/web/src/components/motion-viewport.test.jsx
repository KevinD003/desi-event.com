import { afterAll, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

/*
 * Its own file on purpose. Framer Motion builds one IntersectionObserver per
 * threshold and keeps it for the life of the module, so an observer stub only
 * takes effect if it is installed before the first scroll-triggered entrance
 * renders. Vitest gives each file fresh modules; sharing `motion.test.jsx`
 * would hand these tests the setup file's always-visible stub instead.
 */

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion')

  return { ...actual, useReducedMotion: () => false }
})

/** How much of a very tall list a phone can show at once: 700px of 5,000. */
const TALL_RATIO = 700 / 5000

/**
 * An IntersectionObserver that behaves as a browser would for a list far
 * taller than the viewport, scrolled so that it fills the screen: the
 * visible share never rises above {@link TALL_RATIO}, so a threshold above
 * that is never crossed.
 */
class TallListObserver {
  /**
   * @param {Function} callback Invoked with the observed entries.
   * @param {object} [options] The observer's options.
   */
  constructor(callback, options = {}) {
    this.callback = callback
    this.threshold = options.threshold ?? 0
  }

  /**
   * Report the element's intersection as its threshold would see it.
   *
   * @param {Element} target The observed element.
   * @returns {void}
   */
  observe(target) {
    const isIntersecting = this.threshold === 0 ? TALL_RATIO > 0 : TALL_RATIO >= this.threshold

    this.callback([{ target, isIntersecting, intersectionRatio: TALL_RATIO }], this)
  }

  /** @returns {void} */
  unobserve() {}

  /** @returns {void} */
  disconnect() {}

  /** @returns {object[]} Nothing pending; the stub reports synchronously. */
  takeRecords() {
    return []
  }
}

vi.stubGlobal('IntersectionObserver', TallListObserver)

const { Reveal, Stagger, StaggerItem, VIEWPORT } = await import('./motion.jsx')

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('scroll-triggered entrances on content taller than the screen', () => {
  it('count any intersection as in view, rather than a share of the element', () => {
    expect(VIEWPORT).toMatchObject({ once: true, amount: 'some' })
  })

  it('start a Reveal whose content can never be a sixth on screen', () => {
    const entered = vi.fn()

    render(
      <Reveal as="section" onViewportEnter={entered}>
        A long list of events
      </Reveal>,
    )

    expect(entered).toHaveBeenCalledTimes(1)
  })

  it('start a Stagger group as long as the organiser directory can be', () => {
    const entered = vi.fn()
    const organisers = Array.from({ length: 40 }, (_, index) => `Organiser ${index + 1}`)

    render(
      <Stagger as="ul" onViewportEnter={entered}>
        {organisers.map((name) => (
          <StaggerItem as="li" key={name}>
            {name}
          </StaggerItem>
        ))}
      </Stagger>,
    )

    expect(entered).toHaveBeenCalledTimes(1)
  })
})

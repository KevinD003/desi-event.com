/**
 * Test environment setup for @desi-event/web.
 *
 * Registers the jest-dom matchers and unmounts rendered trees between tests.
 * Testing Library only installs its automatic cleanup when a global `afterEach`
 * exists, and the shared preset runs Vitest with `globals: false`, so the hook
 * is registered by hand.
 *
 * It also stubs `IntersectionObserver`, which jsdom does not implement and
 * Framer Motion needs for `whileInView`. The stub reports every observed
 * element as already on screen, so scroll-triggered entrances render in their
 * final state under test — which is what an assertion about page content should
 * be looking at.
 */

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class ImmediateIntersectionObserver {
    /**
     * @param {Function} callback Invoked with the observed entries.
     */
    constructor(callback) {
      this.callback = callback
      this.root = null
      this.rootMargin = ''
      this.thresholds = [0]
    }

    /**
     * Report the element as fully in view straight away.
     *
     * @param {Element} target The observed element.
     * @returns {void}
     */
    observe(target) {
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this)
    }

    /** @returns {void} */
    unobserve() {}

    /** @returns {void} */
    disconnect() {}

    /** @returns {object[]} Never any pending records; the stub reports synchronously. */
    takeRecords() {
      return []
    }
  }

  globalThis.IntersectionObserver = ImmediateIntersectionObserver
}

afterEach(() => {
  cleanup()
})

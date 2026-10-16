'use client'

/**
 * Keeps the page's colour register in step with the route, across soft
 * navigations.
 *
 * The root layout sets `data-register` on `<body>` from the request path, so
 * the first paint of every page is in the right register. But a root layout
 * is rendered once per hard load: a `<Link>` from the home page to the ticket
 * wallet, or from the account back to the home page, swaps the page under it
 * and leaves `<body>` as it was — the wallet drawn in the poster's colours,
 * or the home page in the courtyard's. This component renders nothing; it
 * watches the client's path and moves the attribute itself whenever the
 * register the path calls for differs from the one on `<body>`.
 *
 * A layout effect rather than an effect, so the attribute changes in the same
 * commit as the new page, before the browser paints it in the old colours.
 *
 * @module components/register-sync
 */

import { useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'

import { registerFor } from '../lib/register.js'

/**
 * Apply the register a path calls for to an element.
 *
 * Exported for the test, and so the rule lives in one place: courtyard sets
 * the attribute, editorial removes it (the poster register is the theme's
 * default and needs none).
 *
 * @param {HTMLElement} element Usually `document.body`.
 * @param {string|null} pathname The current path.
 * @returns {void}
 */
export function applyRegister(element, pathname) {
  if (registerFor(pathname) === 'courtyard') {
    if (element.dataset.register !== 'courtyard') element.dataset.register = 'courtyard'
  } else if ('register' in element.dataset) {
    delete element.dataset.register
  }
}

/**
 * The register keeper. Render it once, inside `<body>`.
 *
 * @returns {null} Nothing.
 */
export function RegisterSync() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    applyRegister(document.body, pathname)
  }, [pathname])

  return null
}

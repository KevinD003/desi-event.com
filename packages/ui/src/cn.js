/**
 * Class name composition for the component library.
 *
 * Every component funnels its own Tailwind utilities and the caller's
 * `className` through {@link cn}, so consumers can always extend or override
 * the styling of a primitive without forking it.
 *
 * @module @desi-event/ui/cn
 */

import clsx from 'clsx'

/**
 * Merge class name values into a single `className` string.
 *
 * Accepts anything clsx accepts: strings, arrays, and objects whose keys are
 * emitted when their value is truthy. Falsy values are dropped.
 *
 * @param {...(string|number|boolean|null|undefined|object|Array)} classes Class name values to merge.
 * @returns {string} The merged class name string, empty when nothing is truthy.
 */
export function cn(...classes) {
  return clsx(...classes)
}

export default cn

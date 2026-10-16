/**
 * Class name composition for the component library.
 *
 * Every component funnels its own Tailwind utilities and the caller's
 * `className` through {@link cn}, so consumers can extend or override the
 * styling of a primitive without forking it.
 *
 * ## Caller classes win, for real
 *
 * `cn` used to be plain `clsx`: it joined the strings and left a conflict
 * (`min-h-9` from the primitive, `min-h-11` from the caller) to whichever
 * rule the stylesheet happened to emit last. It now runs the result through
 * `tailwind-merge`, so of two utilities that set the same property, the later
 * one — the caller's — is the only one left.
 *
 * tailwind-merge has to be told this theme's own scales, or it guesses. Left
 * alone it reads `text-h2` as a colour, because `h2` is not one of
 * Tailwind's sizes, and `cn('text-h2', 'text-ink')` would drop the size. The
 * configuration below names every type step, radius, shadow, easing and
 * tracking the theme declares (`packages/config/src/tailwind.css`), and a
 * test holds the two lists equal.
 *
 * @module @desi-event/ui/cn
 */

import clsx from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The theme's own scales, as tailwind-merge's theme keys take them.
 *
 * Exported so the test can compare it with the stylesheet.
 */
export const THEME_SCALES = Object.freeze({
  text: ['display', 'h1', 'h2', 'h3', 'title', 'body', 'label', 'caption', 'micro'],
  radius: ['plate', 'card', 'control'],
  shadow: ['card', 'card-hover', 'control', 'floating', 'dialog'],
  ease: ['standard', 'out', 'in-out', 'drawer'],
  tracking: ['display', 'heading', 'caps', 'eyebrow'],
})

const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...THEME_SCALES.text],
      radius: [...THEME_SCALES.radius],
      shadow: [...THEME_SCALES.shadow],
      ease: [...THEME_SCALES.ease],
      tracking: [...THEME_SCALES.tracking],
    },
  },
})

/**
 * Merge class name values into a single `className` string.
 *
 * Accepts anything clsx accepts: strings, arrays, and objects whose keys are
 * emitted when their value is truthy. Falsy values are dropped. Of two
 * utilities that set the same property under the same variants, only the
 * later is kept.
 *
 * @param {...(string|number|boolean|null|undefined|object|Array)} classes Class name values to merge.
 * @returns {string} The merged class name string, empty when nothing is truthy.
 */
export function cn(...classes) {
  return merge(clsx(...classes))
}

export default cn

/**
 * The site's ornament: one 2px brand rule in magenta.
 *
 * This module used to hold six: a toran of bunting with seventeen twinkling
 * bulbs, garba rings, a scalloped hem, a mirror-work band, a mirror divider
 * and a diamond. They were stacked on every page (the band under the header
 * and over the footer, the toran and the hem on every hero, diamonds before
 * every eyebrow and between sections), which flattened the brand into
 * wallpaper and tied a site that lists comedy, concerts, Durga Puja and
 * theatre to one festival's decoration.
 *
 * Poster House+ spends its decoration once per page, on a plate (the hero's
 * purple or magenta field, the footer's purple), and lets type do the rest.
 * What is left here is the rule that runs along the foot of the header on
 * every public page: the one line that says whose site this is.
 *
 * Decoration, so hidden from assistive technology, holding no words, never
 * focusable, and drawn in the theme's tokens only.
 *
 * @module components/festive-decor
 */

/**
 * @typedef {object} BrandRuleProps
 * @property {string} [className] Classes for its place in a layout.
 */

/**
 * The brand rule: a 2px line in the accent magenta, the full width of its
 * container.
 *
 * @param {BrandRuleProps} props Component props.
 * @returns {JSX.Element} The rule.
 */
export function BrandRule({ className = '' }) {
  return (
    <span
      aria-hidden="true"
      data-brand-rule=""
      className={`block h-0.5 w-full bg-accent ${className}`.trim()}
    />
  )
}

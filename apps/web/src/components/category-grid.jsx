/**
 * The category browsing grid on the home page.
 *
 * Only categories that actually have events are offered. A browsing tile that
 * leads to an empty listing teaches the visitor that the filters do not work.
 *
 * @module components/category-grid
 */

import Link from 'next/link'

import { buildEventsHref } from '../lib/search-params.js'
import { RevealOnScroll } from './motion.jsx'

/**
 * @typedef {object} CategoryGridProps
 * @property {Array<{value: string, label: string, blurb: string, glyph: string, count: number}>} categories Category descriptors with event counts.
 */

/**
 * A grid of category tiles linking into the filtered listing.
 *
 * @param {CategoryGridProps} props Component props.
 * @returns {JSX.Element} The rendered grid.
 */
export function CategoryGrid({ categories }) {
  return (
    <ul
      aria-label="Browse by category"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {categories.map((category, index) => (
        <RevealOnScroll as="li" key={category.value} index={index}>
          <Link
            href={buildEventsHref({ category: category.value })}
            className="group flex h-full items-start gap-4 rounded-card border border-line bg-surface-raised p-5 transition-colors hover:border-accent-line hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-xl text-accent-strong"
            >
              {category.glyph}
            </span>
            <span className="flex flex-col gap-1">
              <span className="font-display text-base font-semibold text-ink group-hover:text-accent-strong">
                {category.label}
              </span>
              <span className="text-sm text-ink-muted">{category.blurb}</span>
              <span className="text-xs font-medium text-ink-muted">
                {category.count} {category.count === 1 ? 'event' : 'events'}
              </span>
            </span>
          </Link>
        </RevealOnScroll>
      ))}
    </ul>
  )
}

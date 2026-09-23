/**
 * The category strip on the home page.
 *
 * Only categories that actually have events are offered. A browsing tile that
 * leads to an empty listing teaches the visitor that the filters do not work.
 * The number on each is the facet count — how many listed events the tile's
 * link opens onto — and the tiles keep the catalogue's editorial order rather
 * than being sorted by that number, which would start claiming what is
 * popular.
 *
 * @module components/category-grid
 */

import Link from 'next/link'

import { categoryCountLabel } from '../lib/directory.js'
import { buildEventsHref } from '../lib/search-params.js'
import { ArrowRightIcon, CategoryIcon } from './icons.jsx'
import { HoverLift, Stagger, StaggerItem } from './motion.jsx'

/**
 * @typedef {object} CategoryGridProps
 * @property {Array<{value: string, label: string, blurb: string, count?: number}>} categories Category descriptors, with their event counts when known.
 */

/**
 * A row of category tiles linking into the filtered listing. They arrive one
 * after another as the row scrolls into view, and each lifts on hover.
 *
 * @param {CategoryGridProps} props Component props.
 * @returns {JSX.Element} The rendered grid.
 */
export function CategoryGrid({ categories }) {
  return (
    <Stagger
      as="ul"
      aria-label="Browse by category"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4"
    >
      {categories.map((category) => {
        const count = Number.isInteger(category.count) ? categoryCountLabel(category.count) : null

        return (
          <StaggerItem as="li" key={category.value} className="flex">
            <HoverLift className="group flex w-full">
              <Link
                href={buildEventsHref({ category: category.value })}
                className="relative flex w-full flex-col rounded-card bg-surface-raised p-6 shadow-card transition-shadow duration-(--duration-base) ease-standard group-data-lifted:shadow-card-hover hover:shadow-card-hover"
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-control bg-accent-soft text-accent-strong"
                >
                  <CategoryIcon category={category.value} className="h-6 w-6" />
                </span>
                <h3 className="mt-5 text-h3 font-semibold text-ink transition-colors duration-(--duration-fast) group-hover:text-accent-strong">
                  {category.label}
                </h3>
                <p className="mt-1.5 text-sm text-ink-muted">{category.blurb}</p>
                <p className="mt-auto flex items-center justify-between gap-3 pt-5 text-sm font-bold text-accent-strong">
                  <span>{count ?? 'See the listing'}</span>
                  <ArrowRightIcon className="h-4.5 w-4.5 transition-transform duration-(--duration-base) ease-standard motion-safe:group-hover:translate-x-1" />
                </p>
              </Link>
            </HoverLift>
          </StaggerItem>
        )
      })}
    </Stagger>
  )
}

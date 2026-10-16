'use client'

/**
 * The navigation lists the signed-in shells share beside the workspace rail:
 * the account's own pages and an area's tabs.
 *
 * Client components for one reason: which entry is current. A layout is not
 * re-rendered when somebody moves between two pages beneath it, so a server
 * rendering of `aria-current` would still name the first page after a click
 * took them to the second. `usePathname` and `useSearchParams` follow the
 * navigation; the entries themselves are decided on the server and passed in.
 *
 * @module components/shell-nav
 */

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Icon } from '@desi-event/ui/icons'

import { currentHref } from '../lib/active-path.js'
import { navIcon } from '../lib/nav-icons.js'

/**
 * @typedef {object} ShellItem
 * @property {string} href Where it goes.
 * @property {string} label What it says.
 */

/**
 * The href of the current entry, following client navigation.
 *
 * @param {ShellItem[]} items Every entry the list shows.
 * @returns {string|null} The current entry's href.
 */
function useCurrent(items) {
  const pathname = usePathname()
  const search = useSearchParams()

  return currentHref(items, pathname, search)
}

/**
 * The account's own pages: a rail beside the page on a desk, a row of
 * segments across the top on a phone.
 *
 * One list, laid out two ways by CSS, so there is no disclosure to open
 * before the attendee can see where they can go: on a phone the six entries
 * sit in one row that scrolls sideways inside itself (never the page), with
 * the current one filled.
 *
 * @param {object} props Component props.
 * @param {string} props.label The navigation's accessible name.
 * @param {ShellItem[]} props.items The entries.
 * @param {JSX.Element} [props.header] Drawn above the list on a desk (who is signed in).
 * @param {JSX.Element} [props.footer] Drawn below the list on a desk (sign out).
 * @returns {JSX.Element} The navigation.
 */
export function AccountNav({ label, items, header = null, footer = null }) {
  const current = useCurrent(items)

  return (
    <div className="-mx-4 border-b border-line sm:-mx-6 lg:sticky lg:top-(--chrome-top) lg:mx-0 lg:self-start lg:border-b-0 lg:pt-1">
      {header}
      <nav aria-label={label} className="overflow-x-auto overscroll-x-contain px-4 sm:px-6 lg:px-0">
        <ul className="flex min-w-max gap-1 py-2 lg:min-w-0 lg:flex-col lg:gap-0.5 lg:py-0">
          {items.map((item) => {
            const active = item.href === current

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex min-h-11 items-center gap-2.5 rounded-full px-4 text-label whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus lg:rounded-control lg:px-3 lg:whitespace-normal lg:pointer-fine:min-h-10 ${
                    active
                      ? 'bg-action-primary font-semibold text-action-primary-ink lg:bg-opsnav-active lg:text-opsnav-active-ink'
                      : 'font-medium text-opsnav-ink hover:bg-opsnav-hover hover:text-ink'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute inset-y-2 left-0 hidden w-0.75 rounded-full lg:block ${
                      active ? 'bg-opsnav-marker' : 'bg-transparent'
                    }`}
                  />
                  <Icon name={navIcon(item.href)} className="hidden h-5 w-5 lg:block" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
      {footer}
    </div>
  )
}

/**
 * An area's own sections, as a row of tabs.
 *
 * Only for sections the rail does not already list: an area whose every
 * section is a rail entry draws none, because the same links in two places
 * is a second navigation, not a help. Links, not ARIA tabs: each section is
 * its own page with its own URL, and a `tablist` would promise arrow-key
 * behaviour a list of pages should not have. Scrolls sideways inside itself
 * on a narrow screen rather than widening the page.
 *
 * @param {object} props Component props.
 * @param {string} props.label The navigation's accessible name, the area's name.
 * @param {ShellItem[]} props.items The sections.
 * @returns {JSX.Element|null} The tabs, or nothing for an area with one section.
 */
export function AreaTabs({ label, items }) {
  const current = useCurrent(items)

  if (items.length < 2) return null

  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.href === current

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-label transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus ${
                  active
                    ? 'border-accent font-semibold text-ink'
                    : 'border-transparent font-medium text-ink-muted hover:border-line-strong hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

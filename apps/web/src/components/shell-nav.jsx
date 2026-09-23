'use client'

/**
 * The navigation lists every signed-in shell shares: the workspace rail, the
 * account rail and an area's tabs.
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
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { currentHref } from '../lib/active-path.js'

/**
 * @typedef {object} ShellItem
 * @property {string} href Where it goes.
 * @property {string} label What it says.
 */

/**
 * @typedef {object} ShellGroup
 * @property {string} id A stable key.
 * @property {string} label The heading.
 * @property {ShellItem[]} items The entries.
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
 * One rail entry.
 *
 * The current entry is marked three ways: `aria-current`, a tinted ground and
 * a marker bar. Colour is never the only carrier.
 *
 * @param {object} props Component props.
 * @param {ShellItem} props.item The entry.
 * @param {boolean} props.current Whether it is the current page.
 * @param {Function} [props.onNavigate] Called when it is followed.
 * @returns {JSX.Element} The entry.
 */
function RailLink({ item, current, onNavigate }) {
  return (
    <Link
      href={item.href}
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate}
      className={`flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:min-h-10 ${
        current
          ? 'bg-opsnav-active text-opsnav-active-ink'
          : 'text-opsnav-ink hover:bg-opsnav-hover hover:text-ink'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-5 w-1 shrink-0 rounded-full ${current ? 'bg-opsnav-marker' : 'bg-transparent'}`}
      />
      <span className="min-w-0 break-words">{item.label}</span>
    </Link>
  )
}

/**
 * A rail: grouped entries, a sidebar on wide screens and a disclosure on
 * narrow ones.
 *
 * Below the `lg` breakpoint the rail would push the page's own content a
 * screen down, so it folds behind one button. The disclosure keeps the same
 * contract as the header's menu: the trigger says whether it is open, Escape
 * closes it and focus goes back to the trigger.
 *
 * @param {object} props Component props.
 * @param {string} props.label The navigation's accessible name.
 * @param {string} props.toggleLabel What the narrow-screen button says.
 * @param {ShellGroup[]} props.groups The grouped entries.
 * @param {JSX.Element} [props.header] Drawn above the groups (who is signed in).
 * @param {JSX.Element} [props.footer] Drawn below the groups (sign out).
 * @returns {JSX.Element} The rail.
 */
export function ShellRail({ label, toggleLabel, groups, header = null, footer = null }) {
  const items = groups.flatMap((group) => group.items)
  const current = useCurrent(items)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelId = useId()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined

    /**
     * Close on Escape.
     *
     * @param {KeyboardEvent} event The key event.
     * @returns {void}
     */
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  return (
    <div className="mb-6 lg:mb-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-opsnav-line bg-opsnav px-3 text-sm font-semibold text-ink transition-colors duration-(--duration-fast) hover:bg-opsnav-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
      >
        {toggleLabel}
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          <path
            d={
              open
                ? 'M5.3 12.7a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1-1.4 1.4L10 9.4l-3.3 3.3a1 1 0 0 1-1.4 0Z'
                : 'M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z'
            }
          />
        </svg>
      </button>

      <div
        id={panelId}
        className={`${open ? 'mt-2 block' : 'hidden'} rounded-card border border-opsnav-line bg-opsnav p-3 lg:sticky lg:top-24 lg:mt-0 lg:block`}
      >
        {header}
        <nav aria-label={label} className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.id}>
              {/* A label, not a heading: the rail sits before the page's own
                  h1, and headings here would put navigation at the top of a
                  screen reader's list of the page's sections. */}
              <p
                id={`${panelId}-${group.id}`}
                className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase"
              >
                {group.label}
              </p>
              <ul aria-labelledby={`${panelId}-${group.id}`} className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <RailLink
                      item={item}
                      current={item.href === current}
                      onNavigate={open ? () => setOpen(false) : undefined}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        {footer}
      </div>
    </div>
  )
}

/**
 * An area's own sections, as a row of tabs.
 *
 * Links, not ARIA tabs: each section is its own page with its own URL, and a
 * `tablist` would promise arrow-key behaviour a list of pages should not have.
 * Scrolls sideways inside itself on a narrow screen rather than widening the
 * page.
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
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  active
                    ? 'border-accent text-accent-strong'
                    : 'border-transparent text-ink-muted hover:border-line-strong hover:text-ink'
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

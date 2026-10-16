'use client'

/**
 * The primary navigation: a row on a wide viewport, a disclosure on a narrow one.
 *
 * ## Why this is a client component when the rest of the shell is not
 *
 * The groups are computed on the server from `GET /v1/auth/me` and handed down
 * as data. Nothing about *what* is offered is decided here. What needs the
 * client is only the disclosure: the open/closed state of the narrow-viewport
 * sheet, the Escape key, and returning focus to the button that opened it.
 *
 * Doing it this way keeps the capability read on the server, where the session
 * cookie is, and keeps the interactive surface small enough to reason about.
 *
 * ## The focus contract
 *
 * A disclosure that opens and leaves focus behind is a disclosure a keyboard
 * user cannot reach, and one that closes without restoring focus drops them at
 * the top of the document. So: opening moves focus into the sheet, Escape
 * closes it, and closing puts focus back on the trigger — whether it closed by
 * Escape, by choosing a link, or by the viewport growing out from under it.
 *
 * ## Why the account control passes through here
 *
 * On a narrow viewport the header reads wordmark, account control, Menu, and
 * then the open sheet on a row of its own. Tab order has to read the same way
 * (WCAG 2.4.3), and CSS `order` moves boxes without moving focus: with the
 * account control after this component in the DOM, focus went from the
 * wordmark to Menu, through the sheet, and then back up the row to "Sign in".
 * So the header hands its account control in as `account`, and it is rendered
 * between the wide row and the Menu button — the one place that is in visual
 * order at every width, with no `order-*` anywhere.
 *
 * @module components/primary-nav
 */

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { cn } from '@desi-event/ui/classes'
import { Icon } from '@desi-event/ui/icons'

import { currentHref } from '../lib/active-path.js'

/**
 * @typedef {object} PrimaryNavProps
 * @property {Array<{id: string, label: string, items: Array<{href: string, label: string, description?: string}>}>} groups The groups to render, already filtered on the server.
 * @property {ReactNode} [account] The header's account control, placed after the wide row and before the Menu button so the DOM follows the visual order.
 */

/**
 * One navigation link.
 *
 * `aria-current="page"` rather than a class alone: the underline says "here" to
 * somebody looking at it and nothing at all to somebody listening to it.
 *
 * @param {object} props Component props.
 * @param {string} props.href Destination.
 * @param {string} props.label Link text.
 * @param {string|null} props.current The href of the current entry in this list, if any.
 * @param {string} [props.className] Extra classes.
 * @param {Function} [props.onNavigate] Called when the link is chosen.
 * @returns {JSX.Element} The link.
 */
function NavLink({ href, label, current, className = '', onNavigate }) {
  const active = href === current

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'inline-flex min-h-11 items-center rounded-control px-3 font-semibold underline-offset-[0.45em] transition-colors duration-(--duration-fast) ease-standard',
        active
          ? 'text-accent-strong underline decoration-accent decoration-2'
          : 'text-ink hover:text-accent-strong',
        className,
      )}
    >
      {label}
    </Link>
  )
}

/**
 * The primary navigation.
 *
 * @param {PrimaryNavProps} props Component props.
 * @returns {JSX.Element} The rendered navigation.
 */
export function PrimaryNav({ groups, account = null }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const sheetRef = useRef(null)
  const sheetId = useId()

  /** Close the sheet and put focus back where it came from. */
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return undefined

    sheetRef.current?.focus()

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

  // A viewport that grows past the breakpoint hides the sheet by CSS. Without
  // this the disclosure would still be "open" and the trigger would be lying
  // about its state to a screen reader.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined

    const query = window.matchMedia('(min-width: 1024px)')

    /**
     * Collapse the sheet once the wide layout takes over.
     *
     * @returns {void}
     */
    function onChange() {
      if (query.matches) setOpen(false)
    }

    query.addEventListener('change', onChange)

    return () => query.removeEventListener('change', onChange)
  }, [])

  // The wide row is discovery only; the account and the workspace have their
  // own controls beside it. The narrow sheet carries every group.
  const discover = groups.find((group) => group.id === 'discover')?.items ?? []
  const everything = groups.flatMap((group) => group.items)
  const currentWide = currentHref(discover, pathname, search)
  const currentSheet = currentHref(everything, pathname, search)

  return (
    <>
      {/* Wide viewports: one row, no disclosure, no JavaScript needed to use it. */}
      <nav aria-label="Primary" className="hidden lg:block">
        <ul className="flex flex-wrap items-center gap-0.5 text-label lg:gap-1">
          {discover.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} label={item.label} current={currentWide} />
            </li>
          ))}
        </ul>
      </nav>

      {account}

      {/* Narrow viewports: a disclosure, because eleven entries do not fit 320px. */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-2.5 text-sm font-bold text-ink transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-subtle lg:hidden"
      >
        <Icon name={open ? 'close' : 'menu'} className="h-5 w-5" />
        {/* Named "Menu" at every width; on the narrowest phones the word is
            read rather than drawn, so the button fits beside the brand. */}
        <span className="max-[359px]:sr-only">Menu</span>
      </button>

      {open ? (
        <div
          id={sheetId}
          ref={sheetRef}
          tabIndex={-1}
          className="-mx-4 w-[calc(100%+2rem)] border-t border-line bg-surface px-4 pt-4 pb-6 transition-[opacity,translate] duration-(--duration-sheet) ease-drawer starting:-translate-y-2 starting:opacity-0 focus-visible:outline-none sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 lg:hidden"
        >
          <nav aria-label="Primary" className="flex flex-col gap-6">
            {groups.map((group) => (
              <div key={group.id}>
                <h2
                  id={`${sheetId}-${group.id}`}
                  className="pb-1 font-sans text-caption font-semibold text-ink-subtle"
                >
                  {group.label}
                </h2>
                <ul aria-labelledby={`${sheetId}-${group.id}`} className="flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        label={item.label}
                        current={currentSheet}
                        onNavigate={close}
                        className={`min-h-11 w-full px-0 ${
                          group.id === 'discover'
                            ? 'font-display text-h3 font-bold [font-stretch:86%]'
                            : 'text-body'
                        }`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      ) : null}
    </>
  )
}

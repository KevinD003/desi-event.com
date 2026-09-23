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
      className={`inline-flex min-h-11 items-center rounded-control px-3.5 font-semibold transition-colors duration-(--duration-fast) ease-standard lg:px-4 ${
        active
          ? 'bg-accent-soft text-accent-strong'
          : 'text-ink hover:bg-surface-subtle hover:text-accent-strong'
      } ${className}`}
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

    const query = window.matchMedia('(min-width: 768px)')

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
      <nav aria-label="Primary" className="hidden md:block">
        <ul className="flex flex-wrap items-center gap-1 text-[0.9375rem]">
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
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control px-2.5 text-sm font-bold text-ink transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-subtle md:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
          {open ? (
            <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4Z" />
          ) : (
            <path d="M3 5.5A1 1 0 0 1 4 4.5h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm0 4.5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm1 3.5a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H4Z" />
          )}
        </svg>
        {/* Named "Menu" at every width; on the narrowest phones the word is
            read rather than drawn, so the button fits beside the brand. */}
        <span className="max-[359px]:sr-only">Menu</span>
      </button>

      {open ? (
        <div
          id={sheetId}
          ref={sheetRef}
          tabIndex={-1}
          className="w-full rounded-card border border-line bg-surface-raised p-3 shadow-card focus-visible:outline-none md:hidden"
        >
          <nav aria-label="Primary" className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.id}>
                <h2
                  id={`${sheetId}-${group.id}`}
                  className="px-3.5 pb-1 font-sans text-micro font-bold tracking-eyebrow text-ink-subtle uppercase"
                >
                  {group.label}
                </h2>
                <ul aria-labelledby={`${sheetId}-${group.id}`} className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        label={item.label}
                        current={currentSheet}
                        onNavigate={close}
                        className="w-full min-h-11"
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

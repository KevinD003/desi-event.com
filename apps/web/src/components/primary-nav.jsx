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
 * @module components/primary-nav
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { isActivePath } from '../lib/active-path.js'

/**
 * @typedef {object} PrimaryNavProps
 * @property {Array<{id: string, label: string, items: Array<{href: string, label: string, description?: string}>}>} groups The groups to render, already filtered on the server.
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
 * @param {string|null} props.pathname The current path.
 * @param {string} [props.className] Extra classes.
 * @param {Function} [props.onNavigate] Called when the link is chosen.
 * @returns {JSX.Element} The link.
 */
function NavLink({ href, label, pathname, className = '', onNavigate }) {
  const active = isActivePath(href, pathname)

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`inline-flex items-center rounded-lg px-2.5 py-1.5 font-medium transition-colors duration-(--duration-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${
        active
          ? 'bg-accent-soft text-accent-strong'
          : 'text-ink-muted hover:bg-accent-soft hover:text-accent-strong'
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
export function PrimaryNav({ groups }) {
  const pathname = usePathname()
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

  const flat = groups.flatMap((group) => group.items)

  return (
    <>
      {/* Wide viewports: one row, no disclosure, no JavaScript needed to use it. */}
      <nav aria-label="Primary" className="hidden md:block">
        <ul className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm">
          {flat.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} label={item.label} pathname={pathname} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Narrow viewports: a disclosure, because eleven entries do not fit 320px. */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={sheetId}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:bg-canvas-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 md:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
          {open ? (
            <path d="M5.3 4.3a1 1 0 0 1 1.4 0L10 7.6l3.3-3.3a1 1 0 1 1 1.4 1.4L11.4 9l3.3 3.3a1 1 0 0 1-1.4 1.4L10 10.4l-3.3 3.3a1 1 0 0 1-1.4-1.4L8.6 9 5.3 5.7a1 1 0 0 1 0-1.4Z" />
          ) : (
            <path d="M3 5.5A1 1 0 0 1 4 4.5h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm0 4.5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm1 3.5a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H4Z" />
          )}
        </svg>
        Menu
      </button>

      {open ? (
        <div
          id={sheetId}
          ref={sheetRef}
          tabIndex={-1}
          className="w-full border-t border-line pt-3 pb-1 focus-visible:outline-none md:hidden"
        >
          <nav aria-label="Primary" className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.id}>
                <h2
                  id={`${sheetId}-${group.id}`}
                  className="px-2.5 pb-1 text-xs font-semibold tracking-wide text-ink-subtle uppercase"
                >
                  {group.label}
                </h2>
                <ul aria-labelledby={`${sheetId}-${group.id}`} className="flex flex-col gap-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        label={item.label}
                        pathname={pathname}
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

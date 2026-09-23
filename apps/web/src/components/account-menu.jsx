'use client'

/**
 * The header's account control: sign in, or who you are and where you can go.
 *
 * Signed out, a sign-in link that brings you back to the page you were on.
 * Before Phase 4 it carried no `next`, so everybody who signed in from the
 * header landed on the organiser's event list, whatever they had been doing.
 *
 * Signed in, a disclosure: the account's own pages, the workspace when the
 * account has one, and sign out — which did not exist anywhere in the web
 * application before. A disclosure rather than an ARIA `menu`, because these
 * are links and a menu role would promise arrow-key behaviour and swallow the
 * links' own semantics.
 *
 * It shows the display name, never the email address: both identify the
 * person to themselves, but only one of them is credential-adjacent and ends
 * up in screenshots and screen-shares.
 *
 * The trigger's accessible name is set outright, and begins with the words on
 * it, so a speech-input user can say what they see. Assembled from a visually
 * hidden prefix instead, the name depended on how each engine joins the
 * spaces between blockified flex items, and one of them read "Account:Meera".
 *
 * @module components/account-menu
 */

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { signInHref } from '../lib/next-path.js'
import { SignOutButton } from './sign-out-button.jsx'

/** The header's sign-in link. */
const SIGN_IN =
  'inline-flex min-h-11 items-center rounded-lg border border-accent-line bg-accent-soft px-3 text-sm font-semibold text-accent-strong transition-colors duration-(--duration-fast) hover:bg-accent-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/**
 * @typedef {object} SignInLinkProps
 * @property {string} [label] What it says. Defaults to "Sign in".
 * @property {string} [className] Its classes, when it is not in the header.
 */

/**
 * The sign-in link, carrying the current page as `next`.
 *
 * Read from the router rather than passed in, so a server component can place
 * it without knowing which page it is on.
 *
 * @param {SignInLinkProps} props Component props.
 * @returns {JSX.Element} The link.
 */
export function SignInLink({ label = 'Sign in', className = SIGN_IN }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const query = search?.toString()
  const href = signInHref(pathname ? `${pathname}${query ? `?${query}` : ''}` : null)

  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  )
}

/**
 * @typedef {object} AccountMenuProps
 * @property {string} displayName Who is signed in.
 * @property {Array<{href: string, label: string}>} items The account's own pages.
 * @property {string|null} workspaceHref Where the workspace begins, when there is one.
 */

/** Classes for an entry in the open menu. */
const ENTRY =
  'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/**
 * The signed-in account control.
 *
 * @param {AccountMenuProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function AccountMenu({ displayName, items, workspaceHref }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const panelRef = useRef(null)
  const panelId = useId()
  const pathname = usePathname()

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // A navigation closes the menu; it has done its job.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return undefined

    /**
     * Close on Escape, and on a click anywhere outside the control.
     *
     * @param {Event} event The event.
     * @returns {void}
     */
    function onEvent(event) {
      if (event.type === 'keydown' && event.key === 'Escape') {
        event.preventDefault()
        close()
      }

      if (
        event.type === 'pointerdown' &&
        !panelRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }

    document.addEventListener('keydown', onEvent)
    document.addEventListener('pointerdown', onEvent)

    return () => {
      document.removeEventListener('keydown', onEvent)
      document.removeEventListener('pointerdown', onEvent)
    }
  }, [open, close])

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${displayName}, account`}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex min-h-11 max-w-[9rem] items-center gap-2 rounded-lg border border-line bg-surface px-3 sm:max-w-[14rem] text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        <span className="truncate">{displayName}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4 shrink-0"
          fill="currentColor"
        >
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-card border border-line bg-surface-raised p-2 shadow-lg"
        >
          <p className="px-3 pt-1 pb-2 text-xs text-ink-subtle">
            Signed in as <span className="font-medium text-ink">{displayName}</span>
          </p>
          <nav aria-label="Account">
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} onClick={() => setOpen(false)} className={ENTRY}>
                    {item.label}
                  </Link>
                </li>
              ))}
              {workspaceHref ? (
                <li>
                  <Link href={workspaceHref} onClick={() => setOpen(false)} className={ENTRY}>
                    Workspace
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
          <div className="mt-2 border-t border-line pt-2">
            <SignOutButton className={ENTRY} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

'use client'

/**
 * The header's account control: sign in or sign up, or who you are and where
 * you can go.
 *
 * Signed out, two links that bring you back to the page you were on: "Sign
 * in", outlined, and "Sign up", filled, because somebody who has never been
 * here has no other way to find account creation from the header. Before
 * Phase 4 the sign-in link carried no `next`, so everybody who signed in from
 * the header landed on the organiser's event list, whatever they had been
 * doing.
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
import { Icon } from '@desi-event/ui/icons'

import { initialOf } from '../lib/initial.js'
import { registerHref, signInHref } from '../lib/next-path.js'
import { PersonIcon } from './icons.jsx'
import { SignOutButton } from './sign-out-button.jsx'

/**
 * What the header's two signed-out links share: a 44px target, the radius and
 * weight of the site's buttons, and a 1.5px border so the outlined one and the
 * filled one are exactly the same height side by side.
 *
 * Below 480px they are set at 13px with 8px of padding, so that the wordmark,
 * both links and Menu share one line at 320px (`site-header.jsx`, "Two links
 * on a phone"); they never wrap their words, and never drop below 44px tall.
 */
const ACCOUNT_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-control border-[1.5px] px-2 text-[0.8125rem] font-bold whitespace-nowrap transition duration-(--duration-fast) ease-standard motion-safe:active:scale-[0.98] min-[480px]:px-3.5 min-[480px]:text-sm sm:px-4.5 sm:text-[0.9375rem]'

/**
 * The header's sign-in link: outlined in ink on the white bar, with a person
 * icon beside the words on a screen wide enough for both.
 */
const SIGN_IN = `${ACCOUNT_LINK} border-ink bg-surface text-ink hover:bg-surface-subtle`

/**
 * The header's sign-up link: the filled primary action, the colours of every
 * other primary on the site (`PRIMARY_LINK_SMALL`), its border the fill's own
 * colour by being transparent over it.
 */
const SIGN_UP = `${ACCOUNT_LINK} border-transparent bg-action-primary text-action-primary-ink shadow-control hover:bg-action-primary-hover`

/**
 * The page the router says we are on, query and all.
 *
 * Read from the router rather than passed in, so a server component can place
 * the links without knowing which page it is on.
 *
 * @returns {string|null} The path, or null before the router knows it.
 */
function useCurrentPath() {
  const pathname = usePathname()
  const search = useSearchParams()
  const query = search?.toString()

  return pathname ? `${pathname}${query ? `?${query}` : ''}` : null
}

/**
 * @typedef {object} SignInLinkProps
 * @property {string} [label] What it says. Defaults to "Sign in".
 * @property {string} [className] Its classes, when it is not in the header.
 */

/**
 * The sign-in link, carrying the current page as `next`.
 *
 * @param {SignInLinkProps} props Component props.
 * @returns {JSX.Element} The link.
 */
export function SignInLink({ label = 'Sign in', className = SIGN_IN }) {
  const href = signInHref(useCurrentPath())

  return (
    <Link href={href} className={className}>
      {className === SIGN_IN ? <PersonIcon className="hidden h-4.5 w-4.5 sm:block" /> : null}
      {label}
    </Link>
  )
}

/**
 * The header's sign-up link, to account creation, carrying the current page as
 * `next` under the same rules as sign-in (`registerHref`): on the sign-in page
 * it carries the same `next` as that page's own "Create an account" link.
 *
 * Its name is its words, "Sign up", so a speech-input user can say what they
 * see; the page it opens is titled "Create an account".
 *
 * @returns {JSX.Element} The link.
 */
export function SignUpLink() {
  return (
    <Link href={registerHref(useCurrentPath())} className={SIGN_UP}>
      Sign up
    </Link>
  )
}

/**
 * @typedef {object} AccountMenuProps
 * @property {string} displayName Who is signed in.
 * @property {Array<{href: string, label: string}>} items The account's own pages.
 * @property {string|null} workspaceHref Where the workspace begins, when there is one.
 * @property {'light'|'inverse'} [tone] The ground it sits on: the white public header (the default) or the workspace's purple bar.
 */

/** The trigger's colours on each ground it is drawn on. */
const TRIGGER_TONES = Object.freeze({
  light: 'border-ink bg-surface text-ink hover:bg-surface-subtle',
  inverse: 'border-ink-inverse/40 bg-transparent text-ink-inverse hover:bg-ink-inverse/10',
})

/** Classes for an entry in the open menu. */
const ENTRY =
  'flex min-h-11 w-full items-center rounded-control px-3 text-left text-sm font-semibold text-ink transition-colors duration-(--duration-fast) hover:bg-surface-subtle hover:text-accent-strong'

/**
 * The signed-in account control.
 *
 * @param {AccountMenuProps} props Component props.
 * @returns {JSX.Element} The control.
 */
export function AccountMenu({ displayName, items, workspaceHref, tone = 'light' }) {
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
        className={`inline-flex min-h-11 max-w-[9rem] items-center gap-2 rounded-control border-[1.5px] px-2.5 text-sm font-bold transition duration-(--duration-fast) ease-standard sm:max-w-[14rem] sm:px-4 ${TRIGGER_TONES[tone] ?? TRIGGER_TONES.light}`}
      >
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent-strong"
        >
          {initialOf(displayName)}
        </span>
        {/* A phone shows the initial alone, so the logo, this and Menu (or the
            workspace's area name) share one line at 320px; the button's name
            still says who, in words. */}
        <span className="truncate max-sm:sr-only">{displayName}</span>
        <Icon
          name="chevron-down"
          className={`h-4 w-4 transition-transform duration-(--duration-base) ease-out ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-right rounded-card border border-line bg-surface-raised p-2 text-ink shadow-floating transition-[opacity,scale] duration-(--duration-base) ease-out starting:scale-95 starting:opacity-0"
        >
          <p className="px-3 pt-1.5 pb-2 text-caption text-ink-subtle">
            Signed in as <span className="font-bold text-ink">{displayName}</span>
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

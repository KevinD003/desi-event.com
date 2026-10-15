/**
 * A read the API refused, drawn as the state it is, with the way forward.
 *
 * Before Phase 4 most signed-in pages caught a failed read and printed the
 * error's message. That is the API's message, written for an API client: a
 * lapsed step-up read "Authenticate at /v1/auth/step-up and retry" and a
 * privileged account with no second factor read "Enrol one at
 * /v1/auth/mfa/totp", on pages that offered neither. Two detail pages went the
 * other way and called every 403 "Not for you", including the lapsed step-up
 * that one password and one code would have cleared.
 *
 * This reads the refusal with `describeApiRefusal` — the status, the code and
 * `Retry-After`, never the message's wording — and draws one of:
 *
 * | state               | drawn as                                          |
 * |---------------------|---------------------------------------------------|
 * | `step-up`           | the step-up, in place; the page redraws after     |
 * | `mfa-enrolment`     | a link to set up two-step sign-in                 |
 * | `auth-required`     | a link to sign in that comes back to this page    |
 * | `permission-denied` | the same words as `not-found`, so neither leaks   |
 * | `not-found`         | whether the other exists                          |
 * | `rate-limited`      | how long to wait, when the API said               |
 * | anything else       | `Failure`: absent, and not guessed                |
 *
 * It is synchronous on purpose. It sits inside pages, and an async component
 * nested in a page's tree is one React cannot draw outside a server render; the
 * sign-in link reads the current page from the router instead of the request.
 *
 * It has no heading of its own. It stands in for content inside a page that
 * already has one, and a refusal that inserted an `h2` into the middle of a
 * section would break the outline it sits in; the step-up is the exception,
 * because it is a task with its own form.
 *
 * @module components/read-refusal
 */

import Link from 'next/link'

import { describeApiRefusal } from '../lib/refusal.js'
import { SignInLink } from './account-menu.jsx'
import { Failure } from './page-state.jsx'
import { StepUpForRead } from './step-up-for-read.jsx'

/** Classes for the one link a notice offers. */
const ACTION =
  'mt-3 inline-flex min-h-11 items-center rounded-lg bg-action-primary px-4 text-sm font-medium text-action-primary-ink hover:bg-action-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2'

/** Classes for a quieter link. */
const QUIET =
  'mt-3 inline-block rounded-sm text-sm font-medium text-accent-strong underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus'

/** The box for each tone. */
const TONES = Object.freeze({
  warning: 'border-status-warning/30 bg-status-warning-soft',
  info: 'border-status-info/25 bg-status-info-soft',
  neutral: 'border-line bg-surface-subtle',
})

/** The title colour for each tone. */
const TITLES = Object.freeze({
  warning: 'text-status-warning',
  info: 'text-status-info',
  neutral: 'text-ink',
})

/**
 * @typedef {object} NoticeProps
 * @property {'warning'|'info'|'neutral'} tone How it looks.
 * @property {string} title What happened, briefly.
 * @property {string} detail What it means and what can be done.
 * @property {{href: string, label: string, quiet?: boolean}|null} [action] The way forward.
 * @property {ReactNode} [children] A way forward that is not a plain link.
 */

/**
 * A refusal that has a way forward, or at least an explanation.
 *
 * @param {NoticeProps} props Component props.
 * @returns {JSX.Element} The notice.
 */
export function RefusalNotice({ tone, title, detail, action = null, children }) {
  return (
    <div className={`mt-6 rounded-card border p-4 ${TONES[tone] ?? TONES.neutral}`}>
      <p className={`font-semibold ${TITLES[tone] ?? TITLES.neutral}`}>{title}</p>
      <p className="mt-1 max-w-prose text-sm text-ink">{detail}</p>
      {action ? (
        <Link href={action.href} className={action.quiet ? QUIET : ACTION}>
          {action.label}
        </Link>
      ) : null}
      {children}
    </div>
  )
}

/**
 * @typedef {object} ReadRefusalProps
 * @property {object} error What `callApi` threw: `{ status?, code?, message?, retryAfterSeconds? }`.
 * @property {string} what What could not be read, as a sentence subject: "This refund".
 * @property {string} action What a step-up would let the person do: "see this refund".
 * @property {string} [backHref] Where to go instead, for a refusal with no way forward.
 * @property {string} [backLabel] What to call that link.
 */

/**
 * The refused read.
 *
 * @param {ReadRefusalProps} props Component props.
 * @returns {JSX.Element} The state.
 */
export function ReadRefusal({ error, what, action, backHref, backLabel }) {
  const refusal = describeApiRefusal(error)
  const back = backHref ? { href: backHref, label: backLabel ?? 'Go back', quiet: true } : null

  switch (refusal.state) {
    case 'step-up':
      return <StepUpForRead action={action} />

    case 'mfa-enrolment':
      return (
        <RefusalNotice
          tone="warning"
          title={refusal.title}
          detail={refusal.detail}
          action={{ href: '/account/security', label: 'Set up two-step sign-in' }}
        />
      )

    case 'auth-required':
      return (
        <RefusalNotice tone="info" title={refusal.title} detail={refusal.detail}>
          <SignInLink label="Sign in again" className={ACTION} />
        </RefusalNotice>
      )

    case 'permission-denied':
    case 'not-found':
      // One sentence for both: which of the two it was is exactly what a
      // refusal must not say.
      return (
        <RefusalNotice
          tone="neutral"
          title="Not for this account"
          detail={`${what} is not something this account can open. If you think it should be, ask whoever runs the organisation — nothing on this page can grant it.`}
          action={back}
        />
      )

    case 'rate-limited':
      return <RefusalNotice tone="warning" title={refusal.title} detail={refusal.detail} />

    default:
      return <Failure what={what} detail={refusal.detail} />
  }
}

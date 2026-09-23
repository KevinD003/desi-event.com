/**
 * The five states every authenticated screen has to be able to be in.
 *
 * Loading, empty, failed, forbidden, and stale. Written once here because the
 * four surfaces added for gate 13 each need all five, and five states copied
 * four times is twenty chances to phrase a refusal in a way that leaks what it
 * is refusing.
 *
 * ## What a refusal is allowed to say
 *
 * Not whether the thing exists. {@link Forbidden} says the same words whether
 * the caller asked for another organisation's refund or for an identifier
 * nobody has ever used, because a refusal that distinguishes the two is an
 * enumeration oracle — ask for a thousand identifiers, keep the ones that come
 * back "not yours".
 *
 * ## Breadcrumbs
 *
 * A real `nav` with an ordered list, because the reading order *is* the
 * hierarchy and a screen reader announces it as one. The current page is the
 * last item and is not a link: linking a page to itself is a keyboard stop that
 * goes nowhere.
 *
 * @module components/page-state
 */

import Link from 'next/link'

/**
 * @typedef {object} BreadcrumbsProps
 * @property {Array<{href: string|null, label: string}>} trail Oldest ancestor first, current page last.
 * @property {'default'|'inverse'} [tone] `inverse` for a trail drawn on a night band.
 */

/** The trail's colours, per ground. Every pairing is a measured one. */
const CRUMB_TONES = Object.freeze({
  default: {
    list: 'text-ink-muted',
    separator: 'text-ink-subtle',
    link: 'text-accent-strong hover:decoration-2',
    current: 'text-ink-muted',
  },
  inverse: {
    list: 'text-ink-inverse-muted',
    separator: 'text-ink-inverse-muted',
    link: 'text-ink-inverse-muted hover:text-ink-inverse',
    current: 'text-ink-inverse',
  },
})

/**
 * Where this page sits.
 *
 * @param {BreadcrumbsProps} props Component props.
 * @returns {JSX.Element} The trail.
 */
export function Breadcrumbs({ trail, tone = 'default' }) {
  const colours = CRUMB_TONES[tone] ?? CRUMB_TONES.default

  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className={`flex flex-wrap items-center gap-x-2 ${colours.list}`}>
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1

          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className={colours.separator}>
                  /
                </span>
              ) : null}
              {crumb.href && !last ? (
                <Link
                  href={crumb.href}
                  className={`inline-flex min-h-11 items-center rounded-sm font-semibold underline underline-offset-4 ${colours.link}`}
                >
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={`font-semibold ${colours.current}`}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * @typedef {object} FailureProps
 * @property {string} what What could not be loaded, in the reader's words.
 * @property {string} [detail] What happened and what to do, as whole sentences —
 *   `describeApiRefusal(error).detail`, never the API's raw message.
 */

/**
 * A detail as a sentence of its own: capitalised, and ending in a full stop.
 *
 * Callers used to pass a fragment ("the API answered 503") that this spliced
 * after a colon. Since Phase 4 they pass the refusal vocabulary's sentences,
 * and splicing those produced "loaded: Nothing reached Desi-Event…again..".
 *
 * @param {string} detail The detail.
 * @returns {string} The sentence.
 */
function asSentence(detail) {
  const trimmed = detail.trim()
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1)

  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`
}

/**
 * The service could not answer.
 *
 * `role="status"`, polite: it replaces content the reader was expecting, and
 * is usually there when the page arrives, where a heading and the reading order
 * find it; an assertive region is kept for the door's outcomes. The wording
 * refuses to offer a stale alternative: a figure guessed from a cache
 * is worse than a figure that is absent, and on these screens the figure is
 * somebody's money.
 *
 * @param {FailureProps} props Component props.
 * @returns {JSX.Element} The message.
 */
export function Failure({ what, detail }) {
  return (
    <p
      role="status"
      className="mt-6 rounded-card border border-status-danger/25 bg-status-danger-soft p-4 text-sm text-status-danger"
    >
      {what} could not be loaded.{detail ? ` ${asSentence(detail)}` : ''} Nothing here is stale — it
      is absent, and a figure guessed from a cache would be worse than none.
    </p>
  )
}

/**
 * @typedef {object} ForbiddenProps
 * @property {string} area What the caller was trying to reach.
 * @property {string} [backHref] Where to send them instead.
 * @property {string} [backLabel] What to call that link.
 */

/**
 * The caller may not see this.
 *
 * Deliberately identical whether the item exists or not.
 *
 * @param {ForbiddenProps} props Component props.
 * @returns {JSX.Element} The refusal.
 */
export function Forbidden({ area, backHref = '/', backLabel = 'Back to the site' }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-h2 font-semibold text-ink">Not for you</h1>
      <p className="mt-2 text-ink-muted">
        {area} is not something this account can open. If you think it should be, ask whoever runs
        the organisation — nothing on this page can grant it to you.
      </p>
      <p className="mt-4">
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center rounded-sm font-semibold text-accent-strong underline underline-offset-4 hover:decoration-2"
        >
          {backLabel}
        </Link>
      </p>
    </div>
  )
}

/**
 * @typedef {object} EmptyProps
 * @property {string} title What is empty.
 * @property {string} description Why that might be, in a sentence.
 */

/**
 * There is nothing here, and that is not a failure.
 *
 * Distinct from {@link Failure} on purpose: "no refunds yet" and "the refund
 * service is down" look identical if both render as a blank area, and only one
 * of them is a reason to call somebody.
 *
 * @param {EmptyProps} props Component props.
 * @returns {JSX.Element} The message.
 */
export function Empty({ title, description }) {
  return (
    <div className="mt-6 rounded-card border border-dashed border-line-strong bg-surface-subtle p-6">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1 text-sm text-ink-muted">{description}</p>
    </div>
  )
}

/**
 * @typedef {object} LoadingProps
 * @property {string} label What is being fetched.
 */

/**
 * Work is in progress.
 *
 * A live region rather than a spinner alone, because a spinner is invisible to
 * a screen reader and "nothing has happened yet" is exactly what somebody
 * waiting needs told.
 *
 * @param {LoadingProps} props Component props.
 * @returns {JSX.Element} The placeholder.
 */
export function Loading({ label }) {
  return (
    <p role="status" className="mt-6 text-sm text-ink-muted">
      Loading {label}…
    </p>
  )
}

/**
 * @typedef {object} StaleProps
 * @property {string} asOf When the data was read, already formatted.
 */

/**
 * When this was true.
 *
 * Every one of these screens is a snapshot of something that moves — a queue,
 * a balance, an inventory — and a snapshot with no timestamp invites somebody
 * to act on a figure that changed while they were reading it.
 *
 * @param {StaleProps} props Component props.
 * @returns {JSX.Element} The note.
 */
export function AsOf({ asOf }) {
  return (
    <p className="mt-2 text-sm text-ink-muted">
      Read at <time dateTime={asOf}>{asOf}</time>. This page does not refresh itself; reload it to
      see anything that has changed since.
    </p>
  )
}

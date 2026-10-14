/**
 * "Visit the organiser's website" on the public event page.
 *
 * Shown only while an administrator at The Desi Events has the event's website
 * link on and the page is public: the API's `websiteLink` is then `{host}`, and
 * null otherwise. The link is The Desi Events' own `/events/{slug}/website`,
 * never the address, so the switch takes effect at the next click and the visit
 * can be counted without recording who made it. A plain `<a>`, never
 * `next/link`, so nothing prefetches it.
 *
 * `uncounted` marks a reader whose visits are not counted (the event's own team
 * and staff at The Desi Events): the link carries `?count=no`, which can only
 * stop a visit being counted, and the note says so.
 *
 * An event copied from its Sulekha listing passes `label` "Buy tickets on
 * Sulekha" and `button`, since that link is where its tickets are sold
 * (SPEC2-XI I-E); the address, the redirect and the note are the same.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-website-link
 */

import { PRIMARY_LINK, TEXT_LINK } from './link-classes.js'

/** What the link says unless told otherwise. */
export const WEBSITE_LINK_LABEL = 'Visit the organiser’s website'

/**
 * @typedef {object} EventWebsiteLinkProps
 * @property {string} slug The event's web address.
 * @property {{host: string}|null} link Where the link goes, as a host; null for no link.
 * @property {boolean} [uncounted] Whether this reader's visits are left uncounted.
 * @property {string} [label] What the link says.
 * @property {boolean} [button] Whether it is drawn as the page's main action.
 */

/**
 * The link and the note under it, or nothing.
 *
 * @param {EventWebsiteLinkProps} props Component props.
 * @returns {JSX.Element|null} The link, or nothing.
 */
export function EventWebsiteLink({
  slug,
  link,
  uncounted = false,
  label = WEBSITE_LINK_LABEL,
  button = false,
}) {
  if (!link?.host || typeof slug !== 'string' || slug === '') return null

  const href = `/events/${encodeURIComponent(slug)}/website${uncounted ? '?count=no' : ''}`

  return (
    <div className="mt-4">
      <p>
        <a
          href={href}
          rel="nofollow"
          className={button ? `${PRIMARY_LINK} w-full` : TEXT_LINK}
          aria-describedby="website-link-note"
        >
          {label}
        </a>
        {button ? null : (
          <>
            {' '}
            <span className="text-sm text-ink-muted">({link.host})</span>
          </>
        )}
      </p>
      <p id="website-link-note" className="mt-1 text-sm text-ink-muted">
        {uncounted
          ? `Opens ${link.host}, which The Desi Events does not run. Visits by the event’s own team and staff at The Desi Events are not counted.`
          : `Opens ${link.host}, which The Desi Events does not run. The Desi Events counts the visit without recording your address, browser or account.`}
      </p>
    </div>
  )
}

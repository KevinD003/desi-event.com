/**
 * "Visit the organiser's website" on the public event page.
 *
 * Shown only while a Desi-Event administrator has the event's website link on
 * and the page is public: the API's `websiteLink` is then `{host}`, and null
 * otherwise. The link is Desi-Event's own `/events/{slug}/website`, never the
 * address, so the switch takes effect at the next click and the visit can be
 * counted without recording who made it. A plain `<a>`, never `next/link`, so
 * nothing prefetches it.
 *
 * `uncounted` marks a reader whose visits are not counted (the event's own team
 * and Desi-Event staff): the link carries `?count=no`, which can only stop a
 * visit being counted, and the note says so.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-website-link
 */

import { TEXT_LINK } from './link-classes.js'

/**
 * @typedef {object} EventWebsiteLinkProps
 * @property {string} slug The event's web address.
 * @property {{host: string}|null} link Where the link goes, as a host; null for no link.
 * @property {boolean} [uncounted] Whether this reader's visits are left uncounted.
 */

/**
 * The link and the note under it, or nothing.
 *
 * @param {EventWebsiteLinkProps} props Component props.
 * @returns {JSX.Element|null} The link, or nothing.
 */
export function EventWebsiteLink({ slug, link, uncounted = false }) {
  if (!link?.host || typeof slug !== 'string' || slug === '') return null

  const href = `/events/${encodeURIComponent(slug)}/website${uncounted ? '?count=no' : ''}`

  return (
    <div className="mt-4">
      <p>
        <a href={href} rel="nofollow" className={TEXT_LINK} aria-describedby="website-link-note">
          Visit the organiser’s website
        </a>{' '}
        <span className="text-sm text-ink-muted">({link.host})</span>
      </p>
      <p id="website-link-note" className="mt-1 text-sm text-ink-muted">
        {uncounted
          ? `Opens ${link.host}, which Desi-Event does not run. Visits by the event’s own team and Desi-Event staff are not counted.`
          : `Opens ${link.host}, which Desi-Event does not run. Desi-Event counts the visit without recording your address, browser or account.`}
      </p>
    </div>
  )
}

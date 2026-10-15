/**
 * The event page's extra sections: line-up, running order, dress code,
 * getting there, questions, contact, links and sponsors.
 *
 * Server-safe: no hooks, no `'use client'`, so they render into the page's
 * markup and work without JavaScript. Each renders nothing when it has nothing
 * to say, so an event without a running order has no empty "Running order".
 *
 * Every link is checked again here, although the API already refused anything
 * else: an `https:` address, and for a social network, a host that network
 * owns. The text of a link says where it goes — a network's name, or the
 * sponsor's name — never an icon alone.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file components/event-content
 */

import { TEXT_LINK } from './link-classes.js'
import { SOCIAL_HOSTS, SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS } from '../lib/event-content.js'
import { LINK_REL, isSafeHref } from '../lib/rich-text.js'
import { zoneAbbreviation } from '../lib/zoned-time.js'

/** The heading every section here uses. */
const HEADING = 'text-h2 font-semibold text-ink'

/**
 * A section with a heading, or nothing.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading's id.
 * @param {string} props.title The heading.
 * @param {*} props.children The content.
 * @returns {JSX.Element} The section.
 */
function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className={HEADING}>
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  )
}

/**
 * The line-up, in billing order.
 *
 * An event that only has names — older data, or an organiser who gave no roles
 * or bios — is shown as a row of names, each list item exactly the name.
 *
 * @param {object} props Component props.
 * @param {object[]} [props.performers] `{name, role, bio}`, in billing order.
 * @param {string[]} [props.artists] The names alone, for data from before performers existed.
 * @returns {JSX.Element|null} The line-up, or nothing.
 */
export function EventLineUp({ performers = [], artists = [] }) {
  const list =
    Array.isArray(performers) && performers.length > 0
      ? performers
      : (artists ?? []).map((name) => ({ name, role: null, bio: null }))

  if (list.length === 0) return null

  const detailed = list.some((performer) => performer.role || performer.bio)

  return (
    <div className="mt-6">
      <h3 className="font-sans text-sm font-bold text-ink">Line-up</h3>
      {detailed ? (
        <ol className="mt-3 space-y-4">
          {list.map((performer, index) => (
            <li key={`${performer.name}-${index}`}>
              <p className="font-semibold text-ink">
                {performer.name}
                {performer.role ? (
                  <span className="font-normal text-ink-muted"> — {performer.role}</span>
                ) : null}
              </p>
              {performer.bio ? (
                <p className="mt-1 text-sm text-ink-muted">{performer.bio}</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <ol className="mt-2.5 flex flex-wrap gap-2">
          {list.map((performer, index) => (
            <li
              key={`${performer.name}-${index}`}
              className="rounded-full border border-line-strong bg-surface-raised px-3.5 py-1.5 text-sm font-semibold text-ink"
            >
              {performer.name}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * `19:30` as `7:30 PM`.
 *
 * @param {string} time A 24-hour `HH:mm`.
 * @returns {string} The 12-hour reading, or the time as given when it is malformed.
 */
function twelveHour(time) {
  const match = /^(\d{2}):(\d{2})$/u.exec(String(time ?? ''))

  if (!match) return String(time ?? '')

  const hour = Number(match[1])
  const suffix = hour < 12 ? 'AM' : 'PM'

  return `${hour % 12 === 0 ? 12 : hour % 12}:${match[2]} ${suffix}`
}

/**
 * The running order: local times, what happens, and a note.
 *
 * @param {object} props Component props.
 * @param {object[]} [props.items] `{time, title, note}`.
 * @param {string} props.timezone The event's zone; the times are local to it.
 * @param {string} [props.startsAt] The event's start, to read the zone's abbreviation on the day.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventRunningOrder({ items = [], timezone, startsAt = null }) {
  if (!Array.isArray(items) || items.length === 0) return null

  const zone = zoneAbbreviation(timezone, startsAt ? new Date(startsAt) : new Date())

  return (
    <Section id="running-order-heading" title="Running order">
      <ol className="space-y-3">
        {items.map((item, index) => (
          <li key={`${item.time}-${index}`} className="grid grid-cols-[6.5rem_1fr] gap-3">
            <time dateTime={item.time} className="font-semibold text-ink tabular-nums">
              {twelveHour(item.time)}
              {zone ? <span className="text-sm font-normal text-ink-muted"> {zone}</span> : null}
            </time>
            <div>
              <p className="text-ink">{item.title}</p>
              {item.note ? <p className="text-sm text-ink-muted">{item.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-ink-muted">
        Local time at the venue ({timezone}). Where the event runs over several nights, the same
        order applies to each.
      </p>
    </Section>
  )
}

/**
 * What to wear.
 *
 * @param {object} props Component props.
 * @param {string|null} [props.text] The dress code.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventDressCode({ text = null }) {
  if (!text?.trim()) return null

  return (
    <Section id="dress-code-heading" title="Dress code">
      <p className="whitespace-pre-line text-ink-muted">{text}</p>
    </Section>
  )
}

/**
 * This event's parking and arrival notes, after the venue.
 *
 * @param {object} props Component props.
 * @param {string|null} [props.text] The notes.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventDirections({ text = null }) {
  if (!text?.trim()) return null

  return (
    <Section id="directions-heading" title="Getting there">
      <p className="whitespace-pre-line text-ink-muted">{text}</p>
    </Section>
  )
}

/**
 * Questions and answers, each a native disclosure a keyboard opens.
 *
 * @param {object} props Component props.
 * @param {object[]} [props.items] `{question, answer}`.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventFaq({ items = [] }) {
  if (!Array.isArray(items) || items.length === 0) return null

  return (
    <Section id="faq-heading" title="Questions people ask">
      <div className="divide-y divide-line rounded-card border border-line">
        {items.map((item, index) => (
          <details key={`${item.question}-${index}`} className="group px-4 py-3">
            <summary className="cursor-pointer rounded-sm font-semibold text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none">
              {item.question}
            </summary>
            <p className="mt-2 whitespace-pre-line text-ink-muted">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  )
}

/**
 * A telephone link's address: digits and a leading plus, nothing else.
 *
 * @param {string} phone The number as written.
 * @returns {string} The `tel:` address.
 */
function telHref(phone) {
  const digits = String(phone).replace(/[^\d+]/gu, '')

  return `tel:${digits.startsWith('+') ? `+${digits.slice(1).replace(/\+/gu, '')}` : digits.replace(/\+/gu, '')}`
}

/**
 * The contact the organiser chose to publish.
 *
 * @param {object} props Component props.
 * @param {string|null} [props.email] The public email.
 * @param {string|null} [props.phone] The public phone number.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventContact({ email = null, phone = null }) {
  const address = typeof email === 'string' && /^[^\s@]+@[^\s@]+$/u.test(email) ? email : null

  if (!address && !phone) return null

  return (
    <Section id="contact-heading" title="Contact the organiser">
      <dl className="space-y-2">
        {address ? (
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold text-ink">Email</dt>
            <dd>
              <a href={`mailto:${address}`} className={TEXT_LINK}>
                {address}
              </a>
            </dd>
          </div>
        ) : null}
        {phone ? (
          <div className="flex flex-wrap gap-2">
            <dt className="font-bold text-ink">Phone</dt>
            <dd>
              <a href={telHref(phone)} className={TEXT_LINK}>
                {phone}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </Section>
  )
}

/**
 * Whether a link is https and, for a network, on a host that network owns.
 *
 * @param {string} network The network.
 * @param {string} href The address.
 * @returns {boolean} True when it may be shown as a link.
 */
function isAllowedLink(network, href) {
  if (!isSafeHref(href)) return false

  return (SOCIAL_HOSTS[network] ?? []).includes(new URL(href).hostname.toLowerCase())
}

/**
 * The organiser's links, one per network, each named in text.
 *
 * @param {object} props Component props.
 * @param {Record<string, string>|null} [props.links] Addresses by network.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventSocialLinks({ links = null }) {
  const shown = SOCIAL_NETWORKS.filter(
    (network) => typeof links?.[network] === 'string' && isAllowedLink(network, links[network]),
  )

  if (shown.length === 0) return null

  return (
    <Section id="links-heading" title="Links">
      <ul className="flex flex-wrap gap-x-6 gap-y-2">
        {shown.map((network) => {
          const href = links[network].trim()
          const host = new URL(href).hostname.replace(/^www\./u, '')

          return (
            <li key={network}>
              <a href={href} rel={LINK_REL} className={TEXT_LINK}>
                {SOCIAL_NETWORK_LABELS[network]}
              </a>{' '}
              <span className="text-sm text-ink-muted">({host})</span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

/**
 * The event's sponsors, linked when they gave an https website.
 *
 * @param {object} props Component props.
 * @param {object[]} [props.items] `{name, url, level}`.
 * @returns {JSX.Element|null} The section, or nothing.
 */
export function EventSponsors({ items = [] }) {
  if (!Array.isArray(items) || items.length === 0) return null

  return (
    <Section id="sponsors-heading" title="Supported by">
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((sponsor, index) => (
          <li
            key={`${sponsor.name}-${index}`}
            className="rounded-card border border-line bg-surface-raised px-4 py-3"
          >
            {sponsor.url && isSafeHref(sponsor.url) ? (
              <a href={sponsor.url.trim()} rel={LINK_REL} className={TEXT_LINK}>
                {sponsor.name}
              </a>
            ) : (
              <span className="font-semibold text-ink">{sponsor.name}</span>
            )}
            {sponsor.level ? (
              <span className="block text-sm text-ink-muted">{sponsor.level}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

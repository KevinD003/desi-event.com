/**
 * How to reach the team at The Desi Events.
 *
 * One public page with the company's own channels: email, telephone,
 * WhatsApp, Facebook and Instagram, each a plain link that opens the
 * visitor's own mail app, phone, WhatsApp or browser. Organisers use the same
 * channels to ask about listing an event.
 *
 * There is no form: this site does not send contact email, and a form that
 * looked as if it did would be a promise nobody keeps. Nor does the page say
 * how quickly anybody answers, because nothing here can promise that.
 *
 * The channels are `lib/contact.js`, the same list the footer and the home
 * page's structured data read, so the three cannot disagree.
 *
 * @module app/contact/page
 */

import Link from 'next/link'

import { TEXT_LINK } from '../../components/link-classes.js'
import { PageHero } from '../../components/page-hero.jsx'
import { BRAND_NAME, CONTACT_CHANNELS, pageLabel } from '../../lib/contact.js'

export const metadata = {
  title: 'Contact',
  description: `Email, call, WhatsApp or message ${BRAND_NAME} on Facebook or Instagram.`,
  alternates: { canonical: '/contact' },
}

/**
 * The page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function ContactPage() {
  return (
    <div>
      <PageHero
        headingId="contact-heading"
        eyebrow="Get in touch"
        title={`Contact ${BRAND_NAME}`}
        lead="Email, call or message the team on WhatsApp, Facebook or Instagram."
      />

      <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
        <h2 id="channels-heading" className="text-h2 font-semibold text-ink">
          Ways to reach the team
        </h2>
        <ul
          aria-labelledby="channels-heading"
          className="mt-4 divide-y divide-line rounded-card bg-surface-raised shadow-card"
        >
          {CONTACT_CHANNELS.map((channel) => (
            <li
              key={channel.id}
              className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="text-sm font-bold text-ink-muted sm:w-28 sm:shrink-0">
                {channel.kind}
              </span>
              <a
                href={channel.href}
                aria-label={pageLabel(channel)}
                className={`${TEXT_LINK} inline-flex min-h-11 min-w-0 items-center [overflow-wrap:anywhere]`}
              >
                {channel.address}
              </a>
            </li>
          ))}
        </ul>

        <p className="mt-8 max-w-prose text-ink">
          Organisers reach the team the same way about listing an event on {BRAND_NAME}.
        </p>
        <p className="mt-3 max-w-prose text-ink">
          There is no contact form on this site. For a question about one event, its page names the
          organiser who runs it.
        </p>

        <p className="mt-10 text-sm text-ink-muted">
          <Link href="/events" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            Back to what’s on
          </Link>
        </p>
      </div>
    </div>
  )
}

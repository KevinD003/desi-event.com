/**
 * The site footer: the night band every page ends on.
 *
 * The brand and what the site is for, four short columns of ways back into
 * the catalogue, the cities it lists nights in, and the small print. The
 * small print says two things on every page, because both are true on every
 * page: payments here are simulated, and every event, organiser and price is
 * fictional.
 *
 * @module components/site-footer
 */

import Link from 'next/link'

import { categoryLabel } from '../lib/catalog.js'
import { buildEventsHref } from '../lib/search-params.js'
import { Diamond, MirrorBand, Wordmark } from './festive-decor.jsx'
import { ShieldIcon } from './icons.jsx'

/**
 * The cities the catalogue lists nights in, east to west.
 *
 * Static rather than read from the facets: the footer is on every page, and
 * an API read on every page for a row of links is a poor trade. Every one has
 * venues in both the sample catalogue and the development seed; `/venues` and
 * the listing's own city filter say what is really there at any moment.
 */
const CITIES = Object.freeze([
  'Edison',
  'Jersey City',
  'Queens',
  'Philadelphia',
  'Atlanta',
  'Houston',
  'Irving',
  'Schaumburg',
  'Santa Clara',
  'Cerritos',
  'Bellevue',
])

/** The categories a garba season is made of, in the order the footer lists them. */
const FOOTER_CATEGORIES = Object.freeze([
  'GARBA_DANDIYA',
  'WORKSHOP',
  'CULTURAL_FESTIVAL',
  'MUSIC_CONCERT',
])

/** The four ways into the catalogue, as the header offers them. */
const DISCOVER = Object.freeze([
  { href: '/events', label: 'All events' },
  { href: '/categories', label: 'Categories' },
  { href: '/venues', label: 'Venues' },
  { href: '/organizers', label: 'Organisers' },
])

/**
 * A few of the things the limitations page lists, in the footer's words. Each
 * is true of this build; the page itself is the full, recorded list.
 */
const CANNOT = Object.freeze([
  'Take real payments',
  'Calculate US sales tax',
  'Sell seated tickets',
  'Send email',
])

/** A footer link: lavender on the night, ivory and underlined on hover, 44px tall. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-[0.9375rem] text-ink-inverse-muted transition-colors duration-(--duration-fast) hover:text-ink-inverse hover:underline hover:underline-offset-4'

/** A column heading: the marigold eyebrow. */
const COLUMN_HEADING =
  'mb-1 font-sans text-micro font-bold tracking-eyebrow text-accent-inverse uppercase'

/**
 * One titled column of links.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading's id, which names the navigation.
 * @param {string} props.title The heading.
 * @param {Array<{href: string, label: string}>} props.links The links.
 * @returns {JSX.Element} The column.
 */
function LinkColumn({ id, title, links }) {
  return (
    <nav aria-labelledby={id}>
      <h2 id={id} className={COLUMN_HEADING}>
        {title}
      </h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={FOOTER_LINK}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * The global site footer.
 *
 * @returns {JSX.Element} The rendered footer.
 */
export function SiteFooter() {
  const categories = FOOTER_CATEGORIES.map((value) => ({
    href: buildEventsHref({ category: value }),
    label: categoryLabel(value),
  }))

  return (
    <footer className="mt-16 bg-surface-inverse text-ink-inverse-muted">
      <MirrorBand className="bg-surface-inverse" />
      <div className="mx-auto max-w-content px-4 pt-14 pb-10 sm:px-6">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)] lg:gap-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="inline-flex min-h-11 items-center gap-3 rounded-control">
              <Wordmark inverse />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-ink-inverse-muted">
              Tickets for garba, dandiya and Navratri nights across the USA, with every price shown
              in US dollars alongside its booking fee.
            </p>
          </div>

          <LinkColumn id="footer-discover" title="Discover" links={DISCOVER} />
          <LinkColumn id="footer-categories" title="Categories" links={categories} />

          <div>
            <h2 className={COLUMN_HEADING}>For organisers</h2>
            <p className="mt-2 text-sm leading-6 text-ink-inverse-muted">
              Listings, ticket tiers, holds and door check-in, from the organiser workspace.
              Organiser accounts are set up by the platform in this build; there is no sign-up for
              an organisation.
            </p>
          </div>

          <div>
            <h2 className={COLUMN_HEADING}>What this site does not do</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {CANNOT.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-ink-inverse-muted">
                  <Diamond className="mt-1.5 h-2 w-2 fill-accent" />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/limitations"
              className="mt-1 inline-flex min-h-11 items-center rounded-sm text-[0.9375rem] font-bold text-accent-inverse underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              The full list
            </Link>
          </div>
        </div>

        <nav aria-labelledby="footer-cities" className="mt-10">
          <h2 id="footer-cities" className={COLUMN_HEADING}>
            Garba nights in
          </h2>
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {CITIES.map((city, index) => (
              <li key={city} className="flex items-center gap-1">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-ink-inverse-muted">
                    ·
                  </span>
                ) : null}
                <Link href={buildEventsHref({ city })} className={`${FOOTER_LINK} px-1 text-sm`}>
                  {city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink-inverse/15 pt-6 md:flex-row md:items-center md:justify-between md:gap-8">
          <p className="flex items-center gap-2.5 text-[0.9375rem] font-bold text-ink-inverse">
            <ShieldIcon className="h-5 w-5 text-accent-inverse" />
            Payments on this site are simulated — no card, no money moves.
          </p>
          {/* ink-inverse-muted is 11.6:1 on the night band; a grey that
              merely looked quiet once sat at 3.74:1, below AA at this size. */}
          <p className="text-sm text-ink-inverse-muted">
            A demonstration project. Every event, organiser and price on this site is fictional.
          </p>
        </div>
      </div>
    </footer>
  )
}

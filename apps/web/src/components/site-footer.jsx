/**
 * The site footer: the purple plate every public page ends on.
 *
 * The brand's own close. The D and the name, the kit's tagline set as a
 * poster line ("Every moment, one place.", the words themselves, not a
 * picture of them), what the site is for, three short lists of ways back into
 * the catalogue and what organisers need to know, what this site does not do,
 * how to reach the team at The Desi Events, the cities it lists events in,
 * and the small print. The small print says two things on every page,
 * because both are true on every page: payments here are simulated, and
 * events, organisers and prices are fictional — except events imported from
 * organisers' public ticket listings, which name the organiser who presents
 * them and are sold here at the prices the organiser listed (ADR 0015). The
 * site those listings are on is not named, and nothing links to it: the
 * owner asked that there be no connection with it.
 *
 * Flat, on the kit's Royal Purple: the plate is the decoration. The mirror
 * band that used to run along its top edge is gone with the rest of the
 * festival ornament (`festive-decor.jsx`).
 *
 * The footer keeps its place during a page transition, like the header.
 *
 * @module components/site-footer
 */

import Link from 'next/link'

import { Icon } from '@desi-event/ui/icons'

import { SIMULATED_PAYMENTS, TAGLINE } from '../lib/brand.js'
import { categoryLabel } from '../lib/catalog.js'
import { CONTACT_CHANNELS } from '../lib/contact.js'
import { buildEventsHref } from '../lib/search-params.js'
import { BrandLogo } from './brand-logo.jsx'

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

/**
 * A handful of the catalogue's categories, across the year rather than one
 * festival's: the directory at `/categories` lists them all.
 */
const FOOTER_CATEGORIES = Object.freeze([
  'MUSIC_CONCERT',
  'COMEDY',
  'GARBA_DANDIYA',
  'BOLLYWOOD_NIGHT',
  'CULTURAL_FESTIVAL',
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
 * is true of this build in every configuration; the page itself is the full,
 * recorded list. Email is named narrowly: a deployment with a mail server
 * emails invitation and ticket-transfer codes, but never receipts or password
 * resets.
 */
const CANNOT = Object.freeze([
  'Take real payments',
  'Calculate US sales tax',
  'Email receipts or password resets',
])

/** A footer link: lavender on the plate, white and underlined on hover, 44px tall. */
const FOOTER_LINK =
  'inline-flex min-h-11 items-center rounded-sm text-label text-ink-inverse-muted transition-colors duration-(--duration-fast) hover:text-ink-inverse hover:underline hover:underline-offset-4'

/** A column heading: a short gold label, the foil on the plate. */
const COLUMN_HEADING = 'mb-1 font-sans text-label font-semibold text-accent-inverse'

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
    <footer className="mt-20 bg-surface-inverse text-ink-inverse-muted [view-transition-name:site-footer]">
      <div className="mx-auto max-w-bleed px-4 pt-16 pb-10 sm:px-6 lg:px-10 lg:pt-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-5">
            {/* The logo drawn for a dark ground: the light one's crimson
                "Desi" would sink into the plate. */}
            <Link href="/" className="inline-flex min-h-11 items-center rounded-control">
              <BrandLogo variant="dark" className="h-14 w-auto" />
            </Link>
            <p className="mt-10 max-w-[11ch] font-display text-display font-bold text-balance text-ink-inverse [font-stretch:75%]">
              {TAGLINE}
            </p>
            <p className="mt-6 max-w-md text-label leading-6 text-ink-inverse-muted">
              South Asian events across the USA and Canada, from concerts and comedy to garba, Durga
              Puja and Diwali melas. Tickets sold here are priced in US dollars, or Canadian dollars
              at a venue in Canada, alongside their booking fee.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:col-span-7 lg:pt-3">
            <LinkColumn id="footer-discover" title="Discover" links={DISCOVER} />
            <LinkColumn id="footer-categories" title="Categories" links={categories} />

            <div className="col-span-2 sm:col-span-1">
              <h2 className={COLUMN_HEADING}>For organisers</h2>
              <p className="mt-2 text-label leading-6 text-ink-inverse-muted">
                Listings, ticket tiers, seat maps and door check-in, from the organiser workspace.
                Organisers join by invitation from the team at The Desi Events, and every event is
                reviewed by the team before it is published.
              </p>
              <Link href="/account/organizations/new" className={FOOTER_LINK}>
                Accept an organiser invitation
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-10 border-t border-ink-inverse/15 pt-10 md:grid-cols-2 md:gap-12">
          <div>
            <h2 className={COLUMN_HEADING}>What this site does not do</h2>
            <ul className="mt-2 flex flex-col gap-2">
              {CANNOT.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2.5 text-label text-ink-inverse-muted"
                >
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-plate bg-accent-inverse"
                  />
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/limitations"
              className="mt-1 inline-flex min-h-11 items-center rounded-sm text-label font-bold text-accent-inverse underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              The full list
            </Link>
          </div>

          {/* The email address is wider than a narrow column, so the row
              wraps at any width rather than sitting in a grid cell. */}
          <div>
            <h2 id="footer-contact" className={COLUMN_HEADING}>
              Contact
            </h2>
            <ul aria-labelledby="footer-contact" className="flex flex-wrap gap-x-6 gap-y-0">
              {CONTACT_CHANNELS.map((channel) => (
                <li key={channel.id} className="min-w-0">
                  {/* Same tab, as every other footer link: these are the
                      team's own pages and the visitor's own apps. */}
                  <a
                    href={channel.href}
                    aria-label={channel.label}
                    className={`${FOOTER_LINK} [overflow-wrap:anywhere]`}
                  >
                    {channel.text}
                  </a>
                </li>
              ))}
              <li>
                <Link href="/contact" className={FOOTER_LINK}>
                  Contact page
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <nav aria-labelledby="footer-cities" className="mt-10">
          <h2 id="footer-cities" className={COLUMN_HEADING}>
            Cities
          </h2>
          <ul className="flex flex-wrap gap-x-1 gap-y-0">
            {CITIES.map((city, index) => (
              <li key={city} className="flex items-center gap-1">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-ink-inverse-muted">
                    ·
                  </span>
                ) : null}
                <Link href={buildEventsHref({ city })} className={`${FOOTER_LINK} px-1`}>
                  {city}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 flex flex-col gap-3 border-t border-ink-inverse/15 pt-6 md:flex-row md:items-start md:justify-between md:gap-10">
          <p className="flex shrink-0 items-center gap-2.5 text-label font-bold text-ink-inverse">
            <Icon name="shield" className="h-5 w-5 text-accent-inverse" />
            {SIMULATED_PAYMENTS}
          </p>
          {/* ink-inverse-muted is 11.6:1 on the plate; a grey that merely
              looked quiet once sat at 3.74:1, below AA at this size. */}
          <p className="max-w-3xl text-caption text-ink-inverse-muted">
            A demonstration project. Events, organisers and prices on this site are fictional,
            except events imported from organisers’ public ticket listings, which name the organiser
            who presents them and are sold here at the prices the organiser listed.
          </p>
        </div>
      </div>
    </footer>
  )
}

/**
 * Privacy, from the attendee's side: what is kept, who sees it, and what can
 * and cannot be done about it from here.
 *
 * The account shell promises "privacy controls", and the honest inventory of
 * those in this build is short. The controls that exist — two-step sign-in,
 * ending sessions, handing tickets on — live on their own pages and are linked
 * from here. The ones people expect and this build does not have — a copy of
 * their data, deleting the account, email — are named as missing, in plain
 * words, rather than left for somebody to hunt for.
 *
 * Every statement on this page is a property of the code, checked when it was
 * written. Where each is enforced:
 *
 * - Passwords are stored as scrypt hashes (`packages/auth/src/password.js`).
 * - A session keeps the browser's user-agent string and a keyed pseudonym of
 *   the address it came from, never the address itself
 *   (`apps/api/src/lib/sessions.js`).
 * - An organisation reading an order gets the buyer's name and not their
 *   address; a transfer's recipient is `••••@domain` to the parties; a team
 *   member's address is shown only to owners and administrators who have
 *   confirmed a second factor in the last ten minutes (the email-privacy
 *   correction, the first Phase 4 commit).
 * - No route exports a person's own data or deletes their account. Redaction
 *   exists only as an organisation's privacy operation, `privacy:redact`, and
 *   refuses while a hold or open process still needs the data.
 * - The retention worker only rehearses: a `DRY_RUN` row claiming it removed
 *   anything is refused by a database constraint.
 * - No email is delivered: the mail provider in this build is an in-memory
 *   mock.
 *
 * It makes no request of its own. What it says is true of every account, so
 * there is nothing to fetch, and nothing here can fail to load.
 *
 * @module app/account/privacy/page
 */

import Link from 'next/link'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Privacy', robots: { index: false, follow: false } }

/** Classes for an in-text link. */
const LINK =
  'font-medium text-accent-strong underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded-sm'

/**
 * A titled block of the page.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading id.
 * @param {string} props.title The heading.
 * @param {ReactNode} props.children The body.
 * @returns {JSX.Element} The section.
 */
function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      <div className="mt-3 max-w-prose space-y-3 text-ink">{children}</div>
    </section>
  )
}

/**
 * Something this build cannot do, said as plainly as something it can.
 *
 * @param {object} props Component props.
 * @param {string} props.title What cannot be done.
 * @param {ReactNode} props.children Why, and what happens instead.
 * @returns {JSX.Element} The entry.
 */
function Unavailable({ title, children }) {
  return (
    <li className="rounded-card border border-line bg-surface-raised p-4">
      <p className="font-semibold text-ink">
        {title} <span className="font-normal text-ink-muted">— not available in this build.</span>
      </p>
      <p className="mt-1 text-sm text-ink-muted">{children}</p>
    </li>
  )
}

/**
 * The attendee privacy page.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function AccountPrivacyPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Privacy</h1>
      <p className="mt-2 max-w-prose text-ink-muted">
        What this site keeps about you, who can see it, and what you can change from here.
      </p>

      <Section id="privacy-kept" title="What is kept">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your account: your name, your email address, and your password, which is stored only as
            a one-way hash and cannot be read back by anybody.
          </li>
          <li>
            Your orders: the name and email address given at checkout, what was bought, and the
            simulated payment. No card details are asked for or kept; no money moves in this build.
          </li>
          <li>
            Your tickets: who holds each one, whether it was handed on, and when it was scanned at
            the door.
          </li>
          <li>
            Where you are signed in: when each session started and was last used, which browser it
            was, and a scrambled form of the network address it came from — never the address
            itself.
          </li>
        </ul>
      </Section>

      <Section id="privacy-seen" title="Who sees your email address">
        <ul className="list-disc space-y-2 pl-5">
          <li>You, on your account and your orders.</li>
          <li>
            Organisers of the events you buy tickets for see the name on your order and on your
            ticket, not your email address.
          </li>
          <li>
            When you hand a ticket on, the address you sent it to is shown to you only as four dots,
            an @ and its domain.
          </li>
          <li>
            If you join an organisation’s team, its owners and administrators can see your address,
            and only after confirming a second sign-in step within the last ten minutes.
          </li>
        </ul>
      </Section>

      <Section id="privacy-controls" title="What you can do here">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Turn on two-step sign-in, change your password, and sign out any session you do not
            recognise:{' '}
            <Link href="/account/security" className={LINK}>
              Account security
            </Link>
            .
          </li>
          <li>
            See the tickets you have offered to someone else, each linked to the page where the
            offer can be withdrawn before it is accepted:{' '}
            <Link href="/account/transfers" className={LINK}>
              Transfers
            </Link>
            .
          </li>
        </ul>
      </Section>

      <Section id="privacy-missing" title="What cannot be done from here">
        <ul className="space-y-3">
          <Unavailable title="Download a copy of your data">
            There is no self-service export. Your orders, tickets and sessions are each listed on
            their own page.
          </Unavailable>
          <Unavailable title="Delete your account">
            There is no self-service deletion. Personal details are removed by redaction, which an
            organisation’s privacy team carries out within that organisation’s records, and which
            waits while a legal hold, a fraud investigation, a refund in progress, a ticket being
            handed on or an unused ticket still needs them. To ask for it, contact the organiser of
            your event: their page on this site links to their own website when they have given one.
            This site has no way to pass the request on for you.
          </Unavailable>
          <Unavailable title="Email from this site">
            This build delivers no email: no receipts, no confirmation links, no password resets and
            no team invitations. A forgotten password cannot be reset from this site. What an email
            would have told you — an order, a ticket, an offer — is on these pages instead.
          </Unavailable>
          <Unavailable title="Automatic deletion after a set time">
            Scheduled deletion is switched off. The retention job only counts what a policy would
            remove, and removes nothing.
          </Unavailable>
        </ul>
      </Section>
    </div>
  )
}

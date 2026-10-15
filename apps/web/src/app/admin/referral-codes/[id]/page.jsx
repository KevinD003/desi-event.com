/**
 * One referral code: what it is, changing it, switching it off or on, and the
 * orders that used it (SPEC3 §12.5, SPEC3-XI §12.5).
 *
 * The details as the list shows them, and more: every event it names that the
 * API sends (up to three, with how many in all), when it was made and last
 * changed. The form changes its label, events, expiry and limit (a second
 * factor, PAYMENT_TERMS); the switch takes it off offer, or back on. Then the
 * orders placed with it, 50 a page, newest first — the order, the event, when,
 * how it was paid, its status, the booking fee waived and, once an order gave
 * its use back, when and why. Never a buyer's name or address.
 *
 * Gated on `referral_code:manage`; the API decides again on every read and
 * write. The page reads `page` from its address and nothing else: a code's
 * text is never in an address.
 *
 * `@file` rather than `@module`: the path's `[id]` segment is not a valid
 * module name.
 *
 * @file app/admin/referral-codes/id/page.jsx
 */

import Link from 'next/link'

import { ReadRefusal, RefusalNotice } from '../../../../components/read-refusal.jsx'
import { Badge } from '../../../../components/ui.jsx'
import { PANEL, TEXT_LINK } from '../../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../../lib/capabilities.js'
import { formatAmount } from '../../../../lib/pricing.js'
import { readSession } from '../../../../lib/session.js'
import {
  PAGER_LINK_CLASSES,
  formatInstant,
  getReferralCode,
  listHref,
  readPage,
} from '../../../../lib/workspace-api.js'
import { orderStatusMeaning } from '../../../account/orders/order-status.js'
import { CopyCodeButton } from '../copy-code-button.jsx'
import { ReferralCodeForm } from '../referral-code-form.jsx'
import { ReferralCodeSwitch } from '../referral-code-switch.jsx'
import {
  NOT_FOR_THIS_ACCOUNT,
  NO_USES,
  PAYMENT_METHOD_WORDS,
  REFERRAL_CODES_PATH,
  STACKED,
  STATUS_WORDS,
  dayWords,
  makerName,
  returnedText,
  usesDetail,
  usesText,
  waivedText,
  worksForText,
} from '../referral-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Referral code', robots: { index: false, follow: false } }

/** The shape of an id the API takes. */
const ID_PATTERN = /^[a-z][a-z0-9]{7,39}$/u

/**
 * One row of the details.
 *
 * @param {object} props Component props.
 * @param {string} props.term What it is.
 * @param {ReactNode} props.children Its value.
 * @returns {JSX.Element} The row.
 */
function Fact({ term, children }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-ink-muted">{term}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  )
}

/**
 * A cell with its column's name for the stacked cards.
 *
 * @param {object} props Component props.
 * @param {string} props.name The column's name.
 * @param {ReactNode} props.children The cell.
 * @returns {JSX.Element} The cell.
 */
function Cell({ name, children }) {
  return (
    <td className={STACKED.cell}>
      <span aria-hidden="true" className={STACKED.label}>
        {name}
      </span>
      <span className="min-w-0">{children}</span>
    </td>
  )
}

/**
 * The orders that used the code.
 *
 * @param {object} props Component props.
 * @param {object[]} props.uses The page of uses.
 * @returns {JSX.Element} The table, or the empty sentence.
 */
function Uses({ uses }) {
  if (uses.length === 0) return <p className="mt-3 text-ink-muted">{NO_USES}</p>

  return (
    <table className={`mt-3 ${STACKED.table}`}>
      <caption className="sr-only">Orders placed with this code</caption>
      <thead className={STACKED.thead}>
        <tr>
          {['Order', 'Event', 'Placed', 'Payment', 'Status', 'Fee waived', 'Use given back'].map(
            (heading) => (
              <th key={heading} scope="col" className={STACKED.th}>
                {heading}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody className={STACKED.tbody}>
        {uses.map((use) => (
          <tr key={use.orderReference} className={STACKED.row}>
            <Cell name="Order">
              <span className="font-mono">{use.orderReference}</span>
            </Cell>
            <Cell name="Event">
              <Link href={`/admin/events/${encodeURIComponent(use.eventId)}`} className={TEXT_LINK}>
                {use.eventTitle}
              </Link>
            </Cell>
            <Cell name="Placed">
              <time dateTime={use.placedAt}>{dayWords(use.placedAt)}</time>
            </Cell>
            <Cell name="Payment">
              {PAYMENT_METHOD_WORDS[use.paymentMethod] ?? use.paymentMethod}
            </Cell>
            <Cell name="Status">{orderStatusMeaning(use.orderStatus).label}</Cell>
            <Cell name="Fee waived">
              <span className="tabular-nums">{formatAmount(use.feeWaivedCents, use.currency)}</span>
            </Cell>
            <Cell name="Use given back">{returnedText(use)}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * @typedef {object} ReferralCodePageProps
 * @property {Promise<{id: string}>} params The route parameters.
 * @property {Promise<Record<string, string>>} [searchParams] The resolved query string.
 */

/**
 * The page.
 *
 * @param {ReferralCodePageProps} props Route props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ReferralCodePage({ params, searchParams }) {
  const { id } = await params
  const query = (await searchParams) ?? {}
  const page = readPage(query.page)
  const session = await readSession()

  const back = (
    <p className="text-sm">
      <Link href={REFERRAL_CODES_PATH} className={TEXT_LINK}>
        Referral codes
      </Link>
    </p>
  )

  if (!sessionCan(session, 'referral_code:manage')) {
    return (
      <div>
        {back}
        <h1 className="mt-2 text-h2 font-semibold text-ink">Referral code</h1>
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      </div>
    )
  }

  let code = null
  let pagination = null
  let failure = null

  if (!ID_PATTERN.test(id ?? '')) {
    failure = { status: 404, code: 'NOT_FOUND' }
  } else {
    try {
      const result = await getReferralCode(id, { page })

      code = result.code
      pagination = result.pagination
    } catch (error) {
      failure = error
    }
  }

  if (failure || !code) {
    return (
      <div>
        {back}
        <h1 className="mt-2 text-h2 font-semibold text-ink">Referral code</h1>
        <ReadRefusal
          error={failure}
          what="This referral code"
          action="see this referral code"
          backHref={REFERRAL_CODES_PATH}
          backLabel="Back to referral codes"
        />
      </div>
    )
  }

  const status = STATUS_WORDS[code.status] ?? { label: code.status, tone: 'neutral' }
  const detail = usesDetail(code)
  const more = Math.max(0, (code.eventCount ?? 0) - (code.events?.length ?? 0))

  return (
    <div>
      {back}
      <p className="mt-2 text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">
        {code.label ? `Referral code: ${code.label}` : 'Referral code'}
      </h1>

      <section aria-labelledby="code-details" className={`mt-6 p-4 sm:p-6 ${PANEL}`}>
        <h2 id="code-details" className="sr-only">
          Details
        </h2>
        <dl className="space-y-3">
          <Fact term="Code">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg break-all">{code.referralCode}</span>
              <CopyCodeButton code={code} />
            </span>
          </Fact>
          <Fact term="Label">{code.label ?? <span className="text-ink-muted">None</span>}</Fact>
          <Fact term="Status">
            <Badge variant={status.tone} srLabel="Status:">
              {status.label}
            </Badge>
          </Fact>
          <Fact term="Works for">
            {code.scope === 'ALL_EVENTS' ? (
              worksForText(code)
            ) : (
              <>
                <ul className="space-y-1">
                  {(code.events ?? []).map((event) => (
                    <li key={event.id}>
                      <Link
                        href={`/admin/events/${encodeURIComponent(event.id)}`}
                        className={TEXT_LINK}
                      >
                        {event.title}
                      </Link>
                    </li>
                  ))}
                </ul>
                {more > 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    and {more.toLocaleString('en-US')} more ({worksForText(code)} in all)
                  </p>
                ) : null}
              </>
            )}
          </Fact>
          <Fact term="Uses">
            <span className="tabular-nums">{usesText(code)}</span>
            {detail ? <span className="block text-sm text-ink-muted">{detail}</span> : null}
          </Fact>
          <Fact term="Booking fees waived">{waivedText(code.waived)}</Fact>
          <Fact term="Expires">
            {code.expiresAt ? (
              <time dateTime={code.expiresAt}>{formatInstant(code.expiresAt)}</time>
            ) : (
              'Never'
            )}
          </Fact>
          <Fact term="Made by">
            {makerName(code.createdBy)},{' '}
            <time dateTime={code.createdAt}>{formatInstant(code.createdAt)}</time>
          </Fact>
          <Fact term="Last changed">
            <time dateTime={code.updatedAt}>{formatInstant(code.updatedAt)}</time>
          </Fact>
        </dl>
      </section>

      <section aria-labelledby="code-switch" className="mt-10">
        <h2 id="code-switch" className="text-lg font-semibold text-ink">
          {code.active ? 'Switch off' : 'Switch on'}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          {code.active
            ? 'A code that is switched off is not accepted by checkouts from then on. Orders already placed with it keep their waiver.'
            : 'Switching it on lets checkouts accept it again, within its expiry and limit.'}
        </p>
        <div className="mt-3">
          <ReferralCodeSwitch code={code} />
        </div>
      </section>

      <section aria-labelledby="code-change" className="mt-10">
        <h2 id="code-change" className="text-lg font-semibold text-ink">
          Change this code
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">
          The code itself cannot change: switch it off and make a new one instead. Orders already
          placed keep their waiver.
        </p>
        <ReferralCodeForm mode="edit" code={code} />
      </section>

      <section aria-labelledby="code-uses" className="mt-10">
        <h2 id="code-uses" className="text-lg font-semibold text-ink">
          Orders placed with this code
        </h2>
        <Uses uses={code.uses ?? []} />
        {pagination && (pagination.hasPreviousPage || pagination.hasNextPage) ? (
          <nav aria-label="Pages of orders" className="mt-6 flex flex-wrap gap-2">
            {pagination.hasPreviousPage ? (
              <Link
                href={listHref(`${REFERRAL_CODES_PATH}/${encodeURIComponent(code.id)}`, {
                  page: page - 1,
                })}
                className={PAGER_LINK_CLASSES}
              >
                Previous page
              </Link>
            ) : null}
            {pagination.hasNextPage ? (
              <Link
                href={listHref(`${REFERRAL_CODES_PATH}/${encodeURIComponent(code.id)}`, {
                  page: page + 1,
                })}
                className={PAGER_LINK_CLASSES}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </div>
  )
}

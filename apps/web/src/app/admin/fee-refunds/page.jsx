/**
 * Booking fee refunds: refunding one order's booking fee by hand (SPEC3 §7.4,
 * §12.6, SPEC3-XI §12.6).
 *
 * For the platform administrators at The Desi Events, finance administrators
 * and super administrators (`platform_fee:refund`). The administration layout
 * admits a finance administrator for this page alone; every other admin page
 * asks its own question and refuses them. The form is `fee-refund-form.jsx`;
 * the API decides again, asks for a second factor and refuses an order's buyer
 * or an administrator of its event's organisation. A refund that does not
 * settle links to its own page only for an account that can open it
 * (`finance:view`, which a platform administrator does not hold).
 *
 * @module app/admin/fee-refunds/page
 */

import { RefusalNotice } from '../../../components/read-refusal.jsx'
import { sessionCan } from '../../../lib/capabilities.js'
import { readSession } from '../../../lib/session.js'
import { FeeRefundForm } from './fee-refund-form.jsx'
import { INTRODUCTION, NOT_FOR_THIS_ACCOUNT } from './fee-refund-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Booking fee refunds', robots: { index: false, follow: false } }

/**
 * The page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function FeeRefundsPage() {
  const session = await readSession()
  const allowed = sessionCan(session, 'platform_fee:refund')
  const canReadRefunds = sessionCan(session, 'finance:view')

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Booking fee refunds</h1>
      {allowed ? (
        <>
          <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>
          <FeeRefundForm canReadRefunds={canReadRefunds} />
        </>
      ) : (
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      )}
    </div>
  )
}

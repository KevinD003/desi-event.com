/**
 * The notice a checkout shows when an order was placed and its payment is not
 * settled: the capture timed out, it was taken and the order could not be
 * completed, or a retry found the attempt still being checked.
 *
 * It says what the API said, in the API's own words, and where the order is.
 * The checkout takes Pay away while it is showing: paying again is the one
 * thing that must not happen, and "try again" is the one thing it must not
 * say. Shared by both checkouts.
 *
 * @module components/unsettled-payment
 */

import Link from 'next/link'

import { orderHref } from '../lib/checkout-outcome.js'
import { OUTLINE_LINK } from './link-classes.js'
import { Alert } from './ui.jsx'

/**
 * The notice.
 *
 * @param {object} props Component props.
 * @param {{title: string, detail: string, orderReference?: string}} props.refusal A `payment-unsettled` refusal.
 * @param {{current: (HTMLElement|null)}} [props.focusRef] Where focus goes once it is drawn.
 * @returns {JSX.Element} The notice.
 */
export function UnsettledPayment({ refusal, focusRef }) {
  const reference = refusal.orderReference ?? null

  return (
    <div ref={focusRef} tabIndex={-1} className="mt-5">
      <Alert variant="warning" title={refusal.title}>
        {refusal.detail}
        <span className="mt-3 block">
          <Link href={orderHref(reference)} className={OUTLINE_LINK}>
            {reference ? `See order ${reference}` : 'See your orders'}
          </Link>
        </span>
      </Alert>
    </div>
  )
}

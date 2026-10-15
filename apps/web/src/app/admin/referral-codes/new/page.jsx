/**
 * Making a referral code (SPEC3 §12.5).
 *
 * The form is `referral-code-form.jsx`; this page gates it on
 * `referral_code:manage` (the administration layout admits finance
 * administrators too, for the booking-fee refunds) and says what a code does.
 * The API decides again, and asks for a second factor, when the code is made.
 *
 * `@file` rather than `@module`: "new" is a reserved word in a module name.
 *
 * @file app/admin/referral-codes/new/page.jsx
 */

import Link from 'next/link'

import { RefusalNotice } from '../../../../components/read-refusal.jsx'
import { TEXT_LINK } from '../../../../components/workspace-kit.jsx'
import { sessionCan } from '../../../../lib/capabilities.js'
import { readSession } from '../../../../lib/session.js'
import { ReferralCodeForm } from '../referral-code-form.jsx'
import { INTRODUCTION, NOT_FOR_THIS_ACCOUNT, REFERRAL_CODES_PATH } from '../referral-vocabulary.js'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Make a referral code', robots: { index: false, follow: false } }

/**
 * The page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function NewReferralCodePage() {
  const session = await readSession()
  const allowed = sessionCan(session, 'referral_code:manage')

  return (
    <div>
      <p className="text-sm">
        <Link href={REFERRAL_CODES_PATH} className={TEXT_LINK}>
          Referral codes
        </Link>
      </p>
      <p className="mt-2 text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Platform administration
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Make a referral code</h1>
      {allowed ? (
        <>
          <p className="mt-2 max-w-3xl text-ink-muted">{INTRODUCTION}</p>
          <ReferralCodeForm mode="create" />
        </>
      ) : (
        <RefusalNotice tone="neutral" title="Not for this account" detail={NOT_FOR_THIS_ACCOUNT} />
      )}
    </div>
  )
}

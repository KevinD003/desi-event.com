/**
 * Payout setup, simulated.
 *
 * This screen is about a sequence that exists entirely inside this deployment.
 * No payment provider is contacted by anything it can reach, no account exists
 * at one, nothing here has been verified by anybody, and there is no link to
 * send anybody to — in this mode there is nowhere to send them.
 *
 * ## Why the heading is outside the try
 *
 * The read is gated on a step-up window, so a refusal is a state this page has
 * to be able to be in rather than an exception it can throw. The `h1` renders
 * unconditionally and the refusal renders as content, which is what
 * `app/finance/page.jsx` already does and why `/finance` survives the
 * accessibility sweep whatever the session's age. A page that threw instead
 * would be a page the sweep could only scan by arranging a fresh window first.
 *
 * ## What it never says
 *
 * Nothing on this screen may read as a claim about a real provider. The state
 * names are borrowed words and are never rendered raw; every one of them is
 * accompanied by the sentence saying what it does not mean, and a standing
 * notice repeats it above them. `connect.test.js` and
 * `packages/schemas/src/connect.test.js` hold the wording to a
 * machine-checkable rule rather than to care.
 *
 * @module app/finance/connect/page
 */

import Link from 'next/link'

import { AsOf, Failure, Forbidden } from '../../../components/page-state.jsx'
import { getConnectStatus } from '../../../lib/connect-api.js'
import {
  connectStateDisclaimer,
  connectStateLabel,
  describeConnectRefusal,
} from '../../../lib/connect-vocabulary.js'
import { connectOrganizations, readSession } from '../../../lib/session.js'
import { ConnectActions } from './connect-actions.jsx'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Payout setup',
  robots: { index: false, follow: false },
}

/**
 * @typedef {object} ConnectPageProps
 * @property {Promise<Record<string, string>>} searchParams The resolved query string.
 */

/**
 * The screen.
 *
 * @param {ConnectPageProps} props Component props.
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function ConnectPage({ searchParams }) {
  const session = await readSession()
  const organizations = connectOrganizations(session)
  const params = (await searchParams) ?? {}

  if (organizations.length === 0) {
    return <Forbidden area="Payout setup" backHref="/finance" backLabel="Back to finance" />
  }

  // The requested organisation intersected with what this session may manage,
  // falling back to the first permitted one. The API's 403 is the control; this
  // is what stops the screen provoking one.
  const selected =
    organizations.find((organization) => organization.organizationId === params.organizationId) ??
    organizations[0]

  let status = null
  let failure = null

  try {
    status = (await getConnectStatus(selected.organizationId)).data ?? null
  } catch (error) {
    failure = describeConnectRefusal(error)
  }

  const readAt = new Date().toISOString()

  return (
    <div>
      <h1 className="text-2xl font-bold text-indigo-night-900">Payout setup</h1>

      <p
        role="note"
        className="mt-4 rounded-card border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      >
        <span className="font-semibold">Everything on this page is simulated.</span> No payment
        provider has been contacted, no account exists at one, nothing has been checked by anybody,
        and this deployment cannot accept payments or send money. There is no setup link to follow,
        because in this mode there is nowhere for one to lead.
      </p>

      {organizations.length > 1 ? (
        <nav aria-label="Choose an organisation" className="mt-6">
          <ul className="flex flex-wrap gap-2">
            {organizations.map((organization) => {
              const current = organization.organizationId === selected.organizationId

              return (
                <li key={organization.organizationId}>
                  <Link
                    href={`/finance/connect?organizationId=${encodeURIComponent(organization.organizationId)}`}
                    aria-current={current ? 'page' : undefined}
                    className={`inline-flex rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none ${
                      current
                        ? 'bg-indigo-night-900 text-white'
                        : 'border border-slate-300 bg-white text-indigo-night-900 hover:bg-slate-50'
                    }`}
                  >
                    {organization.organizationName ?? organization.organizationId}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      ) : null}

      {failure ? <Failure what="The simulated setup state" detail={failure.detail} /> : null}

      {status ? (
        <>
          <AsOf asOf={readAt} />

          <section aria-labelledby="state-heading" className="mt-6">
            <h2 id="state-heading" className="text-lg font-semibold text-indigo-night-900">
              Where the simulation has reached
            </h2>

            <p className="mt-2 text-xl font-medium text-indigo-night-900">
              {connectStateLabel(status.state)}
            </p>

            <p className="mt-2 max-w-3xl text-sm text-slate-700">
              {connectStateDisclaimer(status.state)}
            </p>

            {status.terminal ? (
              <p className="mt-3 max-w-3xl text-sm text-slate-700">
                This is the last step the simulation offers. Nothing in this deployment moves it out
                of here.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="detail-heading" className="mt-8">
            <h2 id="detail-heading" className="text-lg font-semibold text-indigo-night-900">
              What the simulation records
            </h2>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Simulated payout-setup details for{' '}
                  {selected.organizationName ?? 'this organisation'}
                </caption>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <th scope="row" className="py-2 pr-4 font-medium text-slate-700">
                      A simulated record exists
                    </th>
                    <td className="py-2">{status.accountExists ? 'Yes' : 'No'}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th scope="row" className="py-2 pr-4 font-medium text-slate-700">
                      Simulated ability to take payments
                    </th>
                    <td className="py-2">
                      {status.simulatedChargesEnabled ? 'Simulated as available' : 'Not simulated'}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th scope="row" className="py-2 pr-4 font-medium text-slate-700">
                      Simulated ability to receive money
                    </th>
                    <td className="py-2">
                      {status.simulatedPayoutsEnabled ? 'Simulated as available' : 'Not simulated'}
                    </td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <th scope="row" className="py-2 pr-4 font-medium text-slate-700">
                      Simulated outstanding requirements
                    </th>
                    <td className="py-2">{status.requirementsDueCount}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 pr-4 font-medium text-slate-700">
                      Simulated details step reached
                    </th>
                    <td className="py-2">{status.detailsSubmitted ? 'Yes' : 'No'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-3 max-w-3xl text-sm text-slate-700">
              Neither simulated ability means this deployment can do either thing. Nothing that
              moves money reads these values, and no money can move here in any case.
            </p>
          </section>

          <ConnectActions organizationId={selected.organizationId} state={status.state} />
        </>
      ) : null}
    </div>
  )
}

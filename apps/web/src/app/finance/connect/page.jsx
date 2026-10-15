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
import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { TABLE_FRAME } from '../../../components/workspace-kit.jsx'
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
    failure = error
  }

  const readAt = new Date().toISOString()

  return (
    <div>
      <p className="text-micro font-semibold tracking-eyebrow text-accent-strong uppercase">
        Workspace · Money
      </p>
      <h1 className="mt-2 text-h2 font-semibold text-ink">Payout setup</h1>

      <p
        role="note"
        className="mt-4 rounded-card border border-status-warning/30 bg-status-warning-soft p-4 text-sm text-status-warning"
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
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none ${
                      current
                        ? 'bg-action-primary font-semibold text-action-primary-ink shadow-control'
                        : 'border border-line-strong bg-surface-raised text-ink hover:bg-surface-subtle'
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

      {failure?.code === 'NOT_MOCK_MODE' ? (
        // The one refusal only this screen has: its own words say why.
        <Failure what="The simulated setup state" detail={describeConnectRefusal(failure).detail} />
      ) : failure ? (
        // Reading the state sits behind the FINANCE_VIEW step-up window, so a
        // lapsed one is offered the step-up rather than reported as a failure.
        <ReadRefusal
          error={failure}
          what="The simulated setup state"
          action="see where the simulated payout setup has reached"
          backHref="/finance"
          backLabel="Back to finance"
        />
      ) : null}

      {status ? (
        <>
          <AsOf asOf={readAt} />

          <section aria-labelledby="state-heading" className="mt-6">
            <h2 id="state-heading" className="text-xl font-semibold text-ink">
              Where the simulation has reached
            </h2>

            <p className="mt-2 text-xl font-medium text-ink">{connectStateLabel(status.state)}</p>

            <p className="mt-2 max-w-3xl text-sm text-ink-muted">
              {connectStateDisclaimer(status.state)}
            </p>

            {status.terminal ? (
              <p className="mt-3 max-w-3xl text-sm text-ink-muted">
                This is the last step the simulation offers. Nothing in this deployment moves it out
                of here.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="detail-heading" className="mt-8">
            <h2 id="detail-heading" className="text-xl font-semibold text-ink">
              What the simulation records
            </h2>

            {/*
              Focusable, and named. Every other scrolling table in this product
              has links or buttons in its cells, so a keyboard user reaches the
              scroll by tabbing into the content. This one is entirely static
              text, which leaves the container unreachable — axe's
              `scrollable-region-focusable`, and a real defect rather than a rule
              being pedantic: at 320px the second column is off-screen with no
              way to bring it into view without a pointer.
            */}
            <div
              className={`mt-4 ${TABLE_FRAME} focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:outline-none`}
              tabIndex={0}
              role="region"
              aria-labelledby="detail-heading"
            >
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <caption className="sr-only">
                  Simulated payout-setup details for{' '}
                  {selected.organizationName ?? 'this organisation'}
                </caption>
                <tbody>
                  <tr className="border-b border-line">
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-muted">
                      A simulated record exists
                    </th>
                    <td className="py-2">{status.accountExists ? 'Yes' : 'No'}</td>
                  </tr>
                  <tr className="border-b border-line">
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-muted">
                      Simulated ability to take payments
                    </th>
                    <td className="py-2">
                      {status.simulatedChargesEnabled ? 'Simulated as available' : 'Not simulated'}
                    </td>
                  </tr>
                  <tr className="border-b border-line">
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-muted">
                      Simulated ability to receive money
                    </th>
                    <td className="py-2">
                      {status.simulatedPayoutsEnabled ? 'Simulated as available' : 'Not simulated'}
                    </td>
                  </tr>
                  <tr className="border-b border-line">
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-muted">
                      Simulated outstanding requirements
                    </th>
                    <td className="py-2">{status.requirementsDueCount}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="py-2 pr-4 font-medium text-ink-muted">
                      Simulated details step reached
                    </th>
                    <td className="py-2">{status.detailsSubmitted ? 'Yes' : 'No'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="mt-3 max-w-3xl text-sm text-ink-muted">
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

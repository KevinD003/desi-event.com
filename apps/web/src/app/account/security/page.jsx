/**
 * Account and security: two-step sign-in, where the account is signed in,
 * and the password.
 *
 * Three independent reads, each shown or refused on its own. A failure to list
 * devices is not a reason to hide the second-factor controls, and a page that
 * went blank because one of three requests failed would be a page nobody could
 * use to recover an account in the moment they needed to.
 *
 * Nothing here is a credential the browser keeps: the only secrets on this page
 * — a new TOTP secret and recovery codes — are shown once by `two-step.jsx` and
 * never stored.
 *
 * There is no "forgot password" here, and no email change. The API has routes
 * for resetting a password by email, but this build has no email service to
 * deliver the link, so offering it would be offering something that never
 * arrives.
 *
 * @module app/account/security/page
 */

import { ReadRefusal } from '../../../components/read-refusal.jsx'
import { callApi } from '../../../lib/organizer-api.js'
import { ChangePassword } from './change-password.jsx'
import { SessionsPanel } from './sessions-panel.jsx'
import { TwoStep } from './two-step.jsx'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Account security', robots: { index: false, follow: false } }

/**
 * One read, settled.
 *
 * @param {string} path The API path.
 * @returns {Promise<{data: unknown, error: object|null}>} The data, or why not.
 */
async function read(path) {
  try {
    const body = await callApi(path)

    return { data: body?.data ?? null, error: null }
  } catch (error) {
    return { data: null, error }
  }
}

/**
 * A section heading and its body.
 *
 * @param {object} props Component props.
 * @param {string} props.id The heading id.
 * @param {string} props.title The heading.
 * @param {string} [props.intro] One sentence about it.
 * @param {ReactNode} props.children The body.
 * @returns {JSX.Element} The section.
 */
function Section({ id, title, intro, children }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      {intro ? <p className="mt-1 max-w-prose text-ink-muted">{intro}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/**
 * The account security page.
 *
 * @returns {Promise<JSX.Element>} The rendered page.
 */
export default async function AccountSecurityPage() {
  const [mfa, sessions, devices] = await Promise.all([
    read('/v1/auth/mfa'),
    read('/v1/auth/sessions'),
    read('/v1/auth/devices'),
  ])

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Account security</h1>
      <p className="mt-2 max-w-prose text-ink-muted">
        How you sign in, and where you are signed in now.
      </p>

      <Section
        id="security-two-step"
        title="Two-step sign-in"
        intro="A code from an app on your phone, asked for as well as your password."
      >
        {mfa.error ? (
          <ReadRefusal
            error={mfa.error}
            what="Your sign-in settings"
            action="see your sign-in settings"
          />
        ) : (
          <TwoStep required={Boolean(mfa.data?.required)} factors={mfa.data?.factors ?? []} />
        )}
      </Section>

      <Section
        id="security-sessions"
        title="Where you are signed in"
        intro="End any session you do not recognise. It stops working at once."
      >
        {sessions.error || devices.error ? (
          <ReadRefusal
            error={sessions.error ?? devices.error}
            what="Your sessions and devices"
            action="see where you are signed in"
          />
        ) : (
          <SessionsPanel sessions={sessions.data ?? []} devices={devices.data ?? []} />
        )}
      </Section>

      <Section id="security-password" title="Password">
        <ChangePassword />
      </Section>
    </div>
  )
}

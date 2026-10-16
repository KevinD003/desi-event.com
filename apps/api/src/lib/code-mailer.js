/**
 * Email a show-once code.
 *
 * The `deliver` hook `buildApp` hands to the routes that issue codes when the
 * deployment sets `DELIVERY_MODE=EMAIL` and names an SMTP server. It turns the
 * route's message — a purpose, an address, the code and what the letter needs
 * to say — into one of the letters in `@desi-event/schemas/code-letters`, and
 * gives it to the mail provider. The same module composes the words a person
 * copies in `MANUAL` mode, so the two cannot drift apart.
 *
 * Three purposes, and nothing else: an organiser invitation, a team
 * invitation and a ticket transfer. An unknown purpose, or a letter missing a
 * field it needs, throws before anything is sent — failing closed, so the
 * route withdraws what it issued (`deliverOrWithdraw`) rather than mailing a
 * half-written letter.
 *
 * Account confirmation and password-reset links are never sent from here, in
 * any mode: those are links that carry a token, and a credential never goes in
 * a URL.
 *
 * Nothing here logs. The message holds the code.
 *
 * @module @desi-event/api/lib/code-mailer
 */

import { createSmtpEmailProvider } from '@desi-event/providers'
import {
  assertJoinUrl,
  organizerInvitationLetter,
  teamInvitationLetter,
  ticketTransferLetter,
} from '@desi-event/schemas/code-letters'

/**
 * Where each code is typed, on the web.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CODE_JOIN_PATHS = Object.freeze({
  ORGANIZER_INVITATION: '/account/organizations/new',
  TEAM_INVITATION: '/account/invitations',
  'ticket-transfer': '/tickets/accept',
})

/**
 * The letter for one message, and who it goes to.
 *
 * @param {object} message What the route handed over, with `token` holding the code.
 * @param {string} webOrigin The web app's origin.
 * @returns {{to: string, subject: string, text: string}} The letter.
 * @throws {TypeError} For an unknown purpose or a missing field.
 */
export function composeCodeLetter(message, webOrigin) {
  const path = CODE_JOIN_PATHS[message?.purpose]

  if (!path || !Object.hasOwn(CODE_JOIN_PATHS, message.purpose)) {
    throw new TypeError(`There is no letter for the purpose ${JSON.stringify(message?.purpose)}.`)
  }

  const joinUrl = assertJoinUrl(new URL(path, webOrigin).href)

  if (message.purpose === 'ORGANIZER_INVITATION') {
    return {
      to: message.email,
      ...organizerInvitationLetter({
        code: message.token,
        email: message.email,
        organizationName: message.organizationName,
        expiresAt: message.expiresAt,
        note: message.note ?? null,
        inviterName: message.inviterName ?? null,
        joinUrl,
      }),
    }
  }

  if (message.purpose === 'TEAM_INVITATION') {
    return {
      to: message.email,
      ...teamInvitationLetter({
        code: message.token,
        email: message.email,
        organizationName: message.organizationName,
        organizationVerified: message.organizationVerified,
        role: message.role,
        expiresAt: message.expiresAt,
        events: message.events ?? [],
        joinUrl,
      }),
    }
  }

  return {
    to: message.to,
    ...ticketTransferLetter({
      code: message.token,
      to: message.to,
      expiresAt: message.expiresAt,
      message: message.message ?? null,
      joinUrl,
    }),
  }
}

/**
 * Build the `deliver` hook over an email provider.
 *
 * @param {object} options Inputs.
 * @param {{send: function(object): (object|Promise<object>)}} options.provider The email provider.
 * @param {string} options.webOrigin The web app's origin, for the join page's address.
 * @returns {function(object): Promise<void>} The hook: resolves once the provider took the letter.
 * @throws {TypeError} When the provider or the origin is unusable.
 */
export function createCodeMailer({ provider, webOrigin }) {
  if (!provider || typeof provider.send !== 'function') {
    throw new TypeError('createCodeMailer needs an email provider with send().')
  }

  // Checked once, at boot, with a path that is always there.
  assertJoinUrl(new URL(CODE_JOIN_PATHS.TEAM_INVITATION, webOrigin).href)

  return async function deliver(message) {
    const { to, subject, text } = composeCodeLetter(message, webOrigin)

    await provider.send({ to, subject, text })
  }
}

/**
 * The mailer this environment asks for, or `undefined`.
 *
 * Only when `DELIVERY_MODE` is `EMAIL` **and** an SMTP server is named: email
 * is opt-in and never inferred, so SMTP settings on their own change nothing.
 * The environment schema has already insisted on `SMTP_FROM`, an absolute
 * `WEB_ORIGIN`, a user and password together, and TLS in production.
 *
 * @param {object} env The parsed API environment.
 * @param {object} [options] Inputs for tests.
 * @param {function(object): object} [options.createProvider] Builds the provider; the SMTP adapter by default.
 * @returns {(function(object): Promise<void>)|undefined} The hook, or undefined.
 */
export function codeMailerFromEnv(env, { createProvider = createSmtpEmailProvider } = {}) {
  if (env?.DELIVERY_MODE !== 'EMAIL' || !env?.SMTP_HOST) return undefined

  const provider = createProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    requireTLS: env.SMTP_REQUIRE_TLS,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    from: env.SMTP_FROM,
  })

  return createCodeMailer({ provider, webOrigin: env.WEB_ORIGIN })
}

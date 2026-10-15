/**
 * An email provider that hands messages to an SMTP server.
 *
 * The one adapter in this package besides Stripe that performs I/O. It exists
 * for exactly one job: sending the show-once codes (organiser invitations,
 * team invitations, ticket transfers) when a deployment sets
 * `DELIVERY_MODE=EMAIL` and names a mail server. Nothing else in the platform
 * sends email.
 *
 * Three properties matter more than features:
 *
 *   - **The body never leaves this module except to the server.** The message
 *     carries a code. nodemailer's own logger and debug output are switched
 *     off, because an SMTP transcript contains the DATA section verbatim, and
 *     every transport error is rebuilt as a `ProviderError` carrying only the
 *     server's status (`code`, `responseCode`, `command`), never the text it
 *     was sent.
 *   - **It refuses the same messages as the in-memory provider**, in the same
 *     words, because both validate through `normaliseEmailMessage`. A bad
 *     address is refused before any connection is opened.
 *   - **Bounded.** Connection, greeting and socket timeouts are explicit, so a
 *     mail server that stops answering costs a request seconds rather than
 *     holding it open indefinitely.
 *
 * Letters are UTF-8 `text/plain`, encoded quoted-printable: organisation names
 * in Gujarati or Devanagari arrive as written, and the code, which is ASCII,
 * stays readable on its own line in the raw message.
 *
 * @module @desi-event/providers/smtp
 */

import { createTransport } from 'nodemailer'

import { DEFAULT_EMAIL_FROM, normaliseEmailMessage } from './email.js'
import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js'
import { freezeRecord, isPlainObject } from './internal.js'

/** Milliseconds to wait for the TCP connection. */
export const SMTP_CONNECTION_TIMEOUT_MS = 10_000

/** Milliseconds to wait for the server's greeting once connected. */
export const SMTP_GREETING_TIMEOUT_MS = 10_000

/** Milliseconds of socket inactivity before the send is abandoned. */
export const SMTP_SOCKET_TIMEOUT_MS = 20_000

/**
 * @typedef {object} SmtpEmailProviderOptions
 * @property {string} host The mail server's host name or address.
 * @property {number} [port] Its port; 587 by default.
 * @property {boolean} [secure] TLS from the first byte (usually port 465).
 * @property {boolean} [requireTLS] Refuse to send unless STARTTLS succeeds. Ignored when `secure` is true.
 * @property {{user: string, pass: string}} [auth] Credentials, when the server asks for them.
 * @property {string} [from] The sender address; `no-reply@thedesievents.com` by default.
 * @property {string} [name] Adapter name, recorded on receipts and errors.
 * @property {number} [connectionTimeoutMs] Override for {@link SMTP_CONNECTION_TIMEOUT_MS}.
 * @property {number} [greetingTimeoutMs] Override for {@link SMTP_GREETING_TIMEOUT_MS}.
 * @property {number} [socketTimeoutMs] Override for {@link SMTP_SOCKET_TIMEOUT_MS}.
 * @property {object} [transport] A nodemailer transporter to use instead of building one; for tests.
 */

/**
 * The parts of a transport error that are safe to keep.
 *
 * Status, never content: nodemailer attaches the server's full reply and,
 * for some failures, the command it was sending. The reply to `DATA` can echo
 * what was sent, so only the machine-readable fields survive.
 *
 * @param {unknown} error What the transport threw.
 * @returns {{code: (string|null), responseCode: (number|null), command: (string|null)}} The safe fields.
 */
function safeTransportDetails(error) {
  const raw = /** @type {{code?: unknown, responseCode?: unknown, command?: unknown}} */ (
    error ?? {}
  )
  const command = typeof raw.command === 'string' ? raw.command.split(/\s/u)[0] : null

  return {
    code: typeof raw.code === 'string' ? raw.code : null,
    responseCode: Number.isInteger(raw.responseCode)
      ? /** @type {number} */ (raw.responseCode)
      : null,
    // The verb only ("RCPT", "DATA"), never its argument, which may be an address.
    command: command && /^[A-Z]{3,8}$/u.test(command) ? command : null,
  }
}

/**
 * Validate the construction options.
 *
 * @param {unknown} options Candidate options.
 * @returns {void}
 * @throws {ProviderError} `INVALID_OPTIONS` naming the field.
 */
function assertOptions(options) {
  if (!isPlainObject(options)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'createSmtpEmailProvider expects an options object',
    )
  }

  const { host, port, auth, transport } = /** @type {SmtpEmailProviderOptions} */ (options)

  if (!transport && (typeof host !== 'string' || host.trim() === '')) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'An SMTP provider needs `host`: the mail server to send through',
      { details: { field: 'host' } },
    )
  }

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'Expected `port` to be an integer between 1 and 65535',
      { details: { field: 'port' } },
    )
  }

  if (
    auth !== undefined &&
    (!isPlainObject(auth) || typeof auth.user !== 'string' || typeof auth.pass !== 'string')
  ) {
    // The values are not echoed: one of them is a password.
    throw new ProviderError(
      PROVIDER_ERROR_CODES.INVALID_OPTIONS,
      'Expected `auth` to carry `user` and `pass` as strings',
      { details: { field: 'auth' } },
    )
  }
}

/**
 * Create an email provider that sends through an SMTP server.
 *
 * @param {SmtpEmailProviderOptions} options Construction options.
 * @returns {{name: string, from: string, send: function(object): Promise<object>, close: function(): void}} The provider. `send` is async and resolves to an `EmailReceipt`.
 * @throws {ProviderError} `INVALID_OPTIONS` for unusable options; `INVALID_RECIPIENT` for an unusable `from`.
 */
export function createSmtpEmailProvider(options) {
  assertOptions(options)

  const {
    host,
    port = 587,
    secure = false,
    requireTLS = true,
    auth,
    from = DEFAULT_EMAIL_FROM,
    name = 'smtp-email',
    connectionTimeoutMs = SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeoutMs = SMTP_GREETING_TIMEOUT_MS,
    socketTimeoutMs = SMTP_SOCKET_TIMEOUT_MS,
    transport,
  } = options

  // Validated through the same rules as a message's own sender, so a
  // misconfigured SMTP_FROM fails at boot rather than at the first invitation.
  const { from: defaultFrom } = normaliseEmailMessage(
    { to: 'sender-check@desi-event.test', from, subject: 'sender check', text: 'sender check' },
    { name, defaultFrom: from },
  )

  const transporter =
    transport ??
    createTransport({
      host,
      port,
      secure,
      // STARTTLS is demanded unless the connection is TLS from the start.
      requireTLS: secure ? false : requireTLS,
      ...(auth ? { auth: { user: auth.user, pass: auth.pass } } : {}),
      connectionTimeout: connectionTimeoutMs,
      greetingTimeout: greetingTimeoutMs,
      socketTimeout: socketTimeoutMs,
      // An SMTP transcript holds the message body, and the body holds a code.
      logger: false,
      debug: false,
    })

  /**
   * Send one message.
   *
   * @param {object} message The message: `to`, `subject`, and `text` or `html`.
   * @returns {Promise<object>} An `EmailReceipt`.
   * @throws {ProviderError} `INVALID_MESSAGE` / `INVALID_RECIPIENT` before any connection; `SEND_FAILED` when the server does not take it.
   */
  async function send(message) {
    const normalised = normaliseEmailMessage(message, { name, defaultFrom })

    let info

    try {
      info = await transporter.sendMail({
        from: normalised.from,
        to: normalised.to,
        ...(normalised.cc.length > 0 ? { cc: normalised.cc } : {}),
        ...(normalised.bcc.length > 0 ? { bcc: normalised.bcc } : {}),
        ...(normalised.replyTo ? { replyTo: normalised.replyTo } : {}),
        subject: normalised.subject,
        ...(normalised.text !== null ? { text: normalised.text } : {}),
        ...(normalised.html !== null ? { html: normalised.html } : {}),
        // UTF-8, quoted-printable: readable scripts, and the ASCII code on its
        // own line stays intact in the raw message.
        textEncoding: 'quoted-printable',
      })
    } catch (error) {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.SEND_FAILED,
        'The mail server did not accept the message',
        // Deliberately no `cause`: the transport's error carries the server's
        // reply text, and whatever logs this error would log that too.
        { provider: name, details: safeTransportDetails(error) },
      )
    }

    const accepted = Array.isArray(info?.accepted)
      ? info.accepted.map((entry) => (typeof entry === 'string' ? entry : String(entry?.address)))
      : [...normalised.to]

    return /** @type {object} */ (
      freezeRecord({
        id: String(info?.messageId ?? ''),
        providerRef: String(info?.messageId ?? ''),
        accepted,
        status: 'SENT',
        sentAt: new Date().toISOString(),
      })
    )
  }

  /**
   * Close any pooled connection the transporter holds.
   *
   * @returns {void}
   */
  function close() {
    if (typeof transporter.close === 'function') transporter.close()
  }

  return { name, from: defaultFrom, send, close }
}

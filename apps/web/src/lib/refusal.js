/**
 * What an API refusal means to the person who met it.
 *
 * Every screen used to translate refusals for itself — the privacy screens in
 * `privacy-vocabulary.js`, payout setup in `connect-vocabulary.js`, the door in
 * `door.js`, and most screens not at all, so a lapsed step-up on a finance page
 * read the same as a server fault. This is the shared translation, keyed on
 * what the API actually sends: the HTTP status, the machine-readable `code`
 * from `API_ERRORS` in `packages/api-contract/src/routes.js` and the codes the
 * auth plugin adds (`STEP_UP_REQUIRED`, `MFA_ENROLMENT_REQUIRED`,
 * `CAPABILITY_SCOPE_MISSING`), and `Retry-After` when there is one.
 *
 * Each refusal maps to one of the named states the interface draws, so a
 * given kind of failure looks and reads the same wherever it happens:
 *
 * | state                  | from                                              |
 * |------------------------|---------------------------------------------------|
 * | `payment-unsettled`    | 502 `PAYMENT_TIMEOUT`, 500 `ORDER_NOT_COMPLETED`, |
 * |                        | 409 `ORDER_PENDING`                               |
 * | `payment-declined`     | 402                                               |
 * | `auth-required`        | 401                                               |
 * | `mfa-enrolment`        | 403 `MFA_ENROLMENT_REQUIRED`                      |
 * | `step-up`              | 403 `STEP_UP_REQUIRED`                            |
 * | `permission-denied`    | any other 403                                     |
 * | `not-found`            | 404                                               |
 * | `stale`                | 409                                               |
 * | `expired`              | 410 `HOLD_EXPIRED`, `TRANSFER_EXPIRED`            |
 * | `validation`           | 400, 422                                          |
 * | `rate-limited`         | 429                                               |
 * | `network`              | no response; 503 `API_UNREACHABLE` from the proxy |
 * | `server-error`         | 500, 502, 503, anything unknown                   |
 *
 * The words say what happened and what the person can do, and never name an
 * endpoint, an email address or a phone number that does not exist. Where the
 * API's own message is more specific than the generic one (a 409 or 422 always
 * is), `detail` carries it.
 *
 * `payment-unsettled` is checked before the status, because its three codes
 * arrive as a 409, a 500 and a 502 and mean one thing: an order was placed,
 * whether it was paid is being checked, and pressing Pay again is the one
 * thing that must not happen. It is never `recoverable`, and it carries the
 * order's reference when the API sent one, so the screen can link to it.
 *
 * @module lib/refusal
 */

/**
 * @typedef {object} Refusal
 * @property {string} state One of the states in the table above.
 * @property {string} title A short heading.
 * @property {string} detail What happened, and what can be done about it.
 * @property {boolean} recoverable Whether trying again (after doing what `detail` says) can succeed.
 * @property {number|null} retryAfterSeconds For `rate-limited`, how long to wait, when the API said.
 * @property {string} [orderReference] For `payment-unsettled`, the order the API named.
 */

/**
 * Checkout codes that mean an order exists and its payment is not settled.
 *
 * @type {ReadonlySet<string>}
 */
const UNSETTLED_PAYMENT_CODES = new Set(['PAYMENT_TIMEOUT', 'ORDER_NOT_COMPLETED', 'ORDER_PENDING'])

/**
 * An order reference the API sent, when it is one.
 *
 * @param {unknown} value The value.
 * @returns {string|null} The reference, or null.
 */
function orderReferenceFrom(value) {
  return typeof value === 'string' && /^[A-Z0-9-]{4,32}$/u.test(value) ? value : null
}

/**
 * How long a `Retry-After` header asks for, in seconds.
 *
 * Accepts the delta-seconds form and the HTTP-date form. Anything else, or a
 * value in the past, is no answer.
 *
 * @param {string|null|undefined} value The header.
 * @param {number} [now] The current time, for the date form.
 * @returns {number|null} Whole seconds, or null.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (typeof value !== 'string' || value.trim() === '') return null

  const trimmed = value.trim()

  if (/^\d+$/.test(trimmed)) return Number(trimmed)

  const at = Date.parse(trimmed)

  if (Number.isNaN(at)) return null

  const seconds = Math.ceil((at - now) / 1000)

  return seconds > 0 ? seconds : null
}

/**
 * A wait, in words a person would use.
 *
 * @param {number} seconds Whole seconds.
 * @returns {string} "a few seconds", "about a minute", "about 3 minutes"…
 */
export function describeWait(seconds) {
  if (seconds <= 10) return 'a few seconds'
  if (seconds < 90) return 'about a minute'
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} minutes`

  return `about ${Math.round(seconds / 3600)} hours`
}

/**
 * The API's own message, when it is worth showing.
 *
 * Only a string, trimmed, and never one that repeats a generic status line.
 *
 * @param {object|null|undefined} error The error.
 * @returns {string|null} The message, or null.
 */
function specificMessage(error) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''

  if (!message || /^The API answered \d{3}\.?$/.test(message)) return null

  return message
}

/**
 * Translate a refusal.
 *
 * @param {object|null|undefined} error What `callApi` threw or `apiFetch` answered:
 *   `{ status?, code?, message?, retryAfterSeconds? }`. A missing status means
 *   no response arrived at all.
 * @returns {Refusal} What to show.
 */
export function describeApiRefusal(error) {
  const status = Number.isInteger(error?.status) ? error.status : 0
  const code = typeof error?.code === 'string' ? error.code : null
  const retryAfterSeconds = Number.isFinite(error?.retryAfterSeconds)
    ? error.retryAfterSeconds
    : null

  if (code && UNSETTLED_PAYMENT_CODES.has(code)) {
    const orderReference = orderReferenceFrom(error?.orderReference)

    return {
      state: 'payment-unsettled',
      title: 'Please do not pay again',
      detail:
        specificMessage(error) ??
        'Whether this payment went through is being checked. Please do not pay again; your orders show where it stands.',
      recoverable: false,
      retryAfterSeconds: null,
      ...(orderReference ? { orderReference } : {}),
    }
  }

  // A code could not be emailed, so the API withdrew what it had issued: the
  // sentence says that, and that nothing reached anybody. A 503 is otherwise a
  // server error whose wording is replaced, which would hide both.
  if (code === 'DELIVERY_FAILED') {
    return {
      state: 'delivery-failed',
      title: 'The email could not be sent',
      detail:
        specificMessage(error) ??
        'The email could not be sent, so what it carried was withdrawn and nothing reached them. Try again in a few minutes.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  // Not this person going too fast: the address has been sent its codes for
  // the day by anybody at all, so the generic "wait a moment" would be wrong.
  if (code === 'RECIPIENT_DAILY_LIMIT') {
    return {
      state: 'recipient-limit',
      title: 'That address has had its codes for today',
      detail:
        specificMessage(error) ??
        'This address has already been sent three codes from Desi-Event today. Try again tomorrow.',
      recoverable: false,
      retryAfterSeconds,
    }
  }

  if (status === 0 || code === 'API_UNREACHABLE') {
    return {
      state: 'network',
      title: 'The service is not answering',
      detail:
        'Nothing reached Desi-Event, so nothing was changed. Check your connection, then try again.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 401) {
    return {
      state: 'auth-required',
      title: 'You are signed out',
      detail: 'Your session ended. Sign in again to carry on; nothing was changed.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 402) {
    return {
      state: 'payment-declined',
      title: 'The payment was declined',
      detail:
        specificMessage(error) ??
        'The payment was declined, and nothing was charged. You can try again.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 403 && code === 'MFA_ENROLMENT_REQUIRED') {
    return {
      state: 'mfa-enrolment',
      title: 'Two-step sign-in is needed first',
      detail:
        'A role this account holds needs a second factor before it can do this. Set one up from your account security page, then come back.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 403 && code === 'STEP_UP_REQUIRED') {
    return {
      state: 'step-up',
      title: 'Confirm it is you',
      detail:
        'This needs a recent confirmation of your password and second factor. The window is kept short on purpose, so it lapses and has to be reopened.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 403) {
    return {
      state: 'permission-denied',
      title: 'Not for this account',
      detail:
        'This account does not hold what this needs here. If you think it should, ask whoever runs the organisation — nothing on this page can grant it.',
      recoverable: false,
      retryAfterSeconds: null,
    }
  }

  if (status === 404) {
    return {
      state: 'not-found',
      title: 'Not found',
      detail:
        'There is nothing here to show. The answer is the same whether it does not exist or is not yours to see.',
      recoverable: false,
      retryAfterSeconds: null,
    }
  }

  if (status === 409) {
    return {
      state: 'stale',
      title: 'It changed while you were looking',
      detail:
        specificMessage(error) ??
        'Something moved on between reading this page and acting on it. Reload to see where it stands now; the attempt changed nothing.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 410) {
    return {
      state: 'expired',
      title: code === 'HOLD_EXPIRED' ? 'The hold ran out' : 'This has expired',
      detail:
        specificMessage(error) ??
        'It lapsed before it was finished. Start again from the beginning; nothing was taken.',
      recoverable: false,
      retryAfterSeconds: null,
    }
  }

  // A file refused for its size or its kind: the person chose the wrong file,
  // and choosing another is the fix. Fastify's own wording for the two is a
  // status line rather than a sentence, so it is replaced; the API's is kept.
  if (status === 413 || status === 415) {
    const generic = /^(Unsupported Media Type|Request body is too large)\.?$/iu
    const own = specificMessage(error)

    return {
      state: 'validation',
      title: 'That file was not accepted',
      detail:
        own && !generic.test(own)
          ? own
          : status === 413
            ? 'The file is larger than this accepts. Choose a smaller one and try again.'
            : 'That kind of file is not accepted here. Choose a JPEG, PNG or WebP picture.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 400 || status === 422) {
    return {
      state: 'validation',
      title: 'That was not accepted',
      detail: specificMessage(error) ?? 'Check what you entered and try again.',
      recoverable: true,
      retryAfterSeconds: null,
    }
  }

  if (status === 429) {
    return {
      state: 'rate-limited',
      title: 'Too many attempts',
      detail:
        retryAfterSeconds != null
          ? `Wait ${describeWait(retryAfterSeconds)}, then try again. Nothing was changed.`
          : 'Wait a little, then try again. Nothing was changed.',
      recoverable: true,
      retryAfterSeconds,
    }
  }

  return {
    state: 'server-error',
    title: 'Something went wrong at our end',
    detail:
      'The service could not finish this. It may be momentary; try again. If it keeps happening, nothing you do on this page will fix it.',
    recoverable: status === 0 || status >= 500,
    retryAfterSeconds: null,
  }
}

/**
 * Read a failed `fetch` response into the shape `describeApiRefusal` takes.
 *
 * For client components using `apiFetch`, whose failures arrive as responses
 * rather than as thrown errors.
 *
 * @param {Response} response A response that was not ok.
 * @returns {Promise<{status: number, code: string|null, message: string|null, retryAfterSeconds: number|null, orderReference?: string}>} The error; `orderReference` only when the API named an order.
 */
export async function refusalFromResponse(response) {
  const body = await response.json().catch(() => null)
  const orderReference = orderReferenceFrom(body?.error?.orderReference)

  return {
    status: response.status,
    code: body?.error?.code ?? body?.code ?? null,
    message: body?.error?.message ?? null,
    // Optional chaining: a test double, or a response built by hand, may have no headers.
    retryAfterSeconds: parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
    ...(orderReference ? { orderReference } : {}),
  }
}

/**
 * The sentence to show for a refused mutation, from its status and parsed body.
 *
 * For forms that print the API's own message: a 409 or 422 message is the most
 * specific thing anybody can say ("That slug is taken"), and passes through.
 * But the auth plugin's refusals name endpoints — "Authenticate at
 * /v1/auth/step-up", "Enrol one at /v1/auth/mfa/totp" — and a server error's
 * message is not for a person at all. Those are replaced by the vocabulary's
 * words, which say what to do on this site instead.
 *
 * @param {number} status The response status.
 * @param {object|null} body The parsed response body.
 * @param {string} fallback What to say when the API said nothing usable.
 * @param {number|null} [retryAfterSeconds] The response's `Retry-After`, parsed, so a rate limit can say how long.
 * @returns {string} The sentence.
 */
export function refusalSentence(status, body, fallback, retryAfterSeconds = null) {
  const code = body?.error?.code ?? null
  const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : ''
  const refusal = describeApiRefusal({ status, code, message, retryAfterSeconds })

  if (REPLACED_STATES.has(refusal.state)) return refusal.detail
  // A refused file's sentence is already the best one: the API's own when it
  // said something, the vocabulary's when all it had was a status line.
  if (status === 413 || status === 415) return refusal.detail

  return message || fallback
}

/** The states whose API message is replaced rather than shown. */
const REPLACED_STATES = new Set([
  'network',
  'auth-required',
  'mfa-enrolment',
  'step-up',
  'rate-limited',
  'server-error',
])

/**
 * A validation refusal's issues, keyed by the field they are about.
 *
 * The API names each issue's field with a dotted path (`maxPerOrder`,
 * `sessions.0.endsAt`). A form wants the first segment, to put the message
 * under the box it belongs to; the first message for a field wins, which is
 * the one the schema found first.
 *
 * @param {object|null} body The parsed error body.
 * @returns {Record<string, string>} Messages by field name; empty when there are none.
 */
export function fieldIssues(body) {
  /** @type {Record<string, string>} */
  const byField = {}

  for (const issue of body?.error?.issues ?? []) {
    const path = String(issue?.path ?? '')
      .replace(/^\/+/u, '')
      .replace(/^(body|query|querystring|params)[./]/u, '')
    const field = path.split(/[./]/u)[0]

    if (field && typeof issue?.message === 'string' && !(field in byField)) {
      byField[field] = issue.message
    }
  }

  return byField
}

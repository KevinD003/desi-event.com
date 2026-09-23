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
 * @module lib/refusal
 */

/**
 * @typedef {object} Refusal
 * @property {string} state One of the states in the table above.
 * @property {string} title A short heading.
 * @property {string} detail What happened, and what can be done about it.
 * @property {boolean} recoverable Whether trying again (after doing what `detail` says) can succeed.
 * @property {number|null} retryAfterSeconds For `rate-limited`, how long to wait, when the API said.
 */

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
 * @returns {Promise<{status: number, code: string|null, message: string|null, retryAfterSeconds: number|null}>} The error.
 */
export async function refusalFromResponse(response) {
  const body = await response.json().catch(() => null)

  return {
    status: response.status,
    code: body?.error?.code ?? body?.code ?? null,
    message: body?.error?.message ?? null,
    // Optional chaining: a test double, or a response built by hand, may have no headers.
    retryAfterSeconds: parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
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
 * @returns {string} The sentence.
 */
export function refusalSentence(status, body, fallback) {
  const code = body?.error?.code ?? null
  const message = typeof body?.error?.message === 'string' ? body.error.message.trim() : ''
  const refusal = describeApiRefusal({ status, code, message })

  if (REPLACED_STATES.has(refusal.state)) return refusal.detail

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

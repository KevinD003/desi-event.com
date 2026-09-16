/**
 * The outbox state machine.
 *
 * A notification outbox exists to make two guarantees hold at once: a message
 * is never sent for something that did not happen, and something that happened
 * is never silently not announced. The first is bought by writing the outbox
 * row inside the same transaction as the business change. The second is what
 * this module is about.
 *
 * ## Why a lease, and not a status
 *
 * The obvious design is a `SENDING` status: a worker flips the row to SENDING,
 * sends, flips it to SENT. It fails the moment a worker dies mid-send. The row
 * sits in SENDING forever, and nothing can tell "a worker is sending this right
 * now" from "a worker died four hours ago", because both look identical.
 *
 * So a claim carries a **lease**: an owner and an expiry. Claiming is a
 * conditional `UPDATE` that matches only rows which are due and unleased (or
 * whose lease has lapsed), and compares the affected-row count. Two workers
 * issuing that statement for the same row are serialised by PostgreSQL; the
 * loser updates nothing and moves on. A worker that dies leaves a lease that
 * expires, and the row becomes claimable again without anybody having to decide
 * that it failed.
 *
 * ## Why a deterministic key
 *
 * `dedupeKey` is unique, so at-least-once delivery of a job produces
 * exactly-once delivery of a message. The key is derived from four things —
 * the business event, the recipient, the channel and the template version —
 * because each one changes the answer to "is this the same message?":
 *
 *   - **business event**: two different things happened, so two messages.
 *   - **recipient**: the same cancellation owes an email to each buyer.
 *   - **channel**: an email and an SMS about one event are two deliveries.
 *   - **template version**: a template rewritten enough to be worth re-sending
 *     is a new message; one merely reworded is not, and the version is how an
 *     author says which.
 *
 * ## Why permanent and transient are separated
 *
 * A bounced address will bounce identically forever; a provider timeout will
 * not. Retrying the first five times just delays the moment somebody notices,
 * and *not* retrying the second loses a message for no reason. So every failure
 * is classified, and only `TRANSIENT` is retried.
 *
 * Nothing here touches a database or a provider. It decides; the caller writes.
 *
 * @module @desi-event/notifications/outbox
 */

/**
 * Every state a message can be in.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OUTBOX_STATES = Object.freeze({
  /** Written, due, nobody has it. */
  QUEUED: 'QUEUED',
  /** A worker holds a lease on it. */
  CLAIMED: 'CLAIMED',
  /** The provider accepted it. Terminal. */
  SENT: 'SENT',
  /** A transient failure with attempts left; `scheduledFor` says when. */
  RETRY_SCHEDULED: 'RETRY_SCHEDULED',
  /** Withdrawn before it was sent. Terminal. */
  CANCELLED: 'CANCELLED',
  /** A permanent failure. Terminal until an operator intervenes. */
  FAILED: 'FAILED',
  /** Out of attempts. Waits for a human. */
  DEAD_LETTER: 'DEAD_LETTER',
  /** Suppressed by the recipient's preferences. Terminal. */
  SUPPRESSED: 'SUPPRESSED',
})

/**
 * How a failure is classified.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FAILURE_CATEGORIES = Object.freeze({
  /** Will recur identically. Not retried. */
  PERMANENT: 'PERMANENT',
  /** May clear on its own. Retried with backoff. */
  TRANSIENT: 'TRANSIENT',
})

/**
 * What each state may become.
 *
 * Written out rather than inferred, because "which transitions are legal" is
 * the kind of question that gets answered differently in three places once it
 * is only implied by the code that performs them.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const OUTBOX_TRANSITIONS = Object.freeze({
  QUEUED: Object.freeze([OUTBOX_STATES.CLAIMED, OUTBOX_STATES.CANCELLED, OUTBOX_STATES.SUPPRESSED]),
  CLAIMED: Object.freeze([
    OUTBOX_STATES.SENT,
    OUTBOX_STATES.RETRY_SCHEDULED,
    OUTBOX_STATES.FAILED,
    OUTBOX_STATES.DEAD_LETTER,
    // A lapsed lease returns the row to the pool. Not a failure: nobody has
    // established that the send did not happen, only that this worker stopped
    // answering for it.
    OUTBOX_STATES.QUEUED,
  ]),
  RETRY_SCHEDULED: Object.freeze([
    OUTBOX_STATES.CLAIMED,
    OUTBOX_STATES.CANCELLED,
    OUTBOX_STATES.DEAD_LETTER,
  ]),
  // An operator may push a dead letter back into the queue once the cause is
  // fixed, or give up on it.
  DEAD_LETTER: Object.freeze([OUTBOX_STATES.QUEUED, OUTBOX_STATES.CANCELLED]),
  FAILED: Object.freeze([OUTBOX_STATES.QUEUED, OUTBOX_STATES.CANCELLED]),
  SENT: Object.freeze([]),
  CANCELLED: Object.freeze([]),
  SUPPRESSED: Object.freeze([]),
})

/** States from which no further work will be attempted without a human. */
export const TERMINAL_STATES = Object.freeze(
  new Set([OUTBOX_STATES.SENT, OUTBOX_STATES.CANCELLED, OUTBOX_STATES.SUPPRESSED]),
)

/** States a worker may pick up. */
export const CLAIMABLE_STATES = Object.freeze([OUTBOX_STATES.QUEUED, OUTBOX_STATES.RETRY_SCHEDULED])

/**
 * Whether one state may become another.
 *
 * @param {string} from The current state.
 * @param {string} to The proposed state.
 * @returns {boolean} True when the transition is in the table.
 */
export function canTransition(from, to) {
  return (OUTBOX_TRANSITIONS[from] ?? []).includes(to)
}

/**
 * Build the key that makes at-least-once delivery exactly-once.
 *
 * Deterministic, order-independent of anything but its four inputs, and
 * readable in a database client — an opaque hash would make a support question
 * ("did we email this person about that cancellation?") unanswerable without
 * writing a script.
 *
 * @param {object} parts The four dimensions.
 * @param {string} parts.businessEvent What happened, e.g. `event.cancelled:evt_123`.
 * @param {string} parts.recipient Who it goes to.
 * @param {string} parts.channel EMAIL, SMS or PUSH.
 * @param {number} [parts.templateVersion] The template revision. Defaults to 1.
 * @returns {string} The dedupe key.
 * @throws {TypeError} When a part is missing, so a key can never silently collapse.
 */
export function dedupeKeyFor({ businessEvent, recipient, channel, templateVersion = 1 }) {
  for (const [name, value] of Object.entries({ businessEvent, recipient, channel })) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(
        `A dedupe key needs a ${name}; without it two different messages would share one key and one of them would never be sent.`,
      )
    }
  }

  if (!Number.isInteger(templateVersion) || templateVersion < 1) {
    throw new TypeError(
      `A template version must be a positive integer; received ${templateVersion}.`,
    )
  }

  return [
    businessEvent.trim(),
    channel.trim().toUpperCase(),
    recipient.trim().toLowerCase(),
    `v${templateVersion}`,
  ].join('|')
}

/** Base delay before the first retry, in milliseconds. */
export const BASE_RETRY_DELAY_MS = 30_000

/** No retry is ever scheduled further out than this. */
export const MAX_RETRY_DELAY_MS = 60 * 60 * 1000

/**
 * How long to wait before attempt number `attempts + 1`.
 *
 * Exponential, capped, with bounded jitter. The jitter matters more than it
 * looks: without it, a provider outage that fails a thousand messages at once
 * schedules a thousand retries for the same instant, and the recovery attempt
 * is itself a thundering herd. The jitter is a *fraction* of the delay rather
 * than a fixed window, so it spreads proportionally at every scale.
 *
 * @param {number} attempts How many attempts have already been made.
 * @param {object} [options] Options.
 * @param {number} [options.baseMs] The first delay.
 * @param {number} [options.maxMs] The ceiling.
 * @param {number} [options.jitter] Fraction of the delay to spread over, 0 to 1.
 * @param {function(): number} [options.random] Source of randomness, injectable so a test is deterministic.
 * @returns {number} Milliseconds to wait, always at least 1.
 */
export function retryDelayMs(
  attempts,
  {
    baseMs = BASE_RETRY_DELAY_MS,
    maxMs = MAX_RETRY_DELAY_MS,
    jitter = 0.2,
    random = Math.random,
  } = {},
) {
  const safeAttempts = Number.isInteger(attempts) && attempts > 0 ? attempts : 1
  // Capped before the jitter is applied, so the ceiling is a real ceiling.
  const exponential = Math.min(baseMs * 2 ** (safeAttempts - 1), maxMs)
  const spread = exponential * jitter * (random() * 2 - 1)

  return Math.max(1, Math.round(exponential + spread))
}

/**
 * Decide what happens to a message after an attempt failed.
 *
 * The one place the retry policy lives. A caller passes what it knows — how
 * many attempts have been made, the ceiling, and how the failure was
 * classified — and gets back the next state and the instant to try again.
 *
 * A permanent failure goes straight to DEAD_LETTER rather than burning the
 * remaining attempts: a bounced address does not become deliverable by being
 * tried four more times, and the operator surface should show it now.
 *
 * @param {object} options Options.
 * @param {number} options.attempts Attempts made, including the one that just failed.
 * @param {number} options.maxAttempts The configured ceiling.
 * @param {string} options.category `PERMANENT` or `TRANSIENT`.
 * @param {Date} options.now The instant the attempt failed.
 * @param {object} [options.retry] Passed through to {@link retryDelayMs}.
 * @returns {{status: string, scheduledFor: Date|null, failureCategory: string}} What to write.
 */
export function afterFailure({ attempts, maxAttempts, category, now, retry = {} }) {
  const failureCategory =
    category === FAILURE_CATEGORIES.PERMANENT
      ? FAILURE_CATEGORIES.PERMANENT
      : FAILURE_CATEGORIES.TRANSIENT

  if (failureCategory === FAILURE_CATEGORIES.PERMANENT) {
    return { status: OUTBOX_STATES.DEAD_LETTER, scheduledFor: null, failureCategory }
  }

  if (attempts >= maxAttempts) {
    return { status: OUTBOX_STATES.DEAD_LETTER, scheduledFor: null, failureCategory }
  }

  return {
    status: OUTBOX_STATES.RETRY_SCHEDULED,
    scheduledFor: new Date(now.getTime() + retryDelayMs(attempts, retry)),
    failureCategory,
  }
}

/**
 * Whether a lease has lapsed, and the row is claimable again.
 *
 * @param {object} row An outbox row.
 * @param {Date} now The instant to judge against.
 * @returns {boolean} True when nobody is credibly working on it.
 */
export function leaseHasLapsed(row, now) {
  if (row?.status !== OUTBOX_STATES.CLAIMED) return false
  if (!row.leaseExpiresAt) return true

  return new Date(row.leaseExpiresAt).getTime() <= now.getTime()
}

/** How long a worker holds a claim before it may be taken from it. */
export const DEFAULT_LEASE_MS = 60_000

/**
 * The `where` clause that makes claiming safe.
 *
 * Returned as data rather than executed, so the same condition can be used by
 * the worker's conditional update and asserted directly in a test — a test that
 * rewrote the condition would prove only that the test agrees with itself.
 *
 * @param {Date} now The instant.
 * @returns {object} A Prisma `where` matching every claimable row.
 */
export function claimableWhere(now) {
  return {
    OR: [
      { status: { in: [...CLAIMABLE_STATES] }, scheduledFor: { lte: now } },
      // A lease nobody renewed. Reclaiming this is not a judgement that the
      // send failed — only that this worker stopped answering for it — and the
      // provider's own idempotency is what stops a double send.
      { status: OUTBOX_STATES.CLAIMED, leaseExpiresAt: { lte: now } },
    ],
  }
}

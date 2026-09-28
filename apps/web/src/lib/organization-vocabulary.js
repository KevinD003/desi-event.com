/**
 * The words the organisation and verification screens use.
 *
 * Pure and import-free, because client forms need them and a vocabulary
 * shipped to the browser must not drag the schemas barrel in behind it (see
 * `lib/browser-bundle.js`). The lists are written out; the test beside this
 * file holds them to the API's own lists so the two cannot drift.
 *
 * @module lib/organization-vocabulary
 */

/**
 * The time zones an organisation created here may run in, with the names
 * people use for them. The API accepts exactly these values.
 *
 * @type {ReadonlyArray<{value: string, label: string}>}
 */
export const US_TIMEZONE_OPTIONS = Object.freeze([
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain, no daylight saving (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
])

/**
 * Each verification state, in words, with the badge tone that fits it and
 * what it means for the organisation.
 *
 * @type {Readonly<Record<string, {label: string, tone: string, meaning: string}>>}
 */
export const VERIFICATION_STATUSES = Object.freeze({
  UNVERIFIED: {
    label: 'Unverified',
    tone: 'neutral',
    meaning:
      'Nobody has asked for a check yet. Events can be drafted, but not published or paid for.',
  },
  PENDING: {
    label: 'Waiting for a moderator',
    tone: 'info',
    meaning: 'A moderator will look at it. Events can be drafted meanwhile.',
  },
  REQUIRES_INFORMATION: {
    label: 'Needs more information',
    tone: 'warning',
    meaning: 'A moderator has asked for something. Answer below to put it back in the queue.',
  },
  VERIFIED: {
    label: 'Verified',
    tone: 'success',
    meaning: 'It may publish events and be paid.',
  },
  REJECTED: {
    label: 'Rejected',
    tone: 'danger',
    meaning: 'A moderator decided against it. It may ask again.',
  },
  SUSPENDED: {
    label: 'Suspended',
    tone: 'warning',
    meaning: 'Held by a moderator. It may not publish or be paid while the hold lasts.',
  },
  REVOKED: {
    label: 'Revoked',
    tone: 'danger',
    meaning: 'It was verified and no longer is. It may ask again.',
  },
})

/**
 * A verification state in words.
 *
 * @param {string} status The state.
 * @returns {{label: string, tone: string, meaning: string}} Its reading.
 */
export function verificationReading(status) {
  return (
    VERIFICATION_STATUSES[status] ?? { label: status, tone: 'neutral', meaning: 'Not recognised.' }
  )
}

/**
 * The states from which an organiser may ask to be checked — the organiser
 * edges of the API's transition table.
 *
 * @type {ReadonlyArray<string>}
 */
export const SUBMITTABLE_STATUSES = Object.freeze([
  'UNVERIFIED',
  'REQUIRES_INFORMATION',
  'REJECTED',
  'REVOKED',
])

/**
 * What a moderator may decide from each state — the moderator edges of the
 * API's transition table. The API checks again, inside the transaction.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const MODERATOR_DECISIONS = Object.freeze({
  UNVERIFIED: Object.freeze([]),
  PENDING: Object.freeze(['REQUIRES_INFORMATION', 'VERIFIED', 'REJECTED']),
  REQUIRES_INFORMATION: Object.freeze(['REJECTED']),
  VERIFIED: Object.freeze(['SUSPENDED', 'REVOKED']),
  SUSPENDED: Object.freeze(['VERIFIED', 'REVOKED']),
  REJECTED: Object.freeze([]),
  REVOKED: Object.freeze([]),
})

/**
 * Each decision as a moderator chooses it.
 *
 * @type {Readonly<Record<string, {label: string, consequence: string}>>}
 */
export const DECISIONS = Object.freeze({
  VERIFIED: {
    label: 'Verify',
    consequence: 'It may publish events and be paid, and its public page shows the badge.',
  },
  REQUIRES_INFORMATION: {
    label: 'Ask for more information',
    consequence: 'It goes back to the organiser with your note, and returns here when they answer.',
  },
  REJECTED: {
    label: 'Reject',
    consequence: 'It is not verified. The organiser may ask again.',
  },
  SUSPENDED: {
    label: 'Suspend',
    consequence: 'It may not publish or be paid until the hold is lifted.',
  },
  REVOKED: {
    label: 'Revoke',
    consequence: 'It is no longer verified. The organiser may ask again from the start.',
  },
})

/** The shortest and longest decision reason the API accepts. */
export const REASON_LIMITS = Object.freeze({ min: 3, max: 500 })

/** The longest note either side may write. */
export const NOTE_MAX = 1000

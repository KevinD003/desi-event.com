/**
 * The words the organiser invitation screens use, in one place.
 *
 * Pure, with no imports: the list page (a server component) and the invite
 * form and row actions (client components) all read it, so a status reads the
 * same in the table as in the sentence a row action announces. No capability
 * name appears here; who may open these screens is decided by the list
 * page (a server component), the area and the API.
 *
 * @module app/admin/organizer-invitations/organizer-invitation-vocabulary
 */

/** Where an organiser types their code, as a path: never with the code in it. */
export const JOIN_PATH = '/account/organizations/new'

/** How to reach that page, in words. */
export const JOIN_PLACE = 'Your account → Accept an organiser invitation'

/** How long a code works, as the API sets it. */
export const LIFETIME_DAYS = 14

/**
 * The status filters, in the order the screen offers them. `PENDING` is the
 * API's default and the screen's.
 *
 * @type {ReadonlyArray<{value: string, label: string}>}
 */
export const STATUS_FILTERS = Object.freeze([
  { value: 'PENDING', label: 'Waiting' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REVOKED', label: 'Withdrawn' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'ALL', label: 'All' },
])

/**
 * How each status reads.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_LABELS = Object.freeze({
  PENDING: 'Waiting',
  ACCEPTED: 'Accepted',
  REVOKED: 'Withdrawn',
  EXPIRED: 'Expired',
})

/**
 * The badge tone for each status: a word and a tone, never a colour alone.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const STATUS_TONES = Object.freeze({
  PENDING: 'info',
  ACCEPTED: 'success',
  REVOKED: 'neutral',
  EXPIRED: 'warning',
})

/**
 * How the code went out, per delivery mode.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DELIVERY_LABELS = Object.freeze({
  MANUAL: 'Shown once to whoever sent it',
  EMAIL: 'Emailed',
})

/**
 * What the screen says about how codes go out, per delivery mode. True in the
 * mode it names, and only there.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DELIVERY_LINES = Object.freeze({
  MANUAL:
    'Codes are not emailed from this site, so each code is shown to you once, with a message you can send from your own email. Hand it to them yourself.',
  EMAIL: 'Codes are emailed to the address you enter. You will not see them.',
})

/**
 * What a session that may not invite organisers is told. The administration area
 * also admits finance administrators, for booking fee refunds alone (SPEC3
 * §12.11), so this page asks its own question again, as every admin page does.
 */
export const NOT_FOR_THIS_ACCOUNT =
  'Organisers are invited by the Desi-Event team’s platform administrators and super administrators. Nothing on this page can grant it.'

/**
 * The refusals the organiser invitation routes give, by code, in the API's
 * words. The API's own sentence is shown when it sends one; these are what is
 * shown when it does not, and what the tests hold the screens to.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ORGANIZER_INVITATION_REFUSALS = Object.freeze({
  SELF_INVITATION:
    'You cannot invite your own address. Another platform administrator has to invite you.',
  STAFF_ACCOUNT:
    'That address belongs to a Desi-Event staff account. Organiser invitations are for people outside the team; a super administrator can add a staff account to an organisation directly from People and roles.',
  INVITATION_OUTSTANDING:
    'An invitation to that address is already waiting. Issue a new code for it, or withdraw it first.',
  NOT_OUTSTANDING:
    'This invitation has been accepted or withdrawn, so there is no code to replace. Invite them again instead.',
  DELIVERY_FAILED:
    'The email could not be sent, so the invitation was withdrawn and nothing reached them. Try again in a few minutes.',
})

/**
 * What an invitation is for, in a phrase. There is one kind: starting a new
 * organisation as its owner.
 *
 * @param {{organizationName?: string|null}} summary The invitation.
 * @returns {string} The phrase.
 */
export function invitationDescription(summary) {
  return `New organisation: ${summary?.organizationName ?? 'unnamed'}`
}

/**
 * Where an invitation stands, in a sentence with its date.
 *
 * @param {object} summary The invitation, as the list answers it.
 * @param {function(string|null|undefined): (string|null)} formatInstant How an instant is printed.
 * @returns {string} "Waiting until …", "Accepted on … by …", "Withdrawn on … by …" or "Expired on …".
 */
export function statusSentence(summary, formatInstant) {
  const at = (value) => formatInstant(value) ?? 'a date not recorded'
  const by = (name) => (name ? ` by ${name}` : '')

  switch (summary?.status) {
    case 'PENDING':
      return `Waiting until ${at(summary.expiresAt)}`
    case 'ACCEPTED':
      return `Accepted on ${at(summary.acceptedAt)}${by(summary.acceptedByName)}`
    case 'REVOKED':
      return `Withdrawn on ${at(summary.revokedAt)}${by(summary.revokedByName)}`
    case 'EXPIRED':
      return `Expired on ${at(summary.expiresAt)}`
    default:
      return 'Status not known'
  }
}

/**
 * Whether a row still has a code that can be withdrawn or replaced.
 *
 * @param {{status?: string}} summary The invitation.
 * @returns {{withdraw: boolean, reissue: boolean}} What the row offers.
 */
export function rowActions(summary) {
  return {
    withdraw: summary?.status === 'PENDING',
    reissue: summary?.status === 'PENDING' || summary?.status === 'EXPIRED',
  }
}

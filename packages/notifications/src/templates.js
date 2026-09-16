/**
 * The outbox's template names.
 *
 * One list, because three places need to agree about it: the domain code that
 * writes a row, the worker that renders one, and the operator surface that
 * groups them. A template named in only two of the three is a message that gets
 * queued and never sent, and the failure shows up as a dead letter hours later.
 *
 * The names are dotted rather than SCREAMING_CASE because they are also what an
 * operator reads in `NotificationOutbox.template` in a database client, and a
 * dotted name sorts into families there.
 *
 * @module @desi-event/notifications/templates
 */

/**
 * Every template the outbox may name.
 *
 * @type {ReadonlyArray<string>}
 */
export const OUTBOX_TEMPLATES = Object.freeze([
  'event.cancelled',
  'event.postponed',
  'event.changed',
  'ticket.issued',
  'ticket.transfer.invited',
  'ticket.transfer.completed',
  'ticket.revoked',
  'refund.settled',
  'security.alert',
])

/**
 * Templates a recipient's preferences may never suppress.
 *
 * Being told that the event you bought a ticket for is cancelled is not
 * marketing, and neither is being told that somebody changed your password. The
 * outbox carries `suppressible` per row; this is the list the writers use so
 * that the decision is made once rather than remembered at each call site.
 *
 * @type {ReadonlySet<string>}
 */
export const UNSUPPRESSIBLE_TEMPLATES = Object.freeze(
  new Set([
    'event.cancelled',
    'event.postponed',
    'event.changed',
    'ticket.revoked',
    'refund.settled',
    'security.alert',
  ]),
)

/**
 * Whether a template is one the outbox knows.
 *
 * @param {string} template The name to check.
 * @returns {boolean} True when it is in {@link OUTBOX_TEMPLATES}.
 */
export function isOutboxTemplate(template) {
  return OUTBOX_TEMPLATES.includes(template)
}

/**
 * Whether a recipient's preferences may suppress this template.
 *
 * @param {string} template The name to check.
 * @returns {boolean} True when the message is ordinary enough to be opted out of.
 */
export function isSuppressible(template) {
  return !UNSUPPRESSIBLE_TEMPLATES.has(template)
}

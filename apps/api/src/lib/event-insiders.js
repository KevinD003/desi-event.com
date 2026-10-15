/**
 * Who is on the inside of an event.
 *
 * One question, asked by several places: whether this caller may see what the
 * organiser has not announced — a draft event, a draft or hidden ticket type,
 * the online joining link, the organiser's website address and the website
 * link's switch. It lives here rather than in a route so a library (the
 * website link's) can ask it without importing a route module.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file lib/event-insiders
 */

import { CAPABILITIES, can } from '@desi-event/permissions'

/**
 * Whether this caller may see what the organiser has not announced.
 *
 * The same question twice over: whether an unpublished *event* resolves at all,
 * and whether an unpublished *ticket type* appears in the payload of one that
 * does. Both are "is this person on the inside", so both ask it here rather
 * than each growing its own version of the answer.
 *
 * @param {object} event The event row.
 * @param {object|null} actor The request actor.
 * @returns {boolean} True when the caller is staff or a member of the organisation.
 */
export function maySeeDrafts(event, actor) {
  return (
    can(actor, CAPABILITIES.MODERATION_REVIEW) ||
    can(actor, CAPABILITIES.PLATFORM_ADMIN) ||
    can(actor, CAPABILITIES.EVENT_VIEW_DRAFT, { organizationId: event.organizationId })
  )
}
